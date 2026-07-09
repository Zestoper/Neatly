from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect, HTTPException, Query, UploadFile, File
import os, uuid as _uuid
from dotenv import load_dotenv

load_dotenv()
_BACKEND_URL = os.environ.get("BACKEND_URL", "http://localhost:8000")

from sqlalchemy.orm import Session

from models import ChatRoom, ChatRoomMember, ChatMessage, ChatRoomRead, User, Friend

from routers.auth import get_current_user, get_db, SECRET_KEY, ALGORITHM

from pydantic import BaseModel

from datetime import datetime, timezone
from sqlalchemy import func, and_, or_

from jose import jwt, JWTError

from database import SessionLocal

router = APIRouter()

_CHAT_UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "..", "uploads", "chat")
os.makedirs(_CHAT_UPLOAD_DIR, exist_ok=True)
_ALLOWED_IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".gif", ".webp"}
_IMAGE_PREFIX = "__img__:"

class ConnectionManager:
    def __init__(self):

        self.rooms: dict[str, list[tuple[WebSocket, str, str]]] = {}

    async def connect(self, room_id: str, ws: WebSocket, user_id: str, user_name: str):
        await ws.accept()
        room = self.rooms.setdefault(room_id, [])

        for old_ws, uid, _ in [item for item in room if item[1] == user_id]:
            try:
                await old_ws.close()
            except Exception:
                pass
        self.rooms[room_id] = [item for item in room if item[1] != user_id]
        self.rooms[room_id].append((ws, user_id, user_name))

    def disconnect(self, room_id: str, ws: WebSocket):

        if room_id in self.rooms:

            self.rooms[room_id] = [item for item in self.rooms[room_id] if item[0] is not ws]

    async def broadcast(self, room_id: str, message: dict):

        for ws, _, _ in self.rooms.get(room_id, []):

            try:
                await ws.send_json(message)

            except Exception:

                pass

manager = ConnectionManager()

class PresenceManager:
    def __init__(self):

        self.connections: dict[str, tuple[WebSocket, str]] = {}

    async def connect(self, user_id: str, user_name: str, ws: WebSocket):
        await ws.accept()
        self.connections[user_id] = (ws, user_name)

        await self.broadcast({"type": "online", "user_id": user_id, "user_name": user_name})

    async def disconnect(self, user_id: str):
        if user_id in self.connections:
            del self.connections[user_id]

            await self.broadcast({"type": "offline", "user_id": user_id})

    async def broadcast(self, message: dict):

        for ws, _ in list(self.connections.values()):
            try:
                await ws.send_json(message)
            except Exception:
                pass

    def get_online_ids(self) -> list[str]:

        return list(self.connections.keys())

presence_manager = PresenceManager()

class RoomCreate(BaseModel):
    name: str
    document_id: str | None = None

class InviteBody(BaseModel):
    user_id: str

class DmBody(BaseModel):
    friend_id: str

def upsert_read(db: Session, room_id: str, user_id: str, at: datetime):

    row = db.query(ChatRoomRead).filter_by(room_id=room_id, user_id=user_id).first()
    if row:
        row.last_read_at = at
    else:
        db.add(ChatRoomRead(room_id=room_id, user_id=user_id, last_read_at=at))

def room_to_dict(room: ChatRoom, db: Session, current_user_id: str = None) -> dict:
    member_count = db.query(ChatRoomMember).filter(ChatRoomMember.room_id == room.id).count()
    last_msg = (
        db.query(ChatMessage)
        .filter(ChatMessage.room_id == room.id)
        .order_by(ChatMessage.created_at.desc())
        .first()
    )

    unread_count = 0
    if current_user_id:
        read_row = db.query(ChatRoomRead).filter_by(room_id=str(room.id), user_id=current_user_id).first()
        q = db.query(ChatMessage).filter(
            ChatMessage.room_id == room.id,
            ChatMessage.user_id != current_user_id,
        )
        if read_row:
            q = q.filter(ChatMessage.created_at > read_row.last_read_at)
        unread_count = q.count()

    return {
        "id": str(room.id),
        "name": room.name,
        "document_id": str(room.document_id) if room.document_id else None,
        "created_by": str(room.created_by),
        "member_count": member_count,
        "unread_count": unread_count,
        "last_message": "[이미지]" if last_msg and last_msg.content.startswith(_IMAGE_PREFIX) else (last_msg.content[:50] if last_msg else None),
        "last_message_at": (last_msg.created_at.isoformat() + "Z") if last_msg else (room.created_at.isoformat() + "Z"),
        "created_at": room.created_at.isoformat() + "Z",
    }

def msg_to_dict(msg: ChatMessage) -> dict:
    return {
        "id": str(msg.id),
        "user_id": str(msg.user_id),
        "user_name": msg.user_name,
        "content": msg.content,
        "created_at": msg.created_at.isoformat() + "Z",
    }

@router.post("/chat/dm")
async def get_or_create_dm(
    data: DmBody,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    my_id = str(current_user.id)
    friend_id = data.friend_id

    if db.query(Friend).filter_by(user_id=my_id, friend_id=friend_id, status="blocked").first():
        raise HTTPException(status_code=403, detail="차단한 사용자와는 대화할 수 없습니다.")
    if db.query(Friend).filter_by(user_id=friend_id, friend_id=my_id, status="blocked").first():
        raise HTTPException(status_code=403, detail="대화할 수 없는 사용자입니다.")

    my_room_ids = {m.room_id for m in db.query(ChatRoomMember).filter(ChatRoomMember.user_id == my_id).all()}
    friend_room_ids = {m.room_id for m in db.query(ChatRoomMember).filter(ChatRoomMember.user_id == friend_id).all()}
    shared_ids = my_room_ids & friend_room_ids

    for room_id in shared_ids:
        count = db.query(ChatRoomMember).filter(ChatRoomMember.room_id == room_id).count()
        if count == 2:
            room = db.query(ChatRoom).filter(ChatRoom.id == room_id).first()
            if room:
                return room_to_dict(room, db, my_id)

    friend = db.query(User).filter(User.id == friend_id).first()
    if not friend:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다.")

    room_name = f"{current_user.name or current_user.email}, {friend.name or friend.email}"
    room = ChatRoom(name=room_name, created_by=my_id)
    db.add(room)
    db.flush()
    db.add(ChatRoomMember(room_id=room.id, user_id=my_id))
    db.add(ChatRoomMember(room_id=room.id, user_id=friend_id))

    upsert_read(db, str(room.id), my_id, datetime.now(timezone.utc))
    db.commit()
    db.refresh(room)

    if friend_id in presence_manager.connections:
        p_ws, _ = presence_manager.connections[friend_id]
        try:
            await p_ws.send_json({"type": "room_invited", "room": room_to_dict(room, db, friend_id)})
        except Exception:
            pass

    return room_to_dict(room, db, my_id)

@router.post("/chat/rooms")
def create_room(
    data: RoomCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    room = ChatRoom(name=data.name, document_id=data.document_id, created_by=current_user.id)
    db.add(room)
    db.flush()
    db.add(ChatRoomMember(room_id=room.id, user_id=current_user.id))
    upsert_read(db, str(room.id), str(current_user.id), datetime.now(timezone.utc))
    db.commit()
    db.refresh(room)
    return room_to_dict(room, db, str(current_user.id))

@router.get("/chat/rooms")
def get_rooms(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    my_id = str(current_user.id)
    memberships = db.query(ChatRoomMember).filter(ChatRoomMember.user_id == my_id).all()
    room_ids = [m.room_id for m in memberships]

    if not room_ids:
        return []

    rooms = (
        db.query(ChatRoom)
        .filter(ChatRoom.id.in_(room_ids))
        .order_by(ChatRoom.created_at.desc())
        .all()
    )

    member_count_rows = (
        db.query(ChatRoomMember.room_id, func.count(ChatRoomMember.user_id).label("cnt"))
        .filter(ChatRoomMember.room_id.in_(room_ids))
        .group_by(ChatRoomMember.room_id)
        .all()
    )
    member_counts = {r.room_id: r.cnt for r in member_count_rows}

    last_ts_subq = (
        db.query(
            ChatMessage.room_id,
            func.max(ChatMessage.created_at).label("max_ts"),
        )
        .filter(ChatMessage.room_id.in_(room_ids))
        .group_by(ChatMessage.room_id)
        .subquery()
    )
    last_msgs = (
        db.query(ChatMessage)
        .join(
            last_ts_subq,
            and_(
                ChatMessage.room_id == last_ts_subq.c.room_id,
                ChatMessage.created_at == last_ts_subq.c.max_ts,
            ),
        )
        .all()
    )
    last_msg_map = {m.room_id: m for m in last_msgs}

    read_rows = (
        db.query(ChatRoomRead)
        .filter(ChatRoomRead.room_id.in_(room_ids), ChatRoomRead.user_id == my_id)
        .all()
    )
    read_map = {r.room_id: r for r in read_rows}

    unread_rows = (
        db.query(ChatMessage.room_id, func.count(ChatMessage.id).label("cnt"))
        .outerjoin(
            ChatRoomRead,
            and_(
                ChatRoomRead.room_id == ChatMessage.room_id,
                ChatRoomRead.user_id == my_id,
            ),
        )
        .filter(
            ChatMessage.room_id.in_(room_ids),
            ChatMessage.user_id != my_id,
            or_(
                ChatRoomRead.last_read_at == None,
                ChatMessage.created_at > ChatRoomRead.last_read_at,
            ),
        )
        .group_by(ChatMessage.room_id)
        .all()
    )
    unread_counts = {r.room_id: r.cnt for r in unread_rows}

    result = []
    for room in rooms:
        rid = room.id
        last_msg = last_msg_map.get(rid)
        result.append({
            "id": str(rid),
            "name": room.name,
            "document_id": str(room.document_id) if room.document_id else None,
            "created_by": str(room.created_by),
            "member_count": member_counts.get(rid, 0),
            "unread_count": unread_counts.get(rid, 0),
            "last_message": (
                "[이미지]" if last_msg and last_msg.content.startswith(_IMAGE_PREFIX)
                else (last_msg.content[:50] if last_msg else None)
            ),
            "last_message_at": (
                (last_msg.created_at.isoformat() + "Z") if last_msg
                else (room.created_at.isoformat() + "Z")
            ),
            "created_at": room.created_at.isoformat() + "Z",
        })
    return result

@router.post("/chat/rooms/{room_id}/join")
def join_room(
    room_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    room = db.query(ChatRoom).filter(ChatRoom.id == room_id).first()
    if not room:
        raise HTTPException(status_code=404, detail="채팅방을 찾을 수 없습니다.")

    existing = db.query(ChatRoomMember).filter(
        ChatRoomMember.room_id == room_id,
        ChatRoomMember.user_id == current_user.id,
    ).first()
    if not existing:
        db.add(ChatRoomMember(room_id=room_id, user_id=current_user.id))
        upsert_read(db, room_id, str(current_user.id), datetime.now(timezone.utc))
        db.commit()
    return room_to_dict(room, db, str(current_user.id))

@router.get("/chat/rooms/{room_id}/messages")
def get_messages(
    room_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):

    member = db.query(ChatRoomMember).filter(
        ChatRoomMember.room_id == room_id,
        ChatRoomMember.user_id == current_user.id,
    ).first()
    if not member:
        raise HTTPException(status_code=403, detail="채팅방 멤버가 아닙니다.")

    blocked_ids = {
        str(r.friend_id)
        for r in db.query(Friend).filter_by(user_id=str(current_user.id), status="blocked").all()
    }

    messages = (
        db.query(ChatMessage)
        .filter(ChatMessage.room_id == room_id)
        .order_by(ChatMessage.created_at)
        .all()
    )

    return [msg_to_dict(m) for m in messages if str(m.user_id) not in blocked_ids]

@router.post("/chat/rooms/{room_id}/invite")
async def invite_to_room(
    room_id: str,
    data: InviteBody,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):

    my_membership = db.query(ChatRoomMember).filter(
        ChatRoomMember.room_id == room_id,
        ChatRoomMember.user_id == current_user.id,
    ).first()
    if not my_membership:
        raise HTTPException(status_code=403, detail="채팅방 멤버만 초대할 수 있습니다.")

    target_user = db.query(User).filter(User.id == data.user_id).first()
    if not target_user:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다.")

    already = db.query(ChatRoomMember).filter(
        ChatRoomMember.room_id == room_id,
        ChatRoomMember.user_id == data.user_id,
    ).first()
    if already:
        raise HTTPException(status_code=400, detail="이미 채팅방 멤버입니다.")

    db.add(ChatRoomMember(room_id=room_id, user_id=data.user_id))
    db.commit()

    if data.user_id in presence_manager.connections:
        room = db.query(ChatRoom).filter(ChatRoom.id == room_id).first()
        if room:
            invited_ws, _ = presence_manager.connections[data.user_id]
            try:
                await invited_ws.send_json({
                    "type": "room_invited",
                    "room": room_to_dict(room, db, data.user_id),
                })
            except Exception:
                pass

    return {"ok": True}

@router.post("/chat/rooms/{room_id}/read")
async def mark_read(
    room_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    my_id = str(current_user.id)
    now = datetime.now(timezone.utc)
    upsert_read(db, room_id, my_id, now)
    db.commit()

    await manager.broadcast(room_id, {
        "type": "read",
        "user_id": my_id,
        "read_at": now.isoformat() + "Z",
    })
    return {"ok": True, "read_at": now.isoformat() + "Z"}

@router.get("/chat/rooms/{room_id}/read-status")
def get_read_status(
    room_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    members = db.query(ChatRoomMember).filter_by(room_id=room_id).all()
    if not any(str(m.user_id) == str(current_user.id) for m in members):
        raise HTTPException(status_code=403, detail="채팅방 멤버가 아닙니다.")

    read_map = {
        str(r.user_id): r.last_read_at.isoformat() + "Z"
        for r in db.query(ChatRoomRead).filter_by(room_id=room_id).all()
    }

    return {str(m.user_id): read_map.get(str(m.user_id)) for m in members}

@router.get("/chat/contacts")
def get_contacts(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):

    my_rooms = db.query(ChatRoomMember).filter(
        ChatRoomMember.user_id == current_user.id
    ).all()
    room_ids = [m.room_id for m in my_rooms]

    if not room_ids:
        return []

    other_members = db.query(ChatRoomMember).filter(
        ChatRoomMember.room_id.in_(room_ids),
        ChatRoomMember.user_id != current_user.id,
    ).all()

    seen: set[str] = set()
    contacts = []
    for m in other_members:
        if m.user_id in seen:
            continue
        seen.add(m.user_id)
        user = db.query(User).filter(User.id == m.user_id).first()
        if user:
            contacts.append({
                "id": str(user.id),
                "name": user.name or "",
                "email": user.email,
            })

    return contacts

@router.post("/chat/images")
async def upload_chat_image(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
):
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in _ALLOWED_IMAGE_EXTS:
        raise HTTPException(status_code=400, detail="지원하지 않는 파일 형식입니다. (jpg, png, gif, webp)")
    unique_name = f"{_uuid.uuid4()}{ext}"
    dest = os.path.join(_CHAT_UPLOAD_DIR, unique_name)
    data = await file.read()
    with open(dest, "wb") as f:
        f.write(data)
    return {"url": f"{_BACKEND_URL}/uploads/chat/{unique_name}"}

@router.delete("/chat/rooms/{room_id}/leave")
def leave_room(
    room_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    membership = db.query(ChatRoomMember).filter(
        ChatRoomMember.room_id == room_id,
        ChatRoomMember.user_id == current_user.id,
    ).first()
    if not membership:
        raise HTTPException(status_code=404, detail="참여 중인 채팅방이 아닙니다.")

    db.delete(membership)
    db.flush()

    remaining = db.query(ChatRoomMember).filter(ChatRoomMember.room_id == room_id).count()
    if remaining == 0:

        db.query(ChatMessage).filter(ChatMessage.room_id == room_id).delete()
        db.query(ChatRoom).filter(ChatRoom.id == room_id).delete()

    db.commit()
    return {"ok": True}

@router.websocket("/ws/presence")
async def websocket_presence(
    websocket: WebSocket,
    token: str = Query(...),
):
    db = SessionLocal()
    user = None
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = payload.get("sub")
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            await websocket.close(code=4001)
            return
    except JWTError:
        await websocket.close(code=4001)
        db.close()
        return
    finally:
        db.close()

    user_name = user.name or user.email
    await presence_manager.connect(user_id, user_name, websocket)

    await websocket.send_json({
        "type": "init",
        "online_ids": presence_manager.get_online_ids(),
    })

    try:

        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        await presence_manager.disconnect(user_id)

@router.websocket("/ws/chat/{room_id}")
async def websocket_chat(
    websocket: WebSocket,
    room_id: str,
    token: str = Query(...),

):

    db = SessionLocal()
    try:

        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = payload.get("sub")
        user = db.query(User).filter(User.id == user_id).first()
        if not user:

            await websocket.close(code=4001)
            return
    except JWTError:

        await websocket.close(code=4001)
        db.close()
        return

    member = db.query(ChatRoomMember).filter(
        ChatRoomMember.room_id == room_id,
        ChatRoomMember.user_id == user_id,
    ).first()
    if not member:
        await websocket.close(code=4003)
        db.close()
        return

    user_name = user.name or user.email

    await manager.connect(room_id, websocket, user_id, user_name)

    try:

        while True:
            data = await websocket.receive_json()

            content = data.get("content", "").strip()
            if not content:

                continue

            now = datetime.now(timezone.utc)
            msg = ChatMessage(room_id=room_id, user_id=user_id, user_name=user_name, content=content, created_at=now)
            db.add(msg)

            upsert_read(db, room_id, user_id, now)
            db.commit()
            db.refresh(msg)

            blocker_ids = {
                str(r.user_id)
                for r in db.query(Friend).filter_by(friend_id=user_id, status="blocked").all()
            }

            msg_payload = {
                "type": "message",
                "id": str(msg.id),
                "user_id": user_id,
                "user_name": user_name,
                "content": content,
                "created_at": msg.created_at.isoformat() + "Z",
            }
            for ws_conn, uid, _ in list(manager.rooms.get(room_id, [])):
                if uid not in blocker_ids:
                    try:
                        await ws_conn.send_json(msg_payload)
                    except Exception:
                        pass

            chat_connected_ids = {uid for _, uid, _ in manager.rooms.get(room_id, [])}
            all_members = db.query(ChatRoomMember).filter(ChatRoomMember.room_id == room_id).all()
            room_obj = db.query(ChatRoom).filter(ChatRoom.id == room_id).first()
            for m in all_members:
                mid = str(m.user_id)
                if mid in chat_connected_ids:
                    continue
                if mid in blocker_ids:
                    continue
                if mid in presence_manager.connections:
                    p_ws, _ = presence_manager.connections[mid]
                    try:
                        await p_ws.send_json({
                            "type": "new_message",
                            "room_id": room_id,
                            "room_name": room_obj.name if room_obj else "",
                            "sender": user_name,
                            "content": "[이미지]" if content.startswith(_IMAGE_PREFIX) else content[:50],
                        })
                    except Exception:
                        pass

    except WebSocketDisconnect:
        manager.disconnect(room_id, websocket)
    finally:

        db.close()

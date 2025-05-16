from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect, HTTPException, Query, UploadFile, File
import os, uuid as _uuid
from dotenv import load_dotenv

load_dotenv()
_BACKEND_URL = os.environ.get("BACKEND_URL", "http://localhost:8000")
# APIRouter : 이 파일의 엔드포인트를 묶는 라우터
# WebSocket : 실시간 양방향 통신을 담당하는 FastAPI 클래스
# WebSocketDisconnect : 클라이언트가 연결을 끊었을 때 발생하는 예외
# HTTPException : HTTP 에러를 반환할 때 사용 (예: 404, 403)
# Query : WebSocket 쿼리 파라미터(?token=...)를 받는 데 사용

from sqlalchemy.orm import Session
# Session : DB와 대화하는 세션 객체 — 쿼리, 삽입, 커밋 등을 이 객체로 수행

from models import ChatRoom, ChatRoomMember, ChatMessage, ChatRoomRead, User, Friend
# 이 파일에서 사용할 DB 테이블(모델)들을 가져옴

from routers.auth import get_current_user, get_db, SECRET_KEY, ALGORITHM
# get_current_user : JWT 토큰으로 로그인한 사용자를 확인하는 함수
# get_db : DB 세션을 생성해서 주입하는 함수
# SECRET_KEY / ALGORITHM : JWT 토큰 검증에 필요한 비밀 키와 알고리즘 (auth.py에서 가져옴)

from pydantic import BaseModel
# BaseModel : 요청 바디(body)의 데이터 형식을 정의하는 기반 클래스

from datetime import datetime
# datetime : 메시지 생성 시각 등 날짜·시간 처리에 사용

from jose import jwt, JWTError
# jose.jwt : JWT 토큰을 디코딩(해석)하는 라이브러리
# JWTError : 토큰이 유효하지 않을 때 발생하는 예외

from database import SessionLocal
# SessionLocal : DB 세션을 직접 생성할 때 사용
# WebSocket 엔드포인트는 Depends(get_db)가 아닌 직접 생성 방식을 사용함

router = APIRouter()

_CHAT_UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "..", "uploads", "chat")
os.makedirs(_CHAT_UPLOAD_DIR, exist_ok=True)
_ALLOWED_IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".gif", ".webp"}
_IMAGE_PREFIX = "__img__:"


# ─────────────────────────────────────────────
# ConnectionManager : WebSocket 연결 목록을 관리하는 클래스
# ─────────────────────────────────────────────
class ConnectionManager:
    def __init__(self):
        # rooms : 채팅방 ID를 키로, 연결된 (WebSocket, user_id, user_name) 튜플 목록을 값으로 가지는 딕셔너리
        # 예: { "room-uuid": [(ws1, "user1", "홍길동"), (ws2, "user2", "김철수")] }
        self.rooms: dict[str, list[tuple[WebSocket, str, str]]] = {}

    async def connect(self, room_id: str, ws: WebSocket, user_id: str, user_name: str):
        # WebSocket 연결을 수락하고 해당 방의 목록에 추가
        await ws.accept()
        # setdefault : room_id 키가 없으면 빈 리스트로 초기화 후 반환
        self.rooms.setdefault(room_id, []).append((ws, user_id, user_name))

    def disconnect(self, room_id: str, ws: WebSocket):
        # 특정 WebSocket을 해당 방의 목록에서 제거 (연결 끊김 시 호출)
        if room_id in self.rooms:
            # is not ws : 같은 WebSocket 객체인지 참조(주소)로 비교
            self.rooms[room_id] = [item for item in self.rooms[room_id] if item[0] is not ws]

    async def broadcast(self, room_id: str, message: dict):
        # 해당 방의 모든 연결된 클라이언트에게 메시지를 전송
        for ws, _, _ in self.rooms.get(room_id, []):
            # _ : 튜플의 user_id, user_name은 여기선 필요 없어서 _ 로 무시
            try:
                await ws.send_json(message)
                # send_json : dict를 JSON 문자열로 변환해서 WebSocket으로 전송
            except Exception:
                # 전송 실패한 연결은 조용히 무시 (이미 끊겼을 수 있음)
                pass


# 앱 전체에서 공유하는 ConnectionManager 인스턴스 — 모듈 수준에서 한 번만 생성
manager = ConnectionManager()


# ─────────────────────────────────────────────
# PresenceManager : 온라인 상태를 추적하는 클래스
# 채팅방 WebSocket과 별개로, "지금 접속 중인 사용자" 목록을 관리
# ─────────────────────────────────────────────
class PresenceManager:
    def __init__(self):
        # connections : { user_id: (WebSocket, user_name) }
        # 접속 중인 사용자마다 연결을 하나씩 유지
        self.connections: dict[str, tuple[WebSocket, str]] = {}

    async def connect(self, user_id: str, user_name: str, ws: WebSocket):
        await ws.accept()
        self.connections[user_id] = (ws, user_name)
        # 새 사람이 온라인이 됐다는 걸 모든 접속자에게 알림
        await self.broadcast({"type": "online", "user_id": user_id, "user_name": user_name})

    async def disconnect(self, user_id: str):
        if user_id in self.connections:
            del self.connections[user_id]
            # 오프라인이 됐다는 걸 남은 접속자들에게 알림
            await self.broadcast({"type": "offline", "user_id": user_id})

    async def broadcast(self, message: dict):
        # 현재 접속 중인 모든 사람에게 메시지 전송
        for ws, _ in list(self.connections.values()):
            try:
                await ws.send_json(message)
            except Exception:
                pass

    def get_online_ids(self) -> list[str]:
        # 현재 온라인인 user_id 목록 반환
        return list(self.connections.keys())


# 앱 전체에서 공유하는 PresenceManager 인스턴스
presence_manager = PresenceManager()


# ─────────────────────────────────────────────
# 요청 바디 스키마
# ─────────────────────────────────────────────
class RoomCreate(BaseModel):
    name: str              # 채팅방 이름 (필수)
    document_id: str | None = None  # 연결할 문서 ID (선택 — 없으면 null)


class InviteBody(BaseModel):
    user_id: str  # 초대할 사용자의 ID


class DmBody(BaseModel):
    friend_id: str  # DM 상대방 사용자 ID


# ─────────────────────────────────────────────
# 헬퍼 함수 : DB 객체 → 딕셔너리 변환
# ─────────────────────────────────────────────
def upsert_read(db: Session, room_id: str, user_id: str, at: datetime):
    # ChatRoomRead upsert — 이미 있으면 갱신, 없으면 삽입
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

    # unread_count : 내가 마지막으로 읽은 시각 이후에 온 메시지 수 (내 메시지 제외)
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
        "created_at": msg.created_at.isoformat() + "Z",  # "Z" 붙여야 JS가 UTC로 인식
    }


# ─────────────────────────────────────────────
# POST /chat/dm — 1:1 DM 방 찾기 또는 생성
# 두 유저가 함께 있는 2인 방이 이미 있으면 반환, 없으면 새로 만들어 반환
# ─────────────────────────────────────────────
@router.post("/chat/dm")
async def get_or_create_dm(
    data: DmBody,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    my_id = str(current_user.id)
    friend_id = data.friend_id

    # 차단 관계 확인 — 내가 상대를 차단했거나, 상대가 나를 차단한 경우 거부
    if db.query(Friend).filter_by(user_id=my_id, friend_id=friend_id, status="blocked").first():
        raise HTTPException(status_code=403, detail="차단한 사용자와는 대화할 수 없습니다.")
    if db.query(Friend).filter_by(user_id=friend_id, friend_id=my_id, status="blocked").first():
        raise HTTPException(status_code=403, detail="대화할 수 없는 사용자입니다.")

    # 나와 상대방이 공통으로 속한 방 ID 집합 계산
    my_room_ids = {m.room_id for m in db.query(ChatRoomMember).filter(ChatRoomMember.user_id == my_id).all()}
    friend_room_ids = {m.room_id for m in db.query(ChatRoomMember).filter(ChatRoomMember.user_id == friend_id).all()}
    shared_ids = my_room_ids & friend_room_ids

    # 공통 방 중 멤버가 정확히 2명인 방 = 기존 1:1 DM 방
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
    # 방 생성자는 지금 읽음 처리 (자기가 만든 방이므로 unread=0)
    upsert_read(db, str(room.id), my_id, datetime.utcnow())
    db.commit()
    db.refresh(room)

    if friend_id in presence_manager.connections:
        p_ws, _ = presence_manager.connections[friend_id]
        try:
            await p_ws.send_json({"type": "room_invited", "room": room_to_dict(room, db, friend_id)})
        except Exception:
            pass

    return room_to_dict(room, db, my_id)


# ─────────────────────────────────────────────
# POST /chat/rooms — 새 채팅방 생성
# ─────────────────────────────────────────────
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
    upsert_read(db, str(room.id), str(current_user.id), datetime.utcnow())
    db.commit()
    db.refresh(room)
    return room_to_dict(room, db, str(current_user.id))


# ─────────────────────────────────────────────
# GET /chat/rooms — 내가 참여 중인 채팅방 목록
# ─────────────────────────────────────────────
@router.get("/chat/rooms")
def get_rooms(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    my_id = str(current_user.id)
    memberships = db.query(ChatRoomMember).filter(ChatRoomMember.user_id == my_id).all()
    room_ids = [m.room_id for m in memberships]
    rooms = (
        db.query(ChatRoom)
        .filter(ChatRoom.id.in_(room_ids))
        .order_by(ChatRoom.created_at.desc())
        .all()
    )
    return [room_to_dict(r, db, my_id) for r in rooms]


# ─────────────────────────────────────────────
# POST /chat/rooms/{room_id}/join — 방 ID로 채팅방 참여
# ─────────────────────────────────────────────
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
        upsert_read(db, room_id, str(current_user.id), datetime.utcnow())
        db.commit()
    return room_to_dict(room, db, str(current_user.id))


# ─────────────────────────────────────────────
# GET /chat/rooms/{room_id}/messages — 채팅 기록 조회
# ─────────────────────────────────────────────
@router.get("/chat/rooms/{room_id}/messages")
def get_messages(
    room_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # 멤버만 메시지를 볼 수 있음
    member = db.query(ChatRoomMember).filter(
        ChatRoomMember.room_id == room_id,
        ChatRoomMember.user_id == current_user.id,
    ).first()
    if not member:
        raise HTTPException(status_code=403, detail="채팅방 멤버가 아닙니다.")

    # 내가 차단한 유저 ID 집합
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
    # 차단한 유저의 메시지는 응답에서 제외
    return [msg_to_dict(m) for m in messages if str(m.user_id) not in blocked_ids]


# ─────────────────────────────────────────────
# POST /chat/rooms/{room_id}/invite — 다른 사용자를 채팅방에 초대
# 초대하는 사람은 반드시 해당 방의 멤버여야 함
# ─────────────────────────────────────────────
@router.post("/chat/rooms/{room_id}/invite")
async def invite_to_room(
    room_id: str,
    data: InviteBody,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # 초대자가 해당 방의 멤버인지 확인
    my_membership = db.query(ChatRoomMember).filter(
        ChatRoomMember.room_id == room_id,
        ChatRoomMember.user_id == current_user.id,
    ).first()
    if not my_membership:
        raise HTTPException(status_code=403, detail="채팅방 멤버만 초대할 수 있습니다.")

    # 초대할 사용자가 존재하는지 확인
    target_user = db.query(User).filter(User.id == data.user_id).first()
    if not target_user:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다.")

    # 이미 멤버인지 확인 — 중복 추가 방지
    already = db.query(ChatRoomMember).filter(
        ChatRoomMember.room_id == room_id,
        ChatRoomMember.user_id == data.user_id,
    ).first()
    if already:
        raise HTTPException(status_code=400, detail="이미 채팅방 멤버입니다.")

    # 멤버로 추가
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


# ─────────────────────────────────────────────
# POST /chat/rooms/{room_id}/read — 채팅방 읽음 처리
# 호출 시 last_read_at = now 로 갱신하고, 방의 모든 연결된 멤버에게 read 이벤트 브로드캐스트
# ─────────────────────────────────────────────
@router.post("/chat/rooms/{room_id}/read")
async def mark_read(
    room_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    my_id = str(current_user.id)
    now = datetime.utcnow()
    upsert_read(db, room_id, my_id, now)
    db.commit()

    # 방에 있는 모든 사람에게 "이 사람이 여기까지 읽었다"는 이벤트 전송
    # — 이걸 받으면 상대방은 자신이 보낸 메시지의 "1"을 지울 수 있음
    await manager.broadcast(room_id, {
        "type": "read",
        "user_id": my_id,
        "read_at": now.isoformat() + "Z",
    })
    return {"ok": True, "read_at": now.isoformat() + "Z"}


# ─────────────────────────────────────────────
# GET /chat/rooms/{room_id}/read-status — 방 멤버 전체의 읽음 시각 조회
# 메시지 버블 옆에 "1" 표시 계산에 사용
# ─────────────────────────────────────────────
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
    # 한 번도 안 읽은 멤버는 None으로 포함
    return {str(m.user_id): read_map.get(str(m.user_id)) for m in members}


# ─────────────────────────────────────────────
# GET /chat/contacts — 내가 참여한 채팅방에 있는 다른 사용자 목록 (중복 제거)
# 채팅 모달 "친구" 탭에서 대화 상대를 보여주는 데 사용
# ─────────────────────────────────────────────
@router.get("/chat/contacts")
def get_contacts(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # 내가 속한 방 ID 목록
    my_rooms = db.query(ChatRoomMember).filter(
        ChatRoomMember.user_id == current_user.id
    ).all()
    room_ids = [m.room_id for m in my_rooms]

    if not room_ids:
        return []

    # 같은 방에 있는 나 이외의 멤버 — 여러 방에 있어도 중복 제거
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


# ─────────────────────────────────────────────
# POST /chat/images — 채팅 이미지 업로드
# 허용 형식: jpg, jpeg, png, gif, webp / 멤버 인증 필요
# ─────────────────────────────────────────────
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


# ─────────────────────────────────────────────
# DELETE /chat/rooms/{room_id}/leave — 채팅방 나가기
# 나만 멤버에서 제거. 멤버가 0명이 되면 방과 메시지도 함께 삭제
# ─────────────────────────────────────────────
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
        # 아무도 없는 방은 메시지와 함께 삭제
        db.query(ChatMessage).filter(ChatMessage.room_id == room_id).delete()
        db.query(ChatRoom).filter(ChatRoom.id == room_id).delete()

    db.commit()
    return {"ok": True}


# ─────────────────────────────────────────────
# WebSocket /ws/presence?token= — 실시간 온라인 상태 추적
# 연결하면 현재 온라인 사용자 목록을 받고, 이후 변화가 생길 때마다 알림을 받음
# ─────────────────────────────────────────────
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

    # 연결 직후 현재 온라인 목록 전송 — 화면을 처음 열었을 때 즉시 반영
    await websocket.send_json({
        "type": "init",
        "online_ids": presence_manager.get_online_ids(),
    })

    try:
        # 클라이언트는 메시지를 보낼 필요 없음 — 연결 유지만 하면 됨
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        await presence_manager.disconnect(user_id)


@router.websocket("/ws/chat/{room_id}")
async def websocket_chat(
    websocket: WebSocket,
    room_id: str,
    token: str = Query(...),  # URL 쿼리 파라미터로 토큰을 받음 (?token=eyJ...)
    # WebSocket은 HTTP 헤더를 사용하기 어려워서 쿼리 파라미터로 토큰을 전달하는 것이 일반적
):
    # WebSocket은 Depends(get_db)가 제대로 동작하지 않을 수 있어서 직접 세션 생성
    db = SessionLocal()
    try:
        # JWT 토큰 디코딩 — 사용자 ID(sub) 추출
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = payload.get("sub")  # sub : 토큰에 담긴 사용자 ID
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            # 사용자를 찾을 수 없으면 4001 코드로 연결 거부
            await websocket.close(code=4001)
            return
    except JWTError:
        # 토큰이 위조되었거나 만료된 경우
        await websocket.close(code=4001)
        db.close()
        return

    # 이 방의 멤버인지 확인 — 멤버가 아니면 접속 거부
    member = db.query(ChatRoomMember).filter(
        ChatRoomMember.room_id == room_id,
        ChatRoomMember.user_id == user_id,
    ).first()
    if not member:
        await websocket.close(code=4003)  # 4003 : 권한 없음
        db.close()
        return

    # 이름이 없으면 이메일을 표시 이름으로 사용
    user_name = user.name or user.email

    # ConnectionManager에 이 WebSocket을 등록하고 연결 수락
    await manager.connect(room_id, websocket, user_id, user_name)

    # 입장 알림 생략 — 카카오톡처럼 시스템 메시지 없이 조용히 연결

    try:
        # 메시지 수신 루프 — 연결이 끊길 때까지 계속 대기
        while True:
            data = await websocket.receive_json()
            # receive_json : 클라이언트가 보낸 JSON을 받아서 파이썬 딕셔너리로 변환

            content = data.get("content", "").strip()
            if not content:
                # 빈 메시지는 무시
                continue

            # 메시지를 DB에 저장
            now = datetime.utcnow()
            msg = ChatMessage(room_id=room_id, user_id=user_id, user_name=user_name, content=content, created_at=now)
            db.add(msg)
            # 보낸 사람의 읽음 시각도 함께 갱신 — 자기가 보낸 메시지는 항상 읽은 것
            upsert_read(db, room_id, user_id, now)
            db.commit()
            db.refresh(msg)

            # 발신자를 차단한 유저 ID 집합 — 그 사람들에게는 메시지를 전달하지 않음
            blocker_ids = {
                str(r.user_id)
                for r in db.query(Friend).filter_by(friend_id=user_id, status="blocked").all()
            }

            # 채팅 WS로 브로드캐스트 (차단한 사람 제외)
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

            # 채팅 WS에 연결되지 않은 멤버에게 presence WS로 알림 전송
            # — 모달을 닫아 놓거나 다른 방에 있는 멤버도 뱃지·브라우저 알림을 받음
            chat_connected_ids = {uid for _, uid, _ in manager.rooms.get(room_id, [])}
            all_members = db.query(ChatRoomMember).filter(ChatRoomMember.room_id == room_id).all()
            room_obj = db.query(ChatRoom).filter(ChatRoom.id == room_id).first()
            for m in all_members:
                mid = str(m.user_id)
                if mid in chat_connected_ids:
                    continue  # 이미 채팅 WS로 메시지를 받았으므로 스킵
                if mid in blocker_ids:
                    continue  # 발신자를 차단한 사람에게는 알림도 안 보냄
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
        # 예외가 발생하든 정상 종료하든 반드시 DB 세션을 닫음
        db.close()

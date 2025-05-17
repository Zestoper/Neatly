from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from models import Friend, User
from routers.auth import get_current_user, get_db

router = APIRouter()

FriendStatus = str  # 'active' | 'hidden' | 'blocked'
VALID_STATUSES = {"active", "hidden", "blocked"}


class FriendBody(BaseModel):
    friend_id: str


class StatusBody(BaseModel):
    status: str  # 'active' | 'hidden' | 'blocked'


def _user_to_dict(user: User, status: FriendStatus) -> dict:
    return {
        "id": str(user.id),
        "name": user.name or "",
        "email": user.email,
        "status": status,
    }


# GET /friends — 내 친구 목록 (active + hidden + blocked 모두 반환, 프론트에서 필터)
@router.get("/friends")
def get_friends(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    rows = (
        db.query(Friend, User)
        .join(User, Friend.friend_id == User.id)
        .filter(Friend.user_id == str(current_user.id))
        .all()
    )
    return [_user_to_dict(user, friend.status or "active") for friend, user in rows]


# POST /friends — 친구 추가 (양방향 저장)
@router.post("/friends")
def add_friend(
    data: FriendBody,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    my_id = str(current_user.id)

    if data.friend_id == my_id:
        raise HTTPException(status_code=400, detail="자기 자신을 추가할 수 없습니다.")

    target = db.query(User).filter(User.id == data.friend_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다.")

    already = db.query(Friend).filter_by(user_id=my_id, friend_id=data.friend_id).first()
    if already:
        # 차단/숨김 상태였다면 active로 복구
        if already.status != "active":
            already.status = "active"
            db.commit()
        raise HTTPException(status_code=400, detail="이미 친구입니다.")

    db.add(Friend(user_id=my_id, friend_id=data.friend_id, status="active"))
    # 상대방 목록에 없으면 추가 (이미 있으면 냅둠)
    reverse = db.query(Friend).filter_by(user_id=data.friend_id, friend_id=my_id).first()
    if not reverse:
        db.add(Friend(user_id=data.friend_id, friend_id=my_id, status="active"))
    try:
        db.commit()
    except Exception:
        db.rollback()
        raise HTTPException(status_code=500, detail="친구 추가에 실패했습니다.")

    return _user_to_dict(target, "active")


# PATCH /friends/{friend_id} — 친구 상태 변경 (숨김/차단/복구)
@router.patch("/friends/{friend_id}")
def update_friend_status(
    friend_id: str,
    data: StatusBody,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    my_id = str(current_user.id)

    if data.status not in VALID_STATUSES:
        raise HTTPException(status_code=400, detail="유효하지 않은 상태입니다.")

    row = db.query(Friend).filter_by(user_id=my_id, friend_id=friend_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="친구 관계가 없습니다.")

    row.status = data.status
    db.commit()
    return {"ok": True, "status": data.status}


# DELETE /friends/{friend_id} — 친구 삭제 (양방향 제거)
@router.delete("/friends/{friend_id}")
def remove_friend(
    friend_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    my_id = str(current_user.id)
    db.query(Friend).filter_by(user_id=my_id, friend_id=friend_id).delete()
    db.query(Friend).filter_by(user_id=friend_id, friend_id=my_id).delete()
    db.commit()
    return {"ok": True}

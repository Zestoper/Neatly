from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from models import EmailFilter, User
from routers.auth import get_current_user, get_db

router = APIRouter()


class EmailFilterCreate(BaseModel):
    sender: str            # sender : 발신자 이메일 주소 (아이디)
    name: Optional[str] = None  # name : 발신자 이름 (선택)


# GET /email-filters — 내 필터 목록 반환
@router.get("/email-filters")
def get_email_filters(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return db.query(EmailFilter).filter(
        EmailFilter.user_id == current_user.id
    ).order_by(EmailFilter.created_at).all()


# POST /email-filters — 필터 추가 (같은 sender가 이미 있으면 기존 것 반환)
@router.post("/email-filters")
def create_email_filter(
    data: EmailFilterCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.plan != "PREMIUM":
        raise HTTPException(status_code=403, detail="Premium 플랜 전용 기능입니다.")

    sender = data.sender.strip()
    if not sender:
        raise HTTPException(status_code=400, detail="이메일 주소를 입력해주세요.")

    # 같은 sender가 이미 있으면 name만 업데이트 후 반환
    existing = db.query(EmailFilter).filter(
        EmailFilter.user_id == current_user.id,
        EmailFilter.sender == sender,
    ).first()
    if existing:
        if data.name:
            existing.name = data.name.strip() or None
            db.commit()
            db.refresh(existing)
        return existing

    f = EmailFilter(
        user_id=current_user.id,
        sender=sender,
        name=data.name.strip() if data.name else None,
    )
    db.add(f)
    db.commit()
    db.refresh(f)
    return f


# DELETE /email-filters/{filter_id} — 필터 삭제
@router.delete("/email-filters/{filter_id}")
def delete_email_filter(
    filter_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    f = db.query(EmailFilter).filter(
        EmailFilter.id == filter_id,
        EmailFilter.user_id == current_user.id,  # 본인 필터만 삭제 가능
    ).first()
    if not f:
        raise HTTPException(status_code=404, detail="필터를 찾을 수 없습니다.")

    db.delete(f)
    db.commit()
    return {"message": "삭제되었습니다."}

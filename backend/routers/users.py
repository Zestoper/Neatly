from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session
from sqlalchemy import or_
import bcrypt
from database import SessionLocal
from models import User
from typing import Optional
from routers.auth import get_current_user, get_db

router = APIRouter()

class UserCreate(BaseModel):
    email: EmailStr
    password: str
    name: str
    phone: Optional[str] = None
    birth_date: Optional[str] = None

def hash_password(plain_password: str) -> str:
    return bcrypt.hashpw(plain_password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

class UserUpdate(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    birth_date: Optional[str] = None
    plan: Optional[str] = None

@router.patch("/users/me")
def update_me(
    data: UserUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)

):
    VALID_PLANS = {"FREE", "STANDARD", "PREMIUM"}

    if data.name is not None:
        current_user.name = data.name
    if data.phone is not None:
        current_user.phone = data.phone
    if data.birth_date is not None:
        current_user.birth_date = data.birth_date
    if data.plan is not None:
        if data.plan not in VALID_PLANS:

            raise HTTPException(status_code=400, detail="유효하지 않은 플랜입니다.")
        current_user.plan = data.plan

    db.commit()
    db.refresh(current_user)

    return {
        "id": str(current_user.id),
        "email": current_user.email,
        "name": current_user.name,
        "phone": current_user.phone,
        "birth_date": current_user.birth_date,
        "plan": current_user.plan,
    }

@router.get("/users/search")
def search_users(
    q: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not q.strip():
        return []
    results = (
        db.query(User)
        .filter(
            or_(
                User.name.ilike(f"%{q}%"),
                User.email.ilike(f"%{q}%"),
            ),
            User.id != current_user.id,
        )
        .limit(10)
        .all()
    )
    return [
        {"id": str(u.id), "name": u.name or "", "email": u.email}
        for u in results
    ]

@router.post("/register")
def register(user: UserCreate, db: Session = Depends(get_db)):
    if len(user.password) < 8:
        raise HTTPException(status_code=400, detail="비밀번호는 8자 이상이어야 합니다.")
    if db.query(User).filter(User.email == user.email).first():
        raise HTTPException(status_code=400, detail="이미 존재하는 이메일입니다.")

    hashed_pw = hash_password(user.password)
    new_user = User(
        email=user.email,
        password_hash=hashed_pw,
        name=user.name,
        phone=user.phone,
        birth_date=user.birth_date,
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return {"id": str(new_user.id), "email": new_user.email}

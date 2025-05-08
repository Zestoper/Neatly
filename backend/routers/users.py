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

# UserCreate : 회원가입 요청 바디 형식
class UserCreate(BaseModel):
    email: EmailStr
    password: str
    name: str                    # name : 사용자 이름 (필수)
    phone: Optional[str] = None  # phone : 전화번호 (선택)
    birth_date: Optional[str] = None  # birth_date : 생년월일 YYYY-MM-DD (선택)

def hash_password(plain_password: str) -> str:
    return bcrypt.hashpw(plain_password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')


# UserUpdate : 프로필 수정 요청 바디 형식 (모두 선택값)
class UserUpdate(BaseModel):
    name: Optional[str] = None        # name : 변경할 이름, 안 보내면 그대로 유지
    phone: Optional[str] = None       # phone : 변경할 전화번호
    birth_date: Optional[str] = None  # birth_date : 변경할 생년월일 YYYY-MM-DD
    plan: Optional[str] = None        # plan : 변경할 플랜 "FREE" | "STANDARD" | "PREMIUM"


# PATCH /users/me — 로그인한 사용자의 프로필 + 플랜 수정
@router.patch("/users/me")
def update_me(
    data: UserUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
    # current_user : 토큰으로 인증된 현재 사용자 — 다른 사람 정보를 수정하는 건 불가능
):
    VALID_PLANS = {"FREE", "STANDARD", "PREMIUM"}
    # VALID_PLANS : 허용된 플랜 값 집합 — set을 쓰면 in 검사가 list보다 빠름

    # 각 필드는 None이 아닐 때만 덮어씀 — 보내지 않은 필드는 기존 값 유지
    if data.name is not None:
        current_user.name = data.name
    if data.phone is not None:
        current_user.phone = data.phone
    if data.birth_date is not None:
        current_user.birth_date = data.birth_date
    if data.plan is not None:
        if data.plan not in VALID_PLANS:
            # 허용되지 않은 플랜 값이 들어오면 400으로 거부
            raise HTTPException(status_code=400, detail="유효하지 않은 플랜입니다.")
        current_user.plan = data.plan

    db.commit()        # 변경사항 DB에 저장
    db.refresh(current_user)  # 저장 후 최신 상태를 current_user에 반영

    return {
        "id": str(current_user.id),
        "email": current_user.email,
        "name": current_user.name,
        "phone": current_user.phone,
        "birth_date": current_user.birth_date,
        "plan": current_user.plan,  # plan : 변경된 플랜 값 — 프론트에서 localStorage 업데이트에 사용
    }


# GET /users/search?q= — 이름 또는 이메일로 다른 사용자 검색 (자기 자신 제외)
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
                User.name.ilike(f"%{q}%"),   # ilike : 대소문자 구분 없는 부분 일치
                User.email.ilike(f"%{q}%"),
            ),
            User.id != current_user.id,       # 자기 자신은 결과에서 제외
        )
        .limit(10)
        .all()
    )
    return [
        {"id": str(u.id), "name": u.name or "", "email": u.email}
        for u in results
    ]


# POST /register — 이메일 중복 확인 후 신규 사용자 등록
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

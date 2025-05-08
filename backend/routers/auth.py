from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session
from jose import jwt, JWTError
import bcrypt
import os
from dotenv import load_dotenv
from database import SessionLocal
from models import User
from datetime import datetime, timedelta
from fastapi.security import OAuth2PasswordBearer

load_dotenv()

# tokenUrl="login" : 토큰을 발급받는 엔드포인트 경로 (Swagger UI에 표시됨)
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="login")

router = APIRouter()

SECRET_KEY = os.environ["SECRET_KEY"]
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24  # 1일

# LoginRequest : 로그인 요청 바디 형식
class LoginRequest(BaseModel):
    email: EmailStr # EmailStr : @가 없으면 자동으로 422 에러 반환
    password: str


def get_db():
    db = SessionLocal() # db : 요청마다 새로 생성하는 DB 세션
    try:
        yield db
    finally:
        db.close()


def verify_password(plain_password, hashed_password):
    # checkpw : 평문을 해시와 비교 — bcrypt 내부에서 처리하므로 직접 해시하지 않음
    return bcrypt.checkpw(
        plain_password.encode("utf-8"),  # encode : 문자열을 바이트로 변환
        hashed_password.encode("utf-8")
    )


def create_access_token(data: dict):
    to_encode = data.copy() # copy : 원본 dict를 변경하지 않기 위해 복사
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    # timedelta : 현재 시각에서 60분 뒤를 만료 시간으로 설정

    to_encode.update({"exp": expire}) # "exp" : JWT 표준 만료 시간 클레임
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


# POST /auth/login — 이메일/비밀번호 검증 후 JWT 반환
@router.post("/login")
def login(user: LoginRequest, db: Session = Depends(get_db)):
    db_user = db.query(User).filter(
        User.email == user.email
        # User.email : DB 컬럼 / user.email : 요청으로 받은 값
    ).first() # .first() : 조건에 맞는 첫 번째 행 반환, 없으면 None

    if not db_user:
        raise HTTPException(status_code=400, detail="이메일 또는 비밀번호 오류")

    if not verify_password(user.password, db_user.password_hash):
        raise HTTPException(status_code=400, detail="이메일 또는 비밀번호 오류")

    token = create_access_token({"sub": str(db_user.id)})
    # "sub" : JWT 표준 클레임 — 사용자 식별자(subject)

    return {"access_token": token, "token_type": "bearer"}


# 토큰을 받아 현재 사용자를 반환하는 의존성 함수
# 다른 라우터에서 Depends(get_current_user)로 재사용
def get_current_user(
    token: str = Depends(oauth2_scheme), # oauth2_scheme : Authorization 헤더에서 토큰 추출
    db: Session = Depends(get_db)
):
    credentials_exception = HTTPException(status_code=401, detail="인증 실패")
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        # payload : 토큰 안에 담긴 데이터 (sub, exp 등)
        user_id: str = payload.get("sub") # "sub" : 로그인 시 담아둔 사용자 ID
        if user_id is None:
            raise credentials_exception
    except JWTError:
        # JWTError : 만료(ExpiredSignatureError), 변조 등 모든 JWT 관련 예외를 포함
        raise credentials_exception

    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise credentials_exception

    return user


# PATCH /auth/password — 비밀번호 변경
class PasswordChange(BaseModel):
    current_password: str   # current_password : 현재 비밀번호 (검증용)
    new_password: str       # new_password : 새 비밀번호 (최소 6자)

@router.patch("/password")
def change_password(
    data: PasswordChange,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # 현재 비밀번호 검증
    if not verify_password(data.current_password, current_user.password_hash):
        raise HTTPException(status_code=400, detail="현재 비밀번호가 올바르지 않습니다.")

    if len(data.new_password) < 6:
        raise HTTPException(status_code=400, detail="새 비밀번호는 6자 이상이어야 합니다.")

    # bcrypt로 새 비밀번호 해시 생성 후 저장
    new_hash = bcrypt.hashpw(
        data.new_password.encode("utf-8"),
        bcrypt.gensalt(),
    ).decode("utf-8")

    current_user.password_hash = new_hash
    db.commit()
    return {"message": "비밀번호가 변경되었습니다."}


# GET /auth/me — 현재 로그인된 사용자 정보 반환
@router.get("/me")
def read_users_me(current_user: User = Depends(get_current_user)):
    return {
        "id": str(current_user.id),
        "email": current_user.email,
        "plan": current_user.plan,
        "name": current_user.name,
        "phone": current_user.phone,
        "birth_date": current_user.birth_date,
        "gmail_access_token": bool(current_user.gmail_access_token),
        # 토큰 값 대신 연결 여부(bool)만 반환 — 토큰 자체를 클라이언트에 노출하지 않음
    }

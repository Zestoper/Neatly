from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session
from jose import jwt, JWTError
import bcrypt
import os
from dotenv import load_dotenv
from database import SessionLocal
from models import User
from datetime import datetime, timedelta, timezone
from fastapi.security import OAuth2PasswordBearer

load_dotenv()

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="login")

router = APIRouter()

SECRET_KEY = os.environ["SECRET_KEY"]
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24

class LoginRequest(BaseModel):
    email: EmailStr
    password: str

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def verify_password(plain_password, hashed_password):

    return bcrypt.checkpw(
        plain_password.encode("utf-8"),
        hashed_password.encode("utf-8")
    )

def create_access_token(data: dict):
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)

    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

@router.post("/login")
def login(user: LoginRequest, db: Session = Depends(get_db)):
    db_user = db.query(User).filter(
        User.email == user.email

    ).first()

    if not db_user:
        raise HTTPException(status_code=400, detail="이메일 또는 비밀번호 오류")

    if not verify_password(user.password, db_user.password_hash):
        raise HTTPException(status_code=400, detail="이메일 또는 비밀번호 오류")

    token = create_access_token({"sub": str(db_user.id)})

    return {"access_token": token, "token_type": "bearer"}

def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db)
):
    credentials_exception = HTTPException(status_code=401, detail="인증 실패")
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])

        user_id: str = payload.get("sub")
        if user_id is None:
            raise credentials_exception
    except JWTError:

        raise credentials_exception

    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise credentials_exception

    return user

class PasswordChange(BaseModel):
    current_password: str
    new_password: str

@router.patch("/password")
def change_password(
    data: PasswordChange,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):

    if not verify_password(data.current_password, current_user.password_hash):
        raise HTTPException(status_code=400, detail="현재 비밀번호가 올바르지 않습니다.")

    if len(data.new_password) < 6:
        raise HTTPException(status_code=400, detail="새 비밀번호는 6자 이상이어야 합니다.")

    new_hash = bcrypt.hashpw(
        data.new_password.encode("utf-8"),
        bcrypt.gensalt(),
    ).decode("utf-8")

    current_user.password_hash = new_hash
    db.commit()
    return {"message": "비밀번호가 변경되었습니다."}

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

    }

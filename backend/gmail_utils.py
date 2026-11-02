from google.auth.exceptions import RefreshError
from fastapi import HTTPException
import os
from sqlalchemy.orm import Session
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request as GoogleRequest
from dotenv import load_dotenv

load_dotenv()

GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"

def make_credentials(user) -> Credentials:
    return Credentials(
        token=user.gmail_access_token,
        refresh_token=user.gmail_refresh_token,
        token_uri=GOOGLE_TOKEN_URL,
        client_id=os.environ["GOOGLE_CLIENT_ID"],
        client_secret=os.environ["GOOGLE_CLIENT_SECRET"],
        expiry=user.gmail_token_expiry,
    )

def refresh_if_expired(creds: Credentials, user, db: Session):
    if (creds.expiry is None or creds.expired) and creds.refresh_token:
        try:
            creds.refresh(GoogleRequest())
        except RefreshError as e:
            # invalid_grant: 사용자가 Google 계정에서 접근 권한을 해제했거나 토큰이 만료·폐기됨.
            # 예전에는 이 상태로 계속 실패만 반복했다 → 연결을 끊어서 화면에 'Gmail 연결하기'가 다시 뜨게 한다.
            if "invalid_grant" in str(e):
                print(f"[gmail] 연결 토큰 만료 → 연결 해제 user={user.id}")
                user.gmail_access_token = None
                user.gmail_refresh_token = None
                user.gmail_token_expiry = None
                if hasattr(user, "gmail_watch_expiry"):
                    user.gmail_watch_expiry = None
                db.commit()
                # 401을 쓰면 화면이 Neatly 로그인까지 풀어버려서(로그인 만료로 처리) 409를 쓴다
                raise HTTPException(status_code=409, detail="Gmail 연결이 만료되었습니다. 설정에서 Gmail을 다시 연결해주세요.")
            raise
        user.gmail_access_token = creds.token
        if creds.expiry:
            user.gmail_token_expiry = creds.expiry
        db.commit()

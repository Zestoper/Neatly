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
    if creds.expired and creds.refresh_token:
        creds.refresh(GoogleRequest())
        user.gmail_access_token = creds.token
        if creds.expiry:
            user.gmail_token_expiry = creds.expiry
        db.commit()

"""
Gmail 실시간 수신 — Google Cloud Pub/Sub 푸시 알림.

예전: 서버가 2분마다 Gmail을 확인(폴링). Render 무료 서버는 15분간 요청이 없으면 잠들어서
      아무도 사이트를 안 쓰는 동안 온 메일은 다음 접속 때까지 들어오지 않았다.
지금: 메일이 Gmail에 도착하면 Google이 바로 우리 서버(/gmail/push)를 호출한다.
      잠든 서버도 이 요청으로 깨어나고 Pub/Sub는 성공 응답을 받을 때까지 다시 보내준다.

흐름
  1) Gmail 연결(또는 매일 갱신) 때 users.watch 로 "받은편지함 변화가 생기면 이 토픽으로 알려줘" 등록 (7일 유효)
  2) 메일 도착 → Gmail이 Pub/Sub 토픽에 {emailAddress, historyId} 발행
  3) Pub/Sub 푸시 구독이 POST /gmail/push?token=... 호출
  4) emailAddress 로 사용자를 찾아 기존 동기화(sync_user_emails)를 백그라운드로 실행

필요한 환경변수 (없으면 이 기능은 꺼지고 2분 폴링만 동작)
  GMAIL_PUBSUB_TOPIC  예: projects/<GCP 프로젝트 ID>/topics/neatly-gmail
  GMAIL_PUSH_TOKEN    푸시 URL에 붙이는 비밀 값 (아무나 /gmail/push 를 못 부르게)
"""
import base64
import hmac
import json
import os
import threading
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Request, Response
from googleapiclient.discovery import build

from database import SessionLocal
from models import User

router = APIRouter()

PUBSUB_TOPIC = os.environ.get("GMAIL_PUBSUB_TOPIC", "")
PUSH_TOKEN = os.environ.get("GMAIL_PUSH_TOKEN", "")


def push_enabled() -> bool:
    return bool(PUBSUB_TOPIC and PUSH_TOKEN)


def start_watch(user: User, db) -> bool:
    """사용자 Gmail 받은편지함 감시 등록(또는 갱신). 성공하면 True."""
    if not push_enabled() or not user.gmail_access_token:
        return False
    from routers.gmail import make_credentials, refresh_if_expired
    try:
        creds = make_credentials(user)
        refresh_if_expired(creds, user, db)
        service = build("gmail", "v1", credentials=creds)
        profile = service.users().getProfile(userId="me").execute()
        res = service.users().watch(
            userId="me",
            body={"topicName": PUBSUB_TOPIC, "labelIds": ["INBOX"], "labelFilterBehavior": "include"},
        ).execute()
        user.gmail_address = (profile.get("emailAddress") or "").lower() or None
        expiration_ms = int(res.get("expiration", 0))
        user.gmail_watch_expiry = datetime.fromtimestamp(expiration_ms / 1000, tz=timezone.utc).replace(tzinfo=None) if expiration_ms else None
        db.commit()
        print(f"[gmail push] watch 등록 user={user.id} 만료={user.gmail_watch_expiry}")
        return True
    except Exception as e:
        db.rollback()
        print(f"[gmail push] watch 등록 실패 user={user.id} {type(e).__name__}: {str(e)[:200]}")
        return False


def renew_all_watches() -> None:
    """만료 하루 전인 감시를 갱신 — 스케줄러가 서버 시작 직후와 매일 실행."""
    if not push_enabled():
        return
    db = SessionLocal()
    try:
        soon = datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(days=1)
        users = db.query(User).filter(User.plan == "PREMIUM", User.gmail_access_token != None).all()
        for u in users:
            if not u.gmail_watch_expiry or u.gmail_watch_expiry < soon or not u.gmail_address:
                start_watch(u, db)
    finally:
        db.close()


def _sync_in_background(user_id: str) -> None:
    from routers.email_sync import sync_user_emails
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.id == user_id).first()
        if user:
            n = sync_user_emails(user, db)
            print(f"[gmail push] 동기화 user={user_id} 새 문서 {n}개")
    except Exception as e:
        print(f"[gmail push] 동기화 실패 user={user_id} {type(e).__name__}: {str(e)[:200]}")
    finally:
        db.close()


@router.post("/gmail/push")
async def gmail_push(request: Request, token: str = ""):
    # 비밀 토큰이 맞지 않으면 무시 (Pub/Sub 재시도를 막으려고 성공 코드로 응답)
    if not push_enabled() or not hmac.compare_digest(token, PUSH_TOKEN):
        return Response(status_code=204)
    try:
        envelope = await request.json()
        data = json.loads(base64.b64decode(envelope["message"]["data"]).decode())
        address = (data.get("emailAddress") or "").lower()
    except Exception:
        return Response(status_code=204)

    db = SessionLocal()
    try:
        user = db.query(User).filter(User.gmail_address == address, User.plan == "PREMIUM").first()
        user_id = user.id if user else None
    finally:
        db.close()
    if user_id:
        # 응답은 바로 — 동기화(메일마다 AI 요약)는 수십 초 걸려 Pub/Sub 응답 기한을 넘길 수 있다
        threading.Thread(target=_sync_in_background, args=(user_id,), daemon=True).start()
    return Response(status_code=204)

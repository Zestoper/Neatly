"""소셜 로그인 (구글 · 카카오) — OAuth2 Authorization Code Flow

흐름
  1. 프론트 버튼 → GET /auth/social/{provider}/login → 구글/카카오 로그인 화면으로 이동
  2. 로그인 후 구글/카카오가 GET /auth/social/{provider}/callback?code=...&state=... 로 돌려보냄
  3. code 를 구글/카카오 access token 으로 바꾸고, 그 토큰으로 사용자 정보(id · 이메일 · 이름) 조회
  4. 연결된 계정이 있으면 그 계정, 없으면 같은 이메일 계정에 연결, 그것도 없으면 새로 가입
  5. 기존 이메일 로그인과 똑같은 자체 토큰을 만들어 프론트 /oauth/callback#token=... 으로 보냄
     (실패하면 /login?oauth_error=... 로 보내 화면에 안내 문구를 띄운다)

필요한 환경변수
  GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
  KAKAO_REST_API_KEY, KAKAO_CLIENT_SECRET(카카오 콘솔에서 켰을 때만)
  BACKEND_URL   — 이 서버 주소 (콜백 주소를 만들 때 사용. Render 에서는 비워 두면 자동으로 잡힌다)
  FRONTEND_URL  — 로그인 후 돌아갈 프론트 주소

구글/카카오 콘솔에 등록할 Redirect URI
  {BACKEND_URL}/auth/social/google/callback
  {BACKEND_URL}/auth/social/kakao/callback

주소에 /social 을 넣은 이유: Gmail 연동이 이미 /auth/gmail/callback 을 쓰고 있어서 겹치지 않게 했다.
(Gmail 연동과 같은 구글 OAuth 클라이언트를 써도 된다 — Redirect URI 만 하나 더 등록하면 된다)
"""
import base64
import hashlib
import hmac
import logging
import os
import secrets
import time
from urllib.parse import urlencode, quote

import httpx
import bcrypt
from dotenv import load_dotenv
from fastapi import APIRouter, Depends
from fastapi.responses import RedirectResponse
from sqlalchemy import func
from sqlalchemy.orm import Session

from database import engine
from models import SocialAccount, User
from routers.auth import SECRET_KEY, create_access_token, get_db

load_dotenv()

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/auth/social", tags=["oauth"])

BACKEND_URL  = (os.getenv("BACKEND_URL") or os.getenv("RENDER_EXTERNAL_URL") or "http://localhost:8000").rstrip("/")
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173").rstrip("/")
CALLBACK_PREFIX = "/auth/social"
STATE_SECRET = SECRET_KEY.encode()

GOOGLE_CLIENT_ID     = os.getenv("GOOGLE_CLIENT_ID", "").strip()
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "").strip()
KAKAO_REST_API_KEY   = os.getenv("KAKAO_REST_API_KEY", "").strip()
KAKAO_CLIENT_SECRET  = os.getenv("KAKAO_CLIENT_SECRET", "").strip()


def _fail(message: str) -> RedirectResponse:
    """실패하면 로그인 화면으로 돌려보내고 화면에 안내 문구를 띄운다."""
    return RedirectResponse(f"{FRONTEND_URL}/login?oauth_error={quote(message)}")

PROVIDERS = {
    "google": {
        "label":         "구글",
        "client_id":     GOOGLE_CLIENT_ID,
        "client_secret": GOOGLE_CLIENT_SECRET,
        "authorize_url": "https://accounts.google.com/o/oauth2/v2/auth",
        "token_url":     "https://oauth2.googleapis.com/token",
        "userinfo_url":  "https://openidconnect.googleapis.com/v1/userinfo",
        "scope":         "openid email profile",
    },
    "kakao": {
        "label":         "카카오",
        "client_id":     KAKAO_REST_API_KEY,
        "client_secret": KAKAO_CLIENT_SECRET,  # 콘솔에서 '사용'으로 켰을 때만 필요
        "authorize_url": "https://kauth.kakao.com/oauth/authorize",
        "token_url":     "https://kauth.kakao.com/oauth/token",
        "userinfo_url":  "https://kapi.kakao.com/v2/user/me",
        "scope":         "profile_nickname account_email",
    },
}


def _callback_url(provider: str) -> str:
    # 구글/카카오 콘솔에 등록한 Redirect URI 와 글자 하나까지 같아야 한다
    return f"{BACKEND_URL}{CALLBACK_PREFIX}/{provider}/callback"


# ── CSRF 방지용 state ────────────────────────────────────────────────────────
# 프론트(Vercel)와 백엔드(Render) 도메인이 달라 쿠키 세션을 쓰기 어렵다.
# 그래서 서버 비밀키로 서명한 10분짜리 값을 state 로 보내고, 돌아올 때 서명을 검증한다.
# → 우리 서버가 시작하지 않은 로그인 요청(위조)은 콜백에서 거절된다.
def _sign(message: str) -> str:
    digest = hmac.new(STATE_SECRET, message.encode(), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(digest).decode().rstrip("=")


def _make_state(provider: str) -> str:
    exp = str(int(time.time()) + 600)
    nonce = secrets.token_hex(8)
    return f"{exp}.{nonce}.{_sign(f'{provider}.{exp}.{nonce}')}"


def _state_ok(state: str, provider: str) -> bool:
    parts = (state or "").split(".")
    if len(parts) != 3 or not parts[0].isdigit() or int(parts[0]) < time.time():
        return False
    exp, nonce, sig = parts
    return hmac.compare_digest(sig, _sign(f"{provider}.{exp}.{nonce}"))


# ── 구글/카카오 사용자 정보 → 공통 형식 ─────────────────────────────────────
def _normalize(provider: str, raw: dict) -> dict:
    if provider == "google":
        return {
            "provider_id":    str(raw["sub"]),
            "email":          (raw.get("email") or "").strip().lower() or None,
            "email_verified": bool(raw.get("email_verified")),
            "name":           (raw.get("name") or "").strip(),
        }
    account = raw.get("kakao_account") or {}
    return {
        "provider_id":    str(raw["id"]),
        # 사용자가 이메일 제공에 동의하지 않으면 없을 수 있다
        "email":          (account.get("email") or "").strip().lower() or None,
        "email_verified": bool(account.get("is_email_valid") and account.get("is_email_verified")),
        "name":           ((account.get("profile") or {}).get("nickname") or "").strip(),
    }


def _placeholder_email(provider: str, provider_id: str) -> str:
    # 이메일을 못 받았거나 이미 다른 계정이 쓰는 이메일이면 넣는 자리표시 주소 (실제로 메일이 가지 않는 주소)
    return f"{provider}_{provider_id}@social.noreply"


def _authorize_url(provider: str, cfg: dict) -> str:
    params = {
        "client_id":     cfg["client_id"],
        "redirect_uri":  _callback_url(provider),
        "response_type": "code",
        "scope":         cfg["scope"],
        "state":         _make_state(provider),
    }
    if provider == "google":
        params["prompt"] = "select_account"  # 여러 구글 계정 중 고를 수 있게
    return f"{cfg['authorize_url']}?{urlencode(params)}"


def _token_form(provider: str, cfg: dict, code: str) -> dict:
    data = {
        "grant_type":   "authorization_code",
        "client_id":    cfg["client_id"],
        "redirect_uri": _callback_url(provider),
        "code":         code,
    }
    if cfg["client_secret"]:
        data["client_secret"] = cfg["client_secret"]
    return data


def _log_fetch_error(provider: str, e: Exception) -> None:
    body = getattr(getattr(e, "response", None), "text", "")[:300]
    logger.error("[oauth] %s 토큰/사용자 조회 실패: %s: %s %s", provider, type(e).__name__, e, body)


def _fetch_profile(provider: str, cfg: dict, code: str) -> dict:
    """code → access token → 사용자 정보. 실패하면 예외."""
    with httpx.Client(timeout=10) as client:
        token_res = client.post(cfg["token_url"], data=_token_form(provider, cfg, code),
                                headers={"Accept": "application/json"})
        token_res.raise_for_status()
        access_token = token_res.json()["access_token"]
        me_res = client.get(cfg["userinfo_url"], headers={"Authorization": f"Bearer {access_token}"})
        me_res.raise_for_status()
        return _normalize(provider, me_res.json())


_table_ready = False


def _ensure_table() -> None:
    """user_social_accounts 테이블이 없으면 만든다 (서버가 켜진 뒤 처음 한 번만 확인)."""
    global _table_ready
    if not _table_ready:
        SocialAccount.__table__.create(bind=engine, checkfirst=True)
        _table_ready = True


def _find_or_create_user(db: Session, provider: str, info: dict) -> User:
    _ensure_table()

    # 1) 이미 연결된 소셜 계정
    link = db.query(SocialAccount).filter(
        SocialAccount.provider == provider, SocialAccount.provider_id == info["provider_id"]
    ).first()
    if link:
        user = db.query(User).filter(User.id == link.user_id).first()
        if user:
            return user

    # 2) 같은 이메일로 가입한 계정이 있으면 연결
    #    구글/카카오가 '인증된 이메일'이라고 확인해 준 경우만 — 아니면 남의 계정에 붙을 수 있다
    same_email = db.query(User).filter(func.lower(User.email) == info["email"]).first() if info["email"] else None
    user = same_email if info["email_verified"] else None

    # 3) 없으면 새로 가입
    if not user:
        # User.email 은 비울 수 없고 중복도 안 되므로, 이메일을 못 받았거나 이미 쓰는 주소면 자리표시 주소를 넣는다
        email = info["email"] if info["email"] and not same_email else _placeholder_email(provider, info["provider_id"])
        # 비밀번호로는 로그인할 수 없도록 아무도 모르는 임의 값을 해시해서 넣는다
        random_pw = bcrypt.hashpw(secrets.token_urlsafe(32).encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
        user = User(email=email, password_hash=random_pw, name=(info["name"] or "회원")[:100])
        db.add(user)
        db.flush()

    db.add(SocialAccount(provider=provider, provider_id=info["provider_id"], user_id=user.id))
    db.commit()
    db.refresh(user)
    return user


@router.get("/{provider}/login")
def social_login(provider: str):
    cfg = PROVIDERS.get(provider)
    if not cfg:
        return _fail("지원하지 않는 로그인 방식입니다")
    if not cfg["client_id"]:
        return _fail(f"{cfg['label']} 로그인이 아직 설정되지 않았습니다")
    return RedirectResponse(_authorize_url(provider, cfg))


@router.get("/{provider}/callback")
def social_callback(provider: str, code: str = "", state: str = "", error: str = "",
                    db: Session = Depends(get_db)):
    cfg = PROVIDERS.get(provider)
    if not cfg:
        return _fail("지원하지 않는 로그인 방식입니다")
    if error or not code:
        return _fail("로그인이 취소되었습니다")
    if not _state_ok(state, provider):
        return _fail("로그인 요청이 만료되었습니다. 다시 시도해주세요")

    try:
        info = _fetch_profile(provider, cfg, code)
    except Exception as e:
        _log_fetch_error(provider, e)
        return _fail("소셜 로그인에 실패했습니다. 잠시 후 다시 시도해주세요")

    try:
        user = _find_or_create_user(db, provider, info)
    except Exception as e:
        db.rollback()
        logger.error("[oauth] %s 계정 처리 실패: %s: %s", provider, type(e).__name__, e)
        return _fail("계정 처리 중 오류가 발생했습니다")

    token = create_access_token({"sub": str(user.id)})
    # 토큰은 # 뒤(fragment)에 붙인다 — 브라우저가 서버로 보내지 않아 접속 기록(로그)에 남지 않는다
    return RedirectResponse(f"{FRONTEND_URL}/oauth/callback#token={token}")

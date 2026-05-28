from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session
from requests_oauthlib import OAuth2Session
# requests_oauthlib : Python용 OAuth2 라이브러리 — google-auth-oauthlib의 내부 의존성이라 별도 설치 불필요
# google-auth-oauthlib의 Flow 대신 이걸 직접 쓰는 이유 :
# 최신 google 라이브러리는 PKCE를 자동으로 추가하는데, 서버사이드 흐름에서는 code_verifier를
# 요청 사이에 유지할 수 없어서 "Missing code verifier" 오류가 남 — requests_oauthlib는 PKCE 없이 작동
from gmail_utils import make_credentials, refresh_if_expired
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from models import User, Document, EmailFilter
from routers.auth import get_current_user, get_db
from groq import Groq
import os, base64, re, unicodedata
from datetime import datetime, timezone
from email.header import decode_header, make_header
from email.mime.text import MIMEText
from html.parser import HTMLParser
from dotenv import load_dotenv

load_dotenv()

router = APIRouter()

groq_client = Groq(api_key=os.environ["GROQ_API_KEY"])
GROQ_MODEL = "llama-3.3-70b-versatile"

# 이메일 AI 요약 프롬프트 — 이메일 상세 조회와 문서 변환 두 곳에서 공통으로 사용
EMAIL_SUMMARY_PROMPT = (
    "사용자가 받은 이메일을 읽고 핵심을 2~3문장으로 자연스럽고 간결하게 요약하세요.\n\n"
    "규칙:\n"
    "1. 이메일의 핵심 목적(공지, 요청, 일정, 결과, 승인, 결제, 배송, 알림 등)을 첫 문장에 바로 담으세요.\n"
    "2. 중요한 날짜, 시간, 금액, 장소, 마감일, 예약 정보, 링크가 있으면 반드시 포함하세요.\n"
    "3. 수신자가 취해야 할 행동(답장, 결제, 제출, 확인, 참석, 클릭 등)이 있으면 마지막 문장에 명확히 담으세요.\n"
    "4. 광고·마케팅 메일이라면 혜택, 기간, 할인율, 핵심 조건을 중심으로 요약하세요.\n"
    "5. 여러 사안이 있을 경우 우선순위가 높은 것부터 서술하세요.\n"
    "6. '이메일의 목적은', '본 메일은', '요약하면' 같은 도입 표현 없이 바로 내용을 서술하세요.\n"
    "7. 불필요한 인사말, 반복 표현, 추측성 해석은 제외하고 실제 이메일 내용만 반영하세요.\n"
    "8. 요약문만 출력하세요. 제목, 번호, 마크다운 기호는 쓰지 마세요.\n"
    "9. 실제 내용에 근거하지 않은 추측이나 해석을 추가하지 마세요. 예: '보낸 사람이 급한 것 같음' 같은 표현은 피하세요.\n"
    "10. 이메일에 명확한 요청이나 행동이 없더라도, 수신자가 이메일을 읽고 나서 무엇을 해야 할지 알 수 있도록 요약하세요. 예: '이메일을 확인하고 필요한 경우 답장하세요' 같은 문장을 추가할 수 있습니다."
)

EMAIL_COMPOSE_PROMPT = (
    "사용자의 요청에 따라 이메일 본문을 한국어로 작성하세요.\n\n"
    "규칙:\n"
    "1. 정중하고 자연스러운 한국어로 작성하세요.\n"
    "2. 인사말로 시작하고 마무리 인사로 끝내세요.\n"
    "3. 요청한 내용을 명확하고 간결하게 전달하세요.\n"
    "4. 5~8문장 정도의 적절한 길이로 작성하세요.\n"
    "5. 본문만 출력하세요. 제목은 쓰지 마세요.\n"
    "6. 실제 요청 내용에 근거해서만 작성하세요.\n"
    "7. 반드시 한국어, 영어, 숫자, 표준 문장부호(.,!?:;-()\"')만 사용하세요. 베트남어·중국어·박스문자 등 다른 문자는 절대 쓰지 마세요.\n"
)


def _sanitize_ai_output(text: str) -> str:
    # LLM이 간헐적으로 출력하는 깨진 유니코드·박스문자·제어문자 제거
    # 허용: 한글(AC00-D7A3, 3131-318E), ASCII 출력가능 문자, 줄바꿈
    cleaned = re.sub(
        r"[^가-힣ㄱ-ㆎ -~\n\r\t]",
        "",
        text,
    )
    cleaned = re.sub(r"[ \t]{2,}", " ", cleaned)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip()

EMAIL_REPLY_PROMPT = (
    "다음 이메일에 대한 답장을 한국어로 작성하세요.\n\n"
    "규칙:\n"
    "1. 정중하고 자연스러운 한국어로 작성하세요.\n"
    "2. 이메일의 핵심 내용에 맞게 적절히 응답하세요.\n"
    "3. 인사말로 시작하고 마무리 인사로 끝내세요.\n"
    "4. 3~6문장 정도의 길이로 작성하세요.\n"
    "5. 답장 본문만 출력하세요. 제목이나 추가 설명 없이 바로 내용을 작성하세요.\n"
    "6. 실제 이메일 내용에 근거해서만 응답하세요.\n"
    "7. 반드시 한국어, 영어, 숫자, 표준 문장부호만 사용하세요. 다른 언어 문자나 특수 기호는 쓰지 마세요.\n"
)

SCOPES = [
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/gmail.send",
]


class ReplyBody(BaseModel):
    reply_text: str

class DraftBody(BaseModel):
    to: str
    subject: str
    intent: str

class SendNewBody(BaseModel):
    to: str
    subject: str
    body: str

GOOGLE_AUTH_URL  = "https://accounts.google.com/o/oauth2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://localhost:5173")


# ──────────────────────────────────────────────
# OAuth 세션 / 자격증명 헬퍼
# ──────────────────────────────────────────────

def make_oauth_session(state=None) -> OAuth2Session:
    # OAuth2Session : 인증 URL 생성 + 토큰 교환을 담당하는 세션 객체
    return OAuth2Session(
        client_id=os.environ["GOOGLE_CLIENT_ID"],
        redirect_uri=os.environ["GOOGLE_REDIRECT_URI"],
        scope=SCOPES,
        state=state,
    )


# ──────────────────────────────────────────────
# 이메일 파싱 헬퍼
# ──────────────────────────────────────────────

def _decode_header_value(raw: str) -> str:
    # 이메일 헤더는 비 ASCII 문자(한글 등)를 =?UTF-8?B?...?= 형태로 인코딩해서 전송
    # decode_header → make_header → str() 로 사람이 읽을 수 있는 문자열로 변환
    try:
        return str(make_header(decode_header(raw)))
    except Exception:
        return raw


def _decode_bytes(data: str, headers: list) -> str:
    # data : base64url로 인코딩된 이메일 본문 바이트
    raw = base64.urlsafe_b64decode(data)

    # Content-Type 헤더에서 charset 추출 (예: "text/plain; charset=EUC-KR")
    charset = "utf-8"
    for h in headers:
        if h["name"].lower() == "content-type" and "charset=" in h["value"].lower():
            for part in h["value"].split(";"):
                part = part.strip()
                if part.lower().startswith("charset="):
                    charset = part.split("=", 1)[1].strip().strip('"')
                    break

    try:
        text = raw.decode(charset)
        # 깨진 문자가 30% 이상이면 잘못된 인코딩으로 판단 — 재시도
        if text.count('') > 5 or text.count('?') > len(text) * 0.3:
            raise UnicodeDecodeError(charset, raw, 0, 1, "too many replacement chars")
        return text
    except (LookupError, UnicodeDecodeError):
        pass

    try:
        return raw.decode("euc-kr")  # 한국어 이메일에서 자주 쓰는 인코딩
    except (LookupError, UnicodeDecodeError):
        pass

    return raw.decode("utf-8", errors="ignore")  # 최후 폴백


def _clean_body(text: str) -> str:
    # 이메일 스페이서 문자 제거 (͏ U+034F, ­ U+00AD 소프트 하이픈 등)
    text = re.sub(r'[͏­​‌‍﻿]+', '', text)
    # CSS @import 잔여물 제거
    text = re.sub(r'@import\s+url\([^)]*\)\s*;?', '', text)
    # 줄 안에서 연속 공백 → 1개로 축소
    text = re.sub(r'[ \t]{2,}', ' ', text)
    # <URL> 형식 → 꺽쇠까지 제거
    text = re.sub(r'<https?://\S+>', '', text)
    # 단독 URL 제거
    text = re.sub(r'https?://\S+', '', text)
    # URL 제거 후 남은 빈 꺽쇠 제거
    text = re.sub(r'<\s*>', '', text)
    # 구분선 제거 (----, ======= 등)
    text = re.sub(r'^[-=_*]{4,}\s*$', '', text, flags=re.MULTILINE)

    # 빈 괄호 제거 — URL 제거 후 남는 "(  )", "( )" 등
    text = re.sub(r'\(\s*\)', '', text)

    lines = text.splitlines()
    result = []
    prev_blank = False
    for line in lines:
        stripped = line.strip()
        is_blank = not stripped

        # ASCII 아트 줄 제거 : 줄 전체에서 글자·숫자·한글 비율이 20% 미만이면 제거
        if stripped:
            alpha_count = sum(1 for c in stripped if c.isalnum() or '가' <= c <= '힣')
            # 가 ~ 힣 : 한글 유니코드 범위
            if len(stripped) > 3 and alpha_count / len(stripped) < 0.2:
                continue  # 특수문자가 대부분인 줄은 버림

        if is_blank and prev_blank:
            continue
        result.append(line)
        prev_blank = is_blank

    return "\n".join(result).strip()


class _HTMLTextExtractor(HTMLParser):
    # style/script 안의 CSS·JS는 건너뛰고 태그 사이 텍스트만 수집
    def __init__(self):
        super().__init__()
        self.texts: list[str] = []
        self._skip = False

    def handle_starttag(self, tag: str, attrs):
        if tag in ("style", "script", "head"):
            self._skip = True

    def handle_endtag(self, tag: str):
        if tag in ("style", "script", "head"):
            self._skip = False

    def handle_data(self, data: str):
        if self._skip:
            return
        stripped = data.strip()
        if stripped:
            self.texts.append(stripped)

    def get_text(self) -> str:
        return "\n".join(self.texts)


def _strip_html(html_text: str) -> str:
    # HTML 태그를 제거하고 텍스트만 추출
    parser = _HTMLTextExtractor()
    try:
        parser.feed(html_text)
        return parser.get_text()
    except Exception:
        return re.sub(r'<[^>]+>', '', html_text)


def _is_garbled(text: str) -> bool:
    # 텍스트에서 ? 또는 깨진 문자(대체 문자)가 20% 이상이면 깨진 것으로 판단
    if not text:
        return True
    total = len(text)
    broken = text.count('?') + text.count('�')
    return broken / total > 0.2


def _collect_parts(payload: dict, plain_parts: list, html_parts: list):
    # 멀티파트 이메일을 재귀 순회해서 text/plain, text/html 파트를 수집
    if "parts" in payload:
        for part in payload["parts"]:
            mime = part.get("mimeType", "")
            if mime == "text/plain":
                plain_parts.append(part)
            elif mime == "text/html":
                html_parts.append(part)
            elif mime.startswith("multipart/"):
                _collect_parts(part, plain_parts, html_parts)
    else:
        mime = payload.get("mimeType", "")
        if mime == "text/plain":
            plain_parts.append(payload)
        elif mime == "text/html":
            html_parts.append(payload)


def _extract_html(payload: dict) -> str | None:
    # 이메일에서 text/html 파트를 찾아 디코딩해서 반환
    # 없으면 None — 일반 문서에는 raw_html이 없음
    plain_parts: list = []
    html_parts: list = []
    _collect_parts(payload, plain_parts, html_parts)
    for part in html_parts:
        data = part.get("body", {}).get("data", "")
        if data:
            return _decode_bytes(data, part.get("headers", []))
    return None


def _extract_body(payload: dict) -> str:
    # 1순위 : text/plain — 깨지지 않았으면 사용
    # 2순위 : text/html에서 태그 제거 — plain이 없거나 깨진 경우
    plain_parts: list = []
    html_parts: list = []
    _collect_parts(payload, plain_parts, html_parts)

    for part in plain_parts:
        data = part.get("body", {}).get("data", "")
        if not data:
            continue
        text = _decode_bytes(data, part.get("headers", []))
        cleaned = _clean_body(text)
        if not _is_garbled(cleaned):
            return cleaned

    for part in html_parts:
        data = part.get("body", {}).get("data", "")
        if not data:
            continue
        html_text = _decode_bytes(data, part.get("headers", []))
        text = _strip_html(html_text)
        cleaned = _clean_body(text)
        if cleaned:
            return cleaned

    return ""


# ──────────────────────────────────────────────
# 엔드포인트
# ──────────────────────────────────────────────

# GET /auth/gmail — Google OAuth 로그인 URL 반환 (모든 플랜)
@router.get("/auth/gmail")
def gmail_auth(current_user: User = Depends(get_current_user)):

    oauth = make_oauth_session()
    auth_url, _ = oauth.authorization_url(
        GOOGLE_AUTH_URL,
        access_type="offline",  # offline : refresh_token도 함께 발급
        prompt="consent",       # consent : 항상 동의 화면 표시 — refresh_token 재발급 보장
        state=str(current_user.id),
        # state : Google이 콜백 URL에 그대로 돌려줌 — 어떤 사용자인지 식별하는 데 사용
    )
    return {"url": auth_url}


# GET /auth/gmail/callback — Google 인증 완료 후 리다이렉트되는 엔드포인트
@router.get("/auth/gmail/callback")
def gmail_callback(code: str, state: str, db: Session = Depends(get_db)):
    # code  : Google가 발급한 인증 코드 — 이걸 토큰으로 교환해야 실제 API 사용 가능
    # state : 아까 보낸 user_id — 어떤 사용자의 Gmail인지 식별
    user = db.query(User).filter(User.id == state).first()
    if not user:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다.")

    # HTTP(localhost)에서만 HTTPS 검증 우회 — 프로덕션(HTTPS)에서는 설정하지 않음
    if not os.environ.get("BACKEND_URL", "").startswith("https"):
        os.environ["OAUTHLIB_INSECURE_TRANSPORT"] = "1"

    oauth = make_oauth_session(state=state)
    token = oauth.fetch_token(
        GOOGLE_TOKEN_URL,
        code=code,
        client_secret=os.environ["GOOGLE_CLIENT_SECRET"],
    )

    user.gmail_access_token  = token["access_token"]
    user.gmail_refresh_token = token.get("refresh_token")
    expires_at = token.get("expires_at")
    if expires_at:
        from datetime import datetime
        user.gmail_token_expiry = datetime.utcfromtimestamp(float(expires_at))
    db.commit()

    return RedirectResponse(url=f"{FRONTEND_URL}/emails?connected=true")


# DELETE /auth/gmail — Gmail 연결 해제 (토큰 초기화)
@router.delete("/auth/gmail")
def disconnect_gmail(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    current_user.gmail_access_token = None
    current_user.gmail_refresh_token = None
    # 이메일 필터는 삭제하지 않음 — 재연결 후에도 그대로 유지
    db.commit()
    return {"message": "Gmail 연결이 해제되었습니다."}


# GET /emails — 최근 이메일 20개 목록 반환 (모든 플랜)
# label : 가져올 메일함 — "INBOX"(기본) 또는 "SPAM"
@router.get("/emails")
def get_emails(
    label: str = "INBOX",
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not current_user.gmail_access_token:
        raise HTTPException(status_code=400, detail="Gmail이 연결되지 않았습니다.")

    # 허용된 label만 수용 — 외부 입력 그대로 Gmail API에 넘기지 않음
    allowed_labels = {"INBOX", "SPAM"}
    label = label.upper()
    if label not in allowed_labels:
        label = "INBOX"

    creds = make_credentials(current_user)
    refresh_if_expired(creds, current_user, db)

    service = build("gmail", "v1", credentials=creds)
    # INBOX 조회 시 SPAM 라벨도 있는 메일은 제외 — labelIds만으론 SPAM 중복 제거가 안 됨
    list_kwargs: dict = {"userId": "me", "maxResults": 20, "labelIds": [label]}
    if label == "INBOX":
        list_kwargs["q"] = "-in:spam"
    results = service.users().messages().list(**list_kwargs).execute()
    messages = results.get("messages", [])

    emails = []
    for msg in messages:
        detail = service.users().messages().get(
            userId="me",
            id=msg["id"],
            format="metadata",
            metadataHeaders=["Subject", "From", "Date"],
        ).execute()
        headers = {h["name"]: h["value"] for h in detail["payload"]["headers"]}
        label_ids = detail.get("labelIds", [])
        emails.append({
            "id": msg["id"],
            "subject": _decode_header_value(headers.get("Subject", "(제목 없음)")),
            "from_": _decode_header_value(headers.get("From", "")),
            "date": headers.get("Date", ""),
            "is_unread": "UNREAD" in label_ids,
        })

    return emails


# GET /emails/{message_id} — 이메일 본문 조회 (모든 플랜)
@router.get("/emails/{message_id}")
def get_email_detail(
    message_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not current_user.gmail_access_token:
        raise HTTPException(status_code=400, detail="Gmail이 연결되지 않았습니다.")

    creds = make_credentials(current_user)
    refresh_if_expired(creds, current_user, db)

    service = build("gmail", "v1", credentials=creds)
    try:
        msg = service.users().messages().get(
            userId="me",
            id=message_id,
            format="full",  # full : 헤더 + 본문 전체를 가져옴 (metadata는 헤더만)
        ).execute()
    except HttpError as e:
        if e.resp.status == 404:
            raise HTTPException(status_code=404, detail="이메일을 찾을 수 없습니다.")
        raise HTTPException(status_code=502, detail="Gmail에서 이메일을 불러오지 못했습니다.")

    headers = {h["name"]: h["value"] for h in msg["payload"]["headers"]}
    body = _extract_body(msg["payload"])
    raw_html = _extract_html(msg["payload"])
    is_spam = "SPAM" in msg.get("labelIds", [])

    # AI 요약 — 본문이 있을 때만 생성
    summary = None
    if body.strip():
        try:
            response = groq_client.chat.completions.create(
                model=GROQ_MODEL,
                temperature=0.2,
                messages=[
                    {"role": "system", "content": EMAIL_SUMMARY_PROMPT},
                    # 앞 6000자 사용 — 8B 모델보다 컨텍스트 처리 능력이 좋아 더 긴 본문도 소화 가능
                    {"role": "user", "content": body[:6000]},
                ],
                max_tokens=400,
            )
            summary = response.choices[0].message.content
        except Exception:
            pass  # 요약 실패는 무시 — 본문은 그대로 표시

    return {
        "id": message_id,
        "subject": _decode_header_value(headers.get("Subject", "(제목 없음)")),
        "from_": _decode_header_value(headers.get("From", "")),
        "date": headers.get("Date", ""),
        "body": body,
        "raw_html": raw_html,
        "is_spam": is_spam,
        "is_unread": "UNREAD" in msg.get("labelIds", []),
        "summary": summary,
    }


# PATCH /emails/{message_id}/read — 이메일을 읽음으로 표시 (UNREAD 라벨 제거)
@router.patch("/emails/{message_id}/read")
def mark_as_read(
    message_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not current_user.gmail_access_token:
        raise HTTPException(status_code=400, detail="Gmail이 연결되지 않았습니다.")

    creds = make_credentials(current_user)
    refresh_if_expired(creds, current_user, db)

    service = build("gmail", "v1", credentials=creds)
    try:
        service.users().messages().modify(
            userId="me",
            id=message_id,
            body={"removeLabelIds": ["UNREAD"]},
        ).execute()
    except HttpError:
        pass  # 이미 읽었거나 권한 문제 — 조용히 무시

    return {"message": "읽음 처리되었습니다."}


# DELETE /emails/{message_id} — Gmail 이메일을 휴지통으로 이동 + Neatly DB에 삭제 기록 저장
@router.delete("/emails/{message_id}")
def trash_email(
    message_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not current_user.gmail_access_token:
        raise HTTPException(status_code=400, detail="Gmail이 연결되지 않았습니다.")

    creds = make_credentials(current_user)
    refresh_if_expired(creds, current_user, db)

    service = build("gmail", "v1", credentials=creds)
    try:
        # 제목·본문 추출 — Neatly 휴지통에 저장할 내용
        msg = service.users().messages().get(
            userId="me", id=message_id, format="full"
        ).execute()
        headers = {h["name"]: h["value"] for h in msg["payload"]["headers"]}
        subject = _decode_header_value(headers.get("Subject", "(제목 없음)"))
        sender = _decode_header_value(headers.get("From", ""))
        body = _extract_body(msg["payload"])
        raw_html = _extract_html(msg["payload"])

        # Gmail 휴지통으로 이동
        service.users().messages().trash(userId="me", id=message_id).execute()
    except HttpError as e:
        if e.resp.status == 403:
            current_user.gmail_access_token = None
            current_user.gmail_refresh_token = None
            db.commit()
            raise HTTPException(status_code=403, detail="Gmail 권한이 부족합니다. 다시 연결해주세요.")
        raise HTTPException(status_code=500, detail="이메일 삭제에 실패했습니다.")

    # Neatly 휴지통에 기록 — gmail_message_id 저장해 복원 시 Gmail API 호출 가능
    doc = Document(
        user_id=current_user.id,
        title=subject,
        raw_text=body,
        raw_html=raw_html,
        sender=sender,
        gmail_message_id=message_id,
        status="DONE",
        deleted_at=datetime.now(timezone.utc),
    )
    db.add(doc)
    db.commit()

    return {"message": "이메일을 휴지통으로 이동했습니다."}


# POST /emails/{message_id}/spam — Gmail에서 해당 메일을 스팸으로 이동
@router.post("/emails/{message_id}/spam")
def mark_as_spam(
    message_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not current_user.gmail_access_token:
        raise HTTPException(status_code=400, detail="Gmail이 연결되지 않았습니다.")

    creds = make_credentials(current_user)
    refresh_if_expired(creds, current_user, db)

    service = build("gmail", "v1", credentials=creds)
    try:
        msg = service.users().messages().get(
            userId="me", id=message_id, format="metadata",
            metadataHeaders=["From"],
        ).execute()

        headers_tmp = {h["name"]: h["value"] for h in msg["payload"]["headers"]}
        sender_raw_tmp = _decode_header_value(headers_tmp.get("From", ""))
        email_match_tmp = re.search(r"<(.+?)>", sender_raw_tmp)
        sender_email_tmp = email_match_tmp.group(1) if email_match_tmp else sender_raw_tmp.strip()

        # 해당 발신자의 INBOX 메일 전체를 SPAM으로 이동
        inbox_results = service.users().messages().list(
            userId="me", q=f"from:{sender_email_tmp} in:inbox"
        ).execute()
        for inbox_msg in inbox_results.get("messages", []):
            try:
                service.users().messages().modify(
                    userId="me",
                    id=inbox_msg["id"],
                    body={"addLabelIds": ["SPAM"], "removeLabelIds": ["INBOX"]},
                ).execute()
            except HttpError:
                pass

    except HttpError as e:
        if e.resp.status == 403:
            # 기존 토큰이 gmail.readonly로 발급된 경우 — 초기화 후 재연결 유도
            # 401이 아닌 403으로 반환해야 axios 인터셉터가 JWT를 삭제하지 않음
            current_user.gmail_access_token = None
            current_user.gmail_refresh_token = None
            db.commit()
            raise HTTPException(
                status_code=403,
                detail="Gmail 권한이 부족합니다. Settings에서 Gmail을 다시 연결해주세요.",
            )
        raise HTTPException(status_code=500, detail=str(e))

    # 발신자를 EmailFilter에 추가 + Gmail 서버 필터 생성 — 이후 메일도 자동으로 SPAM으로 분류
    headers = {h["name"]: h["value"] for h in msg["payload"]["headers"]}
    sender_raw = _decode_header_value(headers.get("From", ""))
    if sender_raw:
        existing = db.query(EmailFilter).filter(
            EmailFilter.user_id == current_user.id,
            EmailFilter.sender == sender_raw,
        ).first()
        if not existing:
            db.add(EmailFilter(user_id=current_user.id, sender=sender_raw))
            db.commit()

        # "Name <email@example.com>" 형식에서 이메일 주소만 추출
        email_match = re.search(r"<(.+?)>", sender_raw)
        sender_email = email_match.group(1) if email_match else sender_raw.strip()

        # Gmail 서버 필터 생성 — 이후 이 발신자의 메일은 자동으로 SPAM 처리
        try:
            service.users().settings().filters().create(
                userId="me",
                body={
                    "criteria": {"from": sender_email},
                    "action": {
                        "addLabelIds": ["SPAM"],
                        "removeLabelIds": ["INBOX"],
                    },
                },
            ).execute()
        except HttpError:
            pass  # 필터 생성 실패는 무시 — 이미 있는 필터이거나 권한 문제

    return {"message": "스팸으로 이동되었습니다."}


# DELETE /emails/{message_id}/spam — 스팸 해제 : INBOX로 복원 + 필터 제거
@router.delete("/emails/{message_id}/spam")
def unmark_spam(
    message_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not current_user.gmail_access_token:
        raise HTTPException(status_code=400, detail="Gmail이 연결되지 않았습니다.")

    creds = make_credentials(current_user)
    refresh_if_expired(creds, current_user, db)

    service = build("gmail", "v1", credentials=creds)

    # 발신자 확인
    try:
        msg = service.users().messages().get(
            userId="me", id=message_id, format="metadata",
            metadataHeaders=["From"],
        ).execute()
    except HttpError as e:
        if e.resp.status == 404:
            raise HTTPException(status_code=404, detail="이메일을 찾을 수 없습니다.")
        raise HTTPException(status_code=502, detail="Gmail에서 이메일 정보를 가져오지 못했습니다.")

    headers = {h["name"]: h["value"] for h in msg["payload"]["headers"]}
    sender_raw = _decode_header_value(headers.get("From", ""))
    email_match = re.search(r"<(.+?)>", sender_raw)
    sender_email = email_match.group(1) if email_match else sender_raw.strip()

    # 해당 발신자의 스팸 메일 전체를 INBOX로 복원
    spam_results = service.users().messages().list(
        userId="me", q=f"from:{sender_email} in:spam"
    ).execute()
    for spam_msg in spam_results.get("messages", []):
        try:
            service.users().messages().modify(
                userId="me",
                id=spam_msg["id"],
                body={"addLabelIds": ["INBOX"], "removeLabelIds": ["SPAM"]},
            ).execute()
        except HttpError:
            pass

    if sender_raw:
        # EmailFilter DB에서 제거
        db.query(EmailFilter).filter(
            EmailFilter.user_id == current_user.id,
            EmailFilter.sender == sender_raw,
        ).delete()
        db.commit()

        # Gmail 서버 필터에서도 제거
        try:
            gmail_filters = service.users().settings().filters().list(userId="me").execute()
            for f in gmail_filters.get("filter", []):
                if f.get("criteria", {}).get("from") == sender_email:
                    service.users().settings().filters().delete(
                        userId="me", id=f["id"]
                    ).execute()
        except HttpError:
            pass

    return {"message": "스팸이 해제되었습니다."}


# POST /emails/{message_id}/to-document — 이메일 본문을 AI 요약해서 문서로 저장 (Standard 이상)
@router.post("/emails/{message_id}/to-document")
def email_to_document(
    message_id: str,
    folder_id: str | None = None,  # folder_id : 드래그 시 지정된 폴더 — 없으면 null
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current_user.plan not in ("STANDARD", "PREMIUM"):
        raise HTTPException(status_code=403, detail="Standard 플랜부터 사용할 수 있습니다.")
    if not current_user.gmail_access_token:
        raise HTTPException(status_code=400, detail="Gmail이 연결되지 않았습니다.")

    creds = make_credentials(current_user)
    refresh_if_expired(creds, current_user, db)

    service = build("gmail", "v1", credentials=creds)
    msg = service.users().messages().get(
        userId="me",
        id=message_id,
        format="full",  # full : 헤더 + 본문 전체 가져옴
    ).execute()

    headers = {h["name"]: h["value"] for h in msg["payload"]["headers"]}
    subject  = _decode_header_value(headers.get("Subject", "(제목 없음)"))
    sender   = _decode_header_value(headers.get("From", ""))  # 발신자 — 필터링에 사용
    body     = _extract_body(msg["payload"])
    raw_html = _extract_html(msg["payload"])

    try:
        response = groq_client.chat.completions.create(
            model=GROQ_MODEL,
            temperature=0.2,
            messages=[
                {"role": "system", "content": EMAIL_SUMMARY_PROMPT},
                {"role": "user", "content": body[:6000]},
            ],
            max_tokens=400,
        )
        summary = response.choices[0].message.content
    except Exception:
        summary = None  # AI 요약 실패 시 본문 없이 문서 저장

    new_doc = Document(
        user_id=current_user.id,
        title=subject,
        raw_text=body,
        raw_html=raw_html,
        summary=summary,
        sender=sender,          # 발신자 저장 — 폴더 내 발신자 필터링용
        folder_id=folder_id,
        status="DONE",
    )
    db.add(new_doc)
    db.commit()
    db.refresh(new_doc)

    return new_doc


# POST /emails/{message_id}/generate-reply — 원본 이메일 기반 AI 답장 초안 생성
@router.post("/emails/{message_id}/generate-reply")
def generate_reply(
    message_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not current_user.gmail_access_token:
        raise HTTPException(status_code=400, detail="Gmail이 연결되지 않았습니다.")

    creds = make_credentials(current_user)
    refresh_if_expired(creds, current_user, db)

    service = build("gmail", "v1", credentials=creds)
    try:
        msg = service.users().messages().get(
            userId="me",
            id=message_id,
            format="full",
        ).execute()
    except HttpError as e:
        if e.resp.status == 404:
            raise HTTPException(status_code=404, detail="이메일을 찾을 수 없습니다.")
        raise HTTPException(status_code=502, detail="Gmail에서 이메일을 불러오지 못했습니다.")

    body = _extract_body(msg["payload"])
    if not body.strip():
        return {"reply_text": ""}

    try:
        response = groq_client.chat.completions.create(
            model=GROQ_MODEL,
            temperature=0.5,
            messages=[
                {"role": "system", "content": EMAIL_REPLY_PROMPT},
                {"role": "user", "content": f"원본 이메일:\n\n{body[:4000]}"},
            ],
            max_tokens=600,
        )
        reply_text = _sanitize_ai_output(response.choices[0].message.content)
    except Exception:
        raise HTTPException(status_code=500, detail="AI 답장 생성에 실패했습니다.")

    return {"reply_text": reply_text}


# POST /emails/{message_id}/send-reply — AI가 생성한 답장을 Gmail로 전송
@router.post("/emails/{message_id}/send-reply")
def send_reply(
    message_id: str,
    body: ReplyBody,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not current_user.gmail_access_token:
        raise HTTPException(status_code=400, detail="Gmail이 연결되지 않았습니다.")

    creds = make_credentials(current_user)
    refresh_if_expired(creds, current_user, db)

    service = build("gmail", "v1", credentials=creds)
    try:
        msg = service.users().messages().get(
            userId="me",
            id=message_id,
            format="metadata",
            metadataHeaders=["Subject", "From", "Message-ID"],
        ).execute()
    except HttpError as e:
        if e.resp.status == 404:
            raise HTTPException(status_code=404, detail="이메일을 찾을 수 없습니다.")
        raise HTTPException(status_code=502, detail="Gmail에서 이메일 정보를 가져오지 못했습니다.")

    headers = {h["name"]: h["value"] for h in msg["payload"]["headers"]}
    original_subject = _decode_header_value(headers.get("Subject", ""))
    original_from = _decode_header_value(headers.get("From", ""))
    original_message_id = headers.get("Message-ID", "")
    thread_id = msg.get("threadId", message_id)

    email_match = re.search(r"<(.+?)>", original_from)
    to_email = email_match.group(1) if email_match else original_from.strip()

    subject = original_subject if original_subject.lower().startswith("re:") else f"Re: {original_subject}"

    mime_msg = MIMEText(body.reply_text, "plain", "utf-8")
    mime_msg["To"] = to_email
    mime_msg["Subject"] = subject
    if original_message_id:
        mime_msg["In-Reply-To"] = original_message_id
        mime_msg["References"] = original_message_id

    raw = base64.urlsafe_b64encode(mime_msg.as_bytes()).decode("utf-8")

    try:
        service.users().messages().send(
            userId="me",
            body={"raw": raw, "threadId": thread_id},
        ).execute()
    except HttpError as e:
        if e.resp.status == 403:
            raise HTTPException(
                status_code=403,
                detail="Gmail 답장 권한이 없습니다. Settings에서 Gmail을 다시 연결해주세요.",
            )
        raise HTTPException(status_code=500, detail="답장 전송에 실패했습니다.")

    return {"message": "답장이 전송되었습니다."}


# POST /emails/generate-draft — 수신자·제목·의도를 받아 AI가 이메일 본문 초안 생성
@router.post("/emails/generate-draft")
def generate_draft(
    body: DraftBody,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not current_user.gmail_access_token:
        raise HTTPException(status_code=400, detail="Gmail이 연결되지 않았습니다.")

    prompt = f"수신자: {body.to}\n제목: {body.subject}\n요청: {body.intent}"

    try:
        response = groq_client.chat.completions.create(
            model=GROQ_MODEL,
            temperature=0.5,
            messages=[
                {"role": "system", "content": EMAIL_COMPOSE_PROMPT},
                {"role": "user", "content": prompt},
            ],
            max_tokens=600,
        )
        draft_text = _sanitize_ai_output(response.choices[0].message.content)
    except Exception:
        raise HTTPException(status_code=500, detail="AI 초안 생성에 실패했습니다.")

    return {"body": draft_text}


# POST /emails/send-new — 새 이메일 전송 (답장이 아닌 신규 발송)
@router.post("/emails/send-new")
def send_new_email(
    body: SendNewBody,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not current_user.gmail_access_token:
        raise HTTPException(status_code=400, detail="Gmail이 연결되지 않았습니다.")

    creds = make_credentials(current_user)
    refresh_if_expired(creds, current_user, db)

    service = build("gmail", "v1", credentials=creds)

    mime_msg = MIMEText(body.body, "plain", "utf-8")
    mime_msg["To"] = body.to
    mime_msg["Subject"] = body.subject

    raw = base64.urlsafe_b64encode(mime_msg.as_bytes()).decode("utf-8")

    try:
        service.users().messages().send(
            userId="me",
            body={"raw": raw},
        ).execute()
    except HttpError as e:
        if e.resp.status == 403:
            raise HTTPException(
                status_code=403,
                detail="Gmail 전송 권한이 없습니다. Settings에서 Gmail을 다시 연결해주세요.",
            )
        raise HTTPException(status_code=500, detail="메일 전송에 실패했습니다.")

    return {"message": "메일이 전송되었습니다."}

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session
from requests_oauthlib import OAuth2Session

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

def make_oauth_session(state=None) -> OAuth2Session:

    return OAuth2Session(
        client_id=os.environ["GOOGLE_CLIENT_ID"],
        redirect_uri=os.environ["GOOGLE_REDIRECT_URI"],
        scope=SCOPES,
        state=state,
    )

def _decode_header_value(raw: str) -> str:

    try:
        return str(make_header(decode_header(raw)))
    except Exception:
        return raw

def _decode_bytes(data: str, headers: list) -> str:

    raw = base64.urlsafe_b64decode(data)

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

        if text.count('') > 5 or text.count('?') > len(text) * 0.3:
            raise UnicodeDecodeError(charset, raw, 0, 1, "too many replacement chars")
        return text
    except (LookupError, UnicodeDecodeError):
        pass

    try:
        return raw.decode("euc-kr")
    except (LookupError, UnicodeDecodeError):
        pass

    return raw.decode("utf-8", errors="ignore")

def _clean_body(text: str) -> str:

    text = re.sub(r'[͏­​‌‍﻿]+', '', text)

    text = re.sub(r'@import\s+url\([^)]*\)\s*;?', '', text)

    text = re.sub(r'[ \t]{2,}', ' ', text)

    text = re.sub(r'<https?://\S+>', '', text)

    text = re.sub(r'https?://\S+', '', text)

    text = re.sub(r'<\s*>', '', text)

    text = re.sub(r'^[-=_*]{4,}\s*$', '', text, flags=re.MULTILINE)

    text = re.sub(r'\(\s*\)', '', text)

    lines = text.splitlines()
    result = []
    prev_blank = False
    for line in lines:
        stripped = line.strip()
        is_blank = not stripped

        if stripped:
            alpha_count = sum(1 for c in stripped if c.isalnum() or '가' <= c <= '힣')

            if len(stripped) > 3 and alpha_count / len(stripped) < 0.2:
                continue

        if is_blank and prev_blank:
            continue
        result.append(line)
        prev_blank = is_blank

    return "\n".join(result).strip()

class _HTMLTextExtractor(HTMLParser):

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

    parser = _HTMLTextExtractor()
    try:
        parser.feed(html_text)
        return parser.get_text()
    except Exception:
        return re.sub(r'<[^>]+>', '', html_text)

def _is_garbled(text: str) -> bool:

    if not text:
        return True
    total = len(text)
    broken = text.count('?') + text.count('�')
    return broken / total > 0.2

def _collect_parts(payload: dict, plain_parts: list, html_parts: list):

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

    plain_parts: list = []
    html_parts: list = []
    _collect_parts(payload, plain_parts, html_parts)
    for part in html_parts:
        data = part.get("body", {}).get("data", "")
        if data:
            return _decode_bytes(data, part.get("headers", []))
    return None

def _extract_body(payload: dict) -> str:

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

@router.get("/auth/gmail")
def gmail_auth(current_user: User = Depends(get_current_user)):

    oauth = make_oauth_session()
    auth_url, _ = oauth.authorization_url(
        GOOGLE_AUTH_URL,
        access_type="offline",
        prompt="consent",
        state=str(current_user.id),

    )
    return {"url": auth_url}

@router.get("/auth/gmail/callback")
def gmail_callback(code: str, state: str, db: Session = Depends(get_db)):

    user = db.query(User).filter(User.id == state).first()
    if not user:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다.")

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

@router.delete("/auth/gmail")
def disconnect_gmail(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    current_user.gmail_access_token = None
    current_user.gmail_refresh_token = None

    db.commit()
    return {"message": "Gmail 연결이 해제되었습니다."}

@router.get("/emails")
def get_emails(
    label: str = "INBOX",
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not current_user.gmail_access_token:
        raise HTTPException(status_code=400, detail="Gmail이 연결되지 않았습니다.")

    allowed_labels = {"INBOX", "SPAM"}
    label = label.upper()
    if label not in allowed_labels:
        label = "INBOX"

    creds = make_credentials(current_user)
    refresh_if_expired(creds, current_user, db)

    service = build("gmail", "v1", credentials=creds)

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
            format="full",
        ).execute()
    except HttpError as e:
        if e.resp.status == 404:
            raise HTTPException(status_code=404, detail="이메일을 찾을 수 없습니다.")
        raise HTTPException(status_code=502, detail="Gmail에서 이메일을 불러오지 못했습니다.")

    headers = {h["name"]: h["value"] for h in msg["payload"]["headers"]}
    body = _extract_body(msg["payload"])
    raw_html = _extract_html(msg["payload"])
    is_spam = "SPAM" in msg.get("labelIds", [])

    summary = None
    if body.strip():
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
            pass

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
        pass

    return {"message": "읽음 처리되었습니다."}

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

        msg = service.users().messages().get(
            userId="me", id=message_id, format="full"
        ).execute()
        headers = {h["name"]: h["value"] for h in msg["payload"]["headers"]}
        subject = _decode_header_value(headers.get("Subject", "(제목 없음)"))
        sender = _decode_header_value(headers.get("From", ""))
        body = _extract_body(msg["payload"])
        raw_html = _extract_html(msg["payload"])

        service.users().messages().trash(userId="me", id=message_id).execute()
    except HttpError as e:
        if e.resp.status == 403:
            current_user.gmail_access_token = None
            current_user.gmail_refresh_token = None
            db.commit()
            raise HTTPException(status_code=403, detail="Gmail 권한이 부족합니다. 다시 연결해주세요.")
        raise HTTPException(status_code=500, detail="이메일 삭제에 실패했습니다.")

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

            current_user.gmail_access_token = None
            current_user.gmail_refresh_token = None
            db.commit()
            raise HTTPException(
                status_code=403,
                detail="Gmail 권한이 부족합니다. Settings에서 Gmail을 다시 연결해주세요.",
            )
        raise HTTPException(status_code=500, detail=str(e))

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

        email_match = re.search(r"<(.+?)>", sender_raw)
        sender_email = email_match.group(1) if email_match else sender_raw.strip()

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
            pass

    return {"message": "스팸으로 이동되었습니다."}

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

        db.query(EmailFilter).filter(
            EmailFilter.user_id == current_user.id,
            EmailFilter.sender == sender_raw,
        ).delete()
        db.commit()

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

@router.post("/emails/{message_id}/to-document")
def email_to_document(
    message_id: str,
    folder_id: str | None = None,
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
        format="full",
    ).execute()

    headers = {h["name"]: h["value"] for h in msg["payload"]["headers"]}
    subject  = _decode_header_value(headers.get("Subject", "(제목 없음)"))
    sender   = _decode_header_value(headers.get("From", ""))
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
        summary = None

    new_doc = Document(
        user_id=current_user.id,
        title=subject,
        raw_text=body,
        raw_html=raw_html,
        summary=summary,
        sender=sender,
        folder_id=folder_id,
        status="DONE",
    )
    db.add(new_doc)
    db.commit()
    db.refresh(new_doc)

    return new_doc

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

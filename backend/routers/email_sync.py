from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from models import CalendarEvent, Document, DocumentTag, Folder, Tag, User
from routers.auth import get_current_user, get_db
from datetime import datetime, timezone
from routers.gmail import (
    make_credentials,
    refresh_if_expired,
    _extract_body,
    _extract_html,
    _decode_header_value,
    EMAIL_SUMMARY_PROMPT,
    GROQ_MODEL,
)
from ai_client import create_chat_completion
from googleapiclient.discovery import build
import json as _json
import re as _re

router = APIRouter()

def _classify_email_doc(
    subject: str,
    body: str,
    folders: list[dict],
    tags: list[dict],
) -> tuple[str | None, list[str]]:
    """AI로 이메일 내용을 분석해 적합한 폴더 ID와 태그 ID 목록을 반환."""
    if not folders and not tags:
        return None, []

    folder_str = ", ".join(f["name"] for f in folders) if folders else "없음"
    tag_str    = ", ".join(t["name"] for t in tags)    if tags    else "없음"

    prompt = (
        f"아래 이메일을 분석하고, 주어진 폴더/태그 목록 중 적합한 것을 골라 JSON으로만 출력하세요.\n\n"
        f"폴더 목록: {folder_str}\n"
        f"태그 목록: {tag_str}\n\n"
        f"제목: {subject}\n"
        f"본문:\n{body[:2000]}\n\n"
        f"출력 형식 (JSON만, 다른 텍스트 없이):\n"
        f'{{"folder": "폴더이름 또는 null", "tags": ["태그이름1"]}}\n\n'
        f"규칙:\n"
        f"- folder: 위 폴더 목록 중 정확히 일치하는 이름 하나. 적합한 폴더가 없으면 null.\n"
        f"- tags: 위 태그 목록 중 이 이메일과 관련 있는 것들만. 없으면 빈 배열 [].\n"
    )

    try:
        response = create_chat_completion(
            model=GROQ_MODEL,
            temperature=0.1,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=120,
        )
        text = response.choices[0].message.content.strip()
        match = _re.search(r'\{.*?\}', text, _re.DOTALL)
        if not match:
            return None, []
        data = _json.loads(match.group())

        folder_name = data.get("folder")
        tag_names   = data.get("tags") or []

        folder_id = None
        if folder_name and str(folder_name).lower() != "null":
            for f in folders:
                if f["name"] == folder_name:
                    folder_id = f["id"]
                    break

        tag_ids = []
        for tag_name in tag_names:
            for t in tags:
                if t["name"] == tag_name:
                    tag_ids.append(t["id"])
                    break

        return folder_id, tag_ids
    except Exception:
        return None, []

def _extract_task_from_email(subject: str, body: str, sender: str = "") -> dict | None:
    """
    이메일 본문에서 특정 날짜까지 처리해야 할 할 일을 AI로 추출.
    마감일이 있는 명확한 업무 요청이 아니면 None을 반환.
    """
    if not body.strip():
        return None

    now = datetime.now(timezone.utc)
    today_str = now.strftime("%Y-%m-%d")
    prompt = (
        f"오늘 날짜는 {today_str}입니다.\n"
        f"아래 이메일에 특정 날짜까지 처리해야 할 구체적인 업무 요청(마감일이 있는 할 일)이 있는지 분석하세요.\n\n"
        f"발신: {sender or '알 수 없음'}\n"
        f"제목: {subject}\n"
        f"본문:\n{body[:3000]}\n\n"
        f"출력은 JSON 하나만, 다른 텍스트 없이:\n"
        f'{{"has_task": true 또는 false, "task": "해야 할 일 한 줄 요약", "date": "YYYY-MM-DD", "time": "HH:MM 또는 null"}}\n\n'
        f"규칙:\n"
        f"- 명확한 날짜 또는 '내일', '이번주 금요일'처럼 오늘 기준으로 날짜를 계산할 수 있는 표현과 함께 언급된, 발신자가 이 이메일 수신자에게 직접 요청한 업무만 has_task=true\n"
        f"- 다음은 항상 has_task=false: 서비스 무료 체험판/평가판 시작·종료 안내, 결제·구독·사용량/크레딧 변경 안내, 제품 업데이트/체인지로그/신규 기능 소개, 뉴스레터, 커뮤니티 다이제스트, 광고, 단순 정보 안내, 계정 로그인/보안 알림, 날짜가 없는 요청\n"
        f"- 발신자가 특정 개인이 아니라 서비스/브랜드이고 자동 발송된 메일이면(뉴스레터, changelog, 마케팅 등) has_task=false\n"
        f"- 발신 주소에 noreply, no-reply, updates, notifications, newsletter, changelog, news. 등이 포함되어 있으면 자동 발송 메일이므로 has_task=false\n"
        f"- 이름을 부르는 개인화된 인사말이 있어도, 목적이 자사 서비스의 혜택/크레딧/프로모션을 홍보하고 사용을 유도하는 것이라면 has_task=false (예: '~일까지 크레딧을 받으세요', '~일까지 청구하세요' 등 서비스가 발송한 프로모션성 안내)\n"
        f"- 특히 '평가판 종료일', '체험 기간 만료일', '크레딧/사용량 전환일', '무료 크레딧 수령 기한' 같은 서비스 자체의 일정/혜택은 절대 할 일로 추출하지 말 것\n"
        f"- has_task=true는 실제 사람(동료, 거래처, 지인 등)이 업무상 요청한 것에만 해당. 회사/서비스가 발송한 메일은 원칙적으로 has_task=false\n"
        f"- date는 반드시 YYYY-MM-DD 형식. 연도가 본문에 없으면 {today_str[:4]}년으로 계산하되, 그 결과가 오늘보다 이전이면 다음 해로 계산\n"
        f"- time: 마감 시각이 명시되어 있으면(예: '21시까지', '오후 6시까지') 24시간제 HH:MM으로, 없으면 null\n"
        f"- task는 한글로 간결하게, 마크다운/한자 사용 금지"
    )

    try:
        response = create_chat_completion(
            model=GROQ_MODEL,
            temperature=0.1,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=150,
        )
        text = response.choices[0].message.content.strip()
        match = _re.search(r'\{.*?\}', text, _re.DOTALL)
        if not match:
            return None
        data = _json.loads(match.group())

        if not data.get("has_task"):
            return None

        task = (data.get("task") or "").strip()
        date_str = (data.get("date") or "").strip()
        time_str = (data.get("time") or "").strip()
        if not task or not date_str:
            return None

        if _re.match(r'^\d{2}:\d{2}$', time_str):
            event_date = datetime.strptime(f"{date_str} {time_str}", "%Y-%m-%d %H:%M")
        else:
            event_date = datetime.strptime(f"{date_str} 23:59", "%Y-%m-%d %H:%M")

        return {"task": task, "event_date": event_date}
    except Exception:
        return None

def sync_user_emails(user: User, db: Session) -> int:
    """
    user의 Gmail에서 마지막 동기화 이후 새 이메일을 가져와
    아직 문서로 변환되지 않은 것만 자동 저장한다.

    반환값 : 새로 저장된 문서 수
    """
    if not user.gmail_access_token:
        return 0

    creds = make_credentials(user)
    try:
        refresh_if_expired(creds, user, db)
    except Exception:
        return 0

    service = build("gmail", "v1", credentials=creds)

    if user.gmail_last_sync:

        after_ts = int(user.gmail_last_sync.replace(tzinfo=timezone.utc).timestamp())
        query = f"in:inbox after:{after_ts}"
    else:

        today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
        after_ts = int(today_start.timestamp())
        query = f"in:inbox after:{after_ts}"

    try:
        results = service.users().messages().list(
            userId="me", q=query, maxResults=20
        ).execute()
    except Exception:
        return 0

    messages = results.get("messages", [])
    if not messages:

        user.gmail_last_sync = datetime.now(timezone.utc)
        db.commit()
        return 0

    existing_message_ids = set(
        row[0]
        for row in db.query(Document.gmail_message_id)
        .filter(
            Document.user_id == user.id,
            Document.gmail_message_id != None,
        )
        .all()
    )

    email_folders = db.query(Folder).filter(
        Folder.user_id == user.id,
        Folder.folder_type == "email",
    ).all()
    user_tags = db.query(Tag).filter(Tag.user_id == user.id).all()
    folder_dicts = [{"id": str(f.id), "name": f.name} for f in email_folders]
    tag_dicts    = [{"id": str(t.id), "name": t.name} for t in user_tags]

    saved = 0
    for msg in messages:
        try:
            detail = service.users().messages().get(
                userId="me", id=msg["id"], format="full"
            ).execute()
        except Exception:
            continue

        headers = {h["name"]: h["value"] for h in detail["payload"]["headers"]}
        subject = _decode_header_value(headers.get("Subject", "(제목 없음)"))

        if msg["id"] in existing_message_ids:
            continue

        sender  = _decode_header_value(headers.get("From", ""))
        body    = _extract_body(detail["payload"])
        raw_html = _extract_html(detail["payload"])

        summary = None
        if body.strip():
            try:
                res = create_chat_completion(
                    model=GROQ_MODEL,
                    temperature=0.2,
                    messages=[
                        {"role": "system", "content": EMAIL_SUMMARY_PROMPT},
                        {"role": "user",   "content": body[:6000]},
                    ],
                    max_tokens=400,
                )
                summary = res.choices[0].message.content
            except Exception:
                pass

        folder_id_auto, tag_ids_auto = _classify_email_doc(
            subject, body, folder_dicts, tag_dicts
        )

        new_doc = Document(
            user_id=user.id,
            title=subject,
            raw_text=body,
            raw_html=raw_html,
            summary=summary,
            sender=sender,
            gmail_message_id=msg["id"],
            folder_id=folder_id_auto,
            status="DONE",
        )
        db.add(new_doc)
        db.flush()

        for tag_id in tag_ids_auto:
            db.add(DocumentTag(document_id=new_doc.id, tag_id=tag_id))

        task_info = _extract_task_from_email(subject, body, sender)
        if task_info:
            db.add(CalendarEvent(
                user_id=user.id,
                title=task_info["task"],
                description=f"이메일 '{subject}'에서 AI가 자동으로 추출한 할 일입니다.",
                event_date=task_info["event_date"],
                document_id=new_doc.id,
                email_id=msg["id"],
                email_subject=subject,
                auto_extracted=True,
            ))

        existing_message_ids.add(msg["id"])
        saved += 1

    db.commit()

    user.gmail_last_sync = datetime.now(timezone.utc)
    db.commit()

    return saved

@router.post("/emails/sync")
def manual_sync(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.plan != "PREMIUM":
        raise HTTPException(status_code=403, detail="Premium 플랜에서 사용할 수 있습니다.")

    count = sync_user_emails(current_user, db)
    return {
        "synced": count,
        "last_sync": current_user.gmail_last_sync,
    }

@router.get("/emails/sync/status")
def sync_status(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.plan != "PREMIUM":
        return {"last_sync": None, "new_count": 0}

    since = current_user.gmail_last_view or current_user.gmail_last_sync
    new_count = 0
    if since:
        new_count = (
            db.query(Document)
            .filter(
                Document.user_id == current_user.id,
                Document.deleted_at == None,
                Document.raw_html != None,
                Document.created_at > since,
            )
            .count()
        )

    return {"last_sync": current_user.gmail_last_sync, "new_count": new_count}

@router.post("/emails/mark-viewed")
def mark_emails_viewed(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    current_user.gmail_last_view = datetime.now(timezone.utc)
    db.commit()
    return {"ok": True}

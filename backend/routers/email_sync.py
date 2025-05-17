from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from models import Document, DocumentTag, Folder, Tag, User
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
    groq_client,
)
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
        response = groq_client.chat.completions.create(
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


def sync_user_emails(user: User, db: Session) -> int:
    """
    user의 Gmail에서 마지막 동기화 이후 새 이메일을 가져와
    아직 문서로 변환되지 않은 것만 자동 저장한다.

    반환값 : 새로 저장된 문서 수
    """
    if not user.gmail_access_token:
        return 0  # Gmail 미연결 — 건너뜀

    creds = make_credentials(user)
    try:
        refresh_if_expired(creds, user, db)
    except Exception:
        return 0  # 토큰 갱신 실패 — 조용히 건너뜀

    service = build("gmail", "v1", credentials=creds)

    # 마지막 동기화 시각 이후의 메일만 조회
    # gmail_last_sync가 없으면 24시간 이내 메일만 가져옴 (첫 실행 과부하 방지)
    if user.gmail_last_sync:
        # Gmail query 형식: after:{Unix timestamp}
        after_ts = int(user.gmail_last_sync.replace(tzinfo=timezone.utc).timestamp())
        query = f"in:inbox after:{after_ts}"
    else:
        # 첫 동기화: 오늘 0시 이후 메일만
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
        # 새 메일 없어도 동기화 시각은 업데이트
        user.gmail_last_sync = datetime.now(timezone.utc)
        db.commit()
        return 0

    # 이미 저장된 gmail_message_id 캐시 — 같은 메일을 중복 저장하지 않음
    existing_message_ids = set(
        row[0]
        for row in db.query(Document.gmail_message_id)
        .filter(
            Document.user_id == user.id,
            Document.gmail_message_id != None,
        )
        .all()
    )

    # AI 분류에 사용할 사용자 폴더·태그 목록 (루프 전 한 번만 조회)
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

        # AI 요약 생성
        summary = None
        if body.strip():
            try:
                res = groq_client.chat.completions.create(
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

        # AI 자동 분류: 폴더 + 태그
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

        existing_message_ids.add(msg["id"])
        saved += 1

    db.commit()

    # 동기화 완료 시각 기록
    user.gmail_last_sync = datetime.now(timezone.utc)
    db.commit()

    return saved


# POST /emails/sync — 현재 사용자의 Gmail을 수동으로 즉시 동기화 (Premium 전용)
@router.post("/emails/sync")
def manual_sync(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.plan != "PREMIUM":
        raise HTTPException(status_code=403, detail="Premium 플랜에서 사용할 수 있습니다.")

    count = sync_user_emails(current_user, db)
    return {
        "synced": count,                              # 새로 저장된 문서 수
        "last_sync": current_user.gmail_last_sync,   # 동기화 완료 시각
    }


# GET /emails/sync/status — 마지막 동기화 시각 + 안 읽은 새 문서 수 반환 (Premium 전용)
@router.get("/emails/sync/status")
def sync_status(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.plan != "PREMIUM":
        return {"last_sync": None, "new_count": 0}

    # gmail_last_view 이후에 생성된 이메일 출처 문서 수 계산
    # last_view가 없으면 gmail_last_sync 기준, 그것도 없으면 0
    since = current_user.gmail_last_view or current_user.gmail_last_sync
    new_count = 0
    if since:
        new_count = (
            db.query(Document)
            .filter(
                Document.user_id == current_user.id,
                Document.deleted_at == None,
                Document.raw_html != None,   # 이메일 출처 문서만
                Document.created_at > since,
            )
            .count()
        )

    return {"last_sync": current_user.gmail_last_sync, "new_count": new_count}


# POST /emails/mark-viewed — 사용자가 Emails 페이지를 열었음을 기록 → 뱃지 카운트 초기화
@router.post("/emails/mark-viewed")
def mark_emails_viewed(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    current_user.gmail_last_view = datetime.now(timezone.utc)
    db.commit()
    return {"ok": True}

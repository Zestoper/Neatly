from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from models import CalendarEvent, Document, User
from routers.auth import get_current_user, get_db
from ai_client import create_chat_completion, GROQ_MODEL_SMART as GROQ_MODEL
from datetime import datetime, timezone, timedelta
import os
import re
from dotenv import load_dotenv

load_dotenv()

router = APIRouter()

KST = timezone(timedelta(hours=9))

def _kst_day_range(date_str: str) -> tuple[datetime, datetime]:
    """'YYYY-MM-DD'(한국 시간 기준 날짜)를 UTC datetime 범위 [start, end)로 변환."""
    day_start_kst = datetime.strptime(date_str, "%Y-%m-%d").replace(tzinfo=KST)
    day_end_kst = day_start_kst + timedelta(days=1)
    return day_start_kst.astimezone(timezone.utc), day_end_kst.astimezone(timezone.utc)

_AUTOMATED_SENDER_RE = re.compile(
    r"no.?reply|updates?[-.@]|notifications?[-.@]|newsletter@|changelog@|news\.|team@mail\.",
    re.IGNORECASE,
)

def _is_automated_sender(sender: str | None) -> bool:
    """자동 발송으로 보이는 발신 주소(noreply, changelog, newsletter 등)는 항상 자동 발송으로 간주."""
    return bool(sender and _AUTOMATED_SENDER_RE.search(sender))

def _generate_briefing_text(docs: list[Document], today_str: str | None = None) -> str:
    """문서 목록을 받아 문서별 요약 + 전체 요약 형태의 브리핑 생성.

    '오늘 마감인 할 일'은 CalendarEvent에서 직접 구조화된 데이터로 내려주므로
    (due_tasks API 필드) 이 텍스트에는 포함하지 않는다 — AI가 마감 항목을
    임의로 지어내거나 형식을 흐트러뜨리는 문제를 원천 차단하기 위함.

    자동 발송으로 보이는 발신 주소는 AI 판단에 맡기지 않고 코드에서 먼저 제외한다 —
    AI가 제외 규칙을 놓치는 경우가 있어 확정적으로 걸러내기 위함.
    """

    today_str = today_str or datetime.now(KST).strftime("%Y-%m-%d")
    docs = [d for d in docs if not _is_automated_sender(d.sender)]

    parts = []
    for i, doc in enumerate(docs, 1):
        body = (doc.summary or doc.raw_text or "").strip()[:800]
        if not body:
            body = "(본문 없음)"
        sender_line = f"발신: {doc.sender}\n" if doc.sender else ""
        parts.append(f"[문서 {i}] {doc.title}\n{sender_line}{body}")

    combined = "\n\n".join(parts) if parts else "(오늘 새로 추가된 문서 없음)"
    combined = combined[:9000]

    try:
        response = create_chat_completion(
            model=GROQ_MODEL,
            temperature=0.3,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "당신은 문서 관리 도구 Neatly의 AI 브리핑 어시스턴트입니다.\n"
                        f"오늘 날짜는 {today_str}입니다 (한국 시간 기준).\n"
                        "제공된 문서들을 분석해 아래 형식으로 브리핑을 작성하세요.\n\n"
                        "제외 규칙 (아래에 해당하는 문서는 브리핑에서 완전히 제외):\n"
                        "- 서비스 무료 체험판/평가판 시작·종료 안내, 결제 유도, 구독/사용량/크레딧 변경 안내\n"
                        "- 제품 업데이트, 체인지로그(changelog), 신규 기능 소개, 사용 가이드/튜토리얼 안내 메일\n"
                        "- 뉴스레터, 커뮤니티 다이제스트(LinkedIn 알림·인맥 활동 요약 등), 광고, 프로모션\n"
                        "- 실제 업무나 계정 보안과 무관한 마케팅성 내용\n"
                        "- 위 항목 판단 기준: 발신자가 특정 개인이 아니라 서비스/브랜드이고, 수신자 개인에게 특정 행동을 요청한 것이 아니라 정보 전달·홍보가 목적이면 제외 대상\n"
                        "- 발신 주소에 noreply, no-reply, updates, notifications, newsletter, changelog, news. 등이 포함되어 있으면 자동 발송 메일이므로 원칙적으로 제외 대상 (실제 동료·지인이 개인 메일 주소로 보낸 것이 아님)\n"
                        "- 문서 내용이 오늘보다 이전 날짜에 이미 끝난 회의/일정/이벤트 안내이고 현재 시점에 새로 취할 행동이 없다면 제외 대상 (예: 오늘이 7월 25일인데 7월 21일에 열린 회의 안내)\n"
                        "\n"
                        "형식 규칙:\n"
                        "0. 위 제외 규칙에 해당하지 않는 문서는 절대 누락하지 말고 반드시 모두 포함하세요.\n"
                        "1. 제외 규칙에 해당하지 않는 문서마다 아래 블록을 반복 출력:\n"
                        "   ▪ 문서 제목 (입력의 '[문서 N] 실제 제목'에서 '실제 제목' 부분 그대로. '문서 1', '문서 2' 같은 번호를 제목으로 쓰지 말 것)\n"
                        "   핵심 내용을 2문장으로 요약\n"
                        "   → 할 일: 이 문서에서 해야 할 행동 한 줄 (없으면 생략)\n"
                        "\n"
                        "2. 모든 블록이 끝난 후 마지막에:\n"
                        "   ◆ 전체 요약\n"
                        "   오늘 가장 중요한 내용 2~3문장, 우선순위 순서로\n"
                        "\n"
                        "규칙:\n"
                        "- 마크다운 기호(#, **, -, ``` 등) 사용 금지\n"
                        "- 한글과 필요한 영어(고유명사, 숫자 등) 외에 한자(중국어 간체/번체) 사용 절대 금지 — 반드시 순수 한국어로만 작성\n"
                        "- 제공된 문서 내용만 근거로 작성\n"
                        "- 내용이 없는 문서는 '내용 확인 필요'로 표시\n"
                        "- 제외 규칙에 해당하지 않는 문서가 하나도 없다면 '오늘은 특별히 확인할 업무 관련 내용이 없습니다.'라고만 답변"
                    ),
                },
                {
                    "role": "user",
                    "content": f"다음 문서 {len(docs)}개를 분석해 브리핑을 작성해주세요:\n\n{combined}",
                },
            ],
            max_tokens=1000,
        )
        return response.choices[0].message.content
    except Exception as e:
        raise HTTPException(status_code=502, detail="AI 브리핑 생성에 실패했습니다. 잠시 후 다시 시도해주세요.")

def _due_task_dict(t: CalendarEvent) -> dict:
    return {
        "id": str(t.id),
        "title": t.title,
        "email_subject": t.email_subject,
        "event_date": t.event_date.isoformat(),
    }

def _get_due_tasks(db: Session, user_id: str, day_start: datetime, day_end: datetime) -> list[CalendarEvent]:
    """해당 날짜 범위의 자동 추출 할 일을 조회. 오늘 날짜라면 이미 지난 마감은 제외한다."""
    now = datetime.now(timezone.utc)
    lower = max(day_start, now) if day_start <= now < day_end else day_start
    return db.query(CalendarEvent).filter(
        CalendarEvent.user_id == user_id,
        CalendarEvent.auto_extracted == True,
        CalendarEvent.event_date >= lower,
        CalendarEvent.event_date < day_end,
    ).order_by(CalendarEvent.event_date).all()

def _date_label(date_str: str) -> str:
    """'YYYY-MM-DD' → 'YYYY년 MM월 DD일'"""
    d = datetime.strptime(date_str, "%Y-%m-%d")
    return d.strftime("%Y년 %m월 %d일")

def _today_str() -> str:
    return datetime.now(KST).strftime("%Y-%m-%d")

@router.post("/briefing/generate")
def generate_daily_briefing(
    date: str | None = None,
    folder_id: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.plan != "PREMIUM":
        raise HTTPException(status_code=403, detail="Premium 플랜에서 사용할 수 있습니다.")

    target_date = date or _today_str()
    try:
        day_start, day_end = _kst_day_range(target_date)
    except ValueError:
        raise HTTPException(status_code=400, detail="날짜 형식이 올바르지 않습니다. (YYYY-MM-DD)")

    if folder_id:

        docs = db.query(Document).filter(
            Document.user_id == current_user.id,
            Document.deleted_at == None,
            Document.folder_id == folder_id,
        ).order_by(Document.created_at.desc()).all()
        if not docs:
            raise HTTPException(status_code=404, detail="해당 폴더에 문서가 없습니다.")
        briefing_text = _generate_briefing_text(docs, _today_str())
        return {"id": None, "title": "폴더 브리핑", "content": briefing_text}

    title = f"AI 일간 브리핑 — {_date_label(target_date)}"

    docs = db.query(Document).filter(
        Document.user_id == current_user.id,
        Document.deleted_at == None,
        Document.created_at >= day_start,
        Document.created_at < day_end,
        Document.title != title,
    ).order_by(Document.created_at.desc()).all()

    due_tasks = _get_due_tasks(db, current_user.id, day_start, day_end)

    if not docs and not due_tasks:
        raise HTTPException(status_code=404, detail=f"{_date_label(target_date)}에 추가된 문서나 마감 할 일이 없습니다.")

    briefing_text = _generate_briefing_text(docs, target_date)
    due_tasks_out = [_due_task_dict(t) for t in due_tasks]

    existing = db.query(Document).filter(
        Document.user_id == current_user.id,
        Document.title == title,
        Document.deleted_at == None,
    ).first()

    if existing:
        existing.raw_text = briefing_text
        existing.summary = briefing_text[:300]
        db.commit()
        db.refresh(existing)
        return {"id": str(existing.id), "title": existing.title, "content": briefing_text, "due_tasks": due_tasks_out}

    new_doc = Document(
        user_id=current_user.id,
        title=title,
        raw_text=briefing_text,
        summary=briefing_text[:300],
        status="DONE",
    )
    db.add(new_doc)
    db.commit()
    db.refresh(new_doc)
    return {"id": str(new_doc.id), "title": new_doc.title, "content": briefing_text, "due_tasks": due_tasks_out}

@router.get("/briefing/date")
def get_briefing_by_date(
    date: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.plan != "PREMIUM":
        return {"briefing": None}
    try:
        day_start, day_end = _kst_day_range(date)
        label = _date_label(date)
    except ValueError:
        raise HTTPException(status_code=400, detail="날짜 형식이 올바르지 않습니다. (YYYY-MM-DD)")

    title = f"AI 일간 브리핑 — {label}"
    doc = db.query(Document).filter(
        Document.user_id == current_user.id,
        Document.title == title,
        Document.deleted_at == None,
    ).first()

    due_tasks_out = [_due_task_dict(t) for t in _get_due_tasks(db, current_user.id, day_start, day_end)]

    if not doc:
        if not due_tasks_out:
            return {"briefing": None}
        return {"briefing": {"id": None, "title": title, "content": "", "due_tasks": due_tasks_out}}
    return {"briefing": {"id": str(doc.id), "title": doc.title, "content": doc.raw_text, "due_tasks": due_tasks_out}}

@router.get("/briefing/today")
def get_today_briefing(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.plan != "PREMIUM":
        return {"briefing": None}
    today_str = _today_str()
    today_label = _date_label(today_str)
    day_start, day_end = _kst_day_range(today_str)
    title = f"AI 일간 브리핑 — {today_label}"
    due_tasks_out = [_due_task_dict(t) for t in _get_due_tasks(db, current_user.id, day_start, day_end)]
    doc = db.query(Document).filter(
        Document.user_id == current_user.id,
        Document.title == title,
        Document.deleted_at == None,
    ).first()
    if not doc:
        if not due_tasks_out:
            return {"briefing": None}
        return {"briefing": {"id": None, "title": title, "content": "", "due_tasks": due_tasks_out}}
    return {"briefing": {"id": str(doc.id), "title": doc.title, "content": doc.raw_text, "due_tasks": due_tasks_out}}

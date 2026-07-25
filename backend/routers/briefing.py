from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from models import CalendarEvent, Document, User
from routers.auth import get_current_user, get_db
from groq import Groq
from datetime import datetime, timezone, timedelta
import os
from dotenv import load_dotenv

load_dotenv()

router = APIRouter()

GROQ_MODEL = "llama-3.3-70b-versatile"

groq_client = Groq(api_key=os.environ["GROQ_API_KEY"])

def _generate_briefing_text(docs: list[Document], due_tasks: list[CalendarEvent] | None = None) -> str:
    """문서 목록 + 오늘 마감인 할 일 목록을 받아 브리핑 생성."""

    due_tasks = due_tasks or []

    parts = []
    for i, doc in enumerate(docs, 1):
        body = (doc.summary or doc.raw_text or "").strip()[:800]
        if not body:
            body = "(본문 없음)"
        parts.append(f"[문서 {i}] {doc.title}\n{body}")

    combined = "\n\n".join(parts) if parts else "(오늘 새로 추가된 문서 없음)"
    combined = combined[:9000]

    due_parts = [
        f"- {t.title} (출처 이메일: {t.email_subject or '알 수 없음'})"
        for t in due_tasks
    ]
    due_combined = "\n".join(due_parts) if due_parts else "(없음)"

    try:
        response = groq_client.chat.completions.create(
            model=GROQ_MODEL,
            temperature=0.3,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "당신은 문서 관리 도구 Neatly의 AI 브리핑 어시스턴트입니다.\n"
                        "제공된 문서와 마감 할 일 목록을 분석해 아래 형식으로 브리핑을 작성하세요.\n\n"
                        "제외 규칙 (아래에 해당하는 문서는 브리핑에서 완전히 제외):\n"
                        "- 서비스 무료 체험판/평가판 시작 안내, 결제 유도, 구독 광고 등 프로모션성 이메일\n"
                        "- 실제 업무나 계정 보안과 무관한 마케팅/뉴스레터성 내용\n"
                        "\n"
                        "형식 규칙:\n"
                        "1. '오늘 마감인 할 일' 목록이 비어 있지 않다면 가장 먼저 아래 블록으로 출력 (비어 있으면 이 섹션 전체 생략):\n"
                        "   ⏰ 오늘 마감인 할 일\n"
                        "   각 항목마다 '- 할 일 내용 (출처 이메일 제목)' 한 줄씩\n"
                        "\n"
                        "2. 그 다음, 제외 규칙에 해당하지 않는 문서마다 아래 블록을 반복 출력:\n"
                        "   ▪ 문서 제목\n"
                        "   핵심 내용을 2문장으로 요약\n"
                        "   → 할 일: 이 문서에서 해야 할 행동 한 줄 (없으면 생략)\n"
                        "\n"
                        "3. 모든 블록이 끝난 후 마지막에:\n"
                        "   ◆ 전체 요약\n"
                        "   오늘 가장 중요한 내용 2~3문장, 마감인 할 일을 최우선으로 우선순위 순서로\n"
                        "\n"
                        "규칙:\n"
                        "- 마크다운 기호(#, **, -, ``` 등) 사용 금지\n"
                        "- 한글과 필요한 영어(고유명사, 숫자 등) 외에 한자(중국어 간체/번체) 사용 절대 금지 — 반드시 순수 한국어로만 작성\n"
                        "- 제공된 문서/할 일 내용만 근거로 작성\n"
                        "- 내용이 없는 문서는 '내용 확인 필요'로 표시\n"
                        "- 오늘 마감인 할 일도 없고 제외 규칙에 해당하지 않는 문서도 없다면 '오늘은 특별히 확인할 업무 관련 내용이 없습니다.'라고만 답변"
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"오늘 마감인 할 일 {len(due_tasks)}개:\n{due_combined}\n\n"
                        f"오늘 새로 추가된 문서 {len(docs)}개:\n\n{combined}"
                    ),
                },
            ],
            max_tokens=1000,
        )
        return response.choices[0].message.content
    except Exception as e:
        raise HTTPException(status_code=502, detail="AI 브리핑 생성에 실패했습니다. 잠시 후 다시 시도해주세요.")

def _date_label(date_str: str) -> str:
    """'YYYY-MM-DD' → 'YYYY년 MM월 DD일'"""
    d = datetime.strptime(date_str, "%Y-%m-%d")
    return d.strftime("%Y년 %m월 %d일")

def _today_str() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")

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
        day_start = datetime.strptime(target_date, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    except ValueError:
        raise HTTPException(status_code=400, detail="날짜 형식이 올바르지 않습니다. (YYYY-MM-DD)")
    day_end = day_start + timedelta(days=1)

    if folder_id:

        docs = db.query(Document).filter(
            Document.user_id == current_user.id,
            Document.deleted_at == None,
            Document.folder_id == folder_id,
        ).order_by(Document.created_at.desc()).all()
        if not docs:
            raise HTTPException(status_code=404, detail="해당 폴더에 문서가 없습니다.")
        briefing_text = _generate_briefing_text(docs)
        return {"id": None, "title": "폴더 브리핑", "content": briefing_text}

    docs = db.query(Document).filter(
        Document.user_id == current_user.id,
        Document.deleted_at == None,
        Document.created_at >= day_start,
        Document.created_at < day_end,
    ).order_by(Document.created_at.desc()).all()

    due_tasks = db.query(CalendarEvent).filter(
        CalendarEvent.user_id == current_user.id,
        CalendarEvent.auto_extracted == True,
        CalendarEvent.event_date >= day_start,
        CalendarEvent.event_date < day_end,
    ).order_by(CalendarEvent.event_date).all()

    if not docs and not due_tasks:
        raise HTTPException(status_code=404, detail=f"{_date_label(target_date)}에 추가된 문서나 마감 할 일이 없습니다.")

    briefing_text = _generate_briefing_text(docs, due_tasks)
    title = f"AI 일간 브리핑 — {_date_label(target_date)}"

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
        return {"id": str(existing.id), "title": existing.title, "content": briefing_text}

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
    return {"id": str(new_doc.id), "title": new_doc.title, "content": briefing_text}

@router.get("/briefing/date")
def get_briefing_by_date(
    date: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.plan != "PREMIUM":
        return {"briefing": None}
    try:
        label = _date_label(date)
    except ValueError:
        raise HTTPException(status_code=400, detail="날짜 형식이 올바르지 않습니다. (YYYY-MM-DD)")

    title = f"AI 일간 브리핑 — {label}"
    doc = db.query(Document).filter(
        Document.user_id == current_user.id,
        Document.title == title,
        Document.deleted_at == None,
    ).first()

    if not doc:
        return {"briefing": None}
    return {"briefing": {"id": str(doc.id), "title": doc.title, "content": doc.raw_text}}

@router.get("/briefing/today")
def get_today_briefing(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.plan != "PREMIUM":
        return {"briefing": None}
    today_label = _date_label(_today_str())
    title = f"AI 일간 브리핑 — {today_label}"
    doc = db.query(Document).filter(
        Document.user_id == current_user.id,
        Document.title == title,
        Document.deleted_at == None,
    ).first()
    if not doc:
        return {"briefing": None}
    return {"briefing": {"id": str(doc.id), "title": doc.title, "content": doc.raw_text}}

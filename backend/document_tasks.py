"""
문서(업로드 PDF·DOCX·직접 작성)에서 날짜가 있는 할 일을 AI로 찾아 캘린더 '제안'으로 저장한다.

- 메일 동기화와 같은 방식: 바로 캘린더에 넣지 않고 confirmed=False 로 저장 → 화면 확인 모달에서 사용자가 고른다
- 문서 업로드 응답을 늦추지 않도록 저장이 끝난 뒤 백그라운드 스레드에서 실행한다
- 일정 시각은 캘린더 화면과 같은 '한국 시각(시간대 없음)'으로 저장한다
"""
import json
import re
import threading
from datetime import datetime, timedelta, timezone

from ai_client import create_chat_completion, GROQ_MODEL_FAST
from database import SessionLocal
from models import CalendarEvent

KST = timezone(timedelta(hours=9))
MAX_TASKS = 5


def _prompt(title: str, text: str, today: str) -> str:
    return (
        f"오늘 날짜는 {today}입니다 (한국 시간 기준).\n"
        f"아래 문서에서 '특정 날짜까지 해야 하는 일'이나 '특정 날짜에 있는 일정'을 찾으세요.\n\n"
        f"문서 제목: {title}\n"
        f"본문:\n{text[:5000]}\n\n"
        f"출력은 JSON 하나만, 다른 텍스트 없이:\n"
        f'{{"tasks": [{{"task": "할 일 한 줄 요약", "date": "YYYY-MM-DD", "time": "HH:MM 또는 null"}}]}}\n\n'
        f"규칙:\n"
        f"- 본문에 날짜가 명시돼 있거나 '내일', '이번주 금요일'처럼 오늘 기준으로 계산할 수 있는 것만\n"
        f"- 이미 끝난 과거 사실(예: 회의가 열린 날짜, 작성일)은 제외하고 앞으로 해야 할 일·예정된 일정만\n"
        f"- 누가 하는지 적혀 있으면 task에 포함 (예: '박준호 - 광고 시안 3종 제출')\n"
        f"- 최대 {MAX_TASKS}개, 없으면 빈 배열\n"
        f"- 연도가 없으면 {today[:4]}년으로 계산하되 오늘보다 이전이면 다음 해\n"
        f"- time: 시각이 명시돼 있으면 24시간제 HH:MM, 없으면 null\n"
        f"- task는 한글로 간결하게, 마크다운 금지"
    )


def extract_tasks(title: str, text: str) -> list[dict]:
    """[{"task": str, "event_date": naive KST datetime}] — 실패하면 빈 리스트."""
    if not text or not text.strip():
        return []
    now_kst = datetime.now(KST)
    try:
        res = create_chat_completion(
            model=GROQ_MODEL_FAST,
            temperature=0.1,
            messages=[{"role": "user", "content": _prompt(title, text, now_kst.strftime("%Y-%m-%d"))}],
            max_tokens=500,
        )
        raw = res.choices[0].message.content or ""
        match = re.search(r"\{.*\}", raw, re.DOTALL)
        if not match:
            return []
        items = json.loads(match.group()).get("tasks") or []
    except Exception as e:
        print(f"[문서 일정 추출] 실패 {type(e).__name__}: {e}")
        return []

    out: list[dict] = []
    today = now_kst.replace(tzinfo=None, hour=0, minute=0, second=0, microsecond=0)
    for it in items[:MAX_TASKS]:
        task = (it.get("task") or "").strip()
        date_str = (it.get("date") or "").strip()
        time_str = (it.get("time") or "").strip() if isinstance(it.get("time"), str) else ""
        if not task or not re.match(r"^\d{4}-\d{2}-\d{2}$", date_str):
            continue
        hhmm = time_str if re.match(r"^\d{2}:\d{2}$", time_str) else "23:59"
        try:
            when = datetime.strptime(f"{date_str} {hhmm}", "%Y-%m-%d %H:%M")
        except ValueError:
            continue
        if when < today:   # 과거 일정은 제안하지 않는다
            continue
        out.append({"task": task[:255], "event_date": when})
    return out


def _run(user_id: str, document_id: str, title: str, text: str) -> None:
    tasks = extract_tasks(title, text)
    if not tasks:
        return
    db = SessionLocal()
    try:
        for t in tasks:
            db.add(CalendarEvent(
                user_id=user_id,
                title=t["task"],
                description=f"문서 '{title}'에서 AI가 찾은 일정입니다.",
                event_date=t["event_date"],
                document_id=document_id,
                auto_extracted=True,
                confirmed=False,
            ))
        db.commit()
        print(f"[문서 일정 추출] 문서 {document_id}: 제안 {len(tasks)}개")
    except Exception as e:
        db.rollback()
        print(f"[문서 일정 추출] 저장 실패: {e}")
    finally:
        db.close()


def suggest_tasks_in_background(user_id: str, document_id: str, title: str, text: str) -> None:
    threading.Thread(target=_run, args=(str(user_id), str(document_id), title, text), daemon=True).start()

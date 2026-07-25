"""
scheduler.py — APScheduler 기반 백그라운드 작업 관리

등록된 작업:
  1. sync_all_premium_emails : 2분마다 Premium 사용자의 Gmail 자동 동기화
  2. generate_daily_briefings : 매일 오전 8시 Premium 사용자 일간 브리핑 생성
"""

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger
from database import SessionLocal
from models import User, Document, CalendarEvent
from routers.email_sync import sync_user_emails
from routers.briefing import _generate_briefing_text
from datetime import datetime, timezone, timedelta
import logging

logger = logging.getLogger(__name__)

scheduler = BackgroundScheduler()

def sync_all_premium_emails():
    """
    2분마다 실행 — Gmail이 연결된 Premium 사용자를 순회하며 새 이메일 동기화.
    각 사용자마다 독립적인 DB 세션을 열어 처리 후 닫음.
    """
    db = SessionLocal()
    try:

        users = db.query(User).filter(
            User.plan == "PREMIUM",
            User.gmail_access_token != None,
        ).all()

        for user in users:
            try:
                count = sync_user_emails(user, db)
                if count > 0:
                    logger.info(f"[sync] user={user.id} 새 문서 {count}개 저장")
            except Exception as e:
                logger.warning(f"[sync] user={user.id} 실패: {e}")
    finally:
        db.close()

def generate_daily_briefings():
    """
    매일 오전 8시 실행 — Premium 사용자별로 오늘의 일간 브리핑 문서 자동 생성.
    오늘 추가된 문서도 없고 오늘 마감인 할 일도 없는 사용자는 건너뜀.
    """
    db = SessionLocal()
    try:
        today_start = datetime.now(timezone.utc).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
        today_end = today_start + timedelta(days=1)
        today_str = datetime.now(timezone.utc).strftime("%Y년 %m월 %d일")
        title = f"AI 일간 브리핑 — {today_str}"

        premium_users = db.query(User).filter(User.plan == "PREMIUM").all()

        for user in premium_users:
            try:

                docs = (
                    db.query(Document)
                    .filter(
                        Document.user_id == user.id,
                        Document.deleted_at == None,
                        Document.created_at >= today_start,
                    )
                    .order_by(Document.created_at.desc())
                    .all()
                )

                due_tasks = (
                    db.query(CalendarEvent)
                    .filter(
                        CalendarEvent.user_id == user.id,
                        CalendarEvent.auto_extracted == True,
                        CalendarEvent.event_date >= today_start,
                        CalendarEvent.event_date < today_end,
                    )
                    .order_by(CalendarEvent.event_date)
                    .all()
                )

                if not docs and not due_tasks:
                    continue

                briefing_text = _generate_briefing_text(docs, due_tasks)

                existing = (
                    db.query(Document)
                    .filter(
                        Document.user_id == user.id,
                        Document.title == title,
                        Document.deleted_at == None,
                    )
                    .first()
                )
                if existing:
                    existing.raw_text = briefing_text
                    existing.summary  = briefing_text[:300]
                else:
                    db.add(Document(
                        user_id=user.id,
                        title=title,
                        raw_text=briefing_text,
                        summary=briefing_text[:300],
                        status="DONE",
                    ))
                db.commit()
                logger.info(f"[briefing] user={user.id} 브리핑 생성 완료")
            except Exception as e:
                logger.warning(f"[briefing] user={user.id} 실패: {e}")
    finally:
        db.close()

def cleanup_old_trash():
    """
    매일 새벽 3시 실행 — 30일 이상 지난 휴지통 문서를 영구 삭제.
    """
    db = SessionLocal()
    try:
        cutoff = datetime.now(timezone.utc) - timedelta(days=30)
        deleted = db.query(Document).filter(
            Document.deleted_at != None,
            Document.deleted_at < cutoff,
        ).delete(synchronize_session=False)
        db.commit()
        if deleted:
            logger.info(f"[cleanup] 휴지통 {deleted}개 문서 영구 삭제")
    except Exception as e:
        logger.warning(f"[cleanup] 실패: {e}")
    finally:
        db.close()

def start_scheduler():
    """
    FastAPI 앱 시작 시 호출 — 스케줄러를 시작하고 두 작업을 등록한다.
    이미 실행 중이면 중복 등록하지 않음.
    """
    if scheduler.running:
        return

    scheduler.add_job(
        sync_all_premium_emails,
        trigger=IntervalTrigger(minutes=2),
        id="email_sync",
        replace_existing=True,
    )

    scheduler.add_job(
        generate_daily_briefings,
        trigger=CronTrigger(hour=8, minute=0),
        id="daily_briefing",
        replace_existing=True,
    )

    scheduler.add_job(
        cleanup_old_trash,
        trigger=CronTrigger(hour=3, minute=0),
        id="trash_cleanup",
        replace_existing=True,
    )

    scheduler.start()
    logger.info("[scheduler] 스케줄러 시작됨")

from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import os
from dotenv import load_dotenv

load_dotenv()

from routers.documents import router as documents_router
from routers.ai import router as ai_router
from routers.users import router as users_router
from routers.auth import router as auth_router
from routers.folders import router as folders_router
from routers.gmail import router as gmail_router
from routers.tags import router as tags_router
from routers.email_filters import router as email_filters_router
from routers.search import router as search_router
from routers.briefing import router as briefing_router
from routers.email_sync import router as email_sync_router
from routers.chat import router as chat_router
from routers.friends import router as friends_router
from routers.calendar import router as calendar_router
from scheduler import start_scheduler

def _migrate_calendar() -> None:
    """CalendarEvent.confirmed 컬럼이 없으면 추가하고, 그때 한 번만 자동 추출 일정 시각을 보정한다.

    예전에는 메일에서 뽑은 일정을 UTC로, 화면에서 만든 일정을 한국 시각으로 저장해서
    메일 일정이 캘린더에 9시간 일찍 보였다. 이제 모두 한국 시각으로 저장한다.
    컬럼 추가와 보정을 한 트랜잭션에서 해서 서버가 여러 번 재시작돼도 보정은 한 번만 된다.
    """
    from sqlalchemy import text
    from database import engine
    try:
        with engine.begin() as conn:
            exists = conn.execute(text(
                "SELECT 1 FROM information_schema.columns "
                "WHERE table_name = 'CalendarEvent' AND column_name = 'confirmed'"
            )).first()
            if exists:
                return
            conn.execute(text('ALTER TABLE "CalendarEvent" ADD COLUMN confirmed BOOLEAN NOT NULL DEFAULT TRUE'))
            fixed = conn.execute(text(
                'UPDATE "CalendarEvent" SET event_date = event_date + INTERVAL \'9 hours\' WHERE auto_extracted = TRUE'
            )).rowcount
            print(f"[migrate] CalendarEvent.confirmed 추가 / 메일 일정 {fixed}개 시각 보정")
    except Exception as e:
        print(f"[migrate] CalendarEvent 마이그레이션 실패: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    _migrate_calendar()
    start_scheduler()
    yield

app = FastAPI(lifespan=lifespan)

_UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "uploads")
os.makedirs(_UPLOAD_DIR, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=_UPLOAD_DIR), name="uploads")

_FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://localhost:5173")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[_FRONTEND_URL],
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

@app.api_route("/health", methods=["GET", "HEAD"])
def health_check():
    return {"status": "ok"}

app.include_router(documents_router)
app.include_router(ai_router)
app.include_router(users_router)
app.include_router(folders_router)
app.include_router(auth_router, prefix="/auth")
app.include_router(gmail_router)
app.include_router(tags_router)
app.include_router(email_filters_router)
app.include_router(search_router)
app.include_router(briefing_router)
app.include_router(email_sync_router)
app.include_router(chat_router)
app.include_router(friends_router)
app.include_router(calendar_router)

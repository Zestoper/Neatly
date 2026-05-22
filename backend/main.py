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


@asynccontextmanager
async def lifespan(app: FastAPI):
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

@app.get("/health")
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

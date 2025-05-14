from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from groq import Groq
import os
from dotenv import load_dotenv
from sqlalchemy.orm import Session
from models import Document, User
from routers.auth import get_current_user, get_db

load_dotenv()

router = APIRouter()

client = Groq(api_key=os.environ["GROQ_API_KEY"])

GROQ_MODEL_FAST = "llama-3.1-8b-instant"
GROQ_MODEL_SMART = "llama-3.3-70b-versatile"


class SummaryRequest(BaseModel):
    content: str


class HistoryMessage(BaseModel):
    role: str   # "user" or "ai"
    text: str

class AskRequest(BaseModel):
    document_id: str | None = None
    text: str | None = None       # 이메일 등 document_id 없이 텍스트를 직접 전달할 때 사용
    question: str
    history: list[HistoryMessage] = []


# POST /ai/summarize — 텍스트를 받아 AI 요약 결과 반환
@router.post("/ai/summarize")
def summarize(data: SummaryRequest):
    try:
        response = client.chat.completions.create(
            model=GROQ_MODEL_FAST,
            messages=[
                {
                    "role": "system",
                    "content": "당신은 문서 요약 전문가입니다. 주어진 텍스트를 2~3문장으로 핵심만 간결하게 요약하세요. 요약문만 출력하고 다른 설명은 붙이지 마세요."
                },
                {
                    "role": "user",
                    "content": data.content
                }
            ],
            max_tokens=300,
        )
        return {"summary": response.choices[0].message.content}
    except Exception:
        raise HTTPException(status_code=502, detail="AI 요약에 실패했습니다. 잠시 후 다시 시도해주세요.")


# POST /ai/ask — 문서 본문을 컨텍스트로 질문에 답변 (Standard 이상)
@router.post("/ai/ask")
def ask_document(
    data: AskRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.plan not in ("STANDARD", "PREMIUM"):
        raise HTTPException(status_code=403, detail="Standard 이상 플랜에서 사용할 수 있습니다.")

    if data.document_id:
        doc = db.query(Document).filter(
            Document.id == data.document_id,
            Document.user_id == current_user.id,
            Document.deleted_at == None,
        ).first()
        if not doc:
            raise HTTPException(status_code=404, detail="문서를 찾을 수 없습니다.")
        context = (doc.raw_text or "").strip()[:6000]
        if not context:
            raise HTTPException(status_code=422, detail="문서에 내용이 없습니다.")
    elif data.text:
        context = data.text.strip()[:6000]
    else:
        raise HTTPException(status_code=422, detail="document_id 또는 text를 제공해야 합니다.")

    history_messages = [
        {"role": "user" if m.role == "user" else "assistant", "content": m.text}
        for m in data.history
    ]

    try:
        response = client.chat.completions.create(
            model=GROQ_MODEL_SMART,
            temperature=0.4,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "당신은 친절하고 유능한 AI 어시스턴트입니다.\n"
                        "아래 문서가 참고자료로 제공됩니다. 문서와 관련된 질문은 문서를 우선 참고하고, 일반 질문은 자유롭게 답변하세요.\n"
                        "중요: 이전 대화 맥락을 반드시 유지하세요. 사용자가 '더 정중하게', '짧게', '다시' 등 수정을 요청하면 바로 직전 답변을 기준으로 수정해 주세요.\n"
                        "이메일·메시지 작성 요청 시 [이름], [프로젝트명] 같은 플레이스홀더를 쓰지 말고 자연스러운 문장으로 작성하세요.\n"
                        "마크다운 기호(#, **, -, ``` 등)는 사용하지 마세요.\n\n"
                        f"[참고 문서]\n{context}"
                    ),
                },
                *history_messages,
                {
                    "role": "user",
                    "content": data.question,
                },
            ],
            max_tokens=400,
        )
        return {"answer": response.choices[0].message.content}
    except Exception:
        raise HTTPException(status_code=502, detail="AI 응답에 실패했습니다. 잠시 후 다시 시도해주세요.")

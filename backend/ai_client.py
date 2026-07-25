"""
Groq를 기본으로 사용하고, 레이트리밋/장애 시 Cerebras로 자동 폴백하는 공용 AI 클라이언트.
CEREBRAS_API_KEY가 설정되어 있지 않으면 폴백 없이 Groq 오류를 그대로 올린다.
"""
import os
from groq import Groq
from groq import RateLimitError, InternalServerError, APIConnectionError, APITimeoutError
from dotenv import load_dotenv

load_dotenv()

GROQ_MODEL_SMART = "llama-3.3-70b-versatile"
GROQ_MODEL_FAST = "llama-3.1-8b-instant"

# Groq 모델 -> 장애 시 대신 사용할 Cerebras 모델
_CEREBRAS_FALLBACK_MODEL = {
    GROQ_MODEL_SMART: "gpt-oss-120b",
    GROQ_MODEL_FAST: "gemma-4-31b",
}
_CEREBRAS_DEFAULT_MODEL = "gpt-oss-120b"

_FALLBACK_TRIGGERS = (RateLimitError, InternalServerError, APIConnectionError, APITimeoutError)

_groq_client = Groq(api_key=os.environ["GROQ_API_KEY"])

_cerebras_client = None
if os.environ.get("CEREBRAS_API_KEY"):
    from cerebras.cloud.sdk import Cerebras
    _cerebras_client = Cerebras(api_key=os.environ["CEREBRAS_API_KEY"])

def create_chat_completion(*, model: str, messages: list, temperature: float = 0.3, max_tokens: int = 1000):
    """
    Groq로 채팅 완성을 생성하고, 레이트리밋/서버 장애/타임아웃 시 Cerebras로 폴백한다.
    반환값은 Groq/Cerebras 응답 객체(양쪽 다 choices[0].message.content로 접근 가능)와 동일한 형태.
    """
    try:
        return _groq_client.chat.completions.create(
            model=model,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
        )
    except _FALLBACK_TRIGGERS:
        if not _cerebras_client:
            raise
        fallback_model = _CEREBRAS_FALLBACK_MODEL.get(model, _CEREBRAS_DEFAULT_MODEL)
        extra = {}
        if fallback_model == "gpt-oss-120b":
            # 추론형 모델이라 reasoning 토큰을 먼저 소모함 - effort를 낮추고 여유분을 더 준다.
            extra["reasoning_effort"] = "low"
            max_tokens = max_tokens + 80
        return _cerebras_client.chat.completions.create(
            model=fallback_model,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
            **extra,
        )

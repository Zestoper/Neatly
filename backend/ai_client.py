"""
Groq를 기본으로 사용하고, 레이트리밋/장애 시 Cerebras로 자동 폴백하는 공용 AI 클라이언트.
CEREBRAS_API_KEY가 설정되어 있지 않으면 폴백 없이 Groq 오류를 그대로 올린다.
"""
import os
from groq import Groq
from groq import RateLimitError, InternalServerError, APIConnectionError, APITimeoutError, APIStatusError
from dotenv import load_dotenv

load_dotenv()

# llama-3.3-70b-versatile / llama-3.1-8b-instant는 2026-08-16 종료 → Groq 권장 대체 모델
GROQ_MODEL_SMART = "openai/gpt-oss-120b"
GROQ_MODEL_FAST = "openai/gpt-oss-20b"

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

# Groq는 모델마다 하루 토큰 한도(TPD)가 따로 있다.
# 120b 한도가 바닥나면(실제로 2026-11-02 하루 20만 토큰 소진) 같은 Groq의 20b로 먼저 넘긴다.
_GROQ_FALLBACK_MODEL = {
    GROQ_MODEL_SMART: GROQ_MODEL_FAST,
}


def _groq_call(model: str, messages: list, temperature: float, max_tokens: int):
    extra = {}
    if model.startswith("openai/gpt-oss"):
        # 추론형 모델이라 생각하는 토큰도 max_tokens에 포함 — 추론은 짧게 하고 여유분을 준다.
        extra["reasoning_effort"] = "low"
        max_tokens = max_tokens + 512
    return _groq_client.chat.completions.create(
        model=model,
        messages=messages,
        temperature=temperature,
        max_tokens=max_tokens,
        extra_body=extra or None,
    )


def _should_fallback(e: Exception) -> bool:
    # 한도 초과(429) · 요청이 분당 한도보다 큼(413) · 서버 장애 · 타임아웃만 다른 모델로 넘긴다.
    # 그 밖의 4xx(잘못된 요청)는 다른 곳으로 넘겨도 같으므로 그대로 올린다.
    if isinstance(e, _FALLBACK_TRIGGERS):
        return True
    return isinstance(e, APIStatusError) and getattr(e, "status_code", None) == 413


def create_chat_completion(*, model: str, messages: list, temperature: float = 0.3, max_tokens: int = 1000):
    """
    Groq(요청 모델) → Groq(대체 모델) → Cerebras 순서로 시도한다.
    반환값은 Groq/Cerebras 응답 객체(양쪽 다 choices[0].message.content로 접근 가능)와 동일한 형태.
    실패할 때마다 원인을 로그로 남긴다.
    """
    last_err: Exception | None = None
    for groq_model in dict.fromkeys([model, _GROQ_FALLBACK_MODEL.get(model, model)]):
        try:
            return _groq_call(groq_model, messages, temperature, max_tokens)
        except (*_FALLBACK_TRIGGERS, APIStatusError) as e:
            print(f"[AI] Groq 실패 model={groq_model} {type(e).__name__} status={getattr(e, 'status_code', None)}: {str(e)[:160]}")
            if not _should_fallback(e):
                raise
            last_err = e

    if not _cerebras_client:
        raise last_err
    fallback_model = _CEREBRAS_FALLBACK_MODEL.get(model, _CEREBRAS_DEFAULT_MODEL)
    extra = {}
    if fallback_model == "gpt-oss-120b":
        # 추론형 모델이라 reasoning 토큰을 먼저 소모함 - effort를 낮추고 여유분을 더 준다.
        extra["reasoning_effort"] = "low"
        max_tokens = max_tokens + 80
    try:
        return _cerebras_client.chat.completions.create(
            model=fallback_model,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
            **extra,
        )
    except Exception as e2:
        print(f"[AI] Cerebras 폴백도 실패 model={fallback_model} {type(e2).__name__}: {str(e2)[:200]}")
        raise

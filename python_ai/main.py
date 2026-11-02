import hmac
import json
import os
import re
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated, Literal

import httpx
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import StreamingResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field, model_validator

load_dotenv(Path(__file__).resolve().parent.parent / "backend" / ".env")

GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models"
DEFAULT_MODEL = "gemini-flash-lite-latest"
MAX_CONTEXT_CHARS = 80000
MAX_OUTPUT_TOKENS = int(os.getenv("GEMINI_MAX_OUTPUT_TOKENS", "2048"))
if not 1 <= MAX_OUTPUT_TOKENS <= 8192:
    raise RuntimeError("GEMINI_MAX_OUTPUT_TOKENS must be between 1 and 8192.")
bearer_scheme = HTTPBearer(auto_error=False)


class ChatMessage(BaseModel):
    role: Literal["user", "model"]
    text: str = Field(min_length=1, max_length=12000)


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1, max_length=40)

    @model_validator(mode="after")
    def validate_turn_order(self):
        if self.messages[-1].role != "user":
            raise ValueError("The conversation must end with a user message.")
        if any(message.role != ("user" if index % 2 == 0 else "model") for index, message in enumerate(self.messages)):
            raise ValueError("Conversation messages must alternate between user and model.")
        return self


def service_token() -> str:
    return os.getenv("CHAT_SERVICE_TOKEN", "").strip()


async def require_service_token(
    credentials: Annotated[
        HTTPAuthorizationCredentials | None, Depends(bearer_scheme)
    ],
) -> None:
    expected = service_token()
    if len(expected) < 32:
        raise HTTPException(
            status_code=503,
            detail={
                "code": "CHAT_SERVICE_NOT_CONFIGURED",
                "message": "The internal chat service token is not configured.",
            },
        )
    if credentials is None or not hmac.compare_digest(
        credentials.credentials, expected
    ):
        raise HTTPException(
            status_code=401,
            detail={"code": "CHAT_SERVICE_UNAUTHORIZED", "message": "Unauthorized."},
        )


def gemini_error(response: httpx.Response) -> HTTPException:
    status = response.status_code
    if status == 429:
        code = "GEMINI_QUOTA_EXCEEDED"
        message = "Gemini rate limit or quota reached. Please try again later."
        public_status = 429
    elif status in (401, 403):
        code = "GEMINI_CONFIGURATION_ERROR"
        message = "Gemini rejected the server API key. Check the backend Gemini configuration."
        public_status = 503
    elif status == 404:
        code = "GEMINI_MODEL_UNAVAILABLE"
        message = "The configured Gemini model is unavailable. Check GEMINI_MODEL."
        public_status = 503
    elif status == 400:
        code = "GEMINI_REQUEST_FAILED"
        message = "Gemini could not process this request. Try a shorter prompt."
        public_status = 502
    else:
        code = "GEMINI_UPSTREAM_UNAVAILABLE"
        message = "Gemini is temporarily unavailable. Please try again."
        public_status = 502
    return HTTPException(
        status_code=public_status, detail={"code": code, "message": message}
    )


def gemini_text(payload: dict) -> str:
    candidates = payload.get("candidates") or []
    if not candidates:
        return ""
    content = candidates[0].get("content") or {}
    return "".join(
        part.get("text", "")
        for part in content.get("parts", [])
        if isinstance(part.get("text"), str)
    )


def event_stream(event: str, payload: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.gemini_client = httpx.AsyncClient(
        timeout=httpx.Timeout(connect=10, read=90, write=20, pool=10)
    )
    try:
        yield
    finally:
        await app.state.gemini_client.aclose()


app = FastAPI(title="NoteFlow AI Chat Service", lifespan=lifespan)


@app.get("/health")
async def health():
    return {"status": "ok", "service": "NoteFlow AI Chat"}


@app.post("/v1/chat/stream", dependencies=[Depends(require_service_token)])
async def stream_chat(body: ChatRequest, request: Request):
    api_key = os.getenv("GEMINI_API_KEY") or os.getenv("NotflowAi_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail={
                "code": "GEMINI_NOT_CONFIGURED",
                "message": "Gemini is not configured. Set GEMINI_API_KEY in backend/.env.",
            },
        )

    if sum(len(message.text) for message in body.messages) > MAX_CONTEXT_CHARS:
        raise HTTPException(
            status_code=413,
            detail={
                "code": "CHAT_CONTEXT_TOO_LARGE",
                "message": "This conversation is too long to continue. Start a new chat.",
            },
        )

    model = os.getenv("GEMINI_MODEL", DEFAULT_MODEL).strip() or DEFAULT_MODEL
    if not re.fullmatch(r"[A-Za-z0-9._-]{1,120}", model):
        raise HTTPException(
            status_code=503,
            detail={
                "code": "GEMINI_MODEL_INVALID",
                "message": "The configured Gemini model name is invalid.",
            },
        )

    url = f"{GEMINI_API_BASE}/{model}:streamGenerateContent"
    upstream_request = request.app.state.gemini_client.build_request(
        "POST",
        url,
        params={"alt": "sse"},
        headers={"x-goog-api-key": api_key},
        json={
            "contents": [
                {"role": message.role, "parts": [{"text": message.text}]}
                for message in body.messages
            ],
            "generationConfig": {"maxOutputTokens": MAX_OUTPUT_TOKENS},
        },
    )
    try:
        upstream = await request.app.state.gemini_client.send(
            upstream_request, stream=True
        )
    except httpx.TimeoutException as error:
        raise HTTPException(
            status_code=504,
            detail={
                "code": "GEMINI_TIMEOUT",
                "message": "Gemini took too long to respond. Please retry.",
            },
        ) from error
    except httpx.HTTPError as error:
        raise HTTPException(
            status_code=502,
            detail={
                "code": "GEMINI_UPSTREAM_UNAVAILABLE",
                "message": "Gemini is temporarily unavailable. Please try again.",
            },
        ) from error

    if not upstream.is_success:
        await upstream.aread()
        await upstream.aclose()
        raise gemini_error(upstream)

    async def generate():
        emitted_text = False
        try:
            async for line in upstream.aiter_lines():
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if not data or data == "[DONE]":
                    continue
                try:
                    text = gemini_text(json.loads(data))
                except (json.JSONDecodeError, AttributeError, TypeError):
                    yield event_stream(
                        "error",
                        {
                            "code": "GEMINI_INVALID_RESPONSE",
                            "message": "Gemini returned an unreadable response. Please retry.",
                        },
                    )
                    return
                if text:
                    emitted_text = True
                    yield event_stream("delta", {"text": text})
            if not emitted_text:
                yield event_stream(
                    "error",
                    {
                        "code": "GEMINI_EMPTY_RESPONSE",
                        "message": "Gemini returned an empty response. Please retry.",
                    },
                )
            else:
                yield event_stream("complete", {})
        except httpx.HTTPError:
            yield event_stream(
                "error",
                {
                    "code": "GEMINI_UPSTREAM_INTERRUPTED",
                    "message": "The Gemini connection was interrupted. Retry this response.",
                },
            )
        finally:
            await upstream.aclose()

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"},
    )
import json

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.auth import require_admin
from app.config import settings
from app.database import get_db
from app.models import User
from app.schemas import AssistantChatIn
from app.services.assistant import run_chat

router = APIRouter(prefix="/assistant", tags=["assistant"], dependencies=[Depends(require_admin)])


@router.post("/chat")
def chat(body: AssistantChatIn, db: Session = Depends(get_db), user: User = Depends(require_admin)):
    # Cheap pre-flight so the common "never configured" case gets a real 503
    # -- once StreamingResponse starts, the HTTP status is already committed
    # to 200 and can't retroactively change.
    if not settings.anthropic_api_key:
        raise HTTPException(status_code=503, detail="The AI assistant isn't set up yet on this server -- ask your admin to add an API key.")

    history = [h.model_dump() for h in body.history]

    def event_stream():
        try:
            for event in run_chat(db, user, body.message, history):
                yield json.dumps(event) + "\n"
        except Exception as e:
            yield json.dumps({"type": "error", "message": f"Something went wrong: {e}"}) + "\n"

    return StreamingResponse(event_stream(), media_type="application/x-ndjson",
                             headers={"X-Accel-Buffering": "no"})

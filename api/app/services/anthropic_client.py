"""Builds the Anthropic client used by every AI feature (plan reading, the
admin "ask ShopStock" assistant).

The installed SDK sends api_key via an `Authorization: Bearer` header by
default. Some Console-issued keys (the personal/individual-org "sk-ant-usr-"
ones, as opposed to the org "sk-ant-api03-" ones) are only valid against
Anthropic's `x-api-key` auth path and get a 401 "Invalid bearer token" over
Bearer -- confirmed by curl'ing the same key both ways against a real
ShopStock deployment. Sending it explicitly as x-api-key instead works for
both key styles, so that's what every caller uses."""

import anthropic

from app.config import settings


def get_anthropic_client() -> anthropic.Anthropic:
    if not settings.anthropic_api_key:
        raise RuntimeError("ANTHROPIC_API_KEY is not configured")
    return anthropic.Anthropic(
        api_key=settings.anthropic_api_key,
        default_headers={"x-api-key": settings.anthropic_api_key, "authorization": anthropic.Omit()},
    )

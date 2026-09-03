"""Chat-with-tools loop for the admin console's "ask ShopStock" panel.

Manual agentic loop (not the beta Tool Runner -- avoids its known pause_turn
auto-resume gap and keeps full control over the streamed event shape). Every
tool is a thin, STRICTLY READ-ONLY wrapper around existing route-handler
logic (called directly as plain functions, db= passed explicitly) so no
query logic is duplicated and nothing here can create/update/delete data --
none of these functions may call db.add/db.delete/db.commit."""

import json
from collections.abc import Callable, Generator
from datetime import date, datetime
from decimal import Decimal
from typing import Any

import anthropic
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.config import settings
from app.models import Job, User
from app.routers.estimates import get_estimate as _route_get_estimate
from app.routers.estimates import list_estimates as _route_list_estimates
from app.routers.expenses import list_expenses as _route_list_expenses
from app.routers.items import list_items as _route_list_items
from app.routers.jobs import job_costing as _route_job_costing
from app.routers.jobs import list_jobs as _route_list_jobs
from app.routers.reports import pnl as _route_pnl
from app.routers.reports import reorder_report as _route_reorder_report
from app.routers.reports import timesheet as _route_timesheet
from app.schemas import JobOut
from app.services.dates import to_local

MODEL = "claude-sonnet-5"
MAX_TOKENS = 64000
MAX_TOOL_ROUNDS = 6  # bounds a runaway tool-call chain; see run_chat()


def _to_json_safe(obj: Any) -> Any:
    """Recursively converts a mix of Pydantic models / ORM-ish dicts / Decimal
    / date(time) into something json.dumps can handle -- and drops any
    `image_data` key (base64 blobs are pure token waste in a text chat)."""
    if isinstance(obj, BaseModel):
        return _to_json_safe(obj.model_dump(mode="json"))
    if isinstance(obj, dict):
        return {k: _to_json_safe(v) for k, v in obj.items() if k != "image_data"}
    if isinstance(obj, (list, tuple)):
        return [_to_json_safe(v) for v in obj]
    if isinstance(obj, Decimal):
        return str(obj)
    if isinstance(obj, (datetime, date)):
        return obj.isoformat()
    return obj


def _dump(result: Any) -> str:
    return json.dumps(_to_json_safe(result))


# ---------- Tool implementations (all read-only) ----------

def _tool_search_items(db: Session, user: User, search: str = "", category: str = "",
                       low_stock_only: bool = False) -> Any:
    return _route_list_items(search=search, category=category, low_stock=low_stock_only, db=db, user=user)


def _tool_get_reorder_report(db: Session, user: User, **_: Any) -> Any:
    return _route_reorder_report(format="", db=db)


def _tool_search_jobs(db: Session, user: User, status: str = "", search: str = "") -> Any:
    jobs = _route_list_jobs(status=status, search=search, db=db, user=user)
    return [JobOut.model_validate(j) for j in jobs]


def _tool_get_job_costing(db: Session, user: User, job_number: str) -> Any:
    job = db.query(Job).filter(Job.job_number.ilike(job_number.strip())).first()
    if not job:
        return {"error": f"No job found matching '{job_number}'. Try search_jobs first to find the right number."}
    return _route_job_costing(job_id=job.id, format="", db=db)


def _tool_get_profit_and_loss(db: Session, user: User, date_from: str = "", date_to: str = "") -> Any:
    return _route_pnl(date_from=date_from, date_to=date_to, format="", db=db)


def _tool_get_timesheet_summary(db: Session, user: User, date_from: str = "", date_to: str = "",
                                tech_name: str = "") -> Any:
    result = _route_timesheet(date_from=date_from, date_to=date_to, format="", db=db)
    if tech_name:
        needle = tech_name.strip().lower()
        result = {"techs": [t for t in result["techs"] if needle in t["user_name"].lower()]}
    return result


def _tool_list_expenses(db: Session, user: User, date_from: str = "", date_to: str = "",
                        job_number: str = "", category: str = "") -> Any:
    job_id = ""
    if job_number:
        job = db.query(Job).filter(Job.job_number.ilike(job_number.strip())).first()
        if not job:
            return {"error": f"No job found matching '{job_number}'."}
        job_id = str(job.id)
    return _route_list_expenses(date_from=date_from, date_to=date_to, job_id=job_id, category=category,
                                format="", db=db)


def _tool_get_estimate(db: Session, user: User, estimate_number: str = "", job_number: str = "") -> Any:
    job_id = None
    if job_number:
        job = db.query(Job).filter(Job.job_number.ilike(job_number.strip())).first()
        if not job:
            return {"error": f"No job found matching '{job_number}'."}
        job_id = job.id
    summaries = _route_list_estimates(job_id=job_id, db=db)
    if estimate_number:
        needle = estimate_number.strip().lower()
        summaries = [s for s in summaries if needle in s.estimate_number.lower()]
    if not summaries:
        return {"error": "No matching estimate found."}
    # Full breakdown for a single clear match; summaries otherwise so Claude can narrow down.
    if len(summaries) == 1:
        return _route_get_estimate(estimate_id=summaries[0].id, db=db)
    return {"multiple_matches": summaries}


TOOLS: dict[str, Callable[..., Any]] = {
    "search_items": _tool_search_items,
    "get_reorder_report": _tool_get_reorder_report,
    "search_jobs": _tool_search_jobs,
    "get_job_costing": _tool_get_job_costing,
    "get_profit_and_loss": _tool_get_profit_and_loss,
    "get_timesheet_summary": _tool_get_timesheet_summary,
    "list_expenses": _tool_list_expenses,
    "get_estimate": _tool_get_estimate,
}

TOOL_DEFS: list[dict] = [
    {
        "name": "search_items",
        "description": "Search inventory items by name/SKU/category and see current stock, cost, and reorder "
                       "point. Use to answer 'how much X do we have', 'what does X cost', 'is X low'.",
        "input_schema": {
            "type": "object",
            "properties": {
                "search": {"type": "string", "description": "Free-text match against item name, SKU, barcode, or description"},
                "category": {"type": "string", "description": "Exact category filter, optional"},
                "low_stock_only": {"type": "boolean", "description": "Only items at/below their reorder point"},
            },
            "additionalProperties": False,
        },
    },
    {
        "name": "get_reorder_report",
        "description": "Every item currently at or below its reorder point, grouped by category. Use for "
                       "'what's low on stock' / 'what do we need to order'.",
        "input_schema": {"type": "object", "properties": {}, "additionalProperties": False},
    },
    {
        "name": "search_jobs",
        "description": "Find jobs by status, job number, name, or customer. Use to resolve a job number/name "
                       "mentioned in the question before calling get_job_costing or get_estimate.",
        "input_schema": {
            "type": "object",
            "properties": {
                "status": {"type": "string", "enum": ["active", "closed"], "description": "optional; omit for all statuses"},
                "search": {"type": "string", "description": "partial match against job number, name, or customer"},
            },
            "additionalProperties": False,
        },
    },
    {
        "name": "get_job_costing",
        "description": "Full lifetime-to-date cost and profit breakdown for one job: materials, labor "
                       "(approved hours x rate), expenses, revenue, and profit. Use for 'how much have we spent "
                       "on JOB-1053', 'is JOB-1053 profitable'.",
        "input_schema": {
            "type": "object",
            "properties": {
                "job_number": {"type": "string", "description": "e.g. 'JOB-1053'. If you don't have the exact number, call search_jobs first."},
            },
            "required": ["job_number"],
            "additionalProperties": False,
        },
    },
    {
        "name": "get_profit_and_loss",
        "description": "Business-wide profit & loss for a date range: revenue minus materials, labor, and "
                       "expenses, broken out by job. Use for 'how are we doing this month', 'total profit for X'.",
        "input_schema": {
            "type": "object",
            "properties": {
                "date_from": {"type": "string", "description": "YYYY-MM-DD, inclusive; omit for no lower bound"},
                "date_to": {"type": "string", "description": "YYYY-MM-DD, inclusive; omit for no upper bound"},
            },
            "additionalProperties": False,
        },
    },
    {
        "name": "get_timesheet_summary",
        "description": "Hours worked per technician over a date range, with shift-level detail and approval "
                       "status. Use for 'how many hours did Ed work this week'.",
        "input_schema": {
            "type": "object",
            "properties": {
                "date_from": {"type": "string", "description": "YYYY-MM-DD"},
                "date_to": {"type": "string", "description": "YYYY-MM-DD"},
                "tech_name": {"type": "string", "description": "optional partial name filter, e.g. 'Ed'"},
            },
            "additionalProperties": False,
        },
    },
    {
        "name": "list_expenses",
        "description": "List logged expenses, optionally filtered by date range, job, or category.",
        "input_schema": {
            "type": "object",
            "properties": {
                "date_from": {"type": "string"},
                "date_to": {"type": "string"},
                "job_number": {"type": "string", "description": "optional; omit for all jobs + overhead"},
                "category": {"type": "string", "enum": ["fuel", "tools_equipment", "permits_fees", "subcontractor",
                                                        "office_admin", "insurance", "travel", "misc"]},
            },
            "additionalProperties": False,
        },
    },
    {
        "name": "get_estimate",
        "description": "Look up an estimate by its number (e.g. 'EST-1042') or by job number, including line "
                       "items, material/labor totals, and profit margin. Give at least one of the two.",
        "input_schema": {
            "type": "object",
            "properties": {
                "estimate_number": {"type": "string"},
                "job_number": {"type": "string"},
            },
            "additionalProperties": False,
        },
    },
]

_LABELS: dict[str, Callable[[dict], str]] = {
    "search_items": lambda i: f"Looking up '{i.get('search') or 'items'}'...",
    "get_reorder_report": lambda i: "Checking what's low on stock...",
    "search_jobs": lambda i: "Looking up jobs...",
    "get_job_costing": lambda i: f"Pulling costs for {i.get('job_number', 'that job')}...",
    "get_profit_and_loss": lambda i: "Crunching profit & loss...",
    "get_timesheet_summary": lambda i: "Checking hours" + (f" for {i['tech_name']}" if i.get("tech_name") else "") + "...",
    "list_expenses": lambda i: "Looking up expenses...",
    "get_estimate": lambda i: "Looking up that estimate...",
}


def _label_for(tool_name: str, tool_input: dict) -> str:
    fn = _LABELS.get(tool_name)
    try:
        return fn(tool_input) if fn else "Looking things up..."
    except Exception:
        return "Looking things up..."


def _system_prompt() -> str:
    now_local = to_local(datetime.utcnow())
    return f"""You are the ShopStock assistant, embedded in the admin console of APEX Electrical \
Group's inventory/estimating/timesheet system. You're talking to an APEX admin (not a technician, \
not a customer) looking at real shop data through you.

Today's date is {now_local.strftime('%A, %B %d, %Y')} ({settings.display_timezone}).

You have tools that query APEX's real database: item stock, jobs, job costing, profit & loss, \
timesheets, expenses, and estimates. ALWAYS use a tool to look up a number before stating it -- \
never guess, estimate, or recall a figure from earlier in the conversation without re-checking if \
there's any doubt. If a job number, tech name, or date range in the question is ambiguous, use the \
search/list tools to resolve it rather than asking the user to be more precise, unless the tools \
genuinely return nothing plausible.

Money values are dollars. Be concise -- this is a quick lookup tool, not a report generator. When \
you cite a number, briefly name what it covers (e.g. "materials + labor + expenses" for a job cost) \
so the admin knows what's included."""


def run_chat(db: Session, user: User, message: str, history: list[dict]) -> Generator[dict, None, None]:
    """Yields NDJSON-ready event dicts: text / tool_start / tool_end / done / error.
    Raises RuntimeError("...ANTHROPIC_API_KEY...") if unconfigured -- caught by the router."""
    if not settings.anthropic_api_key:
        raise RuntimeError("ANTHROPIC_API_KEY is not configured")

    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
    messages: list[dict] = [*history, {"role": "user", "content": message}]

    for round_num in range(MAX_TOOL_ROUNDS + 1):
        with client.messages.stream(
            model=MODEL, max_tokens=MAX_TOKENS, thinking={"type": "adaptive"},
            system=_system_prompt(), tools=TOOL_DEFS, messages=messages,
        ) as stream:
            for text in stream.text_stream:
                yield {"type": "text", "text": text}
            final = stream.get_final_message()

        if final.stop_reason != "tool_use":
            yield {"type": "done"}
            return

        if round_num == MAX_TOOL_ROUNDS:
            yield {"type": "text", "text": "\n\nI wasn't able to finish that -- try narrowing your question "
                                           "(e.g. a specific job number or a shorter date range)."}
            yield {"type": "done"}
            return

        messages.append({"role": "assistant", "content": final.content})
        tool_results = []
        for block in final.content:
            if block.type != "tool_use":
                continue
            yield {"type": "tool_start", "tool": block.name, "label": _label_for(block.name, block.input)}
            try:
                result = TOOLS[block.name](db, user, **block.input)
                content = _dump(result)
            except Exception as e:
                content = json.dumps({"error": str(e)})
            yield {"type": "tool_end", "tool": block.name}
            tool_results.append({"type": "tool_result", "tool_use_id": block.id, "content": content})
        messages.append({"role": "user", "content": tool_results})

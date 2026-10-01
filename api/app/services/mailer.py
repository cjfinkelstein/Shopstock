"""Sends outbound email (estimate-ready links, admin password resets) over
SMTP, using whatever mailbox an admin connects on the Settings page (Gmail,
Office365, etc.) -- no third-party transactional-email service. Fails loudly
with a clear RuntimeError rather than silently no-opping, matching the
convention app/services/plan_analysis.py uses for its own missing-API-key
case."""

import smtplib
from dataclasses import dataclass
from email.message import EmailMessage
from email.utils import formataddr

from sqlalchemy.orm import Session

from app.config import settings
from app.models import Estimate, SmtpSettings

_BUTTON_STYLE = (
    "display:inline-block;padding:12px 28px;background:#4338ca;color:#ffffff;"
    "text-decoration:none;border-radius:10px;font-weight:600;font-size:15px;"
)


@dataclass
class SmtpConfig:
    host: str
    port: int
    use_tls: bool
    username: str
    password: str
    from_address: str
    from_name: str


def resolve_smtp_config(db: Session) -> SmtpConfig:
    """The Settings-page row (smtp_settings, id=1) takes priority; the old
    env-var SMTP_* fields are the fallback for a deploy that hasn't set up
    the DB row yet."""
    row = db.get(SmtpSettings, 1)
    if row and row.host and row.from_address:
        return SmtpConfig(
            host=row.host, port=row.port, use_tls=row.use_tls,
            username=row.username or "", password=row.password or "",
            from_address=row.from_address, from_name=row.from_name or settings.smtp_from_name,
        )
    return SmtpConfig(
        host=settings.smtp_host, port=settings.smtp_port, use_tls=settings.smtp_use_tls,
        username=settings.smtp_username, password=settings.smtp_password,
        from_address=settings.smtp_from_address, from_name=settings.smtp_from_name,
    )


def _html_body(from_name: str, estimate: Estimate, view_url: str, total: str) -> str:
    who = estimate.customer or "there"
    return f"""\
<div style="font-family:Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1e293b;">
  <p style="font-size:13px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#64748b;margin:0 0 4px;">
    {from_name}
  </p>
  <h1 style="font-size:20px;margin:0 0 16px;">Estimate {estimate.estimate_number}</h1>
  <p style="font-size:15px;line-height:1.5;margin:0 0 20px;">
    Hi {who}, your estimate for <strong>${total}</strong> is ready to review.
    Click below to see the full scope of work and approve or decline online.
  </p>
  <p style="margin:0 0 20px;">
    <a href="{view_url}" style="{_BUTTON_STYLE}">View &amp; Respond to Estimate</a>
  </p>
  <p style="font-size:13px;color:#64748b;line-height:1.5;margin:0;">
    Or copy this link into your browser:<br>
    <a href="{view_url}" style="color:#4338ca;">{view_url}</a>
  </p>
</div>
"""


def send_estimate_email(db: Session, to_address: str, estimate: Estimate, view_url: str, total: str) -> None:
    """Raises RuntimeError if SMTP isn't configured yet, or the send fails."""
    cfg = resolve_smtp_config(db)
    text = (
        f"Your estimate {estimate.estimate_number} for ${total} is ready to review.\n\n"
        f"View and respond here: {view_url}\n"
    )
    _send(
        cfg, to_address, f"Estimate {estimate.estimate_number} from {cfg.from_name}",
        text, _html_body(cfg.from_name, estimate, view_url, total),
    )


def _send(cfg: SmtpConfig, to_address: str, subject: str, text_body: str, html_body: str) -> None:
    if not cfg.host or not cfg.from_address:
        raise RuntimeError("Email isn't set up yet -- add it in Settings.")

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = formataddr((cfg.from_name, cfg.from_address))
    msg["To"] = to_address
    msg.set_content(text_body)
    msg.add_alternative(html_body, subtype="html")

    try:
        with smtplib.SMTP(cfg.host, cfg.port, timeout=15) as smtp:
            if cfg.use_tls:
                smtp.starttls()
            if cfg.username:
                smtp.login(cfg.username, cfg.password)
            smtp.send_message(msg)
    except Exception as e:
        raise RuntimeError(str(e)) from e


def send_password_reset_email(db: Session, to_address: str, name: str, reset_url: str) -> None:
    """Raises RuntimeError if SMTP isn't configured yet, or the send fails."""
    cfg = resolve_smtp_config(db)
    html = f"""\
<div style="font-family:Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1e293b;">
  <p style="font-size:13px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#64748b;margin:0 0 4px;">
    {cfg.from_name}
  </p>
  <h1 style="font-size:20px;margin:0 0 16px;">Reset your admin password</h1>
  <p style="font-size:15px;line-height:1.5;margin:0 0 20px;">
    Hi {name}, we got a request to reset the password on your {settings.app_name} admin account.
    This link works once and expires in 1 hour.
  </p>
  <p style="margin:0 0 20px;">
    <a href="{reset_url}" style="{_BUTTON_STYLE}">Reset Password</a>
  </p>
  <p style="font-size:13px;color:#64748b;line-height:1.5;margin:0;">
    Or copy this link into your browser:<br>
    <a href="{reset_url}" style="color:#4338ca;">{reset_url}</a><br><br>
    Didn't request this? You can safely ignore this email -- your password won't change.
  </p>
</div>
"""
    text = (
        f"We got a request to reset the password on your {settings.app_name} admin account.\n\n"
        f"Reset it here (expires in 1 hour): {reset_url}\n\n"
        "Didn't request this? You can safely ignore this email -- your password won't change."
    )
    _send(cfg, to_address, f"Reset your {settings.app_name} password", text, html)

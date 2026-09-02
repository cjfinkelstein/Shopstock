"""Sends the customer-facing "your estimate is ready" email over SMTP, using
whatever company mailbox the admin configures (Gmail, Office365, etc.) --
no third-party transactional-email service. Fails loudly with a clear
RuntimeError rather than silently no-opping, matching the convention
app/services/plan_analysis.py uses for its own missing-API-key case."""

import smtplib
from email.message import EmailMessage
from email.utils import formataddr

from app.config import settings
from app.models import Estimate

_BUTTON_STYLE = (
    "display:inline-block;padding:12px 28px;background:#4338ca;color:#ffffff;"
    "text-decoration:none;border-radius:10px;font-weight:600;font-size:15px;"
)


def _html_body(estimate: Estimate, view_url: str, total: str) -> str:
    who = estimate.customer or "there"
    return f"""\
<div style="font-family:Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1e293b;">
  <p style="font-size:13px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#64748b;margin:0 0 4px;">
    {settings.smtp_from_name}
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


def send_estimate_email(to_address: str, estimate: Estimate, view_url: str, total: str) -> None:
    """Raises RuntimeError if SMTP isn't configured yet, or the send fails."""
    if not settings.smtp_host or not settings.smtp_from_address:
        raise RuntimeError("Email isn't set up yet -- ask your admin to add SMTP settings.")

    msg = EmailMessage()
    msg["Subject"] = f"Estimate {estimate.estimate_number} from {settings.smtp_from_name}"
    msg["From"] = formataddr((settings.smtp_from_name, settings.smtp_from_address))
    msg["To"] = to_address
    msg.set_content(
        f"Your estimate {estimate.estimate_number} for ${total} is ready to review.\n\n"
        f"View and respond here: {view_url}\n"
    )
    msg.add_alternative(_html_body(estimate, view_url, total), subtype="html")

    try:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15) as smtp:
            if settings.smtp_use_tls:
                smtp.starttls()
            if settings.smtp_username:
                smtp.login(settings.smtp_username, settings.smtp_password)
            smtp.send_message(msg)
    except Exception as e:
        raise RuntimeError(str(e)) from e

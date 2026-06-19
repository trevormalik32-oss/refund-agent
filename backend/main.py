"""
main.py — Loopp Refund Agent API

Architecture:
  - A "ticket" is the unit of work: one customer interaction, one refund case.
  - Each ticket has a status lifecycle: open → in_progress → resolved | escalated | closed
  - The customer chat endpoint works within a ticket context.
  - Admin endpoints are password-protected via Bearer token (set ADMIN_PASSWORD in .env).
  - All agent reasoning traces are stored on the ticket, not exposed to the customer.
"""

import os
import uuid
import hashlib
import secrets
from datetime import datetime, timezone
from typing import Optional, Literal
from collections import defaultdict

from fastapi import FastAPI, HTTPException, Depends, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv()

from agent import run_agent, get_active_model
from database import list_customers, get_policy

app = FastAPI(title="Loopp Refund Agent API", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Auth ──────────────────────────────────────────────────────────────────────

ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "admin123")

# We issue a simple session token on login rather than checking password on every request.
# In production this would be a signed JWT with expiry.
_admin_tokens: set[str] = set()

def _require_admin(authorization: Optional[str] = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Admin authentication required.")
    token = authorization.removeprefix("Bearer ").strip()
    if token not in _admin_tokens:
        raise HTTPException(status_code=401, detail="Invalid or expired admin token.")
    return token

# ── Ticket store ──────────────────────────────────────────────────────────────
#
# Ticket shape:
# {
#   "ticket_id":     str,
#   "created_at":    ISO str,
#   "updated_at":    ISO str,
#   "status":        "open" | "in_progress" | "resolved" | "escalated" | "closed",
#   "resolution":    "approved" | "denied" | "escalated" | "closed" | None,
#   "customer_name": str | None,   # extracted once identified
#   "order_id":      str | None,
#   "subject":       str | None,   # first user message, truncated
#   "messages":      [{"role": "user"|"assistant", "content": str, "timestamp": str}],
#   "agent_history": [...],         # full LLM history including tool call turns
#   "trace_log":     [...],         # all reasoning trace steps across turns
#   "summary":       str | None,   # set on resolution
# }

tickets: dict[str, dict] = {}

def _now() -> str:
    return datetime.now(timezone.utc).isoformat()

def _new_ticket() -> dict:
    tid = "TKT-" + uuid.uuid4().hex[:8].upper()
    return {
        "ticket_id": tid,
        "created_at": _now(),
        "updated_at": _now(),
        "status": "open",
        "resolution": None,
        "customer_name": None,
        "order_id": None,
        "subject": None,
        "messages": [],
        "agent_history": [],
        "trace_log": [],
        "summary": None,
    }

def _detect_resolution(reply: str) -> Optional[str]:
    """Heuristically detect what the agent decided from its reply text."""
    r = reply.lower()
    if any(w in r for w in ["refund has been approved", "will process your refund", "refund approved"]):
        return "approved"
    if any(w in r for w in ["escalat", "human supervisor", "human review", "within 24 hours"]):
        return "escalated"
    if any(w in r for w in ["unable to process", "cannot process", "not eligible", "denied", "final sale", "ineligible"]):
        return "denied"
    return None

def _extract_customer_info(trace_log: list) -> tuple[Optional[str], Optional[str]]:
    """Pull customer name and order_id out of successful lookup_customer tool calls."""
    for step in trace_log:
        if (
            step.get("type") == "tool_call"
            and step.get("tool") == "lookup_customer"
            and not step.get("is_error")
            and step.get("output", {}).get("found")
        ):
            out = step["output"]
            return out.get("name"), out.get("order", {}).get("order_id")
    return None, None

# ── Request / Response models ─────────────────────────────────────────────────

class AdminLoginRequest(BaseModel):
    password: str

class SendMessageRequest(BaseModel):
    ticket_id: Optional[str] = None   # omit to open a new ticket
    message: str

class CloseTicketRequest(BaseModel):
    ticket_id: str

class MessageOut(BaseModel):
    role: str
    content: str
    timestamp: str

class SendMessageResponse(BaseModel):
    ticket_id: str
    status: str
    resolution: Optional[str]
    reply: str
    messages: list[MessageOut]

# ── Public: Admin login ───────────────────────────────────────────────────────

@app.post("/api/admin/login")
async def admin_login(req: AdminLoginRequest):
    # Constant-time comparison to prevent timing attacks
    expected = ADMIN_PASSWORD.encode()
    provided = req.password.encode()
    if not secrets.compare_digest(
        hashlib.sha256(expected).digest(),
        hashlib.sha256(provided).digest(),
    ):
        raise HTTPException(status_code=401, detail="Incorrect password.")
    token = secrets.token_hex(32)
    _admin_tokens.add(token)
    return {"token": token}

@app.post("/api/admin/logout")
async def admin_logout(token: str = Depends(_require_admin)):
    _admin_tokens.discard(token)
    return {"logged_out": True}

# ── Public: Customer chat ─────────────────────────────────────────────────────

@app.post("/api/chat", response_model=SendMessageResponse)
async def chat(req: SendMessageRequest):
    # Open or retrieve ticket
    if req.ticket_id and req.ticket_id in tickets:
        ticket = tickets[req.ticket_id]
        if ticket["status"] == "closed":
            raise HTTPException(status_code=400, detail="This support ticket is closed.")
    else:
        ticket = _new_ticket()
        tickets[ticket["ticket_id"]] = ticket

    # Set subject from first user message
    if not ticket["subject"]:
        ticket["subject"] = req.message[:120]

    # Record user message
    user_msg = {"role": "user", "content": req.message, "timestamp": _now()}
    ticket["messages"].append(user_msg)
    ticket["status"] = "in_progress"
    ticket["updated_at"] = _now()

    # Build LLM history: prior agent_history + new user message
    llm_history = list(ticket["agent_history"])
    llm_history.append({"role": "user", "content": req.message})

    try:
        result = run_agent(llm_history)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Agent error: {str(e)}")

    # Persist the full LLM history (includes tool call turns) for next round
    ticket["agent_history"] = result["updated_history"]

    # Append this turn's trace to the ticket's running trace log
    ticket["trace_log"].extend(result["trace"])

    # Record assistant reply in the clean message thread
    agent_msg = {"role": "assistant", "content": result["reply"], "timestamp": _now()}
    ticket["messages"].append(agent_msg)

    # Extract customer identity from trace if not yet known
    if not ticket["customer_name"]:
        name, order_id = _extract_customer_info(result["trace"])
        if name:
            ticket["customer_name"] = name
        if order_id:
            ticket["order_id"] = order_id

    # Detect resolution and update status
    resolution = _detect_resolution(result["reply"])
    if resolution:
        ticket["resolution"] = resolution
        ticket["status"] = "escalated" if resolution == "escalated" else "resolved"
        ticket["summary"] = result["reply"][:300]
    ticket["updated_at"] = _now()

    return SendMessageResponse(
        ticket_id=ticket["ticket_id"],
        status=ticket["status"],
        resolution=ticket["resolution"],
        reply=result["reply"],
        messages=[MessageOut(**m) for m in ticket["messages"]],
    )

@app.get("/api/chat/{ticket_id}")
async def get_ticket_messages(ticket_id: str):
    """Customer can retrieve their own ticket's message history."""
    ticket = tickets.get(ticket_id)
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found.")
    return {
        "ticket_id": ticket["ticket_id"],
        "status": ticket["status"],
        "resolution": ticket["resolution"],
        "messages": ticket["messages"],
    }

@app.post("/api/chat/{ticket_id}/close")
async def close_ticket(ticket_id: str):
    """Customer closes their own ticket (e.g. 'I'm satisfied, thanks')."""
    ticket = tickets.get(ticket_id)
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found.")
    ticket["status"] = "closed"
    ticket["resolution"] = ticket["resolution"] or "closed"
    ticket["updated_at"] = _now()
    return {"ticket_id": ticket_id, "status": "closed"}

# ── Admin: Ticket management (protected) ─────────────────────────────────────

@app.get("/api/admin/tickets")
async def list_tickets(_=Depends(_require_admin)):
    """Return all tickets sorted by most recently updated."""
    out = []
    for t in tickets.values():
        out.append({
            "ticket_id":     t["ticket_id"],
            "created_at":    t["created_at"],
            "updated_at":    t["updated_at"],
            "status":        t["status"],
            "resolution":    t["resolution"],
            "customer_name": t["customer_name"],
            "order_id":      t["order_id"],
            "subject":       t["subject"],
            "message_count": len(t["messages"]),
            "summary":       t["summary"],
        })
    out.sort(key=lambda x: x["updated_at"], reverse=True)
    return {"tickets": out, "total": len(out)}

@app.get("/api/admin/tickets/{ticket_id}")
async def get_ticket_detail(_=Depends(_require_admin), ticket_id: str = None):
    """Full ticket detail including agent reasoning trace."""
    ticket = tickets.get(ticket_id)
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found.")
    return ticket

@app.get("/api/admin/stats")
async def get_stats(_=Depends(_require_admin)):
    all_t = list(tickets.values())
    by_resolution = defaultdict(int)
    for t in all_t:
        by_resolution[t["resolution"] or "pending"] += 1

    total_trace_steps = sum(len(t["trace_log"]) for t in all_t)
    tool_calls = sum(
        1 for t in all_t for s in t["trace_log"] if s.get("type") == "tool_call"
    )

    return {
        "total_tickets":    len(all_t),
        "open":             sum(1 for t in all_t if t["status"] == "open"),
        "in_progress":      sum(1 for t in all_t if t["status"] == "in_progress"),
        "resolved":         sum(1 for t in all_t if t["status"] == "resolved"),
        "escalated":        sum(1 for t in all_t if t["status"] == "escalated"),
        "closed":           sum(1 for t in all_t if t["status"] == "closed"),
        "by_resolution":    dict(by_resolution),
        "total_tool_calls": tool_calls,
        "total_trace_steps": total_trace_steps,
    }

@app.get("/api/admin/customers")
async def get_customers(_=Depends(_require_admin)):
    return {"customers": list_customers()}

@app.get("/api/admin/policy")
async def get_policy_text(_=Depends(_require_admin)):
    return {"policy": get_policy()}

@app.get("/api/health")
async def health():
    active = get_active_model()
    return {"status": "ok", "provider": active["provider"], "model": active["model"]}

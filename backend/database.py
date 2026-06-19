"""
database.py — CRM data access layer
"""
import json
from pathlib import Path
from datetime import date, datetime
from typing import Optional

DATA_DIR = Path(__file__).parent.parent / "data"

def _load_crm() -> dict:
    with open(DATA_DIR / "crm_database.json") as f:
        return json.load(f)

def _load_policy() -> str:
    return (DATA_DIR / "refund_policy.txt").read_text()

# ── Public tool functions ──────────────────────────────────────────────────────

def lookup_customer(name: str, order_id: str) -> dict:
    """
    Verify customer identity and fetch order details.
    Returns customer + specific order, or an error dict.
    """
    db = _load_crm()
    name_lower = name.strip().lower()

    for customer in db["customers"]:
        if customer["name"].lower() == name_lower:
            for order in customer["orders"]:
                if order["order_id"].upper() == order_id.strip().upper():
                    return {
                        "found": True,
                        "customer_id": customer["customer_id"],
                        "name": customer["name"],
                        "email": customer["email"],
                        "account_status": customer["account_status"],
                        "membership_tier": customer["membership_tier"],
                        "order": order,
                    }
            # Name matched but order not found
            return {
                "found": False,
                "error": f"No order '{order_id}' found for customer '{name}'. Please check the order ID.",
            }

    return {
        "found": False,
        "error": f"No customer found with name '{name}'. Please verify your full name.",
    }


def check_refund_eligibility(customer_name: str, order_id: str, refund_reason: str) -> dict:
    """
    Run the full policy eligibility check for a refund request.
    Returns a structured eligibility result with reason codes.
    """
    record = lookup_customer(customer_name, order_id)
    if not record["found"]:
        return {"eligible": False, "reason": record["error"], "action": "deny"}

    customer = record
    order = record["order"]
    today = date.today()

    issues = []
    warnings = []
    action = "approve"  # default; overridden below

    # 1. Account status check
    if customer["account_status"] == "suspended":
        issues.append("POLICY §6.1: Account is suspended. Refunds are blocked until suspension is resolved.")
        action = "deny"

    # 2. Delivery status check
    if order["status"] == "in_transit":
        issues.append("POLICY §7.4: Order is still in transit and has not been delivered. Cannot process refund yet.")
        action = "deny"

    # 3. Final sale check (hard block)
    final_sale_items = [i for i in order["items"] if i.get("final_sale")]
    refundable_items = [i for i in order["items"] if not i.get("final_sale")]

    if final_sale_items and not refundable_items:
        issues.append(
            f"POLICY §3.1: All items in this order are marked Final Sale "
            f"({', '.join(i['name'] for i in final_sale_items)}). "
            f"Final Sale items cannot be refunded under any circumstances."
        )
        action = "deny"
    elif final_sale_items:
        warnings.append(
            f"POLICY §3.1: The following items are Final Sale and will be excluded from any refund: "
            f"{', '.join(i['name'] for i in final_sale_items)}."
        )

    # 4. Return window check
    if order["status"] == "delivered" and order.get("delivery_date"):
        delivery = datetime.strptime(order["delivery_date"], "%Y-%m-%d").date()
        days_since = (today - delivery).days
        window = 45 if customer["membership_tier"] == "gold" else 30

        if days_since > window:
            issues.append(
                f"POLICY §2.1/§10: Order was delivered {days_since} days ago. "
                f"Return window for {customer['membership_tier'].capitalize()} members is {window} days. Expired."
            )
            action = "deny"
        else:
            days_remaining = window - days_since
            warnings.append(f"Order delivered {days_since} days ago. {days_remaining} days remain in return window.")

    # 5. Already refunded?
    if order.get("refund_status") == "approved":
        issues.append("This order has already been refunded.")
        action = "deny"

    # 6. Compute refundable amount and check $500 escalation threshold
    refundable_amount = sum(i["price"] for i in refundable_items) if action != "deny" else 0.0
    if refundable_amount == 0.0 and not issues:
        refundable_amount = sum(i["price"] for i in refundable_items)

    if refundable_amount > 500 and action != "deny":
        action = "escalate"
        warnings.append(
            f"POLICY §4.1: Refundable amount ${refundable_amount:.2f} exceeds $500. "
            f"This request requires human supervisor approval."
        )

    # 7. Determine final outcome
    if action == "deny":
        summary = "Refund DENIED. " + " | ".join(issues)
    elif action == "escalate":
        summary = (
            f"Refund ESCALATED for human review. Refundable amount: ${refundable_amount:.2f}. "
            + (" | ".join(warnings) if warnings else "")
        )
    else:
        summary = (
            f"Refund APPROVED. Refundable amount: ${refundable_amount:.2f}. "
            + ((" | " + " | ".join(warnings)) if warnings else "")
        )

    return {
        "eligible": action == "approve",
        "action": action,
        "summary": summary,
        "issues": issues,
        "warnings": warnings,
        "customer_name": customer["name"],
        "order_id": order_id,
        "refundable_amount": refundable_amount,
        "final_sale_items": [i["name"] for i in final_sale_items],
        "refundable_items": [i["name"] for i in refundable_items],
        "order_status": order["status"],
        "membership_tier": customer["membership_tier"],
    }


def get_policy() -> str:
    """Return the full refund policy document."""
    return _load_policy()


def list_customers() -> list:
    """Return a summary list of all customers (for admin use)."""
    db = _load_crm()
    return [
        {
            "customer_id": c["customer_id"],
            "name": c["name"],
            "email": c["email"],
            "membership_tier": c["membership_tier"],
            "account_status": c["account_status"],
            "order_count": len(c["orders"]),
        }
        for c in db["customers"]
    ]

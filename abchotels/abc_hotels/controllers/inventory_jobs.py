# abchotels/abc_hotels/controllers/inventory_jobs.py
from __future__ import annotations
from typing import Dict, Any, Optional
import frappe
from frappe.utils import getdate
from abchotels.abc_hotels.utils.inventory_helpers import (
    bulk_insert_by_date_windows,
    BULK_WINDOW_DAYS,
)

BACKGROUND_WINDOW_DAYS = 7  # smaller chunks in background for more frequent updates

def _publish_done(created: int, target_user: Optional[str]) -> None:
    """Final event the UI listens to; flips the bar to 100% and shows totals."""
    try:
        payload = {"created": created, "existing": None, "failed": 0, "pairs": None}
        if target_user:
            frappe.publish_realtime("inventory_job_done", payload, user=target_user)
        else:
            frappe.publish_realtime("inventory_job_done", payload)
    except Exception:
        pass

@frappe.whitelist()
def populate_inventory_window(
    start_date: str,
    end_date: str,
    run_now: int = 1,
    notify_user: Optional[str] = None,        # FE session to receive progress + final
    days_per_window: Optional[int] = None,    # optional override
) -> Dict[str, Any]:
    """
    Populate inventory for all pairs in [start_date..end_date].
    - Immediate path runs now and publishes progress to `notify_user` (or current user).
    - Background path enqueues the same function with run_now=1, preserving the initiating user.
    """
    start = getdate(start_date)
    end = getdate(end_date)
    if not start or not end:
        raise ValueError("Start and end dates are required")

    initiator = notify_user or frappe.session.user
    window_days = int(days_per_window or (BULK_WINDOW_DAYS if int(run_now) == 1 else BACKGROUND_WINDOW_DAYS))

    if int(run_now) == 1:
        # Run now; send progress to the initiator
        created = bulk_insert_by_date_windows(
            str(start),
            str(end),
            days_per_window=window_days,
            target_user=initiator
        )
        _publish_done(created, target_user=initiator)
        return {"ok": True, "ran_now": True, "created": created, "existing": None, "failed": 0}

    # Background: re-enqueue with run_now=1 so workers execute the same logic above
    job = frappe.enqueue(
        "abchotels.abc_hotels.controllers.inventory_jobs.populate_inventory_window",
        queue="long",
        job_name="Populate Inventory Window",
        start_date=str(start),
        end_date=str(end),
        run_now=1,
        notify_user=initiator,                 # <— make sure events are targeted to the browser user
        days_per_window=BACKGROUND_WINDOW_DAYS,
    )
    return {
        "ok": True,
        "ran_now": False,
        "enqueued": True,
        "job_id": job.get_id(),
        "created": None,
        "existing": None,
        "failed": 0,
    }

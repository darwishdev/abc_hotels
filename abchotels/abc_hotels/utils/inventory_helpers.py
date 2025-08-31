# abchotels/abc_hotels/utils/inventory_helpers.py
from __future__ import annotations
from typing import Any, Mapping, Sequence, Optional, cast
import datetime as _dt
import frappe
from frappe.utils import getdate
from typing import Optional, Any
import frappe
BULK_WINDOW_DAYS = 30
NAME_PREFIX = "INVE-"
# utils/inventory_helpers.py

def _publish_progress(
    percent: float,
    title: str,
    description: str,
    target_user: Optional[str],
    *,
    created_so_far: Optional[int] = None,
    failed_so_far: Optional[int] = None,
    pairs: Optional[int] = None,
    final: bool = False,
) -> None:
    """
    Emit a progress tick (and optionally the final completion event).
    - Always publishes a 'progress' event (with created_so_far if provided)
    - If final=True, also publishes 'inventory_job_done' using the same target_user
    """
    try:
        payload: dict[str, Any] = {
            "percent": percent,
            "title": title,
            "description": description,
        }
        if created_so_far is not None:
            payload["created_so_far"] = int(created_so_far)
        if failed_so_far is not None:
            payload["failed_so_far"] = int(failed_so_far)
        if pairs is not None:
            payload["pairs"] = pairs

        if target_user:
            frappe.publish_realtime("progress", payload, user=target_user, after_commit=False)
        else:
            frappe.publish_realtime("progress", payload, after_commit=False)

        if final:
            done = {
                "created": int(created_so_far or 0),
                "existing": None,
                "failed": int(failed_so_far or 0),
                "pairs": pairs,
            }
            if target_user:
                frappe.publish_realtime("inventory_job_done", done, user=target_user)
            else:
                frappe.publish_realtime("inventory_job_done", done)

    except Exception:
        pass

def _window_slices(start: _dt.date, end: _dt.date, days_per_window: int):
    cur = start
    step = _dt.timedelta(days=days_per_window - 1)
    while cur <= end:
        w_end = min(end, cur + step)
        yield cur, w_end
        cur = w_end + _dt.timedelta(days=1)

def bulk_insert_by_date_windows(
    start_date: str,
    end_date: str,
    days_per_window: int = BULK_WINDOW_DAYS,
    target_user: Optional[str] = None,
) -> int:
    """
    CALL seed_room_type_inventory() per date window and publish progress:
      - pre-window (starting)
      - post-window (finished)
    Counts created rows by (post - pre) since the proc returns no result set.
    """
    start = getdate(start_date)
    end = getdate(end_date)
    if not start or not end:
        raise ValueError("Start or end date missing")

    windows = list(_window_slices(start, end, days_per_window))
    total_windows = len(windows)
    if total_windows == 0:
        return 0

    created_total = 0

    # initial nudge
    _publish_progress(
        1.0,
        "Inventory Population",
        f"Starting {start} → {end}",
        target_user,
        created_so_far=0,
        failed_so_far=0,
        pairs=None,
    )

    for i, (w_start, w_end) in enumerate(windows, start=1):
        # ---- pre-window progress
        pct_before = round(min(95.0, ((i - 1) / total_windows) * 100.0), 2)
        _publish_progress(
            pct_before,
            "Inventory Population",
            f"Starting window {i}/{total_windows}: {w_start} → {w_end}",
            target_user,
            created_so_far=created_total,
        )

        # ---- run the window (measure delta since proc returns nothing)
        try:
            s_int = int(w_start.strftime("%Y%m%d"))
            e_int = int(w_end.strftime("%Y%m%d"))

            # pre-count
            before_rows = frappe.db.sql(
                """
                SELECT COUNT(*) FROM `tabRoom Type Inventory`
                WHERE for_date BETWEEN %s AND %s
                """,
                (s_int, e_int),
                as_list=True,
            )
            before_cnt = int(before_rows[0][0]) if before_rows else 0

            # call proc for this window
            cur = frappe.db._cursor
            cur.callproc(
                "seed_room_type_inventory",
                (str(w_start), str(w_end), int(days_per_window), NAME_PREFIX),
            )

            # drain all result sets defensively
            try:
                while True:
                    if cur.description:
                        cur.fetchall()
                    if not cur.nextset():
                        break
            except Exception:
                pass

            # commit so post-count sees inserted rows
            try:
                frappe.db.commit()
            except Exception:
                pass

            # post-count
            after_rows = frappe.db.sql(
                """
                SELECT COUNT(*) FROM `tabRoom Type Inventory`
                WHERE for_date BETWEEN %s AND %s
                """,
                (s_int, e_int),
                as_list=True,
            )
            after_cnt = int(after_rows[0][0]) if after_rows else 0

            created_window = max(0, after_cnt - before_cnt)
            created_total += created_window

        except Exception as e:
            frappe.logger("abchotels").error(f"Window {w_start}..{w_end} failed: {e}")

        # ---- post-window progress (keep 100% for the controller final ping)
        pct_after = round(min(99.0, (i / total_windows) * 100.0), 2)
        _publish_progress(
            pct_after,
            "Inventory Population",
            f"Finished window {i}/{total_windows}: {w_start} → {w_end}",
            target_user,
            created_so_far=created_total,
        )

    return created_total

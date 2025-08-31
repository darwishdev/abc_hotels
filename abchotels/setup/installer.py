# abchotels/abchotels/setup/installer.py
import os
from typing import Dict, List
import frappe
from abc_utils.utils.sql_utils import run_sql
from pathlib import Path

from abc_utils.utils.role_utils import seed_app_roles
from .seed_roles_perms import seed_roles_and_permissions
from .seed_modules import seed_module_profiles
SQL_DIR = Path(frappe.get_app_path("abchotels", "abc_hotels", "sql"))
DEBUG = os.environ.get("BENCH_DEBUG", "").lower() in {"1", "true", "yes"}
# ------------- Configure once -------------
JOB_ROLES: Dict[str, List[str]] = {
    "F&B Cashier": ["POS Cashier"],
    "F&B Supervisor": ["POS Cashier", "POS Supervisor"],
    "Reservation Agent": ["Reservation Agent"],
    "Reservation Manager": ["Reservation Manager"],
    "Front Desk": ["Front Desk"],
    "Accountant": ["Accountant"],
    "Night Auditor": ["Night Auditor"],
    "Revenue Manager": ["Revenue Manager"],
    "Housekeeping": ["Housekeeping"],
    "Housekeeping Supervisor": ["Housekeeping Supervisor"],
    "Maintenance": ["Maintenance"],
    "Restaurant Manager": ["Restaurant Manager"],
    "Property Manager": ["Property Manager"],
    # System roles (not seeded as users usually):
    # "Inventory Engine": ["Inventory Engine"],
    # "Device Service": ["Device Service"],
    # "API Integration": ["API Integration"],
}
def seed_roles():
    ROLES_CONFIG = {}
    for job, roles in JOB_ROLES.items():
        for role in roles:
            ROLES_CONFIG[role] = {
                "desk_access": True,   # all these are desk-access roles
                "perms": {}            # leave empty or add per-doctype perms
            }

    return seed_app_roles(ROLES_CONFIG, domain="erp.local")


def _seed_dim_date_default() -> None:
    frappe.db.sql(
        "CALL seed_dim_date(%s, %s, %s, %s)",
        ("2025-08-27", "2026-12-31", "FRI_SAT", "+03:00"),
    )


def _safe(label: str, fn, **kwargs):
    print(f"[abchotels] START {label} kwargs={kwargs}")  # stdout so bench shows it
    try:
        out = fn(**kwargs) if kwargs else fn()
        # Many seeders already commit; doing it again is harmless and ensures we flush
        frappe.db.commit()
        print(f"[abchotels] OK    {label} -> {out}")
        return out
    except Exception:
        # log to file and also rethrow so bench shows the traceback (no silent hang)
        frappe.logger("abchotels").exception(f"[abchotels] {label} failed")
        if DEBUG:
            raise
        else:
            # Still surface an error to bench so it doesn't look stuck
            raise

def after_install():
    return {"ok": True}

def migrate_db():
    run_sql(SQL_DIR)

def after_migrate():
    _safe("seed_roles_and_permissions", seed_roles)
    _safe("run_sql", migrate_db)
    _safe("seed_dim_date", _seed_dim_date_default)
    _safe("seed_module_profiles",      seed_module_profiles)
    return {"ok": True}



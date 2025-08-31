# apps/abchotels/abchotels/setup/seed_modules.py
import frappe
from typing import Dict, List, Set

# Job (Role Profile) -> modules the user SHOULD SEE (allow-list)
MODULES_BY_JOB: Dict[str, List[str]] = {
    "F&B Cashier": ["Selling", "Accounts", "Stock"],
    "F&B Supervisor": ["Selling", "Accounts", "Stock"],
    "Reservation Agent": ["ABC Hotels"],
    "Reservation Manager": ["ABC Hotels", "Accounts"],
    "Front Desk": ["ABC Hotels"],
    "Accountant": ["Accounts"],
    "Night Auditor": ["Accounts", "ABC Hotels"],
    "Revenue Manager": ["Selling", "Accounts", "ABC Hotels"],
    "Housekeeping": ["ABC Hotels"],
    "Housekeeping Supervisor": ["ABC Hotels"],
    "Maintenance": ["ABC Hotels"],
    "Restaurant Manager": ["Selling", "Accounts", "Stock"],
    "Property Manager (GM)": ["ABC Hotels", "Accounts", "Selling", "Stock"],
}

def _find_modules_child_field() -> str:
    meta = frappe.get_meta("Module Profile")
    for df in meta.fields:
        if df.fieldtype == "Table" and df.options:
            child = frappe.get_meta(df.options)
            if any(f.fieldname == "module" for f in child.fields):
                return df.fieldname
    raise Exception("Couldn't find modules child table on Module Profile")

def _maybe_set_restrict_flag(mp):
    """Some versions have a check field like 'restrict_to_only_selected_modules'."""
    meta = mp.meta
    for df in meta.fields:
        text = f"{(df.fieldname or '')} {(df.label or '')}".lower()
        if df.fieldtype == "Check" and (
            "restrict" in text or ("only" in text and "module" in text)
        ):
            mp.set(df.fieldname, 1)
            break

def _ensure_module_profile(name: str, allowed_modules: List[str]) -> None:
    child_field = _find_modules_child_field()

    # Create/load
    if frappe.db.exists("Module Profile", name):
        mp = frappe.get_doc("Module Profile", name)
        mp.set(child_field, [])
    else:
        mp = frappe.new_doc("Module Profile")
        # name field varies across versions; setting .name works fine in practice
        mp.module_profile_name = name

    # Build BLOCK list = (all modules) - (allowed)
    all_modules: Set[str] = set(frappe.get_all("Module Def", pluck="name"))
    allow: Set[str] = set(allowed_modules)
    block: Set[str] = all_modules - allow

    for m in sorted(block):
        mp.append(child_field, {"module": m})

    _maybe_set_restrict_flag(mp)
    mp.save(ignore_permissions=True)

def _assign_to_users(role_profile: str, module_profile: str):
    users = frappe.get_all("User", filters={"role_profile_name": role_profile}, pluck="name")
    for u in users:
        frappe.db.set_value("User", u, "module_profile", module_profile)

@frappe.whitelist()
def seed_module_profiles() -> dict:
    for job, mods in MODULES_BY_JOB.items():
        _ensure_module_profile(job, mods)
        _assign_to_users(job, job)
    frappe.db.commit()
    return {"ok": True, "profiles": list(MODULES_BY_JOB.keys())}


import frappe
from typing import Dict, List, Optional

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
    "Property Manager (GM)": ["Property Manager (GM)"],
    # System roles are usually not assigned to humans:
    # "Inventory Engine": ["Inventory Engine"],
    # "Device Service": ["Device Service"],
    # "API Integration": ["API Integration"],
}

# job -> (full name, email local-part)
JOB_USERS: Dict[str, tuple[str, str]] = {
    "F&B Cashier": ("F&B Cashier", "pos.cashier"),
    "F&B Supervisor": ("F&B Supervisor", "pos.supervisor"),
    "Reservation Agent": ("Reservation Agent", "reservation.agent"),
    "Reservation Manager": ("Reservation Manager", "reservation.manager"),
    "Front Desk": ("Front Desk", "front.desk"),
    "Accountant": ("Accountant", "accountant"),
    "Night Auditor": ("Night Auditor", "night.auditor"),
    "Revenue Manager": ("Revenue Manager", "revenue.manager"),
    "Housekeeping": ("Housekeeping", "housekeeping"),
    "Housekeeping Supervisor": ("Housekeeping Supervisor", "housekeeping.supervisor"),
    "Maintenance": ("Maintenance", "maintenance"),
    "Restaurant Manager": ("Restaurant Manager", "restaurant.manager"),
    "Property Manager (GM)": ("Property Manager (GM)", "gm"),
}

DEFAULT_EMAIL_DOMAIN = "hotel.local"  # change if you like
DEFAULT_LANGUAGE = "en"

# Optional: scope everyone to a default Property with User Permission
DEFAULT_PROPERTY = None  # e.g., "Concha Hotel" or keep None to skip
# -----------------------------------------

def _ensure_role_profile(name: str, roles: List[str]) -> None:
    # Load or create the Role Profile
    if frappe.db.exists("Role Profile", name):
        rp = frappe.get_doc("Role Profile", name)
        # Clear existing children to make it idempotent
        rp.set("roles", [])
    else:
        rp = frappe.new_doc("Role Profile")
        rp.role_profile = name
    # IMPORTANT: use append so rows are child docs, not raw dicts
    for r in roles:
        rp.append("roles", {"role": r})  # child doctype is "Has Role"
    rp.save(ignore_permissions=True)

def _ensure_user(fullname: str, email_local: str, role_profile: str, domain: str) -> str:
    email = f"{email_local}@{domain}"
    if frappe.db.exists("User", email):
        user = frappe.get_doc("User", email)
        user.enabled = 1
        user.language = DEFAULT_LANGUAGE
        user.role_profile_name = role_profile
        user.save(ignore_permissions=True)
        return email

    user = frappe.get_doc({
        "doctype": "User",
        "email": email,
        "first_name": fullname,
        "send_welcome_email": 0,
        "language": DEFAULT_LANGUAGE,
        "user_type": "System User",
        "enabled": 1,
        "role_profile_name": role_profile,
    })
    user.insert(ignore_permissions=True)
    return email

def _ensure_user_permission(email: str, property_name: str) -> None:
    if not property_name:
        return
    # Prevent duplicates
    if not frappe.db.exists({
        "doctype": "User Permission",
        "user": email,
        "allow": "Property",
        "for_value": property_name,
    }):
        up = frappe.get_doc({
            "doctype": "User Permission",
            "user": email,
            "allow": "Property",
            "for_value": property_name,
            "apply_to_all_doctypes": 1,
        })
        up.insert(ignore_permissions=True)

@frappe.whitelist()
def seed(domain: str = DEFAULT_EMAIL_DOMAIN, property_name: Optional[str] = DEFAULT_PROPERTY) -> dict:
    """Upsert Role Profiles, Users, and (optional) Property scoping."""
    frappe.only_for("System Manager")
    created = []

    # 1) Ensure Role Profiles exist with the exact role sets
    for job, roles in JOB_ROLES.items():
        _ensure_role_profile(job, roles)

    # 2) Ensure users exist and attach Role Profiles
    for job, (full, local) in JOB_USERS.items():
        email = _ensure_user(full, local, job, domain)
        if property_name:
            _ensure_user_permission(email, property_name)
        created.append({"job": job, "email": email})

    frappe.db.commit()
    return {"ok": True, "users": created}


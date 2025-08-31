import frappe
from typing import Dict, List

# --------- ROLES (role_name -> desk_access) ----------
ROLES: Dict[str, bool] = {
    "Reservation Agent": True,
    "Reservation Manager": True,
    "Front Desk": True,
    "Accountant": True,
    "Inventory Engine": False,     # system-only
    "Night Auditor": True,
    "Revenue Manager": True,
    "Housekeeping": True,
    "Housekeeping Supervisor": True,
    "Maintenance": True,
    "POS Cashier": True,
    "POS Supervisor": True,
    "Restaurant Manager": True,
    "Property Manager (GM)": True,
    "Device Service": False,       # system-only
    "API Integration": False,      # system-only
}

# ---------- PERM MATRIX (core doctypes only) ----------
def _pos_invoice_doctype() -> str:
    # Some benches use "POS Invoice", others use "Sales Invoice" for POS
    return "POS Invoice" if frappe.db.exists("DocType", "POS Invoice") else "Sales Invoice"

def _exists_dt(dt: str) -> bool:
    return bool(frappe.db.exists("DocType", dt))

def _core_perm_matrix() -> Dict[str, Dict[str, Dict[str, int]]]:
    pos_dt = _pos_invoice_doctype()
    M: Dict[str, Dict[str, Dict[str, int]]] = {}

    # POS flow
    if _exists_dt(pos_dt):
        M.setdefault(pos_dt, {}).update({
            "POS Cashier":    dict(create=1, read=1, write=1, submit=1, print_perm=1, email=1),
            "POS Supervisor": dict(read=1, write=1, submit=1, cancel=1, amend=1, print_perm=1, email=1),
        })

    if _exists_dt("POS Closing Voucher"):
        M.setdefault("POS Closing Voucher", {}).update({
            "POS Cashier":    dict(create=1, read=1, submit=1),
            "POS Supervisor": dict(read=1, cancel=1),
        })

    # Masters used by POS
    for dt in ["Customer", "Item", "Item Price", "UOM", "Warehouse", "POS Profile"]:
        if _exists_dt(dt):
            perms = {
                "POS Cashier":    dict(read=1),
                "POS Supervisor": dict(read=1),
            }
            if dt == "Customer":
                perms["POS Cashier"]["create"] = 1
                perms["POS Supervisor"]["create"] = 1
            M.setdefault(dt, {}).update(perms)

    # Finance visibility
    if _exists_dt("Payment Entry"):
        M.setdefault("Payment Entry", {}).update({
            "Accountant": dict(read=1, print_perm=1, export=1),
        })

    # Read-only visibility for reservation-side roles on common masters
    for dt in ["Item Group", "Price List", "Company"]:
        if _exists_dt(dt):
            M.setdefault(dt, {}).update({
                "Reservation Agent":   dict(read=1),
                "Front Desk":          dict(read=1),
                "Reservation Manager": dict(read=1),
                "Revenue Manager":     dict(read=1),
            })

    return M

# ---------- helpers ----------
def _ensure_roles():
    print("[abchotels] roles: upsert")
    for role_name, desk in ROLES.items():
        if frappe.db.exists("Role", role_name):
            frappe.db.set_value("Role", role_name, "desk_access", 1 if desk else 0)
        else:
            doc = frappe.get_doc({"doctype": "Role", "role_name": role_name, "desk_access": 1 if desk else 0})
            doc.insert(ignore_permissions=True)
# --- replace your _ensure_custom_docperm and seed_roles_and_permissions with these ---

def _ensure_custom_docperm(dt: str, role: str, flags: Dict[str, int]) -> None:
    """
    Ensure there is exactly one Custom DocPerm row at permlevel=0 for (dt, role),
    then set all flags on that row in a single save.

    Works on benches where `tabCustom DocPerm` has no `parenttype` column.
    """
    from frappe.permissions import add_permission

    # 1) Ensure a row exists (idempotent)
    add_permission(dt, role, permlevel=0)

    # 2) Find that row WITHOUT filtering on parenttype (some schemas don’t have it)
    name = frappe.db.get_value(
        "Custom DocPerm",
        {"parent": dt, "role": role, "permlevel": 0},
        "name",
    )
    if not name:
        # very rare, but try once more
        rows = frappe.get_all("Custom DocPerm",
                              filters={"parent": dt, "role": role, "permlevel": 0},
                              pluck="name")
        name = rows[0] if rows else None

    if not name:
        # last resort: create explicitly
        doc = frappe.get_doc({
            "doctype": "Custom DocPerm",
            "parent": dt,
            # do NOT set parenttype/parentfield to keep compatibility with your schema
            "role": role,
            "permlevel": 0,
        })
    else:
        doc = frappe.get_doc("Custom DocPerm", name)

    # 3) Map flags (print_perm -> print), set only when needed
    if "print_perm" in flags:
        flags = {**flags, "print": flags["print_perm"]}
        flags.pop("print_perm", None)

    changed = False
    for k, v in flags.items():
        v01 = 1 if v else 0
        if doc.get(k) != v01:
            doc.set(k, v01)
            changed = True

    if changed or doc.is_new():
        doc.save(ignore_permissions=True)


@frappe.whitelist()
def seed_roles_and_permissions() -> dict:
    """
    Idempotent: upserts roles, then applies compact Custom DocPerm set
    to core doctypes. Clears cache ONCE per doctype.
    """
    frappe.only_for("System Manager")
    frappe.flags.in_install = True

    _ensure_roles()

    matrix = _core_perm_matrix()
    print(f"[abchotels] perms: doctypes={list(matrix.keys())}")

    for dt, by_role in matrix.items():
        print(f"[abchotels] perms: {dt}")
        for role, flags in by_role.items():
            _ensure_custom_docperm(dt, role, flags)
        frappe.clear_cache(doctype=dt)

    frappe.db.commit()
    print("[abchotels] done roles+perms")
    return {"ok": True, "doctypes": list(matrix.keys()), "roles": list(ROLES.keys())}

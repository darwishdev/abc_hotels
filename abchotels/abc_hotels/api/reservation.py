import frappe

import pymysql.cursors
from frappe import _
from frappe.utils import nowdate
from frappe.utils import today
from frappe.utils import today, getdate, add_days
@frappe.whitelist()
def check_in(reservation_id):
    # For now just return hello world
    # create new folio and sales invoice with empty items
    try:
        frappe.db.sql("CALL reservation_create_folio(%s)" , reservation_id)

        # 2) Get new folio id (your SP uses CONCAT('f-', reservation_name))
        folio_id = f"f-{reservation_id}"

        # 3) Load reservation again (status + fields updated by SP)
        reservation = frappe.get_doc("Hotel Reservation", reservation_id)

        # 4) Create POS Invoice linked to Folio
        invoice_id = f"{reservation.name}-{folio_id}"
        if frappe.db.exists("POS Invoice", invoice_id):
            invoice_doc = frappe.get_doc("POS Invoice", invoice_id)
        else:
            invoice_doc = frappe.new_doc("POS Invoice")
            invoice_doc.name = invoice_id
            invoice_doc.update_stock = False
            invoice_doc.taxes_and_charges = 'Egypt Hospitality - CH'
            invoice_doc.customer = reservation.customer  # from Hotel Reservation
            invoice_doc.posting_date = nowdate()
            invoice_doc.is_pos = 1
            invoice_doc.folio = folio_id   # 🔹 your custom Link field
            invoice_doc.set("items", [{
                "item_code": "Folio Initial Item",
                "item_name": "Folio Initial Item",
                "qty": 1,
                "rate": 0,
                "uom": "Nos",
                "is_free_item" : True,
                "income_account" : "4110 - Sales - CH"
            }])
            invoice_doc.set_missing_values()
            invoice_doc.insert(ignore_permissions=True)

        # 5) Update Room status
        if reservation.room_type_room:
            frappe.db.set_value("Room Type Room", reservation.room_type_room, "room_status", "Occupied")

        frappe.db.commit()
    except Exception as e:
        raise e
    return f"Hello World from {reservation_id}"

def validate(self):
    set_room_type_assigned(self)

def set_room_type_assigned(self):
    """Set room_type_assigned based on the first assigned room's room type"""
    if self.assigned_rooms:
        # Get the first assigned room
        first_assignment = self.assigned_rooms[0]

        if first_assignment.room:
            # Get the room type from the assigned room
            room_type = frappe.db.get_value("Room", first_assignment.room, "room_type")

            if room_type:
                self.room_type_assigned = room_type
            else:
                self.room_type_assigned = None
        else:
            self.room_type_assigned = None
    else:
        # No rooms assigned, clear the field
        self.room_type_assigned = None





@frappe.whitelist()
def get_dashboard_data(as_of_date):
    """
    Args:
        as_of_date: int date format YYYYMMDD (e.g., 20250831)
    """
    # default to today if not passed
    if not as_of_date:
        as_of_date = int(today().replace("-", ""))  # 20250831:

    as_of_date_int = int(as_of_date)
    as_of_date_str = f"{str(as_of_date_int)[:4]}-{str(as_of_date_int)[4:6]}-{str(as_of_date_int)[6:]}"

    # --- Room Inventory Aggregates ---
    total_rooms, in_house, available, out_of_order = frappe.db.sql("""
        SELECT
            COALESCE(SUM(total_count),0)      AS total_rooms,
            COALESCE(SUM(occupied_count),0)   AS in_house,
            COALESCE(SUM(total_available_units),0) AS available,
            COALESCE(SUM(out_of_order_count),0)    AS out_of_order
        FROM room_type_inventory
        WHERE for_date = %s
    """, as_of_date_int)[0]

    # --- ADR from Rate Codes ---
    adr = frappe.db.sql("""
        SELECT COALESCE(AVG(rate_price),0)
        FROM room_type_inventory_rates
        WHERE for_date = %s
    """, as_of_date_int)[0][0] or 0

    # --- Arrivals / Departures ---
    arrivals = frappe.db.count("Hotel Reservation", {"check_in_date": as_of_date_str, "docstatus" :
                                                     1})
    departures = frappe.db.count("Hotel Reservation", {"check_out_date": as_of_date_str ,  "docstatus" :
                                                     1})

    # --- Occupancy % ---
    occupancy_pct = round((in_house / available) * 100, 2) if available else 0

    return {
        "as_of_date": as_of_date_str,
        "kpis": {
            "total_rooms": total_rooms,
            "out_of_order": out_of_order,
            "available": available,
            "in_house": in_house,
            "occupancy_pct": occupancy_pct,
            "adr": adr,
            "arrivals": arrivals,
            "departures": departures,
        }
    }



@frappe.whitelist()
def get_night_audit_candidates(audit_date=None):
    audit_date = audit_date or today()
    audit_date_int = int(getdate(audit_date).strftime("%Y%m%d"))

    query = "CALL switch_night_candidates(%s)"
    conn = frappe.db.get_connection()
    cur = conn.cursor(pymysql.cursors.DictCursor)
    cur.execute(query, (audit_date,))
    rows = cur.fetchall()
    cur.close()

    # Return preview data, no modifications
    return {
        "ok": True,
        "audit_date": audit_date,
        "candidates": rows,
        "count": len(rows),
    }
@frappe.whitelist()
def run_night_audit(audit_date=None):

    settings = frappe.get_single("ABC Hotels Settings")
    s_audit_date =  settings.business_date
    if not s_audit_date:
        frappe.throw("Business Date is not set in ABC Hotels Settings")

    if audit_date:
        s_audit_date = audit_date

    audit_date_int = int(getdate(s_audit_date).strftime("%Y%m%d"))  # convert to int YYYYMMDD

    query = "CALL switch_night_candidates(%s)"
    conn = frappe.db.get_connection()
    cur = conn.cursor(pymysql.cursors.DictCursor)
    cur.execute(query, (audit_date,))
    rows = cur.fetchall()
    cur.close()

    processed = []
    for row in rows:
        invoice = frappe.get_doc("POS Invoice", row["invoice_id"])

        # check if ROOM-ACCOM for this date already exists
        exists_for_date = any(
            it.item_code == "ROOM-ACCOM"
            and it.folio_window == row["folio_window_id"]
            and it.for_date == audit_date_int
            for it in invoice.items
        )

        if not exists_for_date:
            invoice.append("items", {
                "item_code": "ROOM-ACCOM",
                "item_name": "Room Accommodation",
                "folio_window": row["folio_window_id"],
                "qty": 1,
                "rate": row["nightly_rate"],
                "uom": "Nos",
                "for_date": audit_date_int,
            })

        # recalc + save
        invoice.set_missing_values()
        invoice.calculate_taxes_and_totals()
        invoice.save()
        frappe.db.commit()

        processed.append(invoice.name)
   # 3. Advance business_date by 1 day
    settings.business_date = add_days(getdate(audit_date), 1)
    settings.save(ignore_permissions=True)
    frappe.db.commit()
    return {
        "ok": True,
        "audit_date": audit_date,
        "processed": processed,
        "count": len(processed),
    }

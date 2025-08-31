import frappe
from frappe.utils import today

@frappe.whitelist()
def check_in(reservation_id):
    # For now just return hello world
    # create new folio and sales invoice with empty items
    try:
        frappe.db.sql("CALL reservation_create_folio(%s)" , reservation_id)
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
def get_dashboard_data(as_of_date=None):
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

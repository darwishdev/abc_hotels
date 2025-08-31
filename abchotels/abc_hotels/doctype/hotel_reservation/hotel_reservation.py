import frappe
from abchotels.abc_hotels.api.inventory import apply_reservation_inventory_api
from frappe.model.document import Document

class HotelReservation(Document):
    def on_submit(self):
        frappe.db.commit()  # close current txn first
        apply_reservation_inventory_api(self.name, 1)
        frappe.db.commit()
    def on_cancel(self):
        # 2 = release inventory
        frappe.db.commit()
        apply_reservation_inventory_api(self.name, 2)
        frappe.db.commit()
        pass


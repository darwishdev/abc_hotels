# -*- coding: utf-8 -*-
from . import __version__ as app_version

app_name = "abchotels"
app_title = "ABC Hotels"
app_publisher = "Your Name"
app_description = "Custom app for hotel management"
app_icon = "octicon octicon-home"
app_color = "blue"
app_email = "your.email@example.com"
app_license = "MIT"

app_include_css = "/assets/abchotels/css/abchotels.css"
app_include_js = ["/assets/abchotels/js/abchotels.js"]

desk_page = {"ABC Hotels": "abchotels/workspace/abc_hotels"}

website_include_js = ["/assets/abchotels/js/website.js"]

website_route_rules = [
    {"from_route": "/abchotels/<path:app_path>", "to_route": "abchotels"}
]
# Install / migrate hooks
after_install = "abchotels.setup.installer.after_install"
after_migrate = "abchotels.setup.installer.after_migrate"


fixtures = [
    {"doctype": "Room Type"},
    {"doctype": "Cancelation Policy"},
    {"doctype": "Rate Code"},
    {"doctype": "Room Type Inventory"},
    {"doctype": "Property"},
    {"doctype": "Room Type Room"},
    {"doctype": "Amenity"},
    {"doctype": "Room Category"},
    {"doctype": "Bed Type"},
    {"doctype": "Workspace", "filters": [["module", "=", "ABC Hotels"]]},
]

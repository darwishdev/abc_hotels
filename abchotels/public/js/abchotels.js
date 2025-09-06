frappe.provide("abchotels");

frappe.ui.toolbar.BusinessDate = class BusinessDate {
    static setup() {
        frappe.call({
            method: "frappe.client.get_value",
            args: {
                doctype: "ABC Hotels Settings",
                fieldname: "business_date",
            },
            callback: function (r) {
                if (!r.message) return;

                const business_date = r.message.business_date;
                window.business_date = business_date;

                // Create the nav item
                const dateEl = $(`
                    <li class="nav-item business-date-item">
                        <a class="nav-link disabled" style="font-weight:600;">
                            Business Date: ${business_date}
                        </a>
                    </li>
                `);

                // Insert into toolbar
                const nav = $(".nav.navbar-nav.d-none.d-sm-flex");
                if (nav.length && !$(".business-date-item").length) {
                    nav.append(dateEl);
                    console.log("new Business Date injected:", business_date);
                }
            },
        });
    }
};

// Run after Desk is ready
$(document).on("app_ready", function () {
    abchotels.BusinessDate.setup();

    // Re-run on route changes (SPA navigation)
    frappe.router.on("change", function () {
        if (!$(".business-date-item").length) {
            abchotels.BusinessDate.setup();
        }
    });
});

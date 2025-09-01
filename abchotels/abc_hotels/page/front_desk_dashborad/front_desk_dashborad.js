frappe.pages["front_desk_dashborad"].on_page_load = function (wrapper) {
    const page = frappe.ui.make_app_page({
        parent: wrapper,
        title: __("Front Desk Dashboard"),
        single_column: true,
    });

    // 🔹 Page body instead of overwriting wrapper
    page.body.html(`
    <style>
      .kpi-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 12px;
      }
      .kpi-card {
        border-radius: 12px;
        box-shadow: 0 1px 2px rgba(0,0,0,.06);
        border: 1px solid var(--border-color, #e5e7eb);
        cursor: pointer;
        transition: box-shadow .2s ease;
      }
      .kpi-card:hover { box-shadow: 0 4px 8px rgba(0,0,0,.12); }
      .kpi-card .card-body { padding: 16px; }
      .kpi-card .kpi-label { color: #6b7280; font-size: 12px; margin-bottom: 4px; }
      .kpi-card .kpi-value { font-size: 22px; font-weight: 700; line-height: 1.1; }
      .kpi-pill { display:inline-block; margin-top:6px; font-size:11px; padding:2px 6px; border-radius:999px; background:#f3f4f6; color:#374151; border:1px solid #e5e7eb; }
    </style>

    <div class="p-4 space-y-4">
      <div id="kpis" class="kpi-grid"></div>
    </div>
  `);

    // 🔹 Date filter
    const filter = page.add_field({
        fieldtype: "Date",
        fieldname: "as_of_date",
        label: __("As of Date"),
        default: frappe.datetime.get_today(),
        reqd: 1,
        change: () => loadData(),
    });

    // 🔹 Switch Night button
    page.add_inner_button(__("Switch Night"), () => {
        frappe.confirm(__("Are you sure you want to run Night Audit?"), () => {
            frappe.call({
                method: "abchotels.abc_hotels.api.reservation.run_night_audit",
                args: { audit_date: filter.get_value() },
                callback: function (r) {
                    if (r.message && r.message.ok) {
                        frappe.show_alert({
                            message: __("Night Audit completed for {0}", [r.message.audit_date]),
                            indicator: "green",
                        });
                        loadData();
                    } else {
                        frappe.msgprint({
                            title: __("Night Audit Failed"),
                            message: __("Please check server logs."),
                            indicator: "red",
                        });
                    }
                },
            });
        });
    });

    // 🔹 Load KPI data
    function loadData() {
        const dateStr = filter.get_value(); // YYYY-MM-DD
        const dateInt = cint(dateStr.replace(/-/g, "")); // 20250831

        frappe.call({
            method: "abchotels.abc_hotels.api.reservation.get_dashboard_data",
            args: { as_of_date: dateInt },
            callback: function (r) {
                if (r.message) {
                    render(r.message);
                }
            },
        });
    }

    // 🔹 Render KPI cards
    function render(data) {
        page.set_indicator(
            __("As of {0}", [frappe.datetime.global_date_format(data.as_of_date)]),
            "blue",
        );

        const k = data.kpis;
        const card = (label, value, pill, currency, clickHandler) => {
            const v = currency ? format_currency(value) : (value ?? 0);
            return `
              <div class="card kpi-card" data-click="${clickHandler || ""}">
                <div class="card-body">
                  <div class="kpi-label">${frappe.utils.escape_html(label)}</div>
                  <div class="kpi-value">${v}</div>
                  ${pill ? `<span class="kpi-pill">${pill}</span>` : ""}
                </div>
              </div>`;
        };

        $("#kpis").html(
            [
                card(__("Total Rooms"), k.total_rooms, "blue"),
                card(__("Out of Order"), k.out_of_order, "orange"),
                card(__("Available"), k.available, "cyan"),
                card(__("In-House"), k.in_house, "green"),
                card(__("Occupancy %"), k.occupancy_pct, "purple"),
                card(__("Avg Room Rate"), k.adr, "teal", true),
                card(__("Arrivals"), k.arrivals, "green", false, "arrivals"),
                card(__("Departures"), k.departures, "red", false, "departures"),
            ].join(""),
        );

        // 🔹 Click actions
        $(".kpi-card[data-click='arrivals']").on("click", () => {
            frappe.set_route("List", "Hotel Reservation", {
                check_in_date: data.as_of_date,
            });
        });
        $(".kpi-card[data-click='departures']").on("click", () => {
            frappe.set_route("List", "Hotel Reservation", {
                check_out_date: data.as_of_date,
            });
        });
    }

    // Initial load
    loadData();
};

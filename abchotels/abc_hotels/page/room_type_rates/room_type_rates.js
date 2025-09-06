frappe.pages["room_type_rates"].on_page_load = function (wrapper) {
    const page = frappe.ui.make_app_page({
        parent: wrapper,
        title: "Room Type Rates",
        single_column: true,
    });

    // Filters
    const start_date_field = page.add_field({
        label: "Start Date",
        fieldtype: "Date",
        fieldname: "start_date",
        default: frappe.datetime.get_today(),
    });

    const end_date_field = page.add_field({
        label: "End Date",
        fieldtype: "Date",
        fieldname: "end_date",
        default: frappe.datetime.add_days(frappe.datetime.get_today(), 21), // 3 weeks by default
    });

    const room_type_field = page.add_field({
        label: "Room Type",
        fieldtype: "Link",
        fieldname: "room_type",
        options: "Room Type",
    });
    const rate_code_field = page.add_field({
        label: "Rate Code",
        fieldtype: "Link",
        fieldname: "rate_code",
        options: "Rate Code",
    }); // --- NEW: Seed Rates Button ---
    page.add_button("Seed Rates", () => {
        // Get current filter values
        let current_room_type = room_type_field.get_value() || "";
        let current_start = start_date_field.get_value() || frappe.datetime.get_today();
        let current_end = end_date_field.get_value() || frappe.datetime.add_days(current_start, 7);

        let d = new frappe.ui.Dialog({
            title: "Seed Room Type Inventory Rate Codes",
            fields: [
                {
                    label: "Rate Code",
                    fieldname: "rate_code",
                    fieldtype: "Link",
                    options: "Rate Code",
                    reqd: true,
                },
                {
                    label: "Room Type",
                    fieldname: "room_type",
                    fieldtype: "Link",
                    options: "Room Type",
                    reqd: true,
                    default: current_room_type, // prefill
                },
                {
                    label: "Start Date",
                    fieldname: "start_date",
                    fieldtype: "Date",
                    reqd: true,
                    default: current_start, // prefill
                },
                {
                    label: "End Date",
                    fieldname: "end_date",
                    fieldtype: "Date",
                    reqd: true,
                    default: current_end, // prefill
                },
                {
                    label: "Price",
                    fieldname: "price",
                    fieldtype: "Currency",
                    reqd: true,
                },
            ],
            primary_action_label: "Seed",
            primary_action(values) {
                frappe.call({
                    method: "abchotels.abc_hotels.api.inventory.seed_room_type_inventory_rate_codes",
                    args: {
                        rate_code: values.rate_code,
                        room_type: values.room_type,
                        start_date: values.start_date,
                        end_date: values.end_date,
                        price: values.price,
                    },
                    callback: function (r) {
                        if (!r.exc) {
                            frappe.msgprint("Rates seeded successfully!");
                            d.hide();
                            fetchAndRender(); // refresh table
                        }
                    },
                });
            },
        });

        d.show();
    });
    // Pagination controls
    let currentPage = 0; // page = week index
    let pageSize = 7; // days per page
    let apiMessage = null; // cached API response

    const $content = $(`
        <div style="margin-top: 20px;">
            <div id="pagination-controls" style="margin-bottom: 10px;"></div>
            <div id="rates-table"></div>
        </div>
    `);
    $(wrapper).find(".layout-main").append($content);

    function format_price(value) {
        return new Intl.NumberFormat("en-US", {
            style: "currency",
            currency: "EGP",
        }).format(value);
    }

    // Fetch & render
    async function fetchAndRender() {
        let room_type = room_type_field.get_value() || "";
        let start_date = start_date_field.get_value();
        let end_date = end_date_field.get_value();
        let rate_code = rate_code_field.get_value();
        if (!start_date || !end_date) {
            frappe.msgprint("Please select both start and end dates.");
            return;
        }

        const start_int = start_date.replace(/-/g, "");
        const end_int = end_date.replace(/-/g, "");

        frappe.call({
            method: "abchotels.abc_hotels.api.inventory.get_room_type_rates_grid",
            args: {
                room_type: room_type,
                start_date_int: start_int,
                end_date_int: end_int,
                rate_code: rate_code
            },
            callback: function (r) {
                if (!r.message) return;
                apiMessage = r.message;
                currentPage = 0; // reset to first page
                renderTable();
            },
        });
    }

    // Render with pagination
    function renderTable() {
        const message = apiMessage;
        if (!message) return;

        const columns = message.columns;
        const data = message.data;

        // Paginate date columns (skip Room Type + Rate Code)
        const dayColumns = columns.slice(2);
        const totalPages = Math.ceil(dayColumns.length / pageSize);
        const startIdx = currentPage * pageSize;
        const endIdx = startIdx + pageSize;
        const visibleColumns = dayColumns.slice(startIdx, endIdx);

        // Header
        let html = `
      <div style="margin-bottom:10px;text-align:right;">
        <button class="btn btn-sm btn-primary" id="refresh-table">🔄 Refresh</button>
      </div>
      <table class="table table-bordered">
        <thead>
          <tr>
            <th>Room Type</th>
            <th>Rate Code</th>`;
        visibleColumns.forEach((col) => {
            html += `<th>${col.label}</th>`;
        });
        html += `</tr></thead><tbody>`;

        // Body: one row span per room type
        Object.keys(data).forEach((roomType) => {
            const rateCodes = data[roomType];
            const rateCodeKeys = Object.keys(rateCodes);

            rateCodeKeys.forEach((rateCode, idx) => {
                html += `<tr>`;
                if (idx === 0) {
                    // Only the first row prints the room type, with rowspan
                    html += `<td rowspan="${rateCodeKeys.length}" style="vertical-align: middle; font-weight:bold;">${roomType}</td>`;
                }
                html += `<td>${rateCode}</td>`;
                visibleColumns.forEach((col) => {
                    const dayData = rateCodes[rateCode].find(
                        (d) => d.for_date.toString() === col.fieldname.replace("date_", ""),
                    );
                    html += `<td>${dayData ? format_price(dayData.rate_price) : "-"}</td>`;
                });
                html += `</tr>`;
            });
        });

        html += `</tbody></table>`;

        // Pagination controls
        let controls = `
        <div class="d-flex justify-content-between">
            <button class="btn btn-sm btn-default" id="prev-page" ${currentPage === 0 ? "disabled" : ""}>
                ◀ Prev
            </button>
            <span>Week ${currentPage + 1} of ${totalPages}</span>
            <button class="btn btn-sm btn-default" id="next-page" ${currentPage >= totalPages - 1 ? "disabled" : ""}>
                Next ▶
            </button>
        </div>
    `;

        $("#rates-table").html(html + controls);

        // Events
        $("#prev-page").on("click", function () {
            if (currentPage > 0) {
                currentPage--;
                renderTable();
            }
        });
        $("#next-page").on("click", function () {
            if (currentPage < totalPages - 1) {
                currentPage++;
                renderTable();
            }
        });
        $("#refresh-table").on("click", function () {
            fetchAndRender();
        });
    }

    // Auto-run
    start_date_field.$input.on("change", fetchAndRender);
    end_date_field.$input.on("change", fetchAndRender);
    room_type_field.$input.on("change", fetchAndRender);

    fetchAndRender();
};

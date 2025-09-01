frappe.pages["room_type_rates"].on_page_load = function (wrapper) {
    const page = frappe.ui.make_app_page({
        parent: wrapper,
        title: __("Room Type Pricing Dashboard"),
        single_column: true,
    });

    // Filters
    page.add_field({
        label: __("Room Type"),
        fieldtype: "Link",
        fieldname: "room_type",
        options: "Room Type",
        change: () => fetchAndRender(),
    });

    page.add_field({
        label: __("Start Date"),
        fieldtype: "Date",
        fieldname: "start_date",
        default: frappe.datetime.get_today(),
        change: () => fetchAndRender(),
    });

    page.add_field({
        label: __("End Date"),
        fieldtype: "Date",
        fieldname: "end_date",
        default: frappe.datetime.add_days(frappe.datetime.get_today(), 14),
        change: () => fetchAndRender(),
    });

    // Add navigation buttons
    page.add_button("← Previous 7 Days", () => navigateDates(-7), "btn-secondary");
    page.add_button("Next 7 Days →", () => navigateDates(7), "btn-secondary");
    page.add_button("Refresh", () => fetchAndRender(), "btn-primary");
    page.add_button("Set Price", () => openSetPriceDialog(), "btn-secondary");

    // Table container
    const table_container = $(`
        <div class="pricing-table-container">
            <div class="table-responsive">
                <table class="table table-bordered" id="pricing-table">
                    <thead></thead>
                    <tbody></tbody>
                </table>
            </div>
        </div>
    `).appendTo(page.body);

    // Pagination state
    let allColumns = [];
    let allData = {};
    let currentPage = 0;
    const daysPerPage = 7;

    // Load initial data
    fetchAndRender();

    function navigateDates(days) {
        const start_date = page.fields_dict.start_date.get_value();
        const end_date = page.fields_dict.end_date.get_value();

        const new_start = frappe.datetime.add_days(start_date, days);
        const new_end = frappe.datetime.add_days(end_date, days);

        page.fields_dict.start_date.set_value(new_start);
        page.fields_dict.end_date.set_value(new_end);
    }

    function fetchAndRender() {
        const room_type = page.fields_dict.room_type.get_value();
        const start_date = page.fields_dict.start_date.get_value();
        const end_date = page.fields_dict.end_date.get_value();

        if (!start_date || !end_date) {
            frappe.msgprint(__("Please select both start and end dates."));
            return;
        }

        if (start_date > end_date) {
            frappe.msgprint(__("Start date must be before end date."));
            return;
        }

        // Convert dates to YYYYMMDD format
        const start_int = toIntYYYYMMDD(start_date);
        const end_int = toIntYYYYMMDD(end_date);

        $("#pricing-table tbody").html(
            '<tr><td colspan="100%" class="text-center">Loading...</td></tr>',
        );

        frappe.call({
            method: "abchotels.abc_hotels.api.inventory.get_room_type_rates_grid",
            args: {
                room_type: room_type || "",
                start_date_int: start_int,
                end_date_int: end_int,
            },
            callback: (r) => {
                const payload = r.message || {};
                allColumns = payload.columns || [];
                allData = payload.data || {};

                currentPage = 0; // Reset to first page
                renderTable();

                // Update page title
                const rate_code_count = Object.keys(allData).length;
                const total_days = payload.total_days || 0;
                page.set_title(
                    __(`Room Type Pricing (${rate_code_count} rate codes, ${total_days} days)`),
                );
            },
            error: () => {
                console.log("Failed to load pricing data");
                $("#pricing-table tbody").html(
                    '<tr><td colspan="100%" class="text-center text-danger">Failed to load data</td></tr>',
                );
            },
        });
    }

    function renderTable() {
        const $table = $("#pricing-table");
        const $thead = $table.find("thead");
        const $tbody = $table.find("tbody");

        $thead.empty();
        $tbody.empty();

        if (!Object.keys(allData).length) {
            $tbody.html(
                '<tr><td colspan="100%" class="text-center text-muted">No data available</td></tr>',
            );
            return;
        }

        // Get date columns (skip rate_code column)
        const dateColumns = allColumns.filter((col) => col.fieldname !== "rate_code");

        // Calculate pagination for date columns
        const totalPages = Math.ceil(dateColumns.length / daysPerPage);
        const startIndex = currentPage * daysPerPage;
        const endIndex = Math.min(startIndex + daysPerPage, dateColumns.length);
        const visibleColumns = dateColumns.slice(startIndex, endIndex);

        // Build header row
        const headerCells = [
            '<th rowspan="2" style="position: sticky; left: 0; background: white; z-index: 10; min-width: 200px; vertical-align: middle;">Rate Code</th>',
        ];

        visibleColumns.forEach((col, index) => {
            let label = col.label;
            const weekendClass = col.is_weekend ? "bg-light" : "";

            // Add page info to first column
            if (index === 0 && totalPages > 1) {
                label += ` <small class="text-muted">(${currentPage + 1}/${totalPages})</small>`;
            }

            headerCells.push(
                `<th class="text-center ${weekendClass}" style="min-width: 120px;">${label}</th>`,
            );
        });

        $thead.append(`<tr>${headerCells.join("")}</tr>`);

        // Add subheader row for prices
        const subHeaderCells = [];
        visibleColumns.forEach((col) => {
            const weekendClass = col.is_weekend ? "bg-light" : "";
            subHeaderCells.push(
                `<th class="text-center ${weekendClass}" style="font-size: 10px; padding: 4px;">Price</th>`,
            );
        });

        $thead.append(`<tr>${subHeaderCells.join("")}</tr>`);

        // Add navigation row if needed
        if (totalPages > 1) {
            const navCells = [];

            visibleColumns.forEach((col, index) => {
                let navContent = "";
                if (index === 0) {
                    navContent = `<button class="btn btn-sm btn-outline-primary" onclick="window.prevPageRates()" ${currentPage === 0 ? "disabled" : ""}>←</button>`;
                } else if (index === visibleColumns.length - 1) {
                    navContent = `<button class="btn btn-sm btn-outline-primary" onclick="window.nextPageRates()" ${currentPage === totalPages - 1 ? "disabled" : ""}>→</button>`;
                }
                navCells.push(`<th class="text-center">${navContent}</th>`);
            });

            $thead.append(`<tr class="table-secondary">
                <th style="position: sticky; left: 0; background: #e9ecef; z-index: 10;">Navigate</th>
                ${navCells.join("")}
            </tr>`);
        }

        // Build data rows for each rate code
        Object.entries(allData).forEach(([rateCode, daysData]) => {
            const rateCells = [
                `<td style="position: sticky; left: 0; background: white; font-weight: bold; padding: 12px; vertical-align: middle; border-right: 2px solid #dee2e6; z-index: 10;">${frappe.utils.escape_html(rateCode)}</td>`,
            ];

            visibleColumns.forEach((col) => {
                const dateMatch = col.fieldname.match(/date_(\d+)/);
                if (dateMatch) {
                    const forDate = parseInt(dateMatch[1]);
                    const dayData = daysData.find((d) => d.for_date === forDate);
                    const price = dayData ? dayData.rate_price : 0;

                    // Weekend styling
                    let weekendStyle = col.is_weekend
                        ? "background-color: rgba(248, 249, 250, 0.8);"
                        : "";

                    // Price color coding
                    let colorClass = "text-dark";
                    if (price === 0) {
                        colorClass = "text-muted";
                    } else if (price > 200) {
                        // High price
                        colorClass = "text-success";
                    } else if (price > 100) {
                        // Medium price
                        colorClass = "text-warning";
                    } else {
                        // Low price
                        colorClass = "text-info";
                    }

                    const formattedPrice = price > 0 ? format_currency(price) : "-";

                    rateCells.push(
                        `<td class="text-center ${colorClass}" style="padding: 8px; font-weight: 500; font-size: 14px; ${weekendStyle}" data-date="${forDate}" data-rate-code="${rateCode}" onclick="editPrice(this)">${formattedPrice}</td>`,
                    );
                } else {
                    rateCells.push(`<td class="text-center text-muted">-</td>`);
                }
            });

            $tbody.append(`<tr class="rate-row">${rateCells.join("")}</tr>`);
        });

        // Add global navigation functions
        window.prevPageRates = () => {
            if (currentPage > 0) {
                currentPage--;
                renderTable();
            }
        };

        window.nextPageRates = () => {
            const totalPages = Math.ceil(dateColumns.length / daysPerPage);
            if (currentPage < totalPages - 1) {
                currentPage++;
                renderTable();
            }
        };

        // Add click-to-edit functionality
        window.editPrice = (cell) => {
            const $cell = $(cell);
            const date = $cell.data("date");
            const rateCode = $cell.data("rate-code");
            const currentPrice = $cell.text().replace(/[^\d.]/g, "") || "0";

            frappe.prompt(
                [
                    {
                        fieldtype: "Currency",
                        fieldname: "price",
                        label: __("Price"),
                        default: parseFloat(currentPrice),
                        reqd: 1,
                    },
                ],
                (values) => {
                    updatePrice(rateCode, date, values.price, $cell);
                },
                __(
                    `Update Price for ${rateCode} on ${frappe.datetime.str_to_user(date.toString())}`,
                ),
                __("Update"),
            );
        };
    }

    function updatePrice(rateCode, date, price, $cell) {
        frappe.call({
            method: "abchotels.abc_hotels.api.inventory.update_room_type_rate",
            args: {
                rate_code: rateCode,
                for_date: date,
                price: price,
            },
            callback: (r) => {
                if (r.message && r.message.success) {
                    // Update the cell display
                    $cell.text(format_currency(price));

                    // Update color class based on new price
                    $cell.removeClass("text-muted text-success text-warning text-info text-dark");
                    let colorClass = "text-dark";
                    if (price === 0) {
                        colorClass = "text-muted";
                    } else if (price > 200) {
                        colorClass = "text-success";
                    } else if (price > 100) {
                        colorClass = "text-warning";
                    } else {
                        colorClass = "text-info";
                    }
                    $cell.addClass(colorClass);

                    frappe.show_alert({ message: __("Price Updated"), indicator: "green" });
                } else {
                    frappe.show_alert({ message: __("Failed to update price"), indicator: "red" });
                }
            },
            error: () => {
                frappe.show_alert({ message: __("Failed to update price"), indicator: "red" });
            },
        });
    }

    function openSetPriceDialog() {
        const room_type = page.fields_dict.room_type.get_value();
        if (!room_type) {
            frappe.msgprint(__("Please select a room type first."));
            return;
        }

        frappe.prompt(
            [
                {
                    fieldtype: "Link",
                    fieldname: "rate_code",
                    label: __("Rate Code"),
                    options: "Rate Code",
                    reqd: 1,
                },
                {
                    fieldtype: "Currency",
                    fieldname: "price",
                    label: __("Price"),
                    reqd: 1,
                },
            ],
            (values) => {
                frappe.call({
                    method: "abchotels.abc_hotels.api.inventory.seed_room_type_inventory_rate_codes",
                    args: {
                        rate_code: values.rate_code,
                        room_type: room_type,
                        start_date: page.fields_dict.start_date.get_value(),
                        end_date: page.fields_dict.end_date.get_value(),
                        price: values.price,
                    },
                    callback: () => {
                        frappe.show_alert({ message: __("Prices Updated"), indicator: "green" });
                        fetchAndRender();
                    },
                });
            },
            __("Set Price for Date Range"),
            __("Save"),
        );
    }

    function toIntYYYYMMDD(isoDate) {
        return parseInt(isoDate.replace(/-/g, ""), 10);
    }

    // Custom CSS
    $("<style>")
        .prop("type", "text/css")
        .html(
            `
            .pricing-table-container {
                margin-top: 20px;
            }
            .table th {
                vertical-align: middle;
                text-align: center;
                font-size: 12px;
                padding: 8px 4px;
                border: 1px solid #dee2e6;
            }
            .table td {
                vertical-align: middle;
                padding: 6px 8px;
                border: 1px solid #dee2e6;
                cursor: pointer;
            }
            .table-responsive {
                max-height: 75vh;
                overflow-x: auto;
            }
            .bg-light {
                background-color: #f8f9fa !important;
                border-left: 2px solid #dee2e6 !important;
                border-right: 2px solid #dee2e6 !important;
            }

            /* Price color classes */
            .text-success { color: #28a745 !important; }
            .text-warning { color: #ffc107 !important; }
            .text-info { color: #17a2b8 !important; }
            .text-muted { color: #6c757d !important; }
            .text-dark { color: #343a40 !important; }

            /* Hover effects */
            .table tbody tr:hover td {
                background-color: #f5f5f5 !important;
            }

            .table tbody td:hover {
                background-color: #e9ecef !important;
                transform: scale(1.05);
                transition: all 0.2s ease;
            }

            /* Rate row styling */
            .rate-row {
                background-color: #ffffff;
            }
            .rate-row:nth-child(even) {
                background-color: #f8f9fa;
            }
        `,
        )
        .appendTo("head");
};

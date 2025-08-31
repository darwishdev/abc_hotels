frappe.pages["hotel-availability-d"].on_page_load = function (wrapper) {
    const page = frappe.ui.make_app_page({
        parent: wrapper,
        title: "Hotel Availability Dashboard",
        single_column: true,
    });

    // Create filters
    page.add_field({
        label: "Start Date",
        fieldtype: "Date",
        fieldname: "start_date",
        default: frappe.datetime.get_today(),
        change: () => fetchAndRender(),
    });

    page.add_field({
        label: "End Date",
        fieldtype: "Date",
        fieldname: "end_date",
        default: frappe.datetime.add_days(frappe.datetime.get_today(), 14),
        change: () => fetchAndRender(),
    });

    page.add_field({
        label: "Room Type",
        fieldtype: "Link",
        fieldname: "room_type",
        options: "Room Type",
        change: () => fetchAndRender(),
    });

    // Add navigation buttons
    page.add_button("← Previous 7 Days", () => navigateDates(-7), "btn-secondary");
    page.add_button("Next 7 Days →", () => navigateDates(7), "btn-secondary");
    page.add_button("Refresh", () => fetchAndRender(), "btn-primary");

    // Create table container
    const table_container = $(`
        <div class="availability-table-container">
            <div class="table-responsive">
                <table class="table table-bordered" id="availability-table">
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

    // Auto-run once on load
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
        const start_date = page.fields_dict.start_date.get_value();
        const end_date = page.fields_dict.end_date.get_value();
        const room_type = page.fields_dict.room_type.get_value();

        if (!start_date || !end_date) {
            frappe.msgprint("Please select both start and end dates.");
            return;
        }

        if (start_date > end_date) {
            frappe.msgprint("Start date must be before or equal to end date.");
            return;
        }

        // Convert dates to YYYYMMDD format
        const start_int = toIntYYYYMMDD(start_date);
        const end_int = toIntYYYYMMDD(end_date);

        // Show loading
        $("#availability-table tbody").html(
            '<tr><td colspan="100%" class="text-center">Loading...</td></tr>',
        );

        frappe.call({
            method: "abchotels.abc_hotels.api.inventory.get_availability_grid_simple",
            type: "GET",
            args: {
                start_date: start_int,
                end_date: end_int,
                room_type: room_type || "",
            },
            callback: (r) => {
                const payload = r.message || {};
                allColumns = payload.columns || [];
                allData = payload.data || {};

                currentPage = 0; // Reset to first page
                renderTable();

                // Update page title
                const room_count = Object.keys(allData).length;
                const total_days = payload.total_days || 0;
                page.set_title(
                    `Hotel Availability (${room_count} room types, ${total_days} days)`,
                );
            },
            error: (err) => {
                console.error(err);
                frappe.msgprint("Failed to load availability data.");
                $("#availability-table tbody").html(
                    '<tr><td colspan="100%" class="text-center text-danger">Failed to load data</td></tr>',
                );
            },
        });
    }

    function renderTable() {
        const $table = $("#availability-table");
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

        // Get date columns (skip room_type column)
        const dateColumns = allColumns.filter((col) => col.fieldname !== "room_type");

        // Calculate pagination for date columns
        const totalPages = Math.ceil(dateColumns.length / daysPerPage);
        const startIndex = currentPage * daysPerPage;
        const endIndex = Math.min(startIndex + daysPerPage, dateColumns.length);
        const visibleColumns = dateColumns.slice(startIndex, endIndex);

        // Build header row with labels for the three subrows
        const headerCells = [
            '<th rowspan="2" style="position: sticky; left: 0; background: white; z-index: 10; min-width: 200px; vertical-align: middle;">Room Type</th>',
            '<th rowspan="2" style="position: sticky; left: 200px; background: white; z-index: 9; min-width: 80px; vertical-align: middle;">Type</th>',
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

        // Add subheader row (no cells for room type and type columns due to rowspan)
        const subHeaderCells = [];
        visibleColumns.forEach((col) => {
            const weekendClass = col.is_weekend ? "bg-light" : "";
            subHeaderCells.push(
                `<th class="text-center ${weekendClass}" style="font-size: 10px; padding: 4px;">Count</th>`,
            );
        });

        $thead.append(`<tr>${subHeaderCells.join("")}</tr>`);

        // Add navigation row if needed
        if (totalPages > 1) {
            const navCells = [];

            visibleColumns.forEach((col, index) => {
                let navContent = "";
                if (index === 0) {
                    navContent = `<button class="btn btn-sm btn-outline-primary" onclick="window.prevPage()" ${currentPage === 0 ? "disabled" : ""}>←</button>`;
                } else if (index === visibleColumns.length - 1) {
                    navContent = `<button class="btn btn-sm btn-outline-primary" onclick="window.nextPage()" ${currentPage === totalPages - 1 ? "disabled" : ""}>→</button>`;
                }
                navCells.push(`<th class="text-center">${navContent}</th>`);
            });

            $thead.append(`<tr class="table-secondary">
                <th style="position: sticky; left: 0; background: #e9ecef; z-index: 10;">Navigate</th>
                <th style="position: sticky; left: 200px; background: #e9ecef; z-index: 9;"></th>
                ${navCells.join("")}
            </tr>`);
        }

        // Build data rows with subrows for each room type
        Object.entries(allData).forEach(([roomType, daysData]) => {
            // Row 1: Available - light green background
            const availableCells = [
                `<td rowspan="3" style="position: sticky; left: 0; background: white; font-weight: bold; padding: 12px; vertical-align: middle; border-right: 2px solid #dee2e6; z-index: 10;">${frappe.utils.escape_html(roomType)}</td>`,
                `<td style="position: sticky; left: 200px; background: #d4edda; font-weight: bold; padding: 8px; text-align: center; border-right: 2px solid #dee2e6; color: #155724; z-index: 9;">AVAIL</td>`,
            ];

            visibleColumns.forEach((col) => {
                const dateMatch = col.fieldname.match(/date_(\d+)/);
                if (dateMatch) {
                    const forDate = parseInt(dateMatch[1]);
                    const dayData = daysData.find((d) => d.for_date === forDate);
                    const available = dayData ? dayData.total_available_units : 0;

                    // Light green background for the whole row
                    let weekendStyle = col.is_weekend
                        ? "background-color: rgba(212, 237, 218, 0.7);"
                        : "background-color: rgba(212, 237, 218, 0.3);";
                    let colorClass = "text-success";
                    if (available === 0) colorClass = "text-danger";
                    else if (dayData && available <= dayData.total_count * 0.3)
                        colorClass = "text-warning";

                    availableCells.push(
                        `<td class="text-center ${colorClass}" style="padding: 8px; font-weight: bold; font-size: 16px; ${weekendStyle}">${available}</td>`,
                    );
                } else {
                    availableCells.push(
                        `<td class="text-center text-muted" style="background-color: rgba(212, 237, 218, 0.3);">-</td>`,
                    );
                }
            });

            // Row 2: Occupied - light blue background
            const occupiedCells = [
                `<td style="position: sticky; left: 200px; background: #cce5ff; font-weight: bold; padding: 8px; text-align: center; border-right: 2px solid #dee2e6; color: #004085; z-index: 9;">OCC</td>`,
            ];
            visibleColumns.forEach((col) => {
                const dateMatch = col.fieldname.match(/date_(\d+)/);
                if (dateMatch) {
                    const forDate = parseInt(dateMatch[1]);
                    const dayData = daysData.find((d) => d.for_date === forDate);
                    const occupied = dayData ? dayData.occupied_count : 0;

                    // Light blue background for the whole row
                    const weekendStyle = col.is_weekend
                        ? "background-color: rgba(204, 229, 255, 0.7);"
                        : "background-color: rgba(204, 229, 255, 0.3);";
                    occupiedCells.push(
                        `<td class="text-center text-primary" style="padding: 6px; font-weight: 500; ${weekendStyle}">${occupied}</td>`,
                    );
                } else {
                    occupiedCells.push(
                        `<td class="text-center text-muted" style="background-color: rgba(204, 229, 255, 0.3);">-</td>`,
                    );
                }
            });

            // Row 3: Out of Order - light red background
            const oooCells = [
                `<td style="position: sticky; left: 200px; background: #f8d7da; font-weight: bold; padding: 8px; text-align: center; border-right: 2px solid #dee2e6; color: #721c24; z-index: 9;">OOO</td>`,
            ];
            visibleColumns.forEach((col) => {
                const dateMatch = col.fieldname.match(/date_(\d+)/);
                if (dateMatch) {
                    const forDate = parseInt(dateMatch[1]);
                    const dayData = daysData.find((d) => d.for_date === forDate);
                    const ooo = dayData ? dayData.out_of_order_count : 0;

                    // Light red background for the whole row
                    const weekendStyle = col.is_weekend
                        ? "background-color: rgba(248, 215, 218, 0.7);"
                        : "background-color: rgba(248, 215, 218, 0.3);";
                    const colorClass = ooo > 0 ? "text-danger" : "text-muted";
                    oooCells.push(
                        `<td class="text-center ${colorClass}" style="padding: 6px; ${weekendStyle}">${ooo}</td>`,
                    );
                } else {
                    oooCells.push(
                        `<td class="text-center text-muted" style="background-color: rgba(248, 215, 218, 0.3);">-</td>`,
                    );
                }
            });

            // Add all three rows
            $tbody.append(`<tr class="available-row">${availableCells.join("")}</tr>`);
            $tbody.append(`<tr class="occupied-row">${occupiedCells.join("")}</tr>`);
            $tbody.append(
                `<tr class="ooo-row" style="border-bottom: 2px solid #dee2e6;">${oooCells.join("")}</tr>`,
            );
        });

        // Add global navigation functions
        window.prevPage = () => {
            if (currentPage > 0) {
                currentPage--;
                renderTable();
            }
        };

        window.nextPage = () => {
            const totalPages = Math.ceil(dateColumns.length / daysPerPage);
            if (currentPage < totalPages - 1) {
                currentPage++;
                renderTable();
            }
        };
    }

    function toIntYYYYMMDD(isoDate) {
        return parseInt(isoDate.replace(/-/g, ""), 10);
    }

    // Add custom CSS
    $("<style>")
        .prop("type", "text/css")
        .html(
            `
            .availability-table-container {
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
            }
            .table-responsive {
                max-height: 75vh;
                overflow-x: auto;
            }
            .bg-light {
                background-color: #f8f9fa !important;
            }
            /* Row styling */
            .available-row {
                background-color: #f9f9f9;
                font-weight: bold;
            }
            .occupied-row {
                background-color: #ffffff;
            }
            .ooo-row {
                background-color: #f9f9f9;
                border-bottom: 2px solid #dee2e6 !important;
            }
            /* Color classes */
            .text-success { color: #28a745 !important; }
            .text-warning { color: #ffc107 !important; }
            .text-danger { color: #dc3545 !important; }
            .text-primary { color: #007bff !important; }
            .text-muted { color: #6c757d !important; }

            /* Hover effects */
            .table tbody tr:hover td {
                background-color: #f5f5f5 !important;
            }

            /* Weekend column highlighting */
            .bg-light {
                background-color: #f8f9fa !important;
                border-left: 2px solid #dee2e6 !important;
                border-right: 2px solid #dee2e6 !important;
            }
        `,
        )
        .appendTo("head");
};

frappe.ui.form.on("Hotel Reservation", {
    check_in_date: function (frm) {
        calculate_total_base_amount(frm);
    },

    check_out_date: function (frm) {
        calculate_total_base_amount(frm);
    },

    base_rate_per_night: function (frm) {
        calculate_total_base_amount(frm);
    },

    // Final safety net before save/submit
    validate(frm) {
        //sync_assigned_room_type(frm);
    },
    check_in_date(frm) {
        set_checkout_date_restrictions(frm);
        validate_check_in_date(frm);

        if (frm.doc.check_out_date) {
            if (validate_date_sequence(frm)) {
                update_number_of_nights(frm);
            }
        } else if (frm.doc.number_of_nights) {
            // If nights are entered, auto-set check_out_date
            update_check_out_date(frm);
        }
    },

    check_out_date(frm) {
        if (validate_date_sequence(frm)) {
            update_number_of_nights(frm);
        }
    },

    number_of_nights(frm) {
        if (frm.doc.check_in_date && frm.doc.number_of_nights > 0) {
            update_check_out_date(frm);
            addAvailibilityButton(frm);
        }
    },
    refresh(frm) {
        // Optional: hide the HTML placeholder until needed
        hide_availability(frm);
        console.log("frm status", frm.doc, frm.doc, frm.docroom_type_room);
        const showCheckIn = frm.doc.docstatus == 1;
        if (showCheckIn) {
            frm.add_custom_button("Check In", function () {
                frappe.call({
                    method: "abchotels.abc_hotels.api.reservation.check_in", // adjust path if needed
                    args: {
                        reservation_id: frm.doc.name,
                    },
                    callback: function (r) {
                        if (r.message) {
                            console.log(r.message);
                        } else {
                            console.log("No response from server");
                        }
                    },
                });
            });
        }
        addAvailibilityButton(frm);
        //    if (showAvailability) {
        //
        //        frm.add_custom_button("Get Availability", async () => {
        //            await fetch_and_render_availability(frm);
        //        });
        //    }
    },
});

function addAvailibilityButton(frm) {
    const isShown = frm.doc.docstatus == 0 && frm.doc.number_of_nights > 0;
    if (isShown) {
        frm.add_custom_button("Get Availability", async () => {
            await fetch_and_render_availability(frm);
        });
        return;
    }
}
// Date validation functions
function set_date_field_restrictions(frm) {
    // Set minimum date for check-in to today
    const today = frappe.datetime.get_today();

    frm.set_df_property("check_in_date", "options", {
        minDate: today,
    });

    // Set initial check-out restrictions if check-in is already set
    if (frm.doc.check_in_date) {
        set_checkout_date_restrictions(frm);
    }
}

function set_checkout_date_restrictions(frm) {
    if (frm.doc.check_in_date) {
        // Calculate minimum checkout date (day after check-in)
        const check_in_date = frappe.datetime.str_to_obj(frm.doc.check_in_date);
        const min_checkout = frappe.datetime.add_days(frm.doc.check_in_date, 1);

        frm.set_df_property("check_out_date", "options", {
            minDate: min_checkout,
        });
    }
}

function validate_check_in_date(frm) {
    if (!frm.doc.check_in_date) return;

    const today = frappe.datetime.get_today();
    const check_in = frm.doc.check_in_date;

    if (frappe.datetime.str_to_obj(check_in) < frappe.datetime.str_to_obj(today)) {
        frappe.msgprint({
            title: "Invalid Check-in Date",
            message:
                "Check-in date cannot be in the past. Please select today's date or a future date.",
            indicator: "red",
        });
        frm.set_value("check_in_date", "");
        return false;
    }
    return true;
}

function validate_date_sequence(frm) {
    if (!frm.doc.check_in_date || !frm.doc.check_out_date) return;

    const check_in = frappe.datetime.str_to_obj(frm.doc.check_in_date);
    const check_out = frappe.datetime.str_to_obj(frm.doc.check_out_date);

    if (check_out <= check_in) {
        frappe.msgprint({
            title: "Invalid Date Sequence",
            message:
                "Check-out date must be after check-in date. Please ensure at least one night stay.",
            indicator: "red",
        });
        frm.set_value("check_out_date", "");
        return false;
    }
    return true;
}

async function fetch_and_render_availability(frm) {
    // 1) Read inputs from the form
    const start = frm.doc.check_in_date;
    const end = frm.doc.check_out_date;
    const rooms = cint(frm.doc.number_of_rooms || 0);
    const rate_codes_csv = (frm.doc.rate_code || "").trim(); // single Link is fine as CSV
    const room_types_csv = (frm.doc.room_type || "").trim();

    // 2) Validate
    const errors = [];
    if (!start) errors.push("Check In Date is required.");
    if (!end) errors.push("Check Out Date is required.");
    if (start && end && frappe.datetime.str_to_obj(end) < frappe.datetime.str_to_obj(start)) {
        errors.push("Check Out Date must be on or after Check In Date.");
    }
    if (!rooms || rooms <= 0) errors.push("Number of Rooms must be greater than 0.");
    if (errors.length) {
        frappe.msgprint({
            title: "Validation",
            message: "<ul><li>" + errors.join("</li><li>") + "</li></ul>",
            indicator: "red",
        });
        return;
    }

    // 3) Convert dates to yyyymmdd int expected by your proc
    const startInt = toIntDate(start);
    const endInt = toIntDate(end);

    // 4) Render loading state and disable button
    show_availability(
        frm,
        `
    <div class="flex items-center gap-2 text-muted">
      <span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
      Fetching availability…
    </div>
  `,
    );
    set_action_buttons_enabled(false);

    // 5) Call GET endpoint
    frappe.call({
        method: "abchotels.abc_hotels.api.inventory.get_availability",
        type: "GET",
        args: {
            start: startInt,
            end: endInt,
            rooms: rooms,
            rate_codes_csv: rate_codes_csv, // '' → match all
            room_types_csv: room_types_csv, // '' → match all
        },
        callback: (r) => {
            const rows = r.message || [];
            if (!rows.length) {
                show_availability(
                    frm,
                    `<div class="text-orange">No availability found for the selected dates.</div>`,
                );
                return;
            }
            render_availability_table(frm, rows, { start, end, rooms });
        },
        error: () => {
            show_availability(frm, `<div class="text-danger">Error fetching availability.</div>`);
        },
        always: () => {
            set_action_buttons_enabled(true);
        },
    });
}

//function render_availability_table(frm, rows, ctx) {
//    // --- Minimal styles (scoped into the wrapper) ---
//    const styles = `
//    <style>
//      .avail-grid { display:flex; flex-wrap:wrap; gap:12px; }
//      .avail-card {
//        flex: 1 1 280px;
//        max-width: 420px;
//        border: 1px solid var(--border-color, #e5e7eb);
//        border-radius: 10px;
//        box-shadow: 0 1px 2px rgba(0,0,0,.04);
//        background: #fff;
//        overflow: hidden;
//      }
//      .avail-card .hd {
//        display:flex; align-items:center; justify-content:space-between;
//        padding:10px 12px; border-bottom:1px solid var(--border-color, #eef0f2);
//        background: #f8fafc;
//      }
//      .avail-card .hd .rate {
//        font-weight:600; font-size:14px; color:#111827;
//      }
//      .avail-card .bd { padding:12px; display:grid; grid-template-columns: 1fr auto; grid-row-gap:8px; grid-column-gap:12px; }
//      .avail-card .room { font-weight:600; color:#111827; }
//      .avail-card .meta { color:#6b7280; font-size:12px; }
//      .avail-card .price {
//        font-size:20px; font-weight:700; text-align:right;
//      }
//      .avail-badges { display:flex; flex-wrap:wrap; gap:6px; margin-top:6px; }
//      .avail-badge {
//        font-size:11px; padding:2px 6px; border-radius:999px; background:#f3f4f6; color:#374151; border:1px solid #e5e7eb;
//      }
//      .avail-actions { padding:10px 12px; border-top:1px solid var(--border-color, #eef0f2); text-align:right; }
//      .btn-xs { padding:4px 8px; font-size:12px; }
//    </style>
//  `;
//
//    const html = `
//    ${styles}
//    <div class="avail-grid">
//      ${rows
//          .map(
//              (r, i) => `
//        <div class="avail-card">
//          <div class="hd">
//            <div class="rate">${frappe.utils.escape_html(r.rate_code ?? "")}</div>
//            <div class="meta">${nightsLabel(ctx.start, ctx.end)}</div>
//          </div>
//
//          <div class="bd">
//            <div class="room">
//              ${frappe.utils.escape_html(r.room_type ?? "")}
//              <div class="avail-badges">
//                <span class="avail-badge">Total: ${safeNum(r.total_count)}</span>
//                <span class="avail-badge">Max Occ: ${safeNum(r.max_occupied)}</span>
//                <span class="avail-badge">Min Avail: ${safeNum(r.min_available_units)}</span>
//              </div>
//            </div>
//            <div class="price">${format_currency_safe(r.total_stay)}</div>
//          </div>
//
//          <div class="avail-actions">
//            <button class="btn btn-primary btn-xs avail-select" data-index="${i}">Select</button>
//          </div>
//        </div>
//      `,
//          )
//          .join("")}
//    </div>
//  `;
//
//    show_availability(frm, html);
//
//    // Wire selection
//    const $wrap = get_availability_wrapper(frm);
//    $wrap.off("click.avail").on("click.avail", ".avail-select", function () {
//        const idx = parseInt($(this).data("index"), 10);
//        const row = rows[idx];
//        apply_selection_to_form(frm, row, ctx);
//    });
//}

//// helpers used above
//function nightsLabel(start, end) {
//    const n = Math.max(1, frappe.datetime.get_day_diff(end, start));
//    return n === 1 ? "1 night" : `${n} nights`;
//}
//function safeNum(v) {
//    const n = Number(v);
//    return Number.isFinite(n) ? n : 0;
//}
function apply_selection_to_form(frm, row, ctx) {
    console.log("roww is ", row);
    // Map selected availability row into form fields
    if (row.room_type) frm.set_value("room_type", row.room_type);
    if (row.rate_code) frm.set_value("rate_code", row.rate_code);

    // Reuse the same dates and rooms used for the search
    frm.set_value("check_in_date", ctx.start);
    frm.set_value("check_out_date", ctx.end);
    frm.set_value("number_of_rooms", ctx.rooms);

    // Pricing
    frm.set_value("base_rate_per_night", row.base_rate_per_night || 0);
    frm.set_value("total_base_amount", row.total_stay || 0);

    frappe.show_alert({
        message: `Selected ${row.rate_code} · ${row.room_type}`,
        indicator: "green",
    });
}

// --- helpers ---

function show_availability(frm, html) {
    const $wrap = get_availability_wrapper(frm);
    $wrap.html(html).closest(".form-group").toggle(true);
}

function hide_availability(frm) {
    const $wrap = get_availability_wrapper(frm);
    $wrap.empty().closest(".form-group").toggle(false);
}

function get_availability_wrapper(frm) {
    // Prefer the HTML field; fallback to dashboard if missing
    if (frm.fields_dict.availability_html) {
        return $(frm.fields_dict.availability_html.$wrapper);
    }
    return $(frm.dashboard.wrapper);
}

function toIntDate(d) {
    // "YYYY-MM-DD" → 20250826
    return cint(String(d).replaceAll("-", ""));
}

function format_currency_safe(v) {
    const n = Number(v);
    if (Number.isFinite(n)) {
        try {
            return format_currency(n);
        } catch {
            return n.toFixed(2);
        }
    }
    return "";
}

function cint(v) {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : 0;
}

function set_action_buttons_enabled(frm, enabled) {
    if (frm && frm._avail_btn && frm._avail_btn.prop) {
        frm._avail_btn.prop("disabled", !enabled);
    }
}

// --- Helpers ---
function update_number_of_nights(frm) {
    if (!frm.doc.check_in_date || !frm.doc.check_out_date) return;

    const check_in = frappe.datetime.str_to_obj(frm.doc.check_in_date);
    const check_out = frappe.datetime.str_to_obj(frm.doc.check_out_date);

    const diff_days = frappe.datetime.get_day_diff(check_out, check_in);

    if (diff_days > 0) {
        frm.set_value("number_of_nights", diff_days);
    } else {
        frm.set_value("number_of_nights", 0);
    }
}

function update_check_out_date(frm) {
    if (!frm.doc.check_in_date || !frm.doc.number_of_nights) return;

    const check_in = frappe.datetime.str_to_obj(frm.doc.check_in_date);
    const nights = cint(frm.doc.number_of_nights);

    if (nights > 0) {
        const check_out = frappe.datetime.add_days(check_in, nights);
        frm.set_value("check_out_date", frappe.datetime.obj_to_str(check_out));
    }
}

function calculate_total_base_amount(frm) {
    if (frm.doc.check_in_date && frm.doc.check_out_date && frm.doc.base_rate_per_night) {
        let check_in = frappe.datetime.str_to_obj(frm.doc.check_in_date);
        let check_out = frappe.datetime.str_to_obj(frm.doc.check_out_date);

        if (check_out > check_in) {
            let nights = frappe.datetime.get_diff(frm.doc.check_out_date, frm.doc.check_in_date);
            let total = nights * frm.doc.base_rate_per_night;

            frm.set_value("total_base_amount", total);
        } else {
            frm.set_value("total_base_amount", 0);
        }
    } else {
        frm.set_value("total_base_amount", 0);
    }
}

function render_availability_table(frm, rows, ctx) {
    // 1) Group rows by room_type
    const grouped = {};
    rows.forEach((r) => {
        if (!grouped[r.room_type]) {
            grouped[r.room_type] = {
                room_type: r.room_type,
                total_count: r.total_count,
                max_occupied: r.max_occupied,
                min_available_units: r.min_available_units,
                rates: [],
            };
        }
        grouped[r.room_type].rates.push({
            rate_code: r.rate_code,
            rate_per_night: r.rate_per_night,
            total_stay: r.total_stay,
        });
    });

    const roomGroups = Object.values(grouped);

    // 2) Render cards
    const html = `
  <style>
    .avail-grid {
      display:flex; flex-wrap:wrap; gap:16px; margin-top:12px;
    }
    .avail-card {
      flex: 1 1 300px; max-width: 460px;
      border-radius: 12px; background:#fff;
      box-shadow:0 2px 6px rgba(0,0,0,.08);
      overflow:hidden; display:flex; flex-direction:column;
    }
    .avail-card .hd {
      padding:12px 16px;
      background:linear-gradient(135deg,#2563eb,#3b82f6);
      color:#fff; font-weight:600;
      display:flex; justify-content:space-between; align-items:center;
    }
    .avail-card .meta { font-size:12px; opacity:.9; }
    .avail-card .bd { padding:14px 16px; flex:1; }
    .avail-badges { display:flex; flex-wrap:wrap; gap:8px; margin-top:6px; }
    .avail-badge {
      background:#f0f9ff; border:1px solid #bae6fd; color:#0369a1;
      font-size:12px; font-weight:500; padding:3px 8px; border-radius:6px;
    }
    .rates { margin-top:12px; border-top:1px solid #f1f5f9; padding-top:10px; }
    .rate-row {
      display:flex; justify-content:space-between; align-items:center;
      padding:6px 0; border-bottom:1px dashed #e5e7eb;
    }
    .rate-row:last-child { border-bottom:none; }
    .rate-name { font-weight:500; color:#374151; }
    .rate-price { font-size:14px; font-weight:600; color:#16a34a; margin-left:auto; margin-right:12px; }
    .rate-total { font-size:13px; color:#6b7280; }
    .btn-xs {
      padding:4px 10px; font-size:12px; border-radius:6px;
      background:#2563eb; color:#fff; border:none; cursor:pointer; transition:background .2s;
    }
    .btn-xs:hover { background:#1d4ed8; }
  </style>

  <div class="avail-grid">
    ${roomGroups
        .map(
            (room, i) => `
      <div class="avail-card">
        <div class="hd">
          <div class="room">${frappe.utils.escape_html(room.room_type ?? "")}</div>
          <div class="meta">${nightsLabel(ctx.start, ctx.end)}</div>
        </div>
        <div class="bd">
          <div class="avail-badges">
            <span class="avail-badge">Total: ${safeNum(room.total_count)}</span>
            <span class="avail-badge">Max Occ: ${safeNum(room.max_occupied)}</span>
            <span class="avail-badge">Min Avail: ${safeNum(room.min_available_units)}</span>
          </div>

          <div class="rates">
            ${room.rates
                .map(
                    (rate, j) => `
              <div class="rate-row">
                <div class="rate-name">${frappe.utils.escape_html(rate.rate_code)}</div>
                <div class="rate-price">${format_currency_safe(rate.rate_per_night)}</div>
                <div class="rate-total">${format_currency_safe(rate.total_stay)}</div>
                <button class="btn-xs select-rate"
                        data-room="${room.room_type}"
                        data-index="${j}">Select</button>
              </div>
            `,
                )
                .join("")}
          </div>
        </div>
      </div>
    `,
        )
        .join("")}
  </div>`;

    show_availability(frm, html);

    // 3) Wire up select buttons
    const $wrap = get_availability_wrapper(frm);
    $wrap.off("click.select").on("click.select", ".select-rate", function () {
        const room_type = $(this).data("room");
        const idx = $(this).data("index");
        const group = roomGroups.find((r) => r.room_type === room_type);
        const rate = group.rates[idx];
        if (rate) {
            apply_selection_to_form(
                frm,
                {
                    room_type,
                    rate_code: rate.rate_code,
                    rate_per_night: rate.rate_per_night,
                    total_stay: rate.total_stay,
                },
                ctx,
            );
        }
    });
}
function nightsLabel(start, end) {
    const n = Math.max(1, frappe.datetime.get_day_diff(end, start));
    return n === 1 ? "1 night" : `${n} nights`;
}
function safeNum(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}

function apply_selection_to_form(frm, row, ctx) {
    // Map selected availability row into form fields
    if (row.room_type) frm.set_value("room_type", row.room_type);
    if (row.rate_code) frm.set_value("rate_code", row.rate_code);
    console.log("rate per night is ", row);
    // Reuse the same dates and rooms used for the search
    frm.set_value("check_in_date", ctx.start);
    frm.set_value("check_out_date", ctx.end);
    frm.set_value("base_rate_per_night", row.rate_per_night || 0);

    frappe.show_alert({
        message: `Selected ${row.rate_code} · ${row.room_type}`,
        indicator: "green",
    });
}

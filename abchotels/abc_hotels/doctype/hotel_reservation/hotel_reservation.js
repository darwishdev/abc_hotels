frappe.listview_settings["Hotel Reservation"] = {
    onload(listview) {
        // Force default filters
        listview.filter_area.add([
            ["Hotel Reservation", "check_in_completed", "=", "0"],
        ]);
    },
};
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
    room_type_room: function (frm) {
        console.log("frm2", frm.doc.room_type_room);
        if (frm.doc.room_type_room) {
            console.log("frm", frm.doc.room_type_room);
            frappe.db
                .get_value("Room Type Room", frm.doc.room_type_room, "room_type")
                .then((r) => {
                    console.log("frmr", r);
                    if (r.message && r.message.room_type) {
                        frm.set_value("room_type_assigned", r.message.room_type);
                    } else {
                        frm.set_value("room_type_assigned", "");
                    }
                });
        } else {
            frm.set_value("room_type_assigned", "");
        }
    },
    refresh(frm) {
        // Optional: hide the HTML placeholder until needed
        hide_availability(frm);
        console.log("frm status", frm.doc, frm.doc, frm.docroom_type_room);
        const isSubmitted = frm.doc.docstatus === 1;
        const isToday = frm.doc.check_in_date === frappe.datetime.get_today();
        const notCheckedIn = !frm.doc.check_in_completed;
        const showCheckIn = isSubmitted && isToday && notCheckedIn;
        if (showCheckIn) {
            frm.add_custom_button("Check In", function () {
                frappe.call({
                    method: "abchotels.abc_hotels.api.reservation.check_in", // adjust path if needed
                    args: {
                        reservation_id: frm.doc.name,
                    },
                    callback: function (r) {
                        if (r.message) {
                            // 1) update Room Type Room
                            if (frm.doc.room_type_room) {
                                frappe.call({
                                    method: "frappe.client.set_value",
                                    args: {
                                        doctype: "Room Type Room",
                                        name: frm.doc.room_type_room,
                                        fieldname: { room_status: "Occupied" },
                                    },
                                    callback: function () {
                                        // 2) update Hotel Reservation (check_in_completed=1)
                                        frappe.call({
                                            method: "frappe.client.set_value",
                                            args: {
                                                doctype: "Hotel Reservation",
                                                name: frm.doc.name,
                                                fieldname: { check_in_completed: 1 },
                                            },
                                            callback: function () {
                                                frappe.show_alert({
                                                    message: __("Guest Checked In Successfully"),
                                                    indicator: "green",
                                                });
                                                frm.reload_doc(); // refresh UI
                                            },
                                        });
                                    },
                                });
                            }
                        } else {
                            frappe.msgprint(__("No response from server"));
                        }
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

console.log(window.business_date , "vbdaaate    ");
    const today = window.business_date;
 // const business_date = await frappe.db.get_single_value(
 //        "ABC Hotels Settings",
 //        "business_date"
 //    );
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
            if (!rows.availability.length) {
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
//
// function render_availability_table(frm, rows, ctx) {
//     // 1) Group rows by room_type
//     const grouped = {};
//
//     frappe.msgprint(`rows : ${JSON.stringify(rows)}`)
//     rows.forEach((r) => {
//         if (!grouped[r.room_type]) {
//             grouped[r.room_type] = {
//                 room_type: r.room_type,
//                 total_count: r.total_count,
//                 max_occupied: r.max_occupied,
//                 min_available_units: r.min_available_units,
//                 rates: [],
//             };
//         }
//         grouped[r.room_type].rates.push({
//             rate_code: r.rate_code,
//             rate_per_night: r.rate_per_night,
//             total_stay: r.total_stay,
//         });
//     });
//
//     const roomGroups = Object.values(grouped);
//
//     frappe.msgprint(`rows : ${JSON.stringify(roomGroups)}`)
//     // 2) Render cards
// const html = `
//   <style>
//   <div class="avail-grid">
// ${JSON.stringify(rows)}
//   </div>`;
//
//
//
//     show_availability(frm, html);
//
//     // 3) Wire up select buttons
//     const $wrap = get_availability_wrapper(frm);
//     $wrap.off("click.select").on("click.select", ".select-rate", function () {
//         const room_type = $(this).data("room");
//         const idx = $(this).data("index");
//         const group = roomGroups.find((r) => r.room_type === room_type);
//         const rate = group.rates[idx];
//         if (rate) {
//             apply_selection_to_form(
//                 frm,
//                 {
//                     room_type,
//                     rate_code: rate.rate_code,
//                     rate_per_night: rate.rate_per_night,
//                     total_stay: rate.total_stay,
//                 },
//                 ctx,
//             );
//         }
//     });
// }
// CSS as variable

function format_currency(val) {
    return frappe.format(val, { fieldtype: "Currency" });
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
const AVAILABILITY_CSS = `
<style>
#availability-wrapper {
  position: relative;
  font-family: system-ui, sans-serif;
  color: #111827;
}

/* Loading overlay */
.loading-overlay {
  position: absolute;
  inset: 0;
  display: none;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.6);
  font-weight: 600;
  color: #0369a1;
  z-index: 50;
}

/* Section headings */
section h3 {
  margin: 0 0 0.5rem;
  font-size: 1rem;
  font-weight: 600;
}

/* Availability pills */
.avail-bar {
  list-style: none;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  padding: 0;
  margin: 0 0 1rem;
}
.avail-pill {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-width: 70px;
  padding: 0.5rem 0.75rem;
  border-radius: 8px;
  border: 1px solid #e5e7eb;
  background: #f9fafb;
  cursor: pointer;
  transition: all 0.2s;
}
.avail-pill .count {
  font-size: 1.1rem;
  font-weight: 600;
}
.avail-pill.active {
  background: #0369a1;
  color: #fff;
  border-color: #0369a1;
}

/* Rates section */
.rates-wrapper {
  position: relative;
}
.rates-section {
  display: flex;
  gap: 0.75rem;
  overflow-x: auto;
  scroll-behavior: smooth;
  padding: 0.5rem 0;
  list-style: none;
  margin: 0;
}

/* Rate cards */
.rate-card {
  flex: 0 0 auto;
  min-width: 160px;
  padding: 0.75rem;
  border-radius: 10px;
  border: 1px solid #e5e7eb;
  background: #fff;
  text-align: center;
  cursor: pointer;
  transition: border-color 0.2s, box-shadow 0.2s;
}
.rate-card h4 {
  margin: 0 0 0.25rem;
  font-size: 0.95rem;
  font-weight: 600;
}
.rate-card .room-type {
  font-size: 0.8rem;
  color: #6b7280;
  margin: 0 0 0.25rem;
}
.rate-card .price {
  font-size: 0.9rem;
  font-weight: 600;
}

/* Selected & disabled state */
.rate-card.selected {
  border: 2px solid #0369a1;
}
.rate-card[disabled] {
  cursor: not-allowed;
  pointer-events: none;
color:var(--heading-color);
}

/* Scroll buttons */
.scroll-btn {
  position: absolute;
  top: 40%;
  transform: translateY(-50%);
  background: #fff;
  border: 1px solid #ddd;
  border-radius: 50%;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: 0 1px 3px rgba(0,0,0,.1);
  z-index: 2;
}
.scroll-btn.left { left: -12px; }
.scroll-btn.right { right: -12px; }
</style>
`;
let activeRoomFilter = null;
let selectedRateKey = null;

function render_availability_table(frm, data, ctx) {
    let html = AVAILABILITY_CSS;

    html += `
      <div id="availability-wrapper" style="position:relative;">
        <div class="loading-overlay" id="availability-loading" style="display:none;">
          Loading…
        </div>

        <section class="availability">
          <h3>Availability</h3>
          <ul class="avail-bar">
    `;
    data.availability.forEach((room) => {
        const activeClass = room.room_type === activeRoomFilter ? "active" : "";
        html += `
          <li>
            <button class="avail-pill ${activeClass}"
                    data-room="${room.room_type}"
                    aria-pressed="${activeClass ? "true" : "false"}">
              <span class="count">${room.min_available_units}</span>
              <span class="label">${room.room_type}</span>
            </button>
          </li>`;
    });
    html += `</ul></section>`;

    // Rates
    html += `
        <section class="rates">
          <h3>Rates</h3>
          <div class="rates-wrapper">
            <button class="scroll-btn left" id="scrollLeft" aria-label="Scroll left">&#8249;</button>
            <button class="scroll-btn right" id="scrollRight" aria-label="Scroll right">&#8250;</button>
            <ul class="rates-section" id="ratesScroller" role="list">
    `;

    const filteredRates = data.rates.filter(
        rate => !activeRoomFilter || rate.room_type === activeRoomFilter
    );

    filteredRates.forEach((rate, idx) => {
        const key = `${rate.room_type}::${rate.rate_code}`;
        const isSelected = key === selectedRateKey;
        const selectedClass = isSelected ? "selected" : "";
        const disabledAttr = isSelected ? "disabled" : "";
        html += `
          <li>
            <button class="rate-card select-rate ${selectedClass}"
                    data-room="${rate.room_type}"
                    data-index="${idx}"
                    aria-pressed="${isSelected ? "true" : "false"}"
                    ${disabledAttr}>
              <h4>${rate.rate_code}</h4>
              <p class="room-type">${rate.room_type}</p>
              <p class="price">${format_currency(rate.rate_per_night)}</p>
            </button>
          </li>`;
    });

    html += `
            </ul>
          </div>
        </section>
      </div>
    `;

    show_availability(frm, html);

    // Save context
    window.roomGroups = data.availability.map(room => ({
        ...room,
        rates: data.rates.filter(r => r.room_type === room.room_type),
    }));
    window.lastAvailabilityData = data;
    window.lastCtx = ctx;
}

// Loading overlay toggle
function setLoading(show = true) {
    const overlay = document.getElementById("availability-loading");
    if (overlay) overlay.style.display = show ? "flex" : "none";
}
// Room type filter
$(document)
  .off("click.pill")
  .on("click.pill", ".avail-pill", debounceLeading(function () {
      setLoading(true);
      const room = $(this).data("room");
      activeRoomFilter = activeRoomFilter === room ? null : room;
      render_availability_table(cur_frm, window.lastAvailabilityData, window.lastCtx);
      setLoading(false);
  }, 300));

// Rate selection
$(document)
  .off("click.select")
  .on("click.select", ".select-rate", debounceLeading(function () {
      setLoading(true);
      const room_type = $(this).data("room");
      const idx = $(this).data("index");
      const group = window.roomGroups.find((r) => r.room_type === room_type);
      const rate = group?.rates[idx];
      if (rate) {
          selectedRateKey = `${room_type}::${rate.rate_code}`;
          apply_selection_to_form(
              cur_frm,
              {
                  room_type,
                  rate_code: rate.rate_code,
                  rate_per_night: rate.rate_per_night,
                  total_stay: rate.total_stay,
              },
              window.lastCtx
          );
          render_availability_table(cur_frm, window.lastAvailabilityData, window.lastCtx);
      }
      setLoading(false);
  }, 300));
function debounceLeading(fn, delay = 300) {
    let timeout = null;
    return function (...args) {
        if (!timeout) {
            fn.apply(this, args); // run immediately
            timeout = setTimeout(() => {
                timeout = null; // release lock after delay
            }, delay);
        }
    };
}

function format_currency(val) {
    return frappe.format(val, { fieldtype: "Currency" });
}

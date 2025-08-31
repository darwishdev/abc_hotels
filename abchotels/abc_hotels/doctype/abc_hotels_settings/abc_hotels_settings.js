// ABC Hotels Settings — minimal populate-inventory client
let INV_DLG = null;
let onProgress = null;
let onDone = null;

frappe.ui.form.on("ABC Hotels Settings", {
    refresh(frm) {
        frm.add_custom_button(__("Populate Inventory"), () => startInventoryUI(frm));
    },
});

function startInventoryUI(frm) {
    // -- 1) validate dates
    const start = frm.doc.horizon_start_date,
        end = frm.doc.horizon_end_date;
    if (!start || !end)
        return msg("Missing Dates", "Please set both Horizon Start Date and Horizon End Date.");
    const s = new Date(start),
        e = new Date(end);
    if (isNaN(s) || isNaN(e) || s > e)
        return msg("Invalid Dates", "Start date must be before or equal to end date.");
    const days = Math.ceil((e - s) / 86400000) + 1;
    if (days > 365)
        return msg("Date Range Too Large", `Date range is ${days} days. Maximum allowed is 365.`);

    // -- 2) single dialog
    if (!INV_DLG) {
        INV_DLG = new frappe.ui.Dialog({
            title: __("Populating Inventory"),
            fields: [
                {
                    fieldtype: "HTML",
                    fieldname: "progress_html",
                    options: `
          <div class="progress mb-3">
            <div id="inv-bar" class="progress-bar progress-bar-striped progress-bar-animated" style="width:0%">0%</div>
          </div>
          <p><strong>${__("Status")}:</strong> <span id="inv-status">${__("Waiting…")}</span></p>
          <p><strong>${__("Details")}:</strong> <span id="inv-detail">—</span></p>
          <div id="inv-results" style="display:none">
            <hr/>
            <h5>${__("Results")}</h5>
            <p><strong>${__("Created")}:</strong> <span id="inv-created">0</span></p>
            <p><strong>${__("Failed")}:</strong> <span id="inv-failed">0</span></p>
          </div>`,
                },
            ],
            primary_action_label: __("Close"),
            primary_action: () => {
                detachRealtime();
                INV_DLG.hide();
            },
        });
    }

    // reset & show
    setBar(0);
    setStatus(__("Starting…"), `${start} → ${end} (${days} ${__("days")})`);
    showResults(0, 0, false);
    INV_DLG.get_primary_btn().hide();
    INV_DLG.show();

    // -- 3) realtime listeners (fresh every click)
    detachRealtime();
    onProgress = (data) => {
        if (!data || !String(data.title || "").includes("Inventory")) return;
        setBar(data.percent || 0);
        setStatus(data.title, data.description || "");
        if (data.created_so_far != null)
            showResults(data.created_so_far, data.failed_so_far || 0, true);
    };
    onDone = (payload) => {
        const created = payload?.created ?? 0;
        const failed = payload?.failed ?? 0;
        setBar(100);
        setStatus(__("Inventory Population Complete"), __("Finished"));
        showResults(created, failed, true);
        INV_DLG.get_primary_btn().show();
        frappe.show_alert({
            message:
                created === 0 && failed === 0
                    ? __("Already up to date — no new rows to insert.")
                    : __(`Done. Created ${created}.`),
            indicator: created ? "green" : "blue",
        });
    };
    if (frappe.realtime) {
        frappe.realtime.on("progress", onProgress);
        frappe.realtime.on("inventory_job_done", onDone);
    }

    // -- 4) kick off
    const run_now = days <= 30 ? 1 : 0;
    frappe
        .xcall("abchotels.abc_hotels.controllers.inventory_jobs.populate_inventory_window", {
            start_date: start, // <-- string from Docfield, e.g. "2025-08-21"
            end_date: end, // <-- string from Docfield
            run_now: run_now,
            notify_user: frappe.session.user,
        })
        .then((res) => {
            if (!res || res.ok !== true)
                throw new Error(res?.error || "Failed to start inventory population");
            // immediate path: controller already finished and sent totals
            if (res.ran_now) {
                setBar(100);
                setStatus(__("Inventory Population Complete"), __("Finished"));
                showResults(res.created ?? 0, res.failed ?? 0, true);
                INV_DLG.get_primary_btn().show();
                frappe.show_alert({
                    message:
                        (res.created ?? 0) === 0
                            ? __("Already up to date — no new rows to insert.")
                            : __(`Done. Created ${res.created}.`),
                    indicator: (res.created ?? 0) ? "green" : "blue",
                });
            } else {
                // background path: just show that it started; we'll wait for realtime final event
                setStatus(__("Background job started"), __(`Processing…`));
                // optional tiny nudge so it doesn't look stuck
                setBar(5);
            }
        })
        .catch((err) => {
            detachRealtime();
            INV_DLG.hide();
            msg(__("Error"), __("Failed to start: {0}", [html(friendlyError(err))]), "red");
        });
}

/* ------------ small helpers (tiny + robust) ------------- */

function setBar(pct) {
    const $b = INV_DLG.$wrapper.find("#inv-bar");
    $b.css("width", pct + "%").text(Math.round(pct) + "%");
    if (pct >= 100)
        $b.removeClass("progress-bar-striped progress-bar-animated").addClass("bg-success");
    else if (pct > 0) $b.addClass("progress-bar-striped progress-bar-animated");
}

function setStatus(status, detail) {
    INV_DLG.$wrapper.find("#inv-status").text(status || "");
    INV_DLG.$wrapper.find("#inv-detail").text(detail || "");
}

function showResults(created, failed, show) {
    INV_DLG.$wrapper.find("#inv-created").text(created ?? 0);
    INV_DLG.$wrapper.find("#inv-failed").text(failed ?? 0);
    INV_DLG.$wrapper.find("#inv-results").toggle(!!show);
}

function detachRealtime() {
    if (!frappe.realtime) return;
    if (onProgress) frappe.realtime.off("progress", onProgress);
    if (onDone) frappe.realtime.off("inventory_job_done", onDone);
    onProgress = null;
    onDone = null;
}

function msg(title, message, indicator = "red") {
    frappe.msgprint({ title: __(title), message: __(message), indicator });
}

function html(s) {
    return frappe.utils.escape_html(s || "");
}

function friendlyError(err) {
    try {
        if (!err) return "Unknown error";
        if (typeof err === "string") return err;
        if (err.message) return String(err.message);
        if (err._server_messages) {
            const arr = JSON.parse(err._server_messages);
            return arr
                .map((m) => {
                    try {
                        return JSON.parse(m).message || m;
                    } catch {
                        return m;
                    }
                })
                .join("\n");
        }
        if (err.responseJSON && err.responseJSON.message) return String(err.responseJSON.message);
        return JSON.stringify(err);
    } catch {
        return String(err);
    }
}

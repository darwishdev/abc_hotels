// Copyright (c) 2025, Your Name and contributors
// For license information, please see license.txt

frappe.ui.form.on("Rate Code", {
    refresh(frm) {
        frm.set_query("currency", () => {
            return {
                query: "abc_pos.abc_pos.api.pos_session.currency_list2", // path to your Python function
            };
        });
    },
});

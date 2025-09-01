# your_app/api/availability.py
import frappe
from frappe.utils.data import cint
import pymysql.cursors
from collections import defaultdict
@frappe.whitelist(allow_guest=True, methods=["GET"])
def get_availability(start, end, rooms, rate_codes_csv, room_types_csv):
    """
    Calls: CALL get_available_inventory(p_rate_codes_csv, p_room_types_csv, p_start, p_end, p_rooms)
    Returns: list[dict]
    """
    start_i = cint(start)
    end_i = cint(end)
    rooms_i = cint(rooms)

    rate_codes_csv = (rate_codes_csv or "").strip()
    room_types_csv = (room_types_csv or "").strip()

    # Correct order of params
    params = (start_i,end_i,rooms_i,rate_codes_csv,room_types_csv)

    query = "CALL get_available_inventory(%s, %s, %s, %s, %s)"

    # Log to console (appears in `bench start`)
    print("Executing SQL:")
    print(query)
    print("Params:", params)

    # Optional: show a "naive interpolated" query for human inspection
    # ⚠ not safe for production logs — only debugging
    interpolated = query % tuple(
        [f"'{p}'" if isinstance(p, str) else p for p in params]
    )
    print("Interpolated:", interpolated)
    conn = frappe.db.get_connection()
    cur = conn.cursor(pymysql.cursors.DictCursor)  # new cursor
    cur.execute(query, params)
    rows = cur.fetchall()
    cur.close()
    return rows




@frappe.whitelist(allow_guest=True, methods=["POST"])
def apply_reservation_inventory_api(reservation_name: str, target_docstatus: int):
    """
    Calls: CALL apply_reservation_inventory(p_reservation_name, p_target_docstatus)
    Returns: {'rows_touched': int, 'total_delta': int}
    """
    params = (reservation_name, cint(target_docstatus))

    # Use a raw DictCursor so we can drain extra result sets safely
    conn = frappe.db.get_connection()
    cur = conn.cursor(pymysql.cursors.DictCursor)
    cur.execute("CALL apply_reservation_inventory(%s, %s)", params)
    result = cur.fetchall() or []
    conn.commit()
    cur.close()

    # Your procedure returns one summary row; normalize the shape
    if result:
        row = result[0]
        # Ensure keys exist even if NULL
        return {
            "rows_touched": int(row.get("rows_touched") or 0),
            "total_delta": int(row.get("total_delta") or 0),
        }
    return {"rows_touched": 0, "total_delta": 0}


# Alternative version with more date info for advanced UI
@frappe.whitelist(allow_guest=True, methods=["GET"])
def get_availability_grid_detailed(start_date: int, end_date: int, room_type: str = None):
    """
    Return availability grid with SQL doing heavy lifting.
    """

    # First, get columns from dim_date
    columns_sql = """
    WITH dates AS (
        SELECT
            for_date,
            CONCAT(LEFT(day_name, 3), '<br/>', LPAD(day_of_month, 2, '0')) AS formatted_date,
            day_name,
            day_of_month,
            weekend_indr
        FROM dim_date
        WHERE for_date BETWEEN %s AND %s
        ORDER BY for_date
    )
    SELECT
        for_date,
        formatted_date,
        weekend_indr
    FROM dates
    """

    date_columns = frappe.db.sql(columns_sql, (start_date, end_date), as_dict=True)

    # Build room type condition
    room_type_condition = ""
    params = [start_date, end_date]
    if room_type:
        room_type_condition = "AND inv.room_type = %s"
        params.append(room_type)

    # Main data query with grouping
    data_sql = f"""
    WITH dates AS (
        SELECT
            for_date,
            CONCAT(LEFT(day_name, 3), '<br/>', LPAD(day_of_month, 2, '0')) AS formatted_date,
            day_name,
            day_of_month,
            weekend_indr
        FROM dim_date
        WHERE for_date BETWEEN %s AND %s
    ),
    inventory_data AS (
        SELECT
            inv.room_type,
            inv.for_date,
            inv.total_available_units,
            inv.occupied_count,
            inv.out_of_order_count,
            (inv.total_available_units + inv.occupied_count + inv.out_of_order_count) AS total_count,
            d.formatted_date,
            d.weekend_indr
        FROM room_type_inventory inv
        JOIN dates d ON d.for_date = inv.for_date
        WHERE 1=1 {room_type_condition}
    )
    SELECT
        room_type,
        JSON_ARRAYAGG(
            JSON_OBJECT(
                'for_date', for_date,
                'total_count', total_count,
                'occupied_count', occupied_count,
                'out_of_order_count', out_of_order_count,
                'total_available_units', total_available_units,
                'formatted_date', formatted_date,
                'weekend_indr', weekend_indr
            ) ORDER BY for_date
        ) AS days_data
    FROM inventory_data
    GROUP BY room_type
    ORDER BY room_type
    """

    grouped_data = frappe.db.sql(data_sql, params, as_dict=True)

    # Build columns structure
    columns = [{"label": "Room Type", "fieldname": "room_type", "width": 200}]

    for col in date_columns:
        columns.append({
            "label": col["formatted_date"],
            "fieldname": f"date_{col['for_date']}",
            "width": 120,
            "is_weekend": bool(col["weekend_indr"])
        })

    # Build data structure with pre-rendered HTML
    data = {}

    for room_row in grouped_data:
        room_type = room_row["room_type"]
        days_data = frappe.parse_json(room_row["days_data"]) if room_row["days_data"] else []

        # Create room type entry
        data[room_type] = []

        for day in days_data:
            available = day["total_available_units"]
            occupied = day["occupied_count"]
            out_of_order = day["out_of_order_count"]
            total = day["total_count"]
            is_weekend = day["weekend_indr"]

            # Calculate availability percentage for color coding
            availability_pct = (available / total * 100) if total > 0 else 0

            if available == 0:
                color_class = "bg-danger text-white"
            elif availability_pct <= 30:
                color_class = "bg-warning text-dark"
            else:
                color_class = "bg-success text-white"

            weekend_style = "border: 2px dashed #6c757d;" if is_weekend else ""

            # Pre-render HTML cell
            html_cell = f"""
            <div class="availability-cell {color_class}" style="padding: 8px; border-radius: 6px; text-align: center; min-height: 55px; {weekend_style}">
                <div style="font-size: 18px; font-weight: bold; line-height: 1.2;">{available}</div>
                <div style="font-size: 11px; margin-top: 4px; opacity: 0.9;">
                    Occ: {occupied}<br/>OOO: {out_of_order}
                </div>
            </div>
            """

            data[room_type].append({
                "total_count": total,
                "occupied_count": occupied,
                "out_of_order_count": out_of_order,
                "total_available_units": available,
                "for_date": day["for_date"],
                "html_cell": html_cell,
                "availability_pct": round(availability_pct, 1)
            })

    return {
        "columns": columns,
        "data": data,
        "total_room_types": len(data),
        "total_days": len(date_columns)
    }


# Alternative simpler version that just returns raw data for custom rendering
@frappe.whitelist(allow_guest=True, methods=["GET"])
def get_availability_raw_data(start_date: int, end_date: int, room_type: str = None):
    """
    Return raw availability data grouped by room type.
    """

    room_type_condition = ""
    params = [start_date, end_date]
    if room_type:
        room_type_condition = "AND inv.room_type = %s"
        params.append(room_type)

    sql = f"""
    WITH dates AS (
        SELECT
            for_date,
            CONCAT(LEFT(day_name, 3), '<br/>', LPAD(day_of_month, 2, '0')) AS formatted_date,
            weekend_indr
        FROM dim_date
        WHERE for_date BETWEEN %s AND %s
        ORDER BY for_date
    )
    SELECT
        -- Columns
        (SELECT JSON_ARRAYAGG(
            JSON_OBJECT(
                'label', formatted_date,
                'fieldname', CONCAT('date_', for_date),
                'for_date', for_date,
                'is_weekend', weekend_indr
            ) ORDER BY for_date
        ) FROM dates) AS columns_json,

        -- Data grouped by room type
        JSON_OBJECTAGG(
            inv.room_type,
            (SELECT JSON_ARRAYAGG(
                JSON_OBJECT(
                    'total_count', inv2.total_available_units + inv2.occupied_count + inv2.out_of_order_count,
                    'occupied_count', inv2.occupied_count,
                    'out_of_order_count', inv2.out_of_order_count,
                    'total_available_units', inv2.total_available_units,
                    'for_date', inv2.for_date
                ) ORDER BY inv2.for_date
            ) FROM room_type_inventory inv2
              JOIN dates d2 ON d2.for_date = inv2.for_date
              WHERE inv2.room_type = inv.room_type)
        ) AS data_json
    FROM room_type_inventory inv
    JOIN dates d ON d.for_date = inv.for_date
    WHERE 1=1 {room_type_condition}
    """

    result = frappe.db.sql(sql, params, as_dict=True)

    if not result:
        return {"columns": [], "data": {}}

    row = result[0]
    columns_data = frappe.parse_json(row["columns_json"]) if row["columns_json"] else []
    grouped_data = frappe.parse_json(row["data_json"]) if row["data_json"] else {}

    # Add Room Type column
    columns = [{"label": "Room Type", "fieldname": "room_type", "width": 200}]
    columns.extend([
        {
            "label": col["label"],
            "fieldname": col["fieldname"],
            "width": 120,
            "is_weekend": bool(col["is_weekend"])
        } for col in columns_data
    ])

    return {
        "columns": columns,
        "data": grouped_data
    }

@frappe.whitelist(allow_guest=True, methods=["GET"])
def get_availability_grid_grouped(start_date: int, end_date: int):
    """
    Returns a grid with 3 sub-rows per room type:
      - Available (total_available_units)
      - Occupied  (occupied_count)
      - Out of Order (out_of_order_count)

    Payload shape:
    {
      "columns": [  # from dim_date (ordered), includes label_html for <br/>
        { "for_date": 20250826, "label_text": "Tue 26", "label_html": "Tue<br/>26", ...},
        ...
      ],
      "data": [
        {
          "room_type": "Premium Bungalows King",
          "rows": [
            {"label":"Available",   "key":"total_available_units", "values":[15,14,13,...]},
            {"label":"Occupied",    "key":"occupied_count",        "values":[ 2, 3, 4,...]},
            {"label":"Out of Order","key":"out_of_order_count",    "values":[ 0, 0, 1,...]}
          ]
        },
        ...
      ]
    }
    """
    # 1) Columns (rich header info) directly from dim_date
    columns = frappe.db.sql("""
        SELECT
          d.for_date,
          CONCAT(LEFT(d.day_name, 3), ' ', LPAD(d.day_of_month, 2, '0')) AS label_text,
          CONCAT(LEFT(d.day_name, 3), '<br/>', LPAD(d.day_of_month, 2, '0')) AS label_html,
          d.day_name, d.day_of_month, d.day_of_week, d.week_of_month, d.weekend_indr,
          d.month_name_abbreviated
        FROM dim_date d
        WHERE d.for_date BETWEEN %s AND %s
        ORDER BY d.for_date
    """, (start_date, end_date), as_dict=True)

    if not columns:
        return {"columns": [], "data": []}

    # 2) Inventory (no pricing) for the same range
    rows = frappe.db.sql("""
        SELECT
          inv.room_type,
          inv.for_date,
          inv.total_count,
          inv.occupied_count,
          inv.out_of_order_count,
          inv.total_available_units
        FROM room_type_inventory inv
        WHERE inv.for_date BETWEEN %s AND %s
        ORDER BY inv.room_type, inv.for_date
    """, (start_date, end_date), as_dict=True)

    # 3) Group per room_type, align values to the columns order, fill missing with 0
    col_dates = [c["for_date"] for c in columns]
    # map: room_type -> { for_date -> row }
    buckets = defaultdict(dict)
    for r in rows:
        buckets[r["room_type"]][r["for_date"]] = r

    payload_rows = []
    for room_type, by_date in buckets.items():
        # Build parallel arrays aligned with col_dates
        available = []
        occupied  = []
        ooo       = []
        for fd in col_dates:
            rec = by_date.get(fd)
            if rec:
                available.append(int(rec["total_available_units"] or 0))
                occupied.append(int(rec["occupied_count"] or 0))
                ooo.append(int(rec["out_of_order_count"] or 0))
            else:
                available.append(0)
                occupied.append(0)
                ooo.append(0)

        payload_rows.append({
            "room_type": room_type,
            "rows": [
                {"label": "Available",    "key": "total_available_units", "values": available},
                {"label": "Occupied",     "key": "occupied_count",        "values": occupied},
                {"label": "Out of Order", "key": "out_of_order_count",    "values": ooo},
            ]
        })

    return {"columns": columns, "data": payload_rows}

@frappe.whitelist()
def get_room_type_rates_grid(start_date_int: int, end_date_int: int, room_type: str = None):
    """
    Return room type rates grid with SQL doing heavy lifting.
    Similar structure to get_availability_grid_simple but for pricing data.
    """

    # First, get columns from dim_date
    columns_sql = """
    WITH dates AS (
        SELECT
            for_date,
            CONCAT(LEFT(day_name, 3), '<br/>', LPAD(day_of_month, 2, '0')) AS formatted_date,
            day_name,
            day_of_month,
            weekend_indr
        FROM dim_date
        WHERE for_date BETWEEN %s AND %s
        ORDER BY for_date
    )
    SELECT
        for_date,
        formatted_date,
        weekend_indr
    FROM dates
    """

    date_columns = frappe.db.sql(columns_sql, (start_date_int, end_date_int), as_dict=True)

    # Build room type condition
    room_type_condition = ""
    params = [start_date_int, end_date_int]
    if room_type:
        room_type_condition = "AND inv.room_type = %s"
        params.append(room_type)

    # Main data query with grouping by rate_code
    data_sql = f"""
    WITH dates AS (
        SELECT
            for_date,
            CONCAT(LEFT(day_name, 3), '<br/>', LPAD(day_of_month, 2, '0')) AS formatted_date,
            day_name,
            day_of_month,
            weekend_indr
        FROM dim_date
        WHERE for_date BETWEEN %s AND %s
    ),
    rates_data AS (
        SELECT
            irc.rate_code,
            inv.for_date,
            irc.rate_price,
            inv.room_type,
            d.formatted_date,
            d.weekend_indr
        FROM `tabRoom Type Inventory` inv
        JOIN `tabRoom Type Inventory Rate Code` irc ON inv.name = irc.parent
        JOIN dates d ON d.for_date = inv.for_date
        WHERE 1=1 {room_type_condition}
    )
    SELECT
        rate_code,
        JSON_ARRAYAGG(
            JSON_OBJECT(
                'for_date', for_date,
                'rate_price', rate_price,
                'room_type', room_type,
                'formatted_date', formatted_date,
                'weekend_indr', weekend_indr
            ) ORDER BY for_date
        ) AS days_data
    FROM rates_data
    GROUP BY rate_code
    ORDER BY rate_code
    """

    grouped_data = frappe.db.sql(data_sql, params, as_dict=True)

    # Build columns structure
    columns = [{"label": "Rate Code", "fieldname": "rate_code", "width": 200}]

    for col in date_columns:
        columns.append({
            "label": col["formatted_date"],
            "fieldname": f"date_{col['for_date']}",
            "width": 120,
            "is_weekend": bool(col["weekend_indr"])
        })

    # Build data structure
    data = {}

    for rate_row in grouped_data:
        rate_code = rate_row["rate_code"]
        days_data = frappe.parse_json(rate_row["days_data"]) if rate_row["days_data"] else []

        # Create rate code entry
        data[rate_code] = []

        for day in days_data:
            rate_price = day["rate_price"] or 0
            is_weekend = day["weekend_indr"]
            room_type_name = day["room_type"]

            data[rate_code].append({
                "for_date": day["for_date"],
                "rate_price": rate_price,
                "room_type": room_type_name,
                "formatted_date": day["formatted_date"],
                "is_weekend": bool(is_weekend)
            })

    return {
        "columns": columns,
        "data": data,
        "total_rate_codes": len(data),
        "total_days": len(date_columns)
    }

@frappe.whitelist(allow_guest=True, methods=["GET"])
def get_availability_grid_simple(start_date: int, end_date: int, room_type: str = None):
    """
    Return availability grid with SQL doing heavy lifting.
    """

    # First, get columns from dim_date
    columns_sql = """
    WITH dates AS (
        SELECT
            for_date,
            CONCAT(LEFT(day_name, 3), '<br/>', LPAD(day_of_month, 2, '0')) AS formatted_date,
            day_name,
            day_of_month,
            weekend_indr
        FROM dim_date
        WHERE for_date BETWEEN %s AND %s
        ORDER BY for_date
    )
    SELECT
        for_date,
        formatted_date,
        weekend_indr
    FROM dates
    """

    date_columns = frappe.db.sql(columns_sql, (start_date, end_date), as_dict=True)

    # Build room type condition
    room_type_condition = ""
    params = [start_date, end_date]
    if room_type:
        room_type_condition = "AND inv.room_type = %s"
        params.append(room_type)

    # Main data query with grouping
    data_sql = f"""
    WITH dates AS (
        SELECT
            for_date,
            CONCAT(LEFT(day_name, 3), '<br/>', LPAD(day_of_month, 2, '0')) AS formatted_date,
            day_name,
            day_of_month,
            weekend_indr
        FROM dim_date
        WHERE for_date BETWEEN %s AND %s
    ),
    inventory_data AS (
        SELECT
            inv.room_type,
            inv.for_date,
            inv.total_available_units,
            inv.occupied_count,
            inv.out_of_order_count,
            (inv.total_available_units + inv.occupied_count + inv.out_of_order_count) AS total_count,
            d.formatted_date,
            d.weekend_indr
        FROM room_type_inventory inv
        JOIN dates d ON d.for_date = inv.for_date
        WHERE 1=1 {room_type_condition}
    )
    SELECT
        room_type,
        JSON_ARRAYAGG(
            JSON_OBJECT(
                'for_date', for_date,
                'total_count', total_count,
                'occupied_count', occupied_count,
                'out_of_order_count', out_of_order_count,
                'total_available_units', total_available_units,
                'formatted_date', formatted_date,
                'weekend_indr', weekend_indr
            ) ORDER BY for_date
        ) AS days_data
    FROM inventory_data
    GROUP BY room_type
    ORDER BY room_type
    """

    grouped_data = frappe.db.sql(data_sql, params, as_dict=True)

    # Build columns structure
    columns = [{"label": "Room Type", "fieldname": "room_type", "width": 200}]

    for col in date_columns:
        columns.append({
            "label": col["formatted_date"],
            "fieldname": f"date_{col['for_date']}",
            "width": 120,
            "is_weekend": bool(col["weekend_indr"])
        })

    # Build data structure with pre-rendered HTML
    data = {}

    for room_row in grouped_data:
        room_type = room_row["room_type"]
        days_data = frappe.parse_json(room_row["days_data"]) if room_row["days_data"] else []

        # Create room type entry
        data[room_type] = []

        for day in days_data:
            available = day["total_available_units"]
            occupied = day["occupied_count"]
            out_of_order = day["out_of_order_count"]
            total = day["total_count"]
            is_weekend = day["weekend_indr"]

            # Calculate availability percentage for color coding
            availability_pct = (available / total * 100) if total > 0 else 0

            if available == 0:
                color_class = "bg-danger text-white"
            elif availability_pct <= 30:
                color_class = "bg-warning text-dark"
            else:
                color_class = "bg-success text-white"

            weekend_style = "border: 2px dashed #6c757d;" if is_weekend else ""

            # Pre-render HTML cell
            html_cell = f"""
            <div class="availability-cell {color_class}" style="padding: 8px; border-radius: 6px; text-align: center; min-height: 55px; {weekend_style}">
                <div style="font-size: 18px; font-weight: bold; line-height: 1.2;">{available}</div>
                <div style="font-size: 11px; margin-top: 4px; opacity: 0.9;">
                    Occ: {occupied}<br/>OOO: {out_of_order}
                </div>
            </div>
            """

            data[room_type].append({
                "total_count": total,
                "occupied_count": occupied,
                "out_of_order_count": out_of_order,
                "total_available_units": available,
                "for_date": day["for_date"],
                "html_cell": html_cell,
                "availability_pct": round(availability_pct, 1)
            })

    return {
        "columns": columns,
        "data": data,
        "total_room_types": len(data),
        "total_days": len(date_columns)
    }


# Alternative simpler version that just returns raw data for custom rendering
@frappe.whitelist(allow_guest=True, methods=["GET"])
def get_availability_raw_data(start_date: int, end_date: int, room_type: str = None):
    """
    Return raw availability data grouped by room type.
    """

    room_type_condition = ""
    params = [start_date, end_date]
    if room_type:
        room_type_condition = "AND inv.room_type = %s"
        params.append(room_type)

    sql = f"""
    WITH dates AS (
        SELECT
            for_date,
            CONCAT(LEFT(day_name, 3), '<br/>', LPAD(day_of_month, 2, '0')) AS formatted_date,
            weekend_indr
        FROM dim_date
        WHERE for_date BETWEEN %s AND %s
        ORDER BY for_date
    )
    SELECT
        -- Columns
        (SELECT JSON_ARRAYAGG(
            JSON_OBJECT(
                'label', formatted_date,
                'fieldname', CONCAT('date_', for_date),
                'for_date', for_date,
                'is_weekend', weekend_indr
            ) ORDER BY for_date
        ) FROM dates) AS columns_json,

        -- Data grouped by room type
        JSON_OBJECTAGG(
            inv.room_type,
            (SELECT JSON_ARRAYAGG(
                JSON_OBJECT(
                    'total_count', inv2.total_available_units + inv2.occupied_count + inv2.out_of_order_count,
                    'occupied_count', inv2.occupied_count,
                    'out_of_order_count', inv2.out_of_order_count,
                    'total_available_units', inv2.total_available_units,
                    'for_date', inv2.for_date
                ) ORDER BY inv2.for_date
            ) FROM room_type_inventory inv2
              JOIN dates d2 ON d2.for_date = inv2.for_date
              WHERE inv2.room_type = inv.room_type)
        ) AS data_json
    FROM room_type_inventory inv
    JOIN dates d ON d.for_date = inv.for_date
    WHERE 1=1 {room_type_condition}
    """

    result = frappe.db.sql(sql, params, as_dict=True)

    if not result:
        return {"columns": [], "data": {}}

    row = result[0]
    columns_data = frappe.parse_json(row["columns_json"]) if row["columns_json"] else []
    grouped_data = frappe.parse_json(row["data_json"]) if row["data_json"] else {}

    # Add Room Type column
    columns = [{"label": "Room Type", "fieldname": "room_type", "width": 200}]
    columns.extend([
        {
            "label": col["label"],
            "fieldname": col["fieldname"],
            "width": 120,
            "is_weekend": bool(col["is_weekend"])
        } for col in columns_data
    ])

    return {
        "columns": columns,
        "data": grouped_data
    }

@frappe.whitelist(allow_guest=False, methods=["POST"])
def reallocate_inventory_from_assignments(reservation_name: str):
    """
    Calls: CALL apply_reservation_reassign_from_child(%s)
    Reads child table rows from DB, so we commit parent changes first on the client.
    """
    import pymysql.cursors
    conn = frappe.db.get_connection()
    cur = conn.cursor(pymysql.cursors.DictCursor)
    try:
        cur.execute("CALL apply_reservation_reassign_from_child(%s)", (reservation_name,))
        result = cur.fetchall() or []
        conn.commit()
    finally:
        cur.close()
    return result  # e.g. [{'status':'REALLOCATED'}] / [{'status':'NO_CHANGE'}] / [{'status':'NO_ASSIGNMENTS'}]




@frappe.whitelist()
def get_room_type_inventory_rates(room_type=None, start_date=None, end_date=None):
    """
    Get room type inventory rates with optional filters.
    If a parameter is NULL, COALESCE will fallback to the column itself,
    meaning the condition is always true (no filter).
    """
    rows = frappe.db.sql("""
        SELECT
            inv.for_date,
            inv.room_type,
            irc.rate_code,
            irc.rate_price
        FROM `tabRoom Type Inventory` inv
        JOIN `tabRoom Type Inventory Rate Code` irc
          ON inv.name = irc.parent
        WHERE inv.room_type = COALESCE(%(room_type)s, inv.room_type)
          AND inv.for_date BETWEEN COALESCE(%(start_date)s, inv.for_date)
                               AND COALESCE(%(end_date)s, inv.for_date)
        ORDER BY inv.for_date, irc.rate_code
    """, {
        "room_type": room_type,
        "start_date": start_date,
        "end_date": end_date
    }, as_dict=True)

    return rows



@frappe.whitelist()
def seed_room_type_inventory_rate_codes(rate_code, room_type, start_date, end_date, price):
    frappe.db.sql("""
        CALL seed_room_type_inventory_rate_codes(%s, %s, %s, %s, %s)
    """, (rate_code, room_type, start_date, end_date, price))
    frappe.db.commit()
    return {"ok": True}

DELIMITER $$

DROP PROCEDURE IF EXISTS seed_room_type_inventory $$
CREATE PROCEDURE seed_room_type_inventory(
  IN p_start       DATE,          -- inclusive
  IN p_end         DATE,          -- inclusive
  IN p_batch_days  INT,           -- window size, e.g. 30
  IN p_name_prefix VARCHAR(32)    -- e.g. 'INVE-'
)
BEGIN
  DECLARE v_start DATE;
  DECLARE v_end   DATE;
  DECLARE v_win_s DATE;
  DECLARE v_win_e DATE;
  DECLARE v_created BIGINT DEFAULT 0;

  -- guard rails
  SET v_start = LEAST(p_start, p_end);
  SET v_end   = GREATEST(p_start, p_end);
  SET p_batch_days = IFNULL(p_batch_days, 30);

  SET v_win_s = v_start;

  WHILE v_win_s <= v_end DO
    SET v_win_e = LEAST(v_end, DATE_ADD(v_win_s, INTERVAL p_batch_days - 1 DAY));

    /* Seed one window using dim_date (no CTEs, nice and readable) */
    INSERT IGNORE INTO `tabRoom Type Inventory`
      (name, room_type, for_date, occupied_count)
    SELECT
      LEFT(CONCAT(p_name_prefix, p.room_type, '-', c.for_date), 140) AS name,
      p.room_type,
      c.for_date,
      0
    FROM (
      SELECT rt.name AS room_type
      FROM `tabRoom Type` rt
    ) AS p
    JOIN dim_date c
      ON c.date_actual BETWEEN v_win_s AND v_win_e;

    SET v_created = v_created + ROW_COUNT();

    -- next window
    SET v_win_s = DATE_ADD(v_win_e, INTERVAL 1 DAY);
  END WHILE;

  /* return how many rows were inserted */
  SELECT v_created AS created_rows;
END$$
drop PROCEDURE IF EXISTS seed_room_type_inventory_rate_codes$$
CREATE PROCEDURE seed_room_type_inventory_rate_codes(
  IN p_rate_code VARCHAR(255),
  IN p_room_type VARCHAR(255),
  IN p_start     INT,          -- inclusive
  IN p_end       INT,          -- inclusive
  IN p_price     DECIMAL(10,2)  -- price
)
BEGIN
  /* Insert rows for the date range; if (parent, rate_code) exists, update price */
  INSERT INTO `tabRoom Type Inventory Rate Code` (name , parent, rate_code, rate_price)
  SELECT concat(inv.name , '-' , p_rate_code) , inv.name, p_rate_code, p_price
  FROM `tabRoom Type Inventory` AS inv
  WHERE inv.for_date BETWEEN p_start AND p_end
    AND inv.room_type = p_room_type ON DUPLICATE KEY UPDATE
    rate_price = p_price;

  /* Affected rows: inserts count as 1, updates count as 2 (if value actually changed) */
  SELECT ROW_COUNT() AS affected_rows;
END$$


DROP PROCEDURE IF EXISTS get_available_inventory $$
CREATE PROCEDURE get_available_inventory(
  IN p_start INT,
  IN p_end   INT,
  IN p_rooms INT,
  IN p_rate_codes_csv VARCHAR(4000),  -- comma-separated rate codes
  IN p_room_types_csv VARCHAR(4000)
)
BEGIN
  SELECT
    r.rate_code,
    r.room_type,
    r.total_count,
    MAX(r.occupied_count)        AS max_occupied,
    MIN(r.total_available_units) AS min_available_units,
    AVG(r.rate_price)            AS rate_per_night,
    SUM(r.rate_price)            AS total_stay
  FROM room_type_inventory_rates r
  WHERE r.for_date BETWEEN p_start AND p_end
    -- Match rate codes if param not empty
    AND (p_rate_codes_csv IS NULL OR p_rate_codes_csv = '' OR FIND_IN_SET(r.rate_code, p_rate_codes_csv))
    -- Match room types if param not empty
    AND (p_room_types_csv IS NULL OR p_room_types_csv = '' OR FIND_IN_SET(r.room_type, p_room_types_csv))
  GROUP BY
    r.room_type,
    r.total_count,
    r.rate_code
  HAVING MIN(r.total_available_units) >= p_rooms;
END$$
DROP PROCEDURE IF EXISTS apply_reservation_inventory $$
CREATE PROCEDURE apply_reservation_inventory(
  IN p_reservation_name VARCHAR(140),  -- e.g. 'RES-2025-08-00001'
  IN p_target_docstatus INT            -- 1 = Submit (hold), 2 = Cancel (release)
)
BEGIN
  DECLARE v_sign INT;
 DECLARE done INT DEFAULT FALSE;
  DECLARE v_inv_name VARCHAR(140);

  -- Cursor to lock rows without returning results
  DECLARE lock_cursor CURSOR FOR
    SELECT d.inv_name
    FROM tmp_inv_delta d
    JOIN `tabRoom Type Inventory` t ON t.name = d.inv_name
    FOR UPDATE;

  DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;
  -- Decide whether to subtract or add back
  SET v_sign = IF(p_target_docstatus = 1 , 1 , -1);

  -- Build temp table of rows to update
  DROP TEMPORARY TABLE IF EXISTS tmp_inv_delta;
  CREATE TEMPORARY TABLE tmp_inv_delta (
    inv_name VARCHAR(140) PRIMARY KEY,
    delta INT NOT NULL
  ) ENGINE=Memory;

  INSERT INTO tmp_inv_delta (inv_name, delta)
  SELECT
    inv.name                                   AS inv_name,
    v_sign * r.number_of_rooms                 AS delta
  FROM `tabHotel Reservation` r
  JOIN room_type_inventory inv
    ON inv.room_type = r.room_type
   AND inv.for_date >= r.check_in_date and inv.for_date < r.check_out_date
  WHERE r.name = p_reservation_name;

  OPEN lock_cursor;
  lock_loop: LOOP
    FETCH lock_cursor INTO v_inv_name;
    IF done THEN
      LEAVE lock_loop;
    END IF;
  END LOOP;
  CLOSE lock_cursor;

  UPDATE `tabRoom Type Inventory` t
  JOIN tmp_inv_delta d ON t.name = d.inv_name
  SET t.occupied_count = t.occupied_count + d.delta;

  /* Optional: return a quick summary */
  SELECT COUNT(*) AS rows_touched, SUM(delta) AS total_delta
  FROM tmp_inv_delta;
END $$
DROP PROCEDURE IF EXISTS seed_dim_date;
CREATE PROCEDURE seed_dim_date(
  IN p_start DATE,
  IN p_end   DATE,
  IN p_weekend_mode VARCHAR(7),   -- 'FRI_SAT' or 'SAT_SUN'
  IN p_tz VARCHAR(64)             -- e.g. 'Africa/Cairo' or '+00:00'
)
BEGIN
  DECLARE v_weekend_mode VARCHAR(7);
  DECLARE v_tz VARCHAR(64);
  DECLARE old_tz VARCHAR(64);

  SET v_weekend_mode = IF(p_weekend_mode IN ('FRI_SAT','SAT_SUN'), p_weekend_mode, 'FRI_SAT');
  SET v_tz = IFNULL(p_tz, '+03:00');

  SET old_tz = @@session.time_zone;
  SET time_zone = v_tz;

  INSERT IGNORE INTO dim_date (
    date_actual, next_day_actual, for_date,
    epoch, day_suffix, day_name, day_of_week, day_of_month, day_of_quarter, day_of_year,
    week_of_month, week_of_year, week_of_year_iso,
    month_actual, month_name, month_name_abbreviated,
    quarter_actual, quarter_name, year_actual,
    first_day_of_week, last_day_of_week,
    first_day_of_month, last_day_of_month,
    first_day_of_quarter, last_day_of_quarter,
    first_day_of_year, last_day_of_year,
    mmyyyy, mmddyyyy, weekend_indr
  )
  SELECT
    d AS date_actual,
    DATE_ADD(d, INTERVAL 1 DAY) AS next_day_actual,
    CAST(DATE_FORMAT(d, '%Y%m%d') AS UNSIGNED) AS for_date,
    UNIX_TIMESTAMP(d) AS epoch,

    CASE
      WHEN DAYOFMONTH(d) IN (11,12,13) THEN CONCAT(DAYOFMONTH(d), 'th')
      WHEN MOD(DAYOFMONTH(d),10)=1 THEN CONCAT(DAYOFMONTH(d), 'st')
      WHEN MOD(DAYOFMONTH(d),10)=2 THEN CONCAT(DAYOFMONTH(d), 'nd')
      WHEN MOD(DAYOFMONTH(d),10)=3 THEN CONCAT(DAYOFMONTH(d), 'rd')
      ELSE CONCAT(DAYOFMONTH(d), 'th')
    END AS day_suffix,

    DATE_FORMAT(d, '%W') AS day_name,
    WEEKDAY(d) + 1 AS day_of_week,  -- ISO 1..7 (Mon..Sun)
    DAYOFMONTH(d) AS day_of_month,
    DATEDIFF(d, DATE_ADD(MAKEDATE(YEAR(d),1), INTERVAL (QUARTER(d)-1)*3 MONTH)) + 1 AS day_of_quarter,
    DAYOFYEAR(d) AS day_of_year,

    (WEEK(d, 3) - WEEK(DATE_SUB(d, INTERVAL DAYOFMONTH(d)-1 DAY), 3)) + 1 AS week_of_month,
    WEEK(d, 3) AS week_of_year,
    DATE_FORMAT(d, '%x-W%v-%u') AS week_of_year_iso,

    MONTH(d) AS month_actual,
    DATE_FORMAT(d, '%M') AS month_name,
    DATE_FORMAT(d, '%b') AS month_name_abbreviated,

    QUARTER(d) AS quarter_actual,
    CASE QUARTER(d)
      WHEN 1 THEN 'First'
      WHEN 2 THEN 'Second'
      WHEN 3 THEN 'Third'
      ELSE 'Fourth'
    END AS quarter_name,
    YEAR(d) AS year_actual,

    DATE_SUB(d, INTERVAL WEEKDAY(d) DAY) AS first_day_of_week,
    DATE_ADD(d, INTERVAL 6 - WEEKDAY(d) DAY) AS last_day_of_week,

    DATE_SUB(d, INTERVAL DAYOFMONTH(d)-1 DAY) AS first_day_of_month,
    LAST_DAY(d) AS last_day_of_month,

    DATE_ADD(MAKEDATE(YEAR(d),1), INTERVAL (QUARTER(d)-1)*3 MONTH) AS first_day_of_quarter,
    DATE_SUB(DATE_ADD(MAKEDATE(YEAR(d),1), INTERVAL QUARTER(d)*3 MONTH), INTERVAL 1 DAY) AS last_day_of_quarter,

    MAKEDATE(YEAR(d),1) AS first_day_of_year,
    DATE_SUB(MAKEDATE(YEAR(d)+1,1), INTERVAL 1 DAY) AS last_day_of_year,

    DATE_FORMAT(d, '%m%Y') AS mmyyyy,
    DATE_FORMAT(d, '%m/%d/%Y') AS mmddyyyy,

    CASE
      WHEN v_weekend_mode = 'FRI_SAT' AND DAYOFWEEK(d) IN (6,7) THEN 1  -- Fri, Sat
      WHEN v_weekend_mode = 'SAT_SUN' AND DAYOFWEEK(d) IN (1,7) THEN 1  -- Sun, Sat
      ELSE 0
    END AS weekend_indr
  FROM (
    SELECT DATE_ADD(p_start, INTERVAL n DAY) AS d
    FROM (
      SELECT d0.n + d1.n*10 + d2.n*100 + d3.n*1000 + d4.n*10000 AS n
      FROM (SELECT 0 n UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4
            UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9) d0
      CROSS JOIN (SELECT 0 n UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4
            UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9) d1
      CROSS JOIN (SELECT 0 n UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4
            UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9) d2
      CROSS JOIN (SELECT 0 n UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4
            UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9) d3
      CROSS JOIN (SELECT 0 n UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4
            UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9) d4
    ) seq
    WHERE DATE_ADD(p_start, INTERVAL n DAY) <= p_end
  ) days;

  UPDATE dim_date a
  LEFT JOIN dim_date b
    ON b.date_actual = DATE_ADD(a.date_actual, INTERVAL 1 DAY)
  SET a.next_day_id = b.date_id,
      a.next_day_actual = b.date_actual
  WHERE a.date_actual BETWEEN p_start AND p_end;

  SET time_zone = old_tz;
END$$

DROP PROCEDURE IF EXISTS seed_room_type_inventory_rate_codes $$
CREATE PROCEDURE seed_room_type_inventory_rate_codes(
  IN p_rate_code VARCHAR(255),
  IN p_room_type VARCHAR(255),
  IN p_start     DATE,          -- inclusive
  IN p_end       DATE,          -- inclusive
  IN p_price     DECIMAL(10,2)  -- price
)
BEGIN
  /* Insert rows for the date range; if (parent, rate_code) exists, update price */
  INSERT INTO `tabRoom Type Inventory Rate Code` (name, parent, rate_code, rate_price)
  SELECT
      CONCAT(inv.name, '-', p_rate_code),  -- unique name
      inv.name,
      p_rate_code,
      p_price
  FROM `tabRoom Type Inventory` AS inv
  WHERE inv.for_date BETWEEN p_start AND p_end
    AND inv.room_type = p_room_type

  ON DUPLICATE KEY UPDATE
      rate_price = VALUES(rate_price);

  /* Report how many rows were affected (note: updates count as 2 if changed) */
  SELECT ROW_COUNT() AS affected_rows;
END$$

DROP PROCEDURE IF EXISTS seed_room_type_inventory_rate_codes $$
CREATE PROCEDURE seed_room_type_inventory_rate_codes(
  IN p_rate_code VARCHAR(255),
  IN p_room_type VARCHAR(255),
  IN p_start     DATE,          -- inclusive
  IN p_end       DATE,          -- inclusive
  IN p_price     DECIMAL(10,2)  -- price
)
BEGIN
  /* Insert rows for the date range; if (parent, rate_code) exists, update price */
  INSERT INTO `tabRoom Type Inventory Rate Code` (name, parent, rate_code, rate_price)
  SELECT
      CONCAT(inv.name, '-', p_rate_code),  -- unique name
      inv.name,
      p_rate_code,
      p_price
  FROM `tabRoom Type Inventory` AS inv
  WHERE inv.for_date BETWEEN p_start AND p_end
    AND inv.room_type = p_room_type

  ON DUPLICATE KEY UPDATE
      rate_price = VALUES(rate_price);

  /* Report how many rows were affected (note: updates count as 2 if changed) */
  SELECT ROW_COUNT() AS affected_rows;
END$$

DROP PROCEDURE switch_night_candidates;
CREATE PROCEDURE switch_night_candidates(p_audit_date DATE)
BEGIN
    SELECT
        r.name                AS reservation_id,
        f.name                AS folio_id,
        fw.name               AS folio_window_id,
        inv.name              AS invoice_id,
        r.base_rate_per_night AS nightly_rate,
        r.customer            AS customer_id
    FROM `tabHotel Reservation` r
    JOIN `tabFolio` f
      ON f.linked_reservation = r.name AND f.folio_status = 'Open'
    JOIN `tabFolio Window` fw
      ON fw.parent = f.name AND fw.window_code = '01'
    JOIN `tabPOS Invoice` inv
      ON inv.folio = f.name
    WHERE r.check_in_completed = 1
      AND r.check_out_completed = 0
      AND p_audit_date BETWEEN r.check_in_date AND r.check_out_date;
END$$
 --    CALL seed_room_type_inventory(
 --     20250829,          -- inclusive
 --     20251231,          -- inclusive
 --     50,           -- window size, e.g. 30
 --     'I-'    -- e.g. 'INVE-'
 --   )$$
 --   CALL seed_room_type_inventory_rate_codes(
 --   'RACK',
 --   'Superior Bungalows King',
 --     20250829,
 --     20251231,
 --     15000
 --   )$$
 --   CALL seed_room_type_inventory_rate_codes(
 --   'RACK',
 --   'Superior Bungalows Twin',
 --     20250829,
--     20251231,
--     13000
--   )$$
DELIMITER ;

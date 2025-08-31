-- Create
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
END;


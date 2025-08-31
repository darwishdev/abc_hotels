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
END


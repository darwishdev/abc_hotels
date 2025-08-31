DROP PROCEDURE IF EXISTS update_inventory_counts;
CREATE PROCEDURE update_inventory_counts(
    IN p_date_from          INT,            -- yyyymmdd format (20250823)
    IN p_date_to            INT,            -- yyyymmdd format (20250827)
    IN p_room_type          VARCHAR(140),   -- room type (required)
    IN p_rate_code          VARCHAR(140),   -- rate code (required)
    IN p_reserved_delta     INT,            -- +/- for occupied_count (can be negative)
    IN p_out_of_order_delta INT             -- +/- for out_of_order_count (can be negative)
)
BEGIN
    -- Simple validation
    IF p_date_from IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'date_from is required';
    END IF;

    IF p_date_to IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'date_to is required';
    END IF;

    IF CHAR_LENGTH(CAST(p_date_from AS CHAR)) != 8 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'date_from must be 8 digits (yyyymmdd format)';
    END IF;

    IF CHAR_LENGTH(CAST(p_date_to AS CHAR)) != 8 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'date_to must be 8 digits (yyyymmdd format)';
    END IF;

    IF p_date_from > p_date_to THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'date_from must be <= date_to';
    END IF;

    IF p_room_type IS NULL OR p_room_type = '' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'room_type is required';
    END IF;

    IF p_rate_code IS NULL OR p_rate_code = '' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'rate_code is required';
    END IF;

    -- Set defaults for deltas
    SET p_reserved_delta = IFNULL(p_reserved_delta, 0);
    SET p_out_of_order_delta = IFNULL(p_out_of_order_delta, 0);

    -- Update inventory records with race condition protection
    -- Using single atomic UPDATE with GREATEST/LEAST to prevent negative values
    UPDATE `tabRoom Type Inventory`
    SET
        occupied_count = GREATEST(0, occupied_count + p_reserved_delta),
        out_of_order_count = GREATEST(0, IFNULL(out_of_order_count, 0) + p_out_of_order_delta),
        modified = NOW()
    WHERE
        room_type = p_room_type
        AND rate_code = p_rate_code
        AND for_date BETWEEN p_date_from AND p_date_to;

    -- Return summary of what was updated
    SELECT
        ROW_COUNT() as affected_rows,
        p_date_from as date_from,
        p_date_to as date_to,
        p_room_type as room_type,
        p_rate_code as rate_code,
        p_reserved_delta as reserved_delta_applied,
        p_out_of_order_delta as out_of_order_delta_applied;
END;

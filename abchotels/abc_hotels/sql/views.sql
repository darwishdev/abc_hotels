
DROP view IF EXISTS room_type_inventory;
CREATE view room_type_inventory as
select
inv.name ,
inv.for_date ,
inv.room_type ,
inv.occupied_count ,
inv.out_of_order_count ,
COUNT(r.name) total_count,
(COUNT(r.name) - (inv.out_of_order_count + inv.occupied_count)) total_available_units
from `tabRoom Type Inventory` inv
 join `tabRoom Type` rt on rt.name = inv.room_type
 join `tabRoom Type Room` r on rt.name = r.room_type_name
 group by
inv.name ,
inv.for_date ,
inv.room_type ,
inv.occupied_count ,
inv.out_of_order_count ;

drop view if exists rate_code;
create view rate_code as
select rc.name,
    rc.pay_in_advance ,
    rc.flexible_to_ammend ,
    rc.cacnelation_policy ,
    cp.days_before_cancel ,
    cp.is_percent ,
    cp.cancelation_fee
from `tabRate Code` rc
join `tabCancelation Policy` cp on rc.cacnelation_policy =cp.name ;


drop view if exists room_type_inventory_rates ;
Create view room_type_inventory_rates as
select
rc.pay_in_advance,
rc.flexible_to_ammend,
rc.days_before_cancel,
rc.is_percent is_cancelation_percent,
rc.cancelation_fee,
inv.name,
inv.for_date,
inv.room_type,
inv.occupied_count,
inv.out_of_order_count,
irc.rate_code,
irc.rate_price,
total_count,
total_available_units
from room_type_inventory inv
 join `tabRoom Type Inventory Rate Code` irc on inv.name = irc.parent
 join rate_code rc on irc.rate_code = rc.name;





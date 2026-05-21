-- ============================================================
-- WIPE SEED + TEST DATA before fresh import
-- ============================================================
-- This clears: challan_items, challans, retailers, distributors
-- It KEEPS: companies, products, product_lots (lots stay until you re-import them)
--
-- Run this in Supabase SQL Editor BEFORE importing the cleaned
-- distributors_clean.xlsx and retailers_clean.xlsx files.
-- ============================================================

-- Delete order matters (foreign keys)
-- 1) Challan items (depend on challans + products + lots)
delete from challan_items;

-- 2) Challans (depend on distributors, retailers, companies)
delete from challans;

-- 3) Reset DC counters back to original starting points
update companies set next_dc_number = 192 where code = 'ASN';
update companies set next_dc_number = 1   where code = 'ASIAN';

-- 4) Retailers (depend on distributors)
delete from retailers;

-- 5) Distributors (now safe)
delete from distributors;

-- Verify
select
  (select count(*) from companies)     as companies,
  (select count(*) from distributors)  as distributors,
  (select count(*) from retailers)     as retailers,
  (select count(*) from products)      as products,
  (select count(*) from product_lots)  as lots,
  (select count(*) from challans)      as challans;

-- Expected: 2 companies, 0 distributors, 0 retailers, products kept, lots kept, 0 challans

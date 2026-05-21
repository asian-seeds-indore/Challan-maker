-- ============================================================
-- ASN Agri Genetic + Asian Seeds — Delivery Challan System
-- Database Schema for Supabase (PostgreSQL)
-- ============================================================
-- Run this entire file in Supabase SQL Editor (one-time setup)
-- After running, run seed.sql to populate initial data
-- ============================================================

-- Drop tables if re-running (safe for fresh setup)
drop table if exists challan_items cascade;
drop table if exists challans cascade;
drop table if exists product_lots cascade;
drop table if exists products cascade;
drop table if exists retailers cascade;
drop table if exists distributors cascade;
drop table if exists companies cascade;

-- ============================================================
-- COMPANIES — the two billing entities
-- ============================================================
create table companies (
  id              uuid primary key default gen_random_uuid(),
  code            text unique not null,        -- 'ASN' or 'ASE' (short code for UI)
  name            text not null,               -- full company name
  tagline         text,                        -- e.g. "Farmer's Confidence"
  gstin           text,
  cin             text,
  lic1            text,                        -- primary seed license
  lic2            text,                        -- secondary seed license (optional)
  phone           text,
  phone_alt       text,                        -- additional phone (Asian Seeds has multiple)
  email           text,
  office_addr     text,                        -- office address (null if same as plant)
  plant_addr      text not null,               -- plant/warehouse address
  logo_url        text,                        -- logo as data URL or hosted URL
  footer_notes    text,                        -- company-specific footer (e.g. GST exemption text)
  next_dc_number  integer not null default 1,  -- separate counter per company
  created_at      timestamptz default now()
);

-- ============================================================
-- DISTRIBUTORS — direct customers (we ship to them, bill to them)
-- ============================================================
create table distributors (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  gstin       text,
  license_no  text,
  address     text,
  phone       text,
  city        text,
  created_at  timestamptz default now()
);

create index idx_distributors_name on distributors(name);

-- ============================================================
-- RETAILERS — sub-dealers under a distributor (we ship-to them)
-- ============================================================
create table retailers (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  gstin           text,
  license_no      text,
  address         text,
  phone           text,
  city            text,
  distributor_id  uuid references distributors(id) on delete restrict,
  created_at      timestamptz default now()
);

create index idx_retailers_name on retailers(name);
create index idx_retailers_dist on retailers(distributor_id);

-- ============================================================
-- PRODUCTS — what we sell, scoped per company
-- ============================================================
create table products (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies(id) on delete cascade,
  name            text not null,               -- e.g. "Soybean Seeds (ASIAN-777) Certified Seeds"
  packing_size_kg numeric(10,2) not null,      -- e.g. 25.00 or 27.00
  rate_per_bag    numeric(10,2) default 0,     -- price per bag (for estimated value)
  active          boolean default true,
  created_at      timestamptz default now()
);

create index idx_products_company on products(company_id);

-- ============================================================
-- PRODUCT_LOTS — stock tracking per lot per product
-- This is what enables "block if insufficient stock"
-- ============================================================
create table product_lots (
  id              uuid primary key default gen_random_uuid(),
  product_id      uuid not null references products(id) on delete cascade,
  lot_number      text not null,
  bags_available  integer not null default 0,  -- decrements when DC is saved
  initial_bags    integer not null default 0,  -- original stock, never changes (audit)
  manufacture_date date,
  expiry_date     date,
  notes           text,
  active          boolean default true,        -- can disable old lots without deleting
  created_at      timestamptz default now(),
  unique(product_id, lot_number)
);

create index idx_lots_product on product_lots(product_id);
create index idx_lots_active on product_lots(active) where active = true;

-- ============================================================
-- CHALLANS — header of each delivery challan
-- ============================================================
create table challans (
  id              uuid primary key default gen_random_uuid(),
  dc_number       integer not null,
  company_id      uuid not null references companies(id) on delete restrict,
  dc_date         date not null default current_date,
  distributor_id  uuid references distributors(id) on delete restrict,
  retailer_id     uuid references retailers(id) on delete restrict,
  bill_no         text,
  lorry_no        text,
  lr_no           text,
  transport       text,
  freight_status  text default 'To Pay',       -- 'To Pay' or 'Paid'
  total_bags      integer default 0,
  total_qty_qtl   numeric(10,2) default 0,
  total_value     numeric(12,2) default 0,
  notes           text,
  created_by      uuid references auth.users(id),
  created_at      timestamptz default now(),
  unique(company_id, dc_number)                -- DC numbers unique per company
);

create index idx_challans_company on challans(company_id);
create index idx_challans_date on challans(dc_date desc);
create index idx_challans_dcno on challans(dc_number desc);

-- ============================================================
-- CHALLAN_ITEMS — line items on each DC
-- ============================================================
create table challan_items (
  id              uuid primary key default gen_random_uuid(),
  challan_id      uuid not null references challans(id) on delete cascade,
  product_id      uuid references products(id) on delete restrict,
  product_name    text not null,               -- snapshot of name at time of DC
  lot_id          uuid references product_lots(id) on delete restrict,
  lot_number      text not null,               -- snapshot
  packing_size_kg numeric(10,2) not null,
  bags            integer not null,
  qty_qtl         numeric(10,2) not null,
  rate_per_bag    numeric(10,2) default 0,
  line_value      numeric(12,2) default 0,
  position        integer default 1            -- order of line on DC
);

create index idx_items_challan on challan_items(challan_id);

-- ============================================================
-- FUNCTION: Allocate stock atomically when saving a DC
-- Ensures we never ship more bags than available.
-- Call as: select allocate_stock('<lot_id>', <bags_to_deduct>);
-- ============================================================
create or replace function allocate_stock(p_lot_id uuid, p_bags integer)
returns boolean
language plpgsql
as $$
declare
  v_available integer;
begin
  select bags_available into v_available
  from product_lots
  where id = p_lot_id
  for update;                                  -- row lock prevents race condition

  if v_available is null then
    raise exception 'Lot not found: %', p_lot_id;
  end if;

  if v_available < p_bags then
    raise exception 'Insufficient stock: lot has % bags, requested %', v_available, p_bags;
  end if;

  update product_lots
  set bags_available = bags_available - p_bags
  where id = p_lot_id;

  return true;
end;
$$;

-- ============================================================
-- FUNCTION: Get next DC number for a company (atomic)
-- Call: select next_dc_number('<company_id>');
-- Returns the number AND increments the counter in one shot.
-- ============================================================
create or replace function next_dc_number(p_company_id uuid)
returns integer
language plpgsql
as $$
declare
  v_next integer;
begin
  update companies
  set next_dc_number = next_dc_number + 1
  where id = p_company_id
  returning next_dc_number - 1 into v_next;

  if v_next is null then
    raise exception 'Company not found: %', p_company_id;
  end if;

  return v_next;
end;
$$;

-- ============================================================
-- ROW-LEVEL SECURITY (RLS)
-- ============================================================
-- We enable RLS so only authenticated users can read/write.
-- For internal company tool, all logged-in users can do everything.
-- (If you later want admin-vs-operator roles, we can add policies.)
-- ============================================================
alter table companies      enable row level security;
alter table distributors   enable row level security;
alter table retailers      enable row level security;
alter table products       enable row level security;
alter table product_lots   enable row level security;
alter table challans       enable row level security;
alter table challan_items  enable row level security;

-- Allow all authenticated users full access
create policy "auth_full_access" on companies     for all to authenticated using (true) with check (true);
create policy "auth_full_access" on distributors  for all to authenticated using (true) with check (true);
create policy "auth_full_access" on retailers     for all to authenticated using (true) with check (true);
create policy "auth_full_access" on products      for all to authenticated using (true) with check (true);
create policy "auth_full_access" on product_lots  for all to authenticated using (true) with check (true);
create policy "auth_full_access" on challans      for all to authenticated using (true) with check (true);
create policy "auth_full_access" on challan_items for all to authenticated using (true) with check (true);

-- ============================================================
-- Done. Now run seed.sql to populate initial data.
-- ============================================================

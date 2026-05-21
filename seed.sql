-- ============================================================
-- SEED DATA — initial population for the challan system
-- Run AFTER schema.sql
-- ============================================================

-- ------------------------------------------------------------
-- COMPANIES
-- ------------------------------------------------------------
insert into companies (code, name, tagline, gstin, cin, lic1, lic2, phone, email, office_addr, plant_addr, next_dc_number, footer_notes) values
('ASN',
 'ASN AGRI GENETIC (P) LTD.',
 null,
 '23AABCA4238N1ZQ',
 'U51226MP1995PTC009392',
 '0355 (M.P.)',
 'LCSD 10010417 (M.S.)',
 '+91 8889994427-38',
 'asianseeds.2009@rediffmail.com',
 '38, Ware House Road, Goyal Market, II Floor, INDORE - 7',
 'Sanket Warehouse, Pithampur Road, Near Shiv Kumar College, Village-DEHARI, (Rangwasa) INDORE - 453331 (M.P.) India',
 192,
 null),
('ASE',
 'ASIAN SEEDS (P) LTD.',
 'Farmer''s Confidence',
 '23AAMCS8090B1ZC',
 'U01135MP2007PTC019660',
 '979',
 null,
 '+91 8889994427-38',
 'asianseeds.2009@rediffmail.com',
 null,
 'Sanket Warehouse, Pithampur Road, Near Shiv Kumar College, Village-DEHARI, (Rangwasa) INDORE - 453331 (M.P.) India',
 1,
 'GST (Rule 138(14)), Chapter of Heading or Tariff 1209.12.0909 All Goods of Seed Quality. Tax Invoice is not required as goods of seed Quality (Exempted) as per Serial No. 59 of Notification No. 2/2017 dated 28.06.2017.');

-- ------------------------------------------------------------
-- DISTRIBUTORS (from your existing data)
-- ------------------------------------------------------------
insert into distributors (name, city) values
('Santosh Beej Bhandar', 'Nanded'),
('Mamde Krishi Seva Kendra', 'Nanded'),
('Balaji Krishi Seva Kendra', 'Nanded'),
('Jai Kisan Krishi Kendra', 'Basmat'),
('Padma Agro Traders', 'Warora');

-- ------------------------------------------------------------
-- RETAILERS (linked to distributors by name lookup)
-- ------------------------------------------------------------
insert into retailers (name, city, distributor_id) values
('Pandurang KSK',           'Himayatnagar', (select id from distributors where name='Santosh Beej Bhandar')),
('Krushi Vaibhav KSK',      'Himayatnagar', (select id from distributors where name='Santosh Beej Bhandar')),
('Arun Traders',            'Bodhadi',      (select id from distributors where name='Santosh Beej Bhandar')),
('Prithviraj Beej Bhandar', 'Himayatnagar', (select id from distributors where name='Santosh Beej Bhandar')),
('Samruddhi Beej Bhandar',  'Himayatnagar', (select id from distributors where name='Santosh Beej Bhandar')),
('Patni Traders',           'Ardhapur',     (select id from distributors where name='Santosh Beej Bhandar')),
('Shri Om KSK',             'Islapur',      (select id from distributors where name='Santosh Beej Bhandar')),
('Jannavar Krushi Kendra',  'Bodhadi',      (select id from distributors where name='Santosh Beej Bhandar')),
('Sudhershan KSK',          'Nivgha',       (select id from distributors where name='Santosh Beej Bhandar')),
('Ashtavinayak KSK',        'Bhokar',       (select id from distributors where name='Santosh Beej Bhandar')),
('Shriram KSK',             'Kinvat',       (select id from distributors where name='Mamde Krishi Seva Kendra')),
('Baliraja Agro Agencies',  'Himayatnagar', (select id from distributors where name='Balaji Krishi Seva Kendra')),
('Balirajya KSK',           'Naigaon',      (select id from distributors where name='Balaji Krishi Seva Kendra')),
('Tirupati Krushi Traders', 'Himayatnagar', (select id from distributors where name='Balaji Krishi Seva Kendra')),
('Venkatesh Beej Bhandar',  'Jawalgaon',    (select id from distributors where name='Balaji Krishi Seva Kendra')),
('Gajanan Agency',          'Javla Bz',     (select id from distributors where name='Jai Kisan Krishi Kendra')),
('Basaveshwar KK',          'Basmat',       (select id from distributors where name='Jai Kisan Krishi Kendra')),
('Gajanan Baba Agency',     'Basmat',       (select id from distributors where name='Jai Kisan Krishi Kendra')),
('Tanshree Agro Agency',    'Kurunda',      (select id from distributors where name='Jai Kisan Krishi Kendra')),
('Swamisamarth KK',         'Shirali',      (select id from distributors where name='Jai Kisan Krishi Kendra')),
('Ashish KK',               'Aundha',       (select id from distributors where name='Jai Kisan Krishi Kendra')),
('Om Sai KK',               'Girgaon',      (select id from distributors where name='Jai Kisan Krishi Kendra')),
('Shivshakti Agency',       'Kurunda',      (select id from distributors where name='Jai Kisan Krishi Kendra')),
('Hari Om KK',              'Basmat',       (select id from distributors where name='Jai Kisan Krishi Kendra')),
('Mauli KK',                'Basmat',       (select id from distributors where name='Jai Kisan Krishi Kendra')),
('Padma Agro Traders',      'Warora',       (select id from distributors where name='Padma Agro Traders'));

-- ------------------------------------------------------------
-- PRODUCTS — placeholders (you'll edit these in the app)
-- One per company so the dropdowns aren't empty on first run.
-- ------------------------------------------------------------
insert into products (company_id, name, packing_size_kg, rate_per_bag) values
((select id from companies where code='ASN'),
 'SOYBEAN SEEDS ASIAN-777 Certified Seeds',
 27.00,
 4077.00),
((select id from companies where code='ASN'),
 'SOYBEAN SEEDS Confidence Certified Seeds',
 27.00,
 4077.00),
((select id from companies where code='ASE'),
 'SOYBEAN SEEDS Krishi Gold-3355 Certified Seeds',
 25.00,
 3825.00),
((select id from companies where code='ASE'),
 'SOYBEAN SEEDS Variety Sample Certified Seeds',
 25.00,
 3825.00);

-- ------------------------------------------------------------
-- PRODUCT LOTS — placeholders so the New Batch screen works on day one
-- Add real lots via the Master Data screen later.
-- ------------------------------------------------------------
insert into product_lots (product_id, lot_number, bags_available, initial_bags) values
((select id from products where name='SOYBEAN SEEDS ASIAN-777 Certified Seeds'),
 'OCT-25-12-ASN', 500, 500),
((select id from products where name='SOYBEAN SEEDS Confidence Certified Seeds'),
 'OCT-25-11-ASN', 500, 500),
((select id from products where name='SOYBEAN SEEDS Krishi Gold-3355 Certified Seeds'),
 '02725-12-IND', 500, 500),
((select id from products where name='SOYBEAN SEEDS Variety Sample Certified Seeds'),
 '02725-12-IND', 500, 500);

-- ============================================================
-- Done seeding. Verify with:
-- select count(*) from companies;     -- expect 2
-- select count(*) from distributors;  -- expect 5
-- select count(*) from retailers;     -- expect 26
-- select count(*) from products;      -- expect 4
-- select count(*) from product_lots;  -- expect 4
-- ============================================================

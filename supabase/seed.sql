-- Seed data for BrewCrush development and testing

-- Create demo workspace
INSERT INTO workspaces (id, name, plan, settings)
VALUES 
  ('11111111-1111-1111-1111-111111111111', 'Demo Brewery', 'trial', 
   '{"brewhouse_efficiency": 75, "default_uom": "imperial"}'::jsonb),
  ('22222222-2222-2222-2222-222222222222', 'Contract Test Brewery', 'trial',
   '{"brewhouse_efficiency": 72, "default_uom": "metric"}'::jsonb);

-- Create demo users (passwords will be set through auth)
INSERT INTO users (id, email, full_name)
VALUES 
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'admin@demo.brewcrush.com', 'Admin User'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'brewer@demo.brewcrush.com', 'Head Brewer'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'inventory@demo.brewcrush.com', 'Inventory Manager'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'accounting@demo.brewcrush.com', 'Accounting User');

-- Assign roles to users
INSERT INTO user_workspace_roles (user_id, workspace_id, role)
VALUES 
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'admin'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '11111111-1111-1111-1111-111111111111', 'brewer'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'inventory'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', '11111111-1111-1111-1111-111111111111', 'accounting');

-- Create vendors
INSERT INTO vendors (id, workspace_id, name, email, phone, terms, created_by)
VALUES 
  ('e1111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 
   'Country Malt Group', 'orders@countrymalt.com', '555-0100', 'Net 30', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('e2222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111',
   'Yakima Chief Hops', 'sales@yakimachief.com', '555-0101', 'Net 30', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('e3333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111',
   'BSG CraftBrewing', 'orders@bsgcraft.com', '555-0102', 'Net 15', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('e4444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111',
   'Ball Corporation', 'packaging@ball.com', '555-0103', 'Net 45', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

-- Create inventory locations
INSERT INTO inventory_locations (id, workspace_id, name, type, is_default, created_by)
VALUES 
  ('f1111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111',
   'Main Warehouse', 'warehouse', true, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('f2222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111',
   'Cold Storage', 'warehouse', false, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('f3333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111',
   'Taproom', 'taproom', false, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

-- Create raw material items (malts)
INSERT INTO items (id, workspace_id, name, sku, type, category, subcategory, uom, reorder_level, vendor_id, created_by)
VALUES 
  ('a1111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111',
   '2-Row Pale Malt', 'MALT-2ROW', 'raw', 'Malt', 'Base Malt', 'lb', 500, 'e1111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('a2222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111',
   'Munich Malt', 'MALT-MUNICH', 'raw', 'Malt', 'Specialty Malt', 'lb', 200, 'e1111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('a3333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111',
   'Crystal 60L', 'MALT-C60', 'raw', 'Malt', 'Specialty Malt', 'lb', 100, 'e1111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

-- Create hop items
INSERT INTO items (id, workspace_id, name, sku, type, category, subcategory, uom, reorder_level, vendor_id, created_by)
VALUES 
  ('a4444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111',
   'Cascade Hops', 'HOP-CASCADE', 'raw', 'Hops', 'Aroma', 'oz', 50, 'e2222222-2222-2222-2222-222222222222', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('a5555555-5555-5555-5555-555555555555', '11111111-1111-1111-1111-111111111111',
   'Centennial Hops', 'HOP-CENT', 'raw', 'Hops', 'Dual Purpose', 'oz', 50, 'e2222222-2222-2222-2222-222222222222', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('a6666666-6666-6666-6666-666666666666', '11111111-1111-1111-1111-111111111111',
   'Simcoe Hops', 'HOP-SIMCOE', 'raw', 'Hops', 'Aroma', 'oz', 30, 'e2222222-2222-2222-2222-222222222222', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

-- Create packaging items
INSERT INTO items (id, workspace_id, name, sku, type, category, uom, reorder_level, vendor_id, created_by)
VALUES 
  ('a7777777-7777-7777-7777-777777777777', '11111111-1111-1111-1111-111111111111',
   '16oz Can - Blank', 'PKG-CAN16', 'packaging', 'Cans', 'case', 20, 'e4444444-4444-4444-4444-444444444444', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('a8888888-8888-8888-8888-888888888888', '11111111-1111-1111-1111-111111111111',
   '6-Pack Carrier', 'PKG-6PACK', 'packaging', 'Carriers', 'unit', 100, 'e4444444-4444-4444-4444-444444444444', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('a9999999-9999-9999-9999-999999999999', '11111111-1111-1111-1111-111111111111',
   '1/6 BBL Keg', 'PKG-SIXTEL', 'packaging', 'Kegs', 'unit', 10, NULL, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

-- Create item lots
INSERT INTO item_lots (id, workspace_id, item_id, lot_code, qty, uom, unit_cost, location_id, received_date, created_by)
VALUES 
  ('b1111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111',
   'a1111111-1111-1111-1111-111111111111', 'LOT-2ROW-2025001', 2000, 'lb', 0.65, 'f1111111-1111-1111-1111-111111111111', '2025-01-15', 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  ('b2222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111',
   'a2222222-2222-2222-2222-222222222222', 'LOT-MUN-2025001', 500, 'lb', 0.85, 'f1111111-1111-1111-1111-111111111111', '2025-01-15', 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  ('b3333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111',
   'a4444444-4444-4444-4444-444444444444', 'LOT-CAS-2024H', 100, 'oz', 12.50, 'f2222222-2222-2222-2222-222222222222', '2025-01-10', 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  ('b4444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111',
   'a5555555-5555-5555-5555-555555555555', 'LOT-CENT-2024H', 100, 'oz', 14.00, 'f2222222-2222-2222-2222-222222222222', '2025-01-10', 'cccccccc-cccc-cccc-cccc-cccccccccccc');

-- Create tanks
INSERT INTO tanks (id, workspace_id, name, type, capacity, cip_status, location_id, created_by)
VALUES 
  ('c1111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111',
   'FV-01', 'fermenter', 465, 'clean', 'f1111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('c2222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111',
   'FV-02', 'fermenter', 465, 'clean', 'f1111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('c3333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111',
   'FV-03', 'fermenter', 930, 'clean', 'f1111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('c4444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111',
   'BBT-01', 'brite', 465, 'clean', 'f1111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('c5555555-5555-5555-5555-555555555555', '11111111-1111-1111-1111-111111111111',
   'BBT-02', 'brite', 465, 'clean', 'f1111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

-- Create yeast strains
INSERT INTO yeast_strains (id, workspace_id, name, manufacturer, strain_code, type, form, attenuation_min, attenuation_max, temp_min, temp_max, flocculation, recommended_max_generation, created_by)
VALUES 
  ('d1111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111',
   'California Ale', 'White Labs', 'WLP001', 'ale', 'liquid', 73, 80, 68, 73, 'medium', 10, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  ('d2222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111',
   'London Ale III', 'Wyeast', '1318', 'ale', 'liquid', 71, 75, 64, 74, 'high', 8, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  ('d3333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111',
   'German Lager', 'White Labs', 'WLP830', 'lager', 'liquid', 74, 79, 50, 55, 'medium', 6, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

-- Create recipes
INSERT INTO recipes (id, workspace_id, name, recipe_code, style, target_volume, target_og, target_fg, target_abv, target_ibu, efficiency_pct, created_by)
VALUES 
  ('91111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111',
   'West Coast IPA', 'IPA-001', 'American IPA', 465, 1.062, 1.012, 6.6, 65, 75, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  ('92222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111',
   'Hazy Pale Ale', 'HAZY-001', 'New England Pale Ale', 465, 1.050, 1.012, 5.0, 35, 75, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  ('93333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111',
   'German Pilsner', 'PIL-001', 'German Pilsner', 465, 1.048, 1.010, 5.0, 38, 75, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

-- Create recipe versions
INSERT INTO recipe_versions (id, workspace_id, recipe_id, version_number, name, target_volume, target_og, target_fg, target_abv, target_ibu, efficiency_pct, created_by)
VALUES 
  ('81111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111',
   '91111111-1111-1111-1111-111111111111', 1, 'West Coast IPA v1', 465, 1.062, 1.012, 6.6, 65, 75, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

-- Create recipe ingredients
INSERT INTO recipe_ingredients (workspace_id, recipe_version_id, item_id, qty, uom, phase, timing, sort_order, created_by)
VALUES 
  ('11111111-1111-1111-1111-111111111111', '81111111-1111-1111-1111-111111111111',
   'a1111111-1111-1111-1111-111111111111', 100, 'lb', 'mash', '60 min', 1, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  ('11111111-1111-1111-1111-111111111111', '81111111-1111-1111-1111-111111111111',
   'a2222222-2222-2222-2222-222222222222', 10, 'lb', 'mash', '60 min', 2, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  ('11111111-1111-1111-1111-111111111111', '81111111-1111-1111-1111-111111111111',
   'a4444444-4444-4444-4444-444444444444', 2, 'oz', 'boil', '60 min', 3, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  ('11111111-1111-1111-1111-111111111111', '81111111-1111-1111-1111-111111111111',
   'a5555555-5555-5555-5555-555555555555', 4, 'oz', 'boil', '10 min', 4, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  ('11111111-1111-1111-1111-111111111111', '81111111-1111-1111-1111-111111111111',
   'a6666666-6666-6666-6666-666666666666', 4, 'oz', 'dry_hop', 'day 7', 5, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

-- Create finished SKUs
INSERT INTO finished_skus (id, workspace_id, sku_code, name, type, size_ml, units_per_pack, created_by)
VALUES 
  ('71111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111',
   'IPA-16OZ-6PK', 'West Coast IPA - 16oz 6-Pack', 'can', 473, 6, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('72222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111',
   'IPA-SIXTEL', 'West Coast IPA - 1/6 BBL Keg', 'keg', 19500, 1, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('73333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111',
   'HAZY-16OZ-6PK', 'Hazy Pale Ale - 16oz 6-Pack', 'can', 473, 6, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

-- Create lot code templates
INSERT INTO lot_code_templates (id, workspace_id, name, pattern, is_default, created_by)
VALUES 
  ('61111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111',
   'Standard', '{YY}{JJJ}-{BATCH}', true, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('62222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111',
   'With SKU', '{YY}{JJJ}-{BATCH}-{SKU}', false, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
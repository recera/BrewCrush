-- Simple seed data for BrewCrush that doesn't require auth users
-- This creates basic data for testing without auth dependencies

-- First, let's check if we have any workspaces
DO $$
BEGIN
    -- Only insert if no workspaces exist
    IF NOT EXISTS (SELECT 1 FROM workspaces) THEN
        -- Create demo workspace
        INSERT INTO workspaces (id, name, plan, settings)
        VALUES 
          ('11111111-1111-1111-1111-111111111111', 'Demo Brewery', 'trial', 
           '{"brewhouse_efficiency": 75, "default_uom": "imperial"}'::jsonb);
        
        RAISE NOTICE 'Demo workspace created';
    ELSE
        RAISE NOTICE 'Workspaces already exist, skipping workspace creation';
    END IF;
END $$;

-- Create inventory locations (no user dependency if we remove created_by)
INSERT INTO inventory_locations (id, workspace_id, name, type, is_default)
VALUES 
  ('f1111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111',
   'Main Warehouse', 'warehouse', true),
  ('f2222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111',
   'Cold Storage', 'warehouse', false),
  ('f3333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111',
   'Taproom', 'taproom', false)
ON CONFLICT (id) DO NOTHING;

-- Create vendors (without created_by)
INSERT INTO vendors (id, workspace_id, name, email, phone, terms)
VALUES 
  ('e1111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 
   'Country Malt Group', 'orders@countrymalt.com', '555-0100', 'Net 30'),
  ('e2222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111',
   'Yakima Chief Hops', 'sales@yakimachief.com', '555-0101', 'Net 30'),
  ('e3333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111',
   'BSG CraftBrewing', 'orders@bsgcraft.com', '555-0102', 'Net 15'),
  ('e4444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111',
   'Ball Corporation', 'packaging@ball.com', '555-0103', 'Net 45')
ON CONFLICT (id) DO NOTHING;

-- Create raw material items (malts)
INSERT INTO items (id, workspace_id, name, sku, type, category, subcategory, uom, reorder_level, vendor_id)
VALUES 
  ('a1111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111',
   '2-Row Pale Malt', 'MALT-2ROW', 'raw', 'Malt', 'Base Malt', 'lb', 500, 'e1111111-1111-1111-1111-111111111111'),
  ('a2222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111',
   'Munich Malt', 'MALT-MUNICH', 'raw', 'Malt', 'Specialty Malt', 'lb', 200, 'e1111111-1111-1111-1111-111111111111'),
  ('a3333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111',
   'Crystal 60L', 'MALT-C60', 'raw', 'Malt', 'Specialty Malt', 'lb', 100, 'e1111111-1111-1111-1111-111111111111')
ON CONFLICT (id) DO NOTHING;

-- Create hop items
INSERT INTO items (id, workspace_id, name, sku, type, category, subcategory, uom, reorder_level, vendor_id)
VALUES 
  ('a4444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111',
   'Cascade Hops', 'HOP-CASCADE', 'raw', 'Hops', 'Aroma', 'oz', 50, 'e2222222-2222-2222-2222-222222222222'),
  ('a5555555-5555-5555-5555-555555555555', '11111111-1111-1111-1111-111111111111',
   'Centennial Hops', 'HOP-CENT', 'raw', 'Hops', 'Dual Purpose', 'oz', 50, 'e2222222-2222-2222-2222-222222222222'),
  ('a6666666-6666-6666-6666-666666666666', '11111111-1111-1111-1111-111111111111',
   'Simcoe Hops', 'HOP-SIMCOE', 'raw', 'Hops', 'Aroma', 'oz', 30, 'e2222222-2222-2222-2222-222222222222')
ON CONFLICT (id) DO NOTHING;

-- Create packaging items
INSERT INTO items (id, workspace_id, name, sku, type, category, uom, reorder_level, vendor_id)
VALUES 
  ('a7777777-7777-7777-7777-777777777777', '11111111-1111-1111-1111-111111111111',
   '16oz Can - Blank', 'PKG-CAN16', 'packaging', 'Cans', 'case', 20, 'e4444444-4444-4444-4444-444444444444'),
  ('a8888888-8888-8888-8888-888888888888', '11111111-1111-1111-1111-111111111111',
   '6-Pack Carrier', 'PKG-6PACK', 'packaging', 'Carriers', 'unit', 100, 'e4444444-4444-4444-4444-444444444444'),
  ('a9999999-9999-9999-9999-999999999999', '11111111-1111-1111-1111-111111111111',
   '1/6 BBL Keg', 'PKG-SIXTEL', 'packaging', 'Kegs', 'unit', 10, NULL)
ON CONFLICT (id) DO NOTHING;

-- Create item lots
INSERT INTO item_lots (id, workspace_id, item_id, lot_code, qty, uom, unit_cost, location_id, received_date)
VALUES 
  ('b1111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111',
   'a1111111-1111-1111-1111-111111111111', 'LOT-2ROW-2025001', 2000, 'lb', 0.65, 'f1111111-1111-1111-1111-111111111111', '2025-01-15'),
  ('b2222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111',
   'a2222222-2222-2222-2222-222222222222', 'LOT-MUN-2025001', 500, 'lb', 0.85, 'f1111111-1111-1111-1111-111111111111', '2025-01-15'),
  ('b3333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111',
   'a4444444-4444-4444-4444-444444444444', 'LOT-CAS-2024H', 100, 'oz', 12.50, 'f2222222-2222-2222-2222-222222222222', '2025-01-10'),
  ('b4444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111',
   'a5555555-5555-5555-5555-555555555555', 'LOT-CENT-2024H', 100, 'oz', 14.00, 'f2222222-2222-2222-2222-222222222222', '2025-01-10'),
  ('b5555555-5555-5555-5555-555555555555', '11111111-1111-1111-1111-111111111111',
   'a7777777-7777-7777-7777-777777777777', 'LOT-CAN-2025001', 50, 'case', 35.00, 'f1111111-1111-1111-1111-111111111111', '2025-01-12'),
  ('b6666666-6666-6666-6666-666666666666', '11111111-1111-1111-1111-111111111111',
   'a8888888-8888-8888-8888-888888888888', 'LOT-6PK-2025001', 200, 'unit', 0.25, 'f1111111-1111-1111-1111-111111111111', '2025-01-12')
ON CONFLICT (id) DO NOTHING;

-- Create tanks
INSERT INTO tanks (id, workspace_id, name, type, capacity, cip_status, location_id)
VALUES 
  ('c1111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111',
   'FV-01', 'fermenter', 465, 'clean', 'f1111111-1111-1111-1111-111111111111'),
  ('c2222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111',
   'FV-02', 'fermenter', 465, 'clean', 'f1111111-1111-1111-1111-111111111111'),
  ('c3333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111',
   'FV-03', 'fermenter', 930, 'clean', 'f1111111-1111-1111-1111-111111111111'),
  ('c4444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111',
   'BT-01', 'brite', 465, 'clean', 'f1111111-1111-1111-1111-111111111111'),
  ('c5555555-5555-5555-5555-555555555555', '11111111-1111-1111-1111-111111111111',
   'BT-02', 'brite', 465, 'clean', 'f1111111-1111-1111-1111-111111111111')
ON CONFLICT (id) DO NOTHING;

-- Create sample Purchase Orders
INSERT INTO purchase_orders (id, workspace_id, po_number, vendor_id, status, order_date, due_date, terms)
VALUES
  ('d1111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111',
   'PO-2025-001', 'e1111111-1111-1111-1111-111111111111', 'draft', '2025-01-17', '2025-01-31', 'Net 30'),
  ('d2222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111',
   'PO-2025-002', 'e2222222-2222-2222-2222-222222222222', 'approved', '2025-01-16', '2025-01-30', 'Net 30')
ON CONFLICT (id) DO NOTHING;

-- Create PO lines
INSERT INTO po_lines (id, workspace_id, po_id, item_id, qty, uom, expected_unit_cost, location_id)
VALUES
  ('d1111111-1111-1111-1111-111111111112', '11111111-1111-1111-1111-111111111111',
   'd1111111-1111-1111-1111-111111111111', 'a1111111-1111-1111-1111-111111111111', 1000, 'lb', 0.65, 'f1111111-1111-1111-1111-111111111111'),
  ('d1111111-1111-1111-1111-111111111113', '11111111-1111-1111-1111-111111111111',
   'd1111111-1111-1111-1111-111111111111', 'a2222222-2222-2222-2222-222222222222', 200, 'lb', 0.85, 'f1111111-1111-1111-1111-111111111111'),
  ('d2222222-2222-2222-2222-222222222223', '11111111-1111-1111-1111-111111111111',
   'd2222222-2222-2222-2222-222222222222', 'a4444444-4444-4444-4444-444444444444', 100, 'oz', 12.50, 'f2222222-2222-2222-2222-222222222222')
ON CONFLICT (id) DO NOTHING;

-- Refresh materialized views
REFRESH MATERIALIZED VIEW inventory_on_hand_by_item_location;
REFRESH MATERIALIZED VIEW inventory_value;

-- Summary
SELECT 'Database seeded with demo data' as status;
SELECT 'Workspaces: ' || COUNT(*) FROM workspaces;
SELECT 'Items: ' || COUNT(*) FROM items;
SELECT 'Vendors: ' || COUNT(*) FROM vendors;
SELECT 'Tanks: ' || COUNT(*) FROM tanks;
SELECT 'Purchase Orders: ' || COUNT(*) FROM purchase_orders;
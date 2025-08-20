-- ============================================================================
-- Phase 8: Integration Demo Test
-- Demonstrates end-to-end reporting functionality with realistic brewery data
-- ============================================================================

BEGIN;

SELECT plan(15);

-- ============================================================================
-- INTEGRATION TEST: FULL BREWERY WORKFLOW WITH REPORTING
-- ============================================================================

-- Create test workspace with proper auth user (simplified for demo)
INSERT INTO workspaces (id, name, plan) VALUES 
    ('22222222-2222-2222-2222-222222222222', 'Demo Brewery', 'pro');

-- Create test location
INSERT INTO inventory_locations (id, workspace_id, name, type, is_default) VALUES 
    ('11111111-1111-1111-1111-111111111112', '22222222-2222-2222-2222-222222222222', 'Main Warehouse', 'warehouse', true);

-- Create test vendor
INSERT INTO vendors (id, workspace_id, name, email) VALUES 
    ('11111111-1111-1111-1111-111111111113', '22222222-2222-2222-2222-222222222222', 'Grain Supplier', 'orders@grain.com');

-- Create test items
INSERT INTO items (id, workspace_id, name, type, uom, reorder_level, vendor_id) VALUES 
    ('11111111-1111-1111-1111-111111111114', '22222222-2222-2222-2222-222222222222', 'Pale Malt', 'raw', 'lbs', 200, '11111111-1111-1111-1111-111111111113'),
    ('11111111-1111-1111-1111-111111111115', '22222222-2222-2222-2222-222222222222', '16oz Cans', 'packaging', 'cases', 100, null);

-- Create item lots with inventory
INSERT INTO item_lots (id, workspace_id, item_id, lot_code, qty, uom, unit_cost, location_id, received_date) VALUES 
    ('11111111-1111-1111-1111-111111111116', '22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111114', 'MALT-001', 1000, 'lbs', 0.90, '11111111-1111-1111-1111-111111111112', '2025-01-01'),
    ('11111111-1111-1111-1111-111111111117', '22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111115', 'CAN-001', 50, 'cases', 40.00, '11111111-1111-1111-1111-111111111112', '2025-01-05');

-- Create test tank
INSERT INTO tanks (id, workspace_id, name, type, capacity) VALUES 
    ('11111111-1111-1111-1111-111111111118', '22222222-2222-2222-2222-222222222222', 'FV-01', 'fermenter', 1200);

-- Create recipe and version
INSERT INTO recipes (id, workspace_id, name, style, target_volume) VALUES 
    ('11111111-1111-1111-1111-111111111119', '22222222-2222-2222-2222-222222222222', 'House IPA', 'American IPA', 1000);

INSERT INTO recipe_versions (id, workspace_id, recipe_id, version_number, name, target_volume, target_og) VALUES 
    ('11111111-1111-1111-1111-111111111120', '22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111119', 1, 'House IPA v1.0', 1000, 1.062);

-- Create batch  
INSERT INTO batches (id, workspace_id, batch_number, recipe_version_id, status, brew_date, target_volume, actual_volume, tank_id) VALUES 
    ('11111111-1111-1111-1111-111111111121', '22222222-2222-2222-2222-222222222222', 'IPA-2025-001', '11111111-1111-1111-1111-111111111120', 'fermenting', '2025-01-15', 1000, 980, '11111111-1111-1111-1111-111111111118');

-- Create Purchase Order
INSERT INTO purchase_orders (id, workspace_id, po_number, vendor_id, status, order_date, due_date) VALUES 
    ('11111111-1111-1111-1111-111111111122', '22222222-2222-2222-2222-222222222222', 'PO-2025-003', '11111111-1111-1111-1111-111111111113', 'approved', '2025-01-20', '2025-02-05');

INSERT INTO po_lines (id, workspace_id, po_id, item_id, qty, uom, expected_unit_cost, location_id, line_number) VALUES 
    ('11111111-1111-1111-1111-111111111123', '22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111122', '11111111-1111-1111-1111-111111111114', 2000, 'lbs', 0.90, '11111111-1111-1111-1111-111111111112', 1);

-- Add supplier price history to show trends
INSERT INTO supplier_price_history (workspace_id, item_id, vendor_id, receipt_date, unit_cost, uom) VALUES 
    ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111114', '11111111-1111-1111-1111-111111111113', '2024-11-01', 0.85, 'lbs'),
    ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111114', '11111111-1111-1111-1111-111111111113', '2024-12-01', 0.87, 'lbs'),
    ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111114', '11111111-1111-1111-1111-111111111113', '2025-01-01', 0.90, 'lbs');

-- Refresh materialized views to include new data
REFRESH MATERIALIZED VIEW mv_inventory_on_hand;
REFRESH MATERIALIZED VIEW mv_batch_summary;
REFRESH MATERIALIZED VIEW mv_production_summary;
REFRESH MATERIALIZED VIEW mv_po_aging;
REFRESH MATERIALIZED VIEW mv_supplier_price_trends;

-- ============================================================================
-- TEST 1: INVENTORY REPORTING WITH REAL DATA
-- ============================================================================

SELECT ok(
    (SELECT COUNT(*) FROM mv_inventory_on_hand WHERE workspace_id = '22222222-2222-2222-2222-222222222222') = 2,
    'Inventory view contains both test items'
);

SELECT ok(
    (SELECT total_qty FROM mv_inventory_on_hand 
     WHERE workspace_id = '22222222-2222-2222-2222-222222222222' AND item_name = 'Pale Malt') = 1000,
    'Inventory view shows correct quantity for Pale Malt'
);

SELECT ok(
    (SELECT total_value FROM mv_inventory_on_hand 
     WHERE workspace_id = '22222222-2222-2222-2222-222222222222' AND item_name = 'Pale Malt') = 900,
    'Inventory view calculates correct value for Pale Malt (1000 lbs × $0.90)'
);

SELECT ok(
    (SELECT below_reorder_level FROM mv_inventory_on_hand 
     WHERE workspace_id = '22222222-2222-2222-2222-222222222222' AND item_name = 'Pale Malt') = false,
    'Inventory view correctly shows Pale Malt is above reorder level'
);

-- ============================================================================  
-- TEST 2: BATCH SUMMARY REPORTING
-- ============================================================================

SELECT ok(
    (SELECT COUNT(*) FROM mv_batch_summary WHERE workspace_id = '22222222-2222-2222-2222-222222222222') = 1,
    'Batch summary view contains the test batch'
);

SELECT ok(
    (SELECT batch_number FROM mv_batch_summary 
     WHERE workspace_id = '22222222-2222-2222-2222-222222222222') = 'IPA-2025-001',
    'Batch summary shows correct batch number'
);

SELECT ok(
    (SELECT yield_percentage FROM mv_batch_summary 
     WHERE workspace_id = '22222222-2222-2222-2222-222222222222') = 98.0,
    'Batch summary calculates correct yield percentage (980/1000 = 98%)'
);

-- ============================================================================
-- TEST 3: PRODUCTION SUMMARY REPORTING  
-- ============================================================================

SELECT ok(
    (SELECT total_batches FROM mv_production_summary 
     WHERE workspace_id = '22222222-2222-2222-2222-222222222222') = 1,
    'Production summary shows correct total batch count'
);

SELECT ok(
    (SELECT active_batches FROM mv_production_summary 
     WHERE workspace_id = '22222222-2222-2222-2222-222222222222') = 1,
    'Production summary shows correct active batch count (fermenting status)'
);

-- ============================================================================
-- TEST 4: PURCHASE ORDER AGING
-- ============================================================================

SELECT ok(
    (SELECT COUNT(*) FROM mv_po_aging WHERE workspace_id = '22222222-2222-2222-2222-222222222222') = 1,
    'PO aging view contains the test purchase order'
);

SELECT ok(
    (SELECT po_number FROM mv_po_aging 
     WHERE workspace_id = '22222222-2222-2222-2222-222222222222') = 'PO-2025-003',
    'PO aging shows correct PO number'
);

-- ============================================================================
-- TEST 5: SUPPLIER PRICE TRENDS
-- ============================================================================

SELECT ok(
    (SELECT COUNT(*) FROM mv_supplier_price_trends 
     WHERE workspace_id = '22222222-2222-2222-2222-222222222222' AND item_name = 'Pale Malt') = 1,
    'Price trends view contains Pale Malt data'
);

SELECT ok(
    (SELECT price_trend FROM mv_supplier_price_trends 
     WHERE workspace_id = '22222222-2222-2222-2222-222222222222' AND item_name = 'Pale Malt') = 'increasing',
    'Price trends correctly identifies increasing price trend for Pale Malt'
);

-- ============================================================================
-- TEST 6: DASHBOARD STATS INTEGRATION
-- ============================================================================

SELECT ok(
    (get_dashboard_stats('22222222-2222-2222-2222-222222222222', 'admin') -> 'inventory_value')::numeric = 2900,
    'Dashboard stats shows correct total inventory value ($900 + $2000 = $2900)'
);

SELECT ok(
    (get_dashboard_stats('22222222-2222-2222-2222-222222222222', 'admin') -> 'active_batches')::int = 1,
    'Dashboard stats shows correct active batch count'
);

SELECT finish();

ROLLBACK;
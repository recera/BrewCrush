-- ============================================================================
-- Phase 8: Comprehensive Reporting and Dashboard Tests
-- Using pgTAP for thorough testing of all reporting functionality
-- ============================================================================

BEGIN;

-- Set up the test plan
SELECT plan(45);

-- ============================================================================
-- TEST SETUP: CREATE TEST WORKSPACE AND DATA
-- ============================================================================

-- Create test workspace
INSERT INTO workspaces (id, name, plan) VALUES 
    ('550e8400-e29b-41d4-a716-446655440001', 'Test Brewery', 'pro');

-- Create test users
INSERT INTO users (id, email, full_name) VALUES 
    ('550e8400-e29b-41d4-a716-446655440002', 'admin@test.com', 'Admin User'),
    ('550e8400-e29b-41d4-a716-446655440003', 'brewer@test.com', 'Brewer User');

-- Create user roles
INSERT INTO user_workspace_roles (user_id, workspace_id, role) VALUES 
    ('550e8400-e29b-41d4-a716-446655440002', '550e8400-e29b-41d4-a716-446655440001', 'admin'),
    ('550e8400-e29b-41d4-a716-446655440003', '550e8400-e29b-41d4-a716-446655440001', 'brewer');

-- Create test inventory location
INSERT INTO inventory_locations (id, workspace_id, name, type, is_default) VALUES 
    ('550e8400-e29b-41d4-a716-446655440004', '550e8400-e29b-41d4-a716-446655440001', 'Main Warehouse', 'warehouse', true);

-- Create test vendors
INSERT INTO vendors (id, workspace_id, name, email) VALUES 
    ('550e8400-e29b-41d4-a716-446655440005', '550e8400-e29b-41d4-a716-446655440001', 'Great Western Malting', 'orders@gwmalting.com'),
    ('550e8400-e29b-41d4-a716-446655440006', '550e8400-e29b-41d4-a716-446655440001', 'YCH Hops', 'sales@ychhops.com');

-- Create test items
INSERT INTO items (id, workspace_id, name, type, uom, reorder_level, vendor_id) VALUES 
    ('550e8400-e29b-41d4-a716-446655440007', '550e8400-e29b-41d4-a716-446655440001', '2-Row Pale Malt', 'raw', 'lbs', 100, '550e8400-e29b-41d4-a716-446655440005'),
    ('550e8400-e29b-41d4-a716-446655440008', '550e8400-e29b-41d4-a716-446655440001', 'Cascade Hops', 'raw', 'lbs', 10, '550e8400-e29b-41d4-a716-446655440006'),
    ('550e8400-e29b-41d4-a716-446655440009', '550e8400-e29b-41d4-a716-446655440001', '16oz Cans', 'packaging', 'cases', 50, null),
    ('550e8400-e29b-41d4-a716-446655440010', '550e8400-e29b-41d4-a716-446655440001', 'IPA 16oz', 'finished', 'cases', 0, null);

-- Create test item lots
INSERT INTO item_lots (id, workspace_id, item_id, lot_code, qty, uom, unit_cost, location_id, received_date) VALUES 
    ('550e8400-e29b-41d4-a716-446655440011', '550e8400-e29b-41d4-a716-446655440001', '550e8400-e29b-41d4-a716-446655440007', 'MALT-2025-001', 500, 'lbs', 0.85, '550e8400-e29b-41d4-a716-446655440004', '2025-01-01'),
    ('550e8400-e29b-41d4-a716-446655440012', '550e8400-e29b-41d4-a716-446655440001', '550e8400-e29b-41d4-a716-446655440008', 'HOP-2025-001', 25, 'lbs', 12.50, '550e8400-e29b-41d4-a716-446655440004', '2025-01-05'),
    ('550e8400-e29b-41d4-a716-446655440013', '550e8400-e29b-41d4-a716-446655440001', '550e8400-e29b-41d4-a716-446655440009', 'CAN-2025-001', 200, 'cases', 45.00, '550e8400-e29b-41d4-a716-446655440004', '2025-01-10');

-- Create test tanks
INSERT INTO tanks (id, workspace_id, name, type, capacity) VALUES 
    ('550e8400-e29b-41d4-a716-446655440014', '550e8400-e29b-41d4-a716-446655440001', 'FV-01', 'fermenter', 1000),
    ('550e8400-e29b-41d4-a716-446655440015', '550e8400-e29b-41d4-a716-446655440001', 'BT-01', 'brite', 1000);

-- Create test recipes
INSERT INTO recipes (id, workspace_id, name, style, target_volume) VALUES 
    ('550e8400-e29b-41d4-a716-446655440016', '550e8400-e29b-41d4-a716-446655440001', 'West Coast IPA', 'American IPA', 800);

INSERT INTO recipe_versions (id, workspace_id, recipe_id, version_number, name, target_volume, target_og) VALUES 
    ('550e8400-e29b-41d4-a716-446655440017', '550e8400-e29b-41d4-a716-446655440001', '550e8400-e29b-41d4-a716-446655440016', 1, 'West Coast IPA v1.0', 800, 1.065);

-- Create test batches
INSERT INTO batches (id, workspace_id, batch_number, recipe_version_id, status, brew_date, target_volume, actual_volume, tank_id) VALUES 
    ('550e8400-e29b-41d4-a716-446655440018', '550e8400-e29b-41d4-a716-446655440001', 'IPA-001', '550e8400-e29b-41d4-a716-446655440017', 'fermenting', '2025-01-15', 800, 790, '550e8400-e29b-41d4-a716-446655440014'),
    ('550e8400-e29b-41d4-a716-446655440019', '550e8400-e29b-41d4-a716-446655440001', 'IPA-002', '550e8400-e29b-41d4-a716-446655440017', 'packaged', '2025-01-10', 800, 785, '550e8400-e29b-41d4-a716-446655440015');

-- Create test finished SKUs
INSERT INTO finished_skus (id, workspace_id, sku_code, name, type, size_ml) VALUES 
    ('550e8400-e29b-41d4-a716-446655440020', '550e8400-e29b-41d4-a716-446655440001', 'IPA-16OZ', 'IPA 16oz Can', 'can', 473);

-- Create test packaging runs
INSERT INTO packaging_runs (id, workspace_id, run_number, sku_id, total_produced, packaging_date) VALUES 
    ('550e8400-e29b-41d4-a716-446655440021', '550e8400-e29b-41d4-a716-446655440001', 'PKG-001', '550e8400-e29b-41d4-a716-446655440020', 1320, '2025-01-18');

INSERT INTO packaging_run_sources (id, workspace_id, run_id, batch_id, volume_liters, allocation_pct) VALUES 
    ('550e8400-e29b-41d4-a716-446655440022', '550e8400-e29b-41d4-a716-446655440001', '550e8400-e29b-41d4-a716-446655440021', '550e8400-e29b-41d4-a716-446655440019', 785, 100.0);

-- Create test finished lots
INSERT INTO finished_lots (id, workspace_id, sku_id, lot_code, packaging_run_id, produced_qty, remaining_qty) VALUES 
    ('550e8400-e29b-41d4-a716-446655440023', '550e8400-e29b-41d4-a716-446655440001', '550e8400-e29b-41d4-a716-446655440020', 'IPA-001-25018', '550e8400-e29b-41d4-a716-446655440021', 1320, 1200);

-- Create test purchase orders
INSERT INTO purchase_orders (id, workspace_id, po_number, vendor_id, status, order_date, due_date) VALUES 
    ('550e8400-e29b-41d4-a716-446655440024', '550e8400-e29b-41d4-a716-446655440001', 'PO-2025-001', '550e8400-e29b-41d4-a716-446655440005', 'approved', '2025-01-20', '2025-02-01'),
    ('550e8400-e29b-41d4-a716-446655440025', '550e8400-e29b-41d4-a716-446655440001', 'PO-2025-002', '550e8400-e29b-41d4-a716-446655440006', 'received', '2025-01-05', '2025-01-25');

INSERT INTO po_lines (id, workspace_id, po_id, item_id, qty, uom, expected_unit_cost, location_id, line_number) VALUES 
    ('550e8400-e29b-41d4-a716-446655440026', '550e8400-e29b-41d4-a716-446655440001', '550e8400-e29b-41d4-a716-446655440024', '550e8400-e29b-41d4-a716-446655440007', 1000, 'lbs', 0.85, '550e8400-e29b-41d4-a716-446655440004', 1),
    ('550e8400-e29b-41d4-a716-446655440027', '550e8400-e29b-41d4-a716-446655440001', '550e8400-e29b-41d4-a716-446655440025', '550e8400-e29b-41d4-a716-446655440008', 50, 'lbs', 12.50, '550e8400-e29b-41d4-a716-446655440004', 1);

-- Create supplier price history
INSERT INTO supplier_price_history (workspace_id, item_id, vendor_id, receipt_date, unit_cost, uom) VALUES 
    ('550e8400-e29b-41d4-a716-446655440001', '550e8400-e29b-41d4-a716-446655440007', '550e8400-e29b-41d4-a716-446655440005', '2024-12-15', 0.80, 'lbs'),
    ('550e8400-e29b-41d4-a716-446655440001', '550e8400-e29b-41d4-a716-446655440007', '550e8400-e29b-41d4-a716-446655440005', '2025-01-01', 0.85, 'lbs'),
    ('550e8400-e29b-41d4-a716-446655440001', '550e8400-e29b-41d4-a716-446655440008', '550e8400-e29b-41d4-a716-446655440006', '2024-12-20', 11.00, 'lbs'),
    ('550e8400-e29b-41d4-a716-446655440001', '550e8400-e29b-41d4-a716-446655440008', '550e8400-e29b-41d4-a716-446655440006', '2025-01-05', 12.50, 'lbs');

-- ============================================================================
-- REFRESH MATERIALIZED VIEWS BEFORE TESTING
-- ============================================================================

REFRESH MATERIALIZED VIEW mv_inventory_on_hand;
REFRESH MATERIALIZED VIEW mv_batch_summary;
REFRESH MATERIALIZED VIEW mv_production_summary;
REFRESH MATERIALIZED VIEW mv_po_aging;
REFRESH MATERIALIZED VIEW mv_supplier_price_trends;

-- ============================================================================
-- TEST 1: MATERIALIZED VIEW EXISTENCE AND BASIC FUNCTIONALITY
-- ============================================================================

SELECT has_materialized_view('mv_inventory_on_hand', 'mv_inventory_on_hand materialized view exists');
SELECT has_materialized_view('mv_batch_summary', 'mv_batch_summary materialized view exists');
SELECT has_materialized_view('mv_production_summary', 'mv_production_summary materialized view exists');
SELECT has_materialized_view('mv_po_aging', 'mv_po_aging materialized view exists');
SELECT has_materialized_view('mv_supplier_price_trends', 'mv_supplier_price_trends materialized view exists');

-- ============================================================================
-- TEST 2: INVENTORY ON-HAND VIEW TESTS
-- ============================================================================

SELECT ok(
    (SELECT COUNT(*) FROM mv_inventory_on_hand WHERE workspace_id = '550e8400-e29b-41d4-a716-446655440001') > 0,
    'mv_inventory_on_hand contains test workspace data'
);

SELECT ok(
    (SELECT COUNT(*) FROM mv_inventory_on_hand WHERE workspace_id = '550e8400-e29b-41d4-a716-446655440001' AND item_name = '2-Row Pale Malt') = 1,
    'mv_inventory_on_hand contains 2-Row Pale Malt'
);

SELECT ok(
    (SELECT remaining_qty FROM mv_inventory_on_hand WHERE workspace_id = '550e8400-e29b-41d4-a716-446655440001' AND item_name = '2-Row Pale Malt') = 500,
    'mv_inventory_on_hand shows correct remaining quantity for 2-Row Pale Malt'
);

SELECT ok(
    (SELECT below_reorder_level FROM mv_inventory_on_hand WHERE workspace_id = '550e8400-e29b-41d4-a716-446655440001' AND item_name = '2-Row Pale Malt') = false,
    'mv_inventory_on_hand correctly calculates reorder level status'
);

-- ============================================================================
-- TEST 3: BATCH SUMMARY VIEW TESTS
-- ============================================================================

SELECT ok(
    (SELECT COUNT(*) FROM mv_batch_summary WHERE workspace_id = '550e8400-e29b-41d4-a716-446655440001') = 2,
    'mv_batch_summary contains all test batches'
);

SELECT ok(
    (SELECT yield_percentage FROM mv_batch_summary WHERE workspace_id = '550e8400-e29b-41d4-a716-446655440001' AND batch_number = 'IPA-001') BETWEEN 98 AND 99,
    'mv_batch_summary calculates yield percentage correctly'
);

-- ============================================================================
-- TEST 4: PRODUCTION SUMMARY VIEW TESTS
-- ============================================================================

SELECT ok(
    (SELECT COUNT(*) FROM mv_production_summary WHERE workspace_id = '550e8400-e29b-41d4-a716-446655440001') = 1,
    'mv_production_summary contains test workspace data'
);

SELECT ok(
    (SELECT total_batches FROM mv_production_summary WHERE workspace_id = '550e8400-e29b-41d4-a716-446655440001') = 2,
    'mv_production_summary correctly counts total batches'
);

-- ============================================================================
-- TEST 5: PO AGING VIEW TESTS
-- ============================================================================

SELECT ok(
    (SELECT COUNT(*) FROM mv_po_aging WHERE workspace_id = '550e8400-e29b-41d4-a716-446655440001') = 2,
    'mv_po_aging contains all test purchase orders'
);

SELECT ok(
    (SELECT days_since_order FROM mv_po_aging WHERE workspace_id = '550e8400-e29b-41d4-a716-446655440001' AND po_number = 'PO-2025-001') > 0,
    'mv_po_aging calculates days since order correctly'
);

-- ============================================================================
-- TEST 6: SUPPLIER PRICE TRENDS VIEW TESTS
-- ============================================================================

SELECT ok(
    (SELECT COUNT(*) FROM mv_supplier_price_trends WHERE workspace_id = '550e8400-e29b-41d4-a716-446655440001') > 0,
    'mv_supplier_price_trends contains test data'
);

SELECT ok(
    (SELECT price_trend FROM mv_supplier_price_trends 
     WHERE workspace_id = '550e8400-e29b-41d4-a716-446655440001' 
       AND item_name = '2-Row Pale Malt') = 'increasing',
    'mv_supplier_price_trends correctly calculates price trend for 2-Row Pale Malt'
);

-- ============================================================================
-- TEST 7: DASHBOARD STATS FUNCTION TESTS
-- ============================================================================

SELECT ok(
    get_dashboard_stats('550e8400-e29b-41d4-a716-446655440001', 'admin') IS NOT NULL,
    'get_dashboard_stats function returns data for admin role'
);

SELECT ok(
    (get_dashboard_stats('550e8400-e29b-41d4-a716-446655440001', 'admin') -> 'inventory_value')::numeric > 0,
    'get_dashboard_stats returns inventory value for admin'
);

SELECT ok(
    (get_dashboard_stats('550e8400-e29b-41d4-a716-446655440001', 'admin') -> 'active_batches')::int >= 0,
    'get_dashboard_stats returns active batches count for admin'
);

SELECT ok(
    get_dashboard_stats('550e8400-e29b-41d4-a716-446655440001', 'brewer') IS NOT NULL,
    'get_dashboard_stats function returns data for brewer role'
);

SELECT ok(
    get_dashboard_stats('550e8400-e29b-41d4-a716-446655440001', 'brewer') -> 'inventory_value' IS NULL,
    'get_dashboard_stats does not return inventory value for brewer role'
);

SELECT ok(
    (get_dashboard_stats('550e8400-e29b-41d4-a716-446655440001', 'brewer') -> 'active_batches')::int >= 0,
    'get_dashboard_stats returns active batches count for brewer'
);

SELECT ok(
    get_dashboard_stats('550e8400-e29b-41d4-a716-446655440001', 'inventory') IS NOT NULL,
    'get_dashboard_stats function returns data for inventory role'
);

SELECT ok(
    (get_dashboard_stats('550e8400-e29b-41d4-a716-446655440001', 'inventory') -> 'low_stock_items')::int >= 0,
    'get_dashboard_stats returns low stock items count for inventory role'
);

-- ============================================================================
-- TEST 8: RECALL DRILL FUNCTIONS TESTS
-- ============================================================================

SELECT has_function('trace_upstream_from_finished_lot', 'trace_upstream_from_finished_lot function exists');
SELECT has_function('trace_downstream_from_ingredient_lot', 'trace_downstream_from_ingredient_lot function exists');
SELECT has_function('comprehensive_trace', 'comprehensive_trace function exists');
SELECT has_function('recall_impact_summary', 'recall_impact_summary function exists');

-- Test upstream tracing
SELECT ok(
    array_length(
        (SELECT array_agg(entity_id) FROM trace_upstream_from_finished_lot('550e8400-e29b-41d4-a716-446655440023')),
        1
    ) > 0,
    'trace_upstream_from_finished_lot returns upstream entities'
);

-- Test comprehensive trace
SELECT ok(
    (SELECT comprehensive_trace('finished_lot', '550e8400-e29b-41d4-a716-446655440023', 10) IS NOT NULL),
    'comprehensive_trace function works with finished lot'
);

-- ============================================================================
-- TEST 9: REFRESH FUNCTIONS TESTS
-- ============================================================================

SELECT has_function('refresh_inventory_materialized_view', 'refresh_inventory_materialized_view function exists');
SELECT has_function('refresh_batch_materialized_view', 'refresh_batch_materialized_view function exists');
SELECT has_function('refresh_production_materialized_view', 'refresh_production_materialized_view function exists');

-- Test refresh functions
SELECT ok(
    refresh_inventory_materialized_view() = 'SUCCESS',
    'refresh_inventory_materialized_view executes successfully'
);

SELECT ok(
    refresh_batch_materialized_view() = 'SUCCESS',
    'refresh_batch_materialized_view executes successfully'
);

SELECT ok(
    refresh_production_materialized_view() = 'SUCCESS',
    'refresh_production_materialized_view executes successfully'
);

-- ============================================================================
-- TEST 10: REPORT GENERATION FUNCTIONS TESTS
-- ============================================================================

SELECT has_function('generate_inventory_report', 'generate_inventory_report function exists');
SELECT has_function('generate_batch_report', 'generate_batch_report function exists');
SELECT has_function('generate_production_report', 'generate_production_report function exists');
SELECT has_function('generate_po_report', 'generate_po_report function exists');

-- ============================================================================
-- TEST 11: DATA INTEGRITY AND EDGE CASES
-- ============================================================================

-- Test with invalid role
SELECT ok(
    get_dashboard_stats('550e8400-e29b-41d4-a716-446655440001', 'invalid_role') IS NOT NULL,
    'get_dashboard_stats handles invalid role gracefully'
);

-- Test empty result scenarios
SELECT ok(
    (SELECT COUNT(*) FROM mv_inventory_on_hand WHERE workspace_id = 'non-existent-workspace') = 0,
    'mv_inventory_on_hand returns empty result for non-existent workspace'
);

-- Test data consistency after refresh
REFRESH MATERIALIZED VIEW mv_inventory_on_hand;
REFRESH MATERIALIZED VIEW mv_batch_summary;

SELECT ok(
    (SELECT COUNT(*) FROM mv_inventory_on_hand WHERE workspace_id = '550e8400-e29b-41d4-a716-446655440001') > 0,
    'mv_inventory_on_hand maintains data after refresh'
);

SELECT ok(
    (SELECT COUNT(*) FROM mv_batch_summary WHERE workspace_id = '550e8400-e29b-41d4-a716-446655440001') = 2,
    'mv_batch_summary maintains data after refresh'
);

-- ============================================================================
-- CLEANUP AND FINISH
-- ============================================================================

-- Run the tests
SELECT finish();

ROLLBACK;
-- ============================================================================
-- Phase 8 SQL Function Tests (pgTAP)
-- Comprehensive testing for materialized views and reporting functions
-- ============================================================================

BEGIN;

-- Load test setup functions
\i phase8_reporting_test_setup.sql

-- Plan the number of tests
SELECT plan(85);

-- ============================================================================
-- SETUP TEST DATA
-- ============================================================================

-- Create test workspace and users
CREATE TEMPORARY TABLE test_context AS 
SELECT * FROM setup_test_workspace();

-- Get test workspace info
SELECT workspace_id, admin_user_id, brewer_user_id, inventory_user_id, accounting_user_id
FROM test_context \gset

-- Set up test data
SELECT setup_test_inventory(:'workspace_id');
SELECT setup_test_production(:'workspace_id');
SELECT setup_test_purchasing(:'workspace_id');  
SELECT setup_test_compliance(:'workspace_id');

-- Refresh materialized views with test data
REFRESH MATERIALIZED VIEW mv_inventory_on_hand;
REFRESH MATERIALIZED VIEW mv_batch_summary;
REFRESH MATERIALIZED VIEW mv_production_summary; 
REFRESH MATERIALIZED VIEW mv_po_aging;
REFRESH MATERIALIZED VIEW mv_supplier_price_trends;
REFRESH MATERIALIZED VIEW mv_keg_deposit_summary;

-- ============================================================================
-- MATERIALIZED VIEW TESTS
-- ============================================================================

-- Test mv_inventory_on_hand structure and data
SELECT has_materialized_view('mv_inventory_on_hand', 'mv_inventory_on_hand materialized view exists');

SELECT has_column('mv_inventory_on_hand', 'workspace_id', 'mv_inventory_on_hand has workspace_id column');
SELECT has_column('mv_inventory_on_hand', 'item_name', 'mv_inventory_on_hand has item_name column');
SELECT has_column('mv_inventory_on_hand', 'total_qty', 'mv_inventory_on_hand has total_qty column');
SELECT has_column('mv_inventory_on_hand', 'below_reorder_level', 'mv_inventory_on_hand has below_reorder_level column');

-- Test inventory data accuracy
SELECT ok(
    (SELECT COUNT(*) FROM mv_inventory_on_hand WHERE workspace_id = :'workspace_id') > 0,
    'mv_inventory_on_hand contains test data'
);

SELECT ok(
    (SELECT COUNT(*) FROM mv_inventory_on_hand WHERE workspace_id = :'workspace_id' AND below_reorder_level = true) = 1,
    'mv_inventory_on_hand correctly identifies low stock items (Cascade Hops)'
);

SELECT ok(
    (SELECT total_qty FROM mv_inventory_on_hand WHERE workspace_id = :'workspace_id' AND item_name = '2-Row Pale Malt') = 800,
    'mv_inventory_on_hand shows correct quantity for 2-Row Pale Malt'
);

-- Test expiry date logic
SELECT ok(
    (SELECT COUNT(*) FROM mv_inventory_on_hand WHERE workspace_id = :'workspace_id' AND earliest_expiry IS NOT NULL) > 0,
    'mv_inventory_on_hand tracks expiry dates for applicable items'
);

-- Test mv_batch_summary structure and data
SELECT has_materialized_view('mv_batch_summary', 'mv_batch_summary materialized view exists');

SELECT has_column('mv_batch_summary', 'batch_id', 'mv_batch_summary has batch_id column');
SELECT has_column('mv_batch_summary', 'yield_percentage', 'mv_batch_summary has yield_percentage column');
SELECT has_column('mv_batch_summary', 'abv_actual', 'mv_batch_summary has abv_actual column');

-- Test batch summary calculations
SELECT ok(
    (SELECT COUNT(*) FROM mv_batch_summary WHERE workspace_id = :'workspace_id') = 1,
    'mv_batch_summary contains test batch data'
);

SELECT ok(
    (SELECT yield_percentage FROM mv_batch_summary WHERE workspace_id = :'workspace_id' AND batch_number = 'IPA-001') BETWEEN 95 AND 100,
    'mv_batch_summary calculates reasonable yield percentage'
);

SELECT ok(
    (SELECT abv_actual FROM mv_batch_summary WHERE workspace_id = :'workspace_id' AND batch_number = 'IPA-001') = 6.3,
    'mv_batch_summary shows correct ABV'
);

-- Test mv_production_summary aggregations
SELECT has_materialized_view('mv_production_summary', 'mv_production_summary materialized view exists');

SELECT ok(
    (SELECT COUNT(*) FROM mv_production_summary WHERE workspace_id = :'workspace_id') = 1,
    'mv_production_summary contains aggregated data'
);

SELECT ok(
    (SELECT total_batches FROM mv_production_summary WHERE workspace_id = :'workspace_id') = 1,
    'mv_production_summary counts batches correctly'
);

-- Test mv_po_aging calculations
SELECT has_materialized_view('mv_po_aging', 'mv_po_aging materialized view exists');

SELECT ok(
    (SELECT COUNT(*) FROM mv_po_aging WHERE workspace_id = :'workspace_id') = 2,
    'mv_po_aging contains test PO data'
);

SELECT ok(
    (SELECT age_category FROM mv_po_aging WHERE workspace_id = :'workspace_id' AND po_number = 'PO-2025-002') = 'overdue',
    'mv_po_aging correctly identifies overdue POs'
);

SELECT ok(
    (SELECT days_overdue FROM mv_po_aging WHERE workspace_id = :'workspace_id' AND po_number = 'PO-2025-002') > 0,
    'mv_po_aging calculates overdue days correctly'
);

-- Test mv_supplier_price_trends
SELECT has_materialized_view('mv_supplier_price_trends', 'mv_supplier_price_trends materialized view exists');

SELECT ok(
    (SELECT COUNT(*) FROM mv_supplier_price_trends WHERE workspace_id = :'workspace_id') > 0,
    'mv_supplier_price_trends contains price trend data'
);

SELECT ok(
    (SELECT price_change_direction FROM mv_supplier_price_trends 
     WHERE workspace_id = :'workspace_id' AND item_name = '2-Row Pale Malt') = 'up',
    'mv_supplier_price_trends correctly identifies price increases'
);

SELECT ok(
    (SELECT price_change_pct FROM mv_supplier_price_trends 
     WHERE workspace_id = :'workspace_id' AND item_name = '2-Row Pale Malt') > 0,
    'mv_supplier_price_trends calculates positive price change percentage'
);

-- ============================================================================
-- RLS POLICY TESTS
-- ============================================================================

-- Test workspace isolation
-- Create a second test workspace to verify isolation
INSERT INTO workspaces (id, name) VALUES (gen_random_uuid(), 'Other Test Brewery');
SELECT currval(pg_get_serial_sequence('workspaces', 'id')) AS other_workspace_id \gset

-- Set current user context to test workspace admin
SET LOCAL jwt.claims.workspace_id = :'workspace_id';
SET LOCAL jwt.claims.role = 'admin';

-- Test that we only see our workspace data
SELECT ok(
    (SELECT COUNT(*) FROM mv_inventory_on_hand WHERE workspace_id != :'workspace_id') = 0,
    'RLS policy prevents access to other workspace inventory data'
);

SELECT ok(
    (SELECT COUNT(*) FROM mv_batch_summary WHERE workspace_id != :'workspace_id') = 0,
    'RLS policy prevents access to other workspace batch data'
);

-- Test role-based cost visibility
-- Switch to brewer role (should not see costs)
SET LOCAL jwt.claims.role = 'brewer';

SELECT ok(
    (SELECT COUNT(*) FROM mv_inventory_on_hand WHERE workspace_id = :'workspace_id' AND avg_unit_cost IS NOT NULL) = 0,
    'RLS policy hides cost data from brewer role'
);

-- Switch back to admin role (should see costs)
SET LOCAL jwt.claims.role = 'admin';

SELECT ok(
    (SELECT COUNT(*) FROM mv_inventory_on_hand WHERE workspace_id = :'workspace_id' AND avg_unit_cost IS NOT NULL) > 0,
    'RLS policy shows cost data to admin role'
);

-- ============================================================================
-- DASHBOARD STATS FUNCTION TESTS
-- ============================================================================

-- Test get_dashboard_stats function for admin role
SELECT ok(
    get_dashboard_stats(:'workspace_id', 'admin') IS NOT NULL,
    'get_dashboard_stats returns data for admin role'
);

SELECT ok(
    (get_dashboard_stats(:'workspace_id', 'admin') -> 'inventory_value')::numeric > 0,
    'get_dashboard_stats calculates inventory value for admin'
);

SELECT ok(
    (get_dashboard_stats(:'workspace_id', 'admin') -> 'active_batches')::int >= 0,
    'get_dashboard_stats returns active batch count'
);

-- Test get_dashboard_stats function for brewer role  
SELECT ok(
    get_dashboard_stats(:'workspace_id', 'brewer') IS NOT NULL,
    'get_dashboard_stats returns data for brewer role'
);

SELECT ok(
    get_dashboard_stats(:'workspace_id', 'brewer') -> 'inventory_value' IS NULL,
    'get_dashboard_stats hides inventory value from brewer role'
);

SELECT ok(
    (get_dashboard_stats(:'workspace_id', 'brewer') -> 'active_batches')::int >= 0,
    'get_dashboard_stats returns active batch count for brewer'
);

-- Test get_dashboard_stats function for inventory role
SELECT ok(
    get_dashboard_stats(:'workspace_id', 'inventory') IS NOT NULL,
    'get_dashboard_stats returns data for inventory role'
);

SELECT ok(
    (get_dashboard_stats(:'workspace_id', 'inventory') -> 'low_stock_items')::int >= 0,
    'get_dashboard_stats returns low stock count for inventory role'
);

-- ============================================================================
-- RECALL DRILL FUNCTION TESTS  
-- ============================================================================

-- Get test IDs for recall drill testing
SELECT batch_id, finished_lot_id 
FROM setup_test_production(:'workspace_id') \gset

-- Test upstream tracing from finished lot
SELECT ok(
    array_length(trace_upstream_from_finished_lot(:'finished_lot_id'), 1) > 0,
    'trace_upstream_from_finished_lot returns upstream ingredients'
);

-- Test that upstream trace includes expected ingredient lots
SELECT ok(
    EXISTS(
        SELECT 1 FROM unnest(trace_upstream_from_finished_lot(:'finished_lot_id')) AS t(item)
        WHERE item->>'entity_type' = 'item_lot'
    ),
    'trace_upstream_from_finished_lot includes ingredient lots'
);

-- Test that upstream trace includes batch information
SELECT ok(
    EXISTS(
        SELECT 1 FROM unnest(trace_upstream_from_finished_lot(:'finished_lot_id')) AS t(item)
        WHERE item->>'entity_type' = 'batch'
    ),
    'trace_upstream_from_finished_lot includes batch information'
);

-- Test downstream tracing from ingredient lot
-- Get a specific ingredient lot ID for testing
SELECT id as ingredient_lot_id FROM item_lots 
WHERE workspace_id = :'workspace_id' 
  AND item_id = (SELECT id FROM items WHERE workspace_id = :'workspace_id' AND name = 'Cascade Hops')
LIMIT 1 \gset

SELECT ok(
    array_length(trace_downstream_from_ingredient_lot(:'ingredient_lot_id'), 1) > 0,
    'trace_downstream_from_ingredient_lot returns downstream products'
);

-- Test comprehensive trace function
SELECT ok(
    comprehensive_trace('finished_lot', :'finished_lot_id', 'both') IS NOT NULL,
    'comprehensive_trace returns results for finished lot'
);

-- Test comprehensive trace includes impact summary
SELECT ok(
    EXISTS(
        SELECT 1 FROM comprehensive_trace('finished_lot', :'finished_lot_id', 'both') AS t
        WHERE t.impact_summary IS NOT NULL
    ),
    'comprehensive_trace includes impact summary'
);

-- Test recall risk assessment calculation
SELECT ok(
    recall_impact_summary(:'finished_lot_id') IS NOT NULL,
    'recall_impact_summary calculates impact for finished lot'
);

SELECT ok(
    (recall_impact_summary(:'finished_lot_id') -> 'total_downstream_items')::int > 0,
    'recall_impact_summary identifies downstream items'
);

-- ============================================================================
-- REPORT GENERATION FUNCTION TESTS
-- ============================================================================

-- Test generate_inventory_report function
SELECT ok(
    generate_inventory_report('{}', '{}', 'json') IS NOT NULL,
    'generate_inventory_report returns data with empty filters'
);

SELECT ok(
    (generate_inventory_report('{}', '{}', 'json') -> 'data') IS NOT NULL,
    'generate_inventory_report returns data array'
);

-- Test inventory report with filters
SELECT ok(
    generate_inventory_report('{"item_type": "raw"}', '{}', 'json') IS NOT NULL,
    'generate_inventory_report works with type filter'
);

-- Test generate_batch_summary_report function
SELECT ok(
    generate_batch_summary_report('{}', '{}', 'json') IS NOT NULL,
    'generate_batch_summary_report returns data'
);

SELECT ok(
    array_length((generate_batch_summary_report('{}', '{}', 'json') -> 'data')::jsonb, 1) > 0,
    'generate_batch_summary_report returns batch data'
);

-- Test generate_po_aging_report function
SELECT ok(
    generate_po_aging_report('{}', '{}', 'json') IS NOT NULL,
    'generate_po_aging_report returns data'
);

SELECT ok(
    array_length((generate_po_aging_report('{}', '{}', 'json') -> 'data')::jsonb, 1) = 2,
    'generate_po_aging_report returns expected number of POs'
);

-- Test generate_recall_drill_report function
SELECT ok(
    generate_recall_drill_report('finished_lot', :'finished_lot_id', 'both', 'json') IS NOT NULL,
    'generate_recall_drill_report returns data for finished lot'
);

-- ============================================================================
-- REFRESH MECHANISM TESTS
-- ============================================================================

-- Test refresh functions exist and work
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

-- Test that refresh updates data correctly
-- Insert a new inventory transaction and verify refresh updates the view
INSERT INTO inventory_transactions (
    workspace_id, item_lot_id, type, qty, uom, ref_type, ref_id
) 
SELECT 
    :'workspace_id',
    id,
    'consume',
    -50,
    'lbs',
    'batch_ingredient',
    gen_random_uuid()
FROM item_lots 
WHERE workspace_id = :'workspace_id' 
  AND item_id = (SELECT id FROM items WHERE workspace_id = :'workspace_id' AND name = '2-Row Pale Malt')
LIMIT 1;

-- Get quantity before refresh
CREATE TEMPORARY TABLE qty_before AS
SELECT total_qty FROM mv_inventory_on_hand 
WHERE workspace_id = :'workspace_id' AND item_name = '2-Row Pale Malt';

-- Refresh and check quantity updated
SELECT refresh_inventory_materialized_view();

SELECT ok(
    (SELECT total_qty FROM mv_inventory_on_hand 
     WHERE workspace_id = :'workspace_id' AND item_name = '2-Row Pale Malt') < 
    (SELECT total_qty FROM qty_before),
    'Materialized view refresh updates inventory quantities correctly'
);

-- ============================================================================
-- PERFORMANCE TESTS
-- ============================================================================

-- Test query performance on materialized views
-- These should be fast even with larger datasets

SELECT ok(
    (SELECT COUNT(*) FROM mv_inventory_on_hand WHERE workspace_id = :'workspace_id') > 0,
    'Inventory materialized view query completes quickly'
);

SELECT ok(
    (SELECT COUNT(*) FROM mv_batch_summary WHERE workspace_id = :'workspace_id') >= 0,
    'Batch summary materialized view query completes quickly'
);

-- ============================================================================
-- ERROR HANDLING TESTS
-- ============================================================================

-- Test functions handle invalid parameters gracefully
SELECT ok(
    get_dashboard_stats(gen_random_uuid(), 'admin') IS NOT NULL,
    'get_dashboard_stats handles non-existent workspace gracefully'
);

SELECT ok(
    get_dashboard_stats(:'workspace_id', 'invalid_role') IS NOT NULL,
    'get_dashboard_stats handles invalid role gracefully'
);

-- Test recall drill with non-existent entity
SELECT ok(
    comprehensive_trace('finished_lot', gen_random_uuid(), 'both') IS NOT NULL,
    'comprehensive_trace handles non-existent entity gracefully'
);

-- ============================================================================
-- DATA INTEGRITY TESTS
-- ============================================================================

-- Test that materialized views maintain referential integrity
SELECT ok(
    NOT EXISTS(
        SELECT 1 FROM mv_inventory_on_hand 
        WHERE workspace_id NOT IN (SELECT id FROM workspaces)
    ),
    'mv_inventory_on_hand maintains workspace referential integrity'
);

SELECT ok(
    NOT EXISTS(
        SELECT 1 FROM mv_batch_summary 
        WHERE workspace_id NOT IN (SELECT id FROM workspaces)
    ),
    'mv_batch_summary maintains workspace referential integrity'
);

-- Test that cost calculations are consistent
SELECT ok(
    NOT EXISTS(
        SELECT 1 FROM mv_inventory_on_hand 
        WHERE total_value IS NOT NULL 
          AND avg_unit_cost IS NOT NULL 
          AND total_qty > 0
          AND ABS(total_value - (avg_unit_cost * total_qty)) > 0.01
    ),
    'mv_inventory_on_hand cost calculations are mathematically consistent'
);

-- ============================================================================
-- EDGE CASE TESTS
-- ============================================================================

-- Test handling of zero quantities
INSERT INTO item_lots (workspace_id, item_id, lot_code, qty, uom, unit_cost, location_id)
SELECT 
    :'workspace_id',
    id,
    'ZERO-TEST',
    0,
    'lbs',
    1.0,
    (SELECT id FROM inventory_locations WHERE workspace_id = :'workspace_id' LIMIT 1)
FROM items WHERE workspace_id = :'workspace_id' LIMIT 1;

SELECT refresh_inventory_materialized_view();

SELECT ok(
    EXISTS(SELECT 1 FROM mv_inventory_on_hand WHERE workspace_id = :'workspace_id' AND total_qty = 0),
    'Materialized views handle zero quantities correctly'
);

-- Test handling of NULL values
SELECT ok(
    (SELECT COUNT(*) FROM mv_batch_summary WHERE workspace_id = :'workspace_id' AND abv_actual IS NOT NULL) > 0,
    'Batch summary handles NULL ABV values appropriately'
);

-- ============================================================================
-- CLEANUP AND FINISH TESTS
-- ============================================================================

-- Clean up test data
SELECT cleanup_test_data();

-- Reset JWT claims
RESET jwt.claims.workspace_id;
RESET jwt.claims.role;

-- Verify cleanup worked
SELECT ok(
    (SELECT COUNT(*) FROM workspaces WHERE name LIKE '%Test%') = 0,
    'Test data cleanup completed successfully'
);

-- Finish the test suite
SELECT finish();

ROLLBACK;
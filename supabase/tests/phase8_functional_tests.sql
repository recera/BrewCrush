-- ============================================================================
-- Phase 8: Functional Testing of Reporting Features
-- Tests materialized views and functions using minimal test data
-- ============================================================================

BEGIN;

SELECT plan(25);

-- ============================================================================
-- TEST MATERIALIZED VIEW EXISTENCE
-- ============================================================================

SELECT has_materialized_view('mv_inventory_on_hand', 'mv_inventory_on_hand materialized view exists');
SELECT has_materialized_view('mv_batch_summary', 'mv_batch_summary materialized view exists');  
SELECT has_materialized_view('mv_production_summary', 'mv_production_summary materialized view exists');
SELECT has_materialized_view('mv_po_aging', 'mv_po_aging materialized view exists');
SELECT has_materialized_view('mv_supplier_price_trends', 'mv_supplier_price_trends materialized view exists');

-- ============================================================================
-- TEST MATERIALIZED VIEW STRUCTURE
-- ============================================================================

-- Test mv_inventory_on_hand has expected columns
SELECT has_column('mv_inventory_on_hand', 'workspace_id', 'mv_inventory_on_hand has workspace_id column');
SELECT has_column('mv_inventory_on_hand', 'item_name', 'mv_inventory_on_hand has item_name column');
SELECT has_column('mv_inventory_on_hand', 'total_qty', 'mv_inventory_on_hand has total_qty column');
SELECT has_column('mv_inventory_on_hand', 'total_value', 'mv_inventory_on_hand has total_value column');
SELECT has_column('mv_inventory_on_hand', 'below_reorder_level', 'mv_inventory_on_hand has below_reorder_level column');

-- Test mv_batch_summary has expected columns
SELECT has_column('mv_batch_summary', 'workspace_id', 'mv_batch_summary has workspace_id column');
SELECT has_column('mv_batch_summary', 'batch_number', 'mv_batch_summary has batch_number column');
SELECT has_column('mv_batch_summary', 'yield_percentage', 'mv_batch_summary has yield_percentage column');
SELECT has_column('mv_batch_summary', 'cost_per_liter', 'mv_batch_summary has cost_per_liter column');

-- Test mv_production_summary has expected columns
SELECT has_column('mv_production_summary', 'workspace_id', 'mv_production_summary has workspace_id column');
SELECT has_column('mv_production_summary', 'total_batches', 'mv_production_summary has total_batches column');
SELECT has_column('mv_production_summary', 'active_batches', 'mv_production_summary has active_batches column');

-- ============================================================================
-- TEST DASHBOARD STATS FUNCTION
-- ============================================================================

SELECT has_function('get_dashboard_stats', ARRAY['uuid', 'text'], 'get_dashboard_stats function exists with correct parameters');

-- Test function executes without error for different roles
SELECT ok(
    get_dashboard_stats('00000000-0000-0000-0000-000000000000'::uuid, 'admin') IS NOT NULL,
    'get_dashboard_stats executes for admin role'
);

SELECT ok(
    get_dashboard_stats('00000000-0000-0000-0000-000000000000'::uuid, 'brewer') IS NOT NULL,
    'get_dashboard_stats executes for brewer role'
);

SELECT ok(
    get_dashboard_stats('00000000-0000-0000-0000-000000000000'::uuid, 'inventory') IS NOT NULL,
    'get_dashboard_stats executes for inventory role'
);

-- ============================================================================
-- TEST REFRESH FUNCTIONS
-- ============================================================================

SELECT has_function('refresh_inventory_materialized_view', 'refresh_inventory_materialized_view function exists');
SELECT has_function('refresh_batch_materialized_view', 'refresh_batch_materialized_view function exists');
SELECT has_function('refresh_production_materialized_view', 'refresh_production_materialized_view function exists');

-- Test refresh functions execute successfully
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
-- TEST RECALL DRILL FUNCTIONS EXISTENCE
-- ============================================================================

SELECT has_function('trace_upstream_from_finished_lot', ARRAY['uuid'], 'trace_upstream_from_finished_lot function exists');
SELECT has_function('trace_downstream_from_ingredient_lot', ARRAY['uuid'], 'trace_downstream_from_ingredient_lot function exists');
SELECT has_function('comprehensive_trace', ARRAY['text', 'uuid', 'text'], 'comprehensive_trace function exists');

SELECT finish();

ROLLBACK;
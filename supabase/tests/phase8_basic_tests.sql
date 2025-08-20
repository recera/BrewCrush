-- ============================================================================
-- Phase 8 Basic Tests - Initial validation of core functionality
-- ============================================================================

BEGIN;

-- Enable pgTAP
CREATE EXTENSION IF NOT EXISTS pgtap;

-- Plan basic tests
SELECT plan(15);

-- ============================================================================
-- BASIC STRUCTURE TESTS
-- ============================================================================

-- Test that materialized views exist
SELECT has_materialized_view('mv_inventory_on_hand', 'mv_inventory_on_hand materialized view exists');
SELECT has_materialized_view('mv_batch_summary', 'mv_batch_summary materialized view exists');  
SELECT has_materialized_view('mv_production_summary', 'mv_production_summary materialized view exists');
SELECT has_materialized_view('mv_po_aging', 'mv_po_aging materialized view exists');
SELECT has_materialized_view('mv_supplier_price_trends', 'mv_supplier_price_trends materialized view exists');
SELECT has_materialized_view('mv_keg_deposit_summary', 'mv_keg_deposit_summary materialized view exists');

-- Test that key functions exist
SELECT has_function('get_dashboard_stats', ARRAY['uuid', 'text'], 'get_dashboard_stats function exists');
SELECT has_function('comprehensive_trace', ARRAY['text', 'uuid', 'text'], 'comprehensive_trace function exists');
SELECT has_function('generate_inventory_report', ARRAY['jsonb', 'jsonb', 'text'], 'generate_inventory_report function exists');

-- ============================================================================
-- BASIC FUNCTIONALITY TESTS
-- ============================================================================

-- Test materialized views have basic structure
SELECT has_column('mv_inventory_on_hand', 'workspace_id', 'mv_inventory_on_hand has workspace_id');
SELECT has_column('mv_batch_summary', 'workspace_id', 'mv_batch_summary has workspace_id');  
SELECT has_column('mv_production_summary', 'workspace_id', 'mv_production_summary has workspace_id');

-- Test that materialized views can be queried
SELECT lives_ok(
    $$SELECT COUNT(*) FROM mv_inventory_on_hand$$,
    'Can query mv_inventory_on_hand without errors'
);

SELECT lives_ok(
    $$SELECT COUNT(*) FROM mv_batch_summary$$,
    'Can query mv_batch_summary without errors'
);

SELECT lives_ok(
    $$SELECT COUNT(*) FROM mv_production_summary$$,
    'Can query mv_production_summary without errors'
);

-- Test basic function calls work
SELECT lives_ok(
    $$SELECT get_dashboard_stats('00000000-0000-0000-0000-000000000000'::uuid, 'admin')$$,
    'get_dashboard_stats function can be called'
);

-- Finish tests
SELECT finish();

ROLLBACK;
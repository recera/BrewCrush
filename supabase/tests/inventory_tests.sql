-- Phase 2 Inventory System Tests
-- Run with: supabase test db

BEGIN;

-- Load pgTAP
CREATE EXTENSION IF NOT EXISTS pgtap;

-- Set up test workspace and user
\set test_workspace_id '00000000-0000-0000-0000-000000000001'
\set test_user_id '00000000-0000-0000-0000-000000000002'
\set test_admin_id '00000000-0000-0000-0000-000000000003'
\set test_location_id '00000000-0000-0000-0000-000000000004'
\set test_item_id '00000000-0000-0000-0000-000000000005'
\set test_vendor_id '00000000-0000-0000-0000-000000000006'

-- Plan tests
SELECT plan(30);

-- =============================================================================
-- TEST SETUP
-- =============================================================================

-- Create test workspace
INSERT INTO workspaces (id, name, plan) 
VALUES (:test_workspace_id, 'Test Brewery', 'starter');

-- Create test users
INSERT INTO users (id, email, full_name)
VALUES 
  (:test_user_id, 'inventory@test.com', 'Inventory User'),
  (:test_admin_id, 'admin@test.com', 'Admin User');

-- Assign roles
INSERT INTO user_workspace_roles (user_id, workspace_id, role)
VALUES 
  (:test_user_id, :test_workspace_id, 'inventory'),
  (:test_admin_id, :test_workspace_id, 'admin');

-- Create test location
INSERT INTO inventory_locations (id, workspace_id, name, type)
VALUES (:test_location_id, :test_workspace_id, 'Main Warehouse', 'warehouse');

-- Create test vendor
INSERT INTO vendors (id, workspace_id, name)
VALUES (:test_vendor_id, :test_workspace_id, 'Test Supplier');

-- Create test item
INSERT INTO items (id, workspace_id, name, type, uom, reorder_level)
VALUES (:test_item_id, :test_workspace_id, 'Test Hops', 'raw', 'lb', 10);

-- =============================================================================
-- TEST: FIFO Lot Selection
-- =============================================================================

-- Create multiple lots with different FIFO indexes
INSERT INTO item_lots (workspace_id, item_id, lot_code, qty, uom, unit_cost, location_id, fifo_index, received_date)
VALUES 
  (:test_workspace_id, :test_item_id, 'LOT001', 50, 'lb', 10.00, :test_location_id, 1, '2024-01-01'),
  (:test_workspace_id, :test_item_id, 'LOT002', 30, 'lb', 12.00, :test_location_id, 2, '2024-01-02'),
  (:test_workspace_id, :test_item_id, 'LOT003', 20, 'lb', 11.00, :test_location_id, 3, '2024-01-03');

-- Test FIFO lot selection
SELECT results_eq(
  $$SELECT lot_code FROM get_fifo_lots($1::uuid, $2::uuid, $3::uuid) LIMIT 1$$,
  $$SELECT 'LOT001'::text$$,
  'FIFO should select LOT001 first'
) FROM (VALUES (:test_workspace_id, :test_item_id, :test_location_id)) AS t;

-- =============================================================================
-- TEST: Inventory Adjustment - Positive
-- =============================================================================

-- Set JWT for inventory user
SELECT set_config('request.jwt.claims', 
  json_build_object(
    'sub', :test_user_id::text,
    'workspace_id', :test_workspace_id::text,
    'role', 'inventory'
  )::text, true);

-- Test positive adjustment
SELECT lives_ok(
  $$SELECT inventory_adjust(
    $1::uuid, 25::decimal, 'lb'::text, $2::uuid, 
    'Found inventory'::text, 'Test positive adjustment'::text
  )$$,
  'Positive inventory adjustment should succeed'
) FROM (VALUES (:test_item_id, :test_location_id)) AS t;

-- Verify transaction was created
SELECT ok(
  EXISTS(
    SELECT 1 FROM inventory_transactions 
    WHERE item_id = :test_item_id 
    AND type = 'adjust' 
    AND qty = 25
  ),
  'Positive adjustment transaction should be created'
);

-- =============================================================================
-- TEST: Inventory Adjustment - Negative
-- =============================================================================

-- Test negative adjustment
SELECT lives_ok(
  $$SELECT inventory_adjust(
    $1::uuid, -5::decimal, 'lb'::text, $2::uuid, 
    'Damaged'::text, 'Test negative adjustment'::text
  )$$,
  'Negative inventory adjustment should succeed'
) FROM (VALUES (:test_item_id, :test_location_id)) AS t;

-- Verify transaction was created
SELECT ok(
  EXISTS(
    SELECT 1 FROM inventory_transactions 
    WHERE item_id = :test_item_id 
    AND type = 'adjust' 
    AND qty = -5
  ),
  'Negative adjustment transaction should be created'
);

-- =============================================================================
-- TEST: Inventory Transfer
-- =============================================================================

-- Create second location
INSERT INTO inventory_locations (workspace_id, name, type)
VALUES (:test_workspace_id, 'Secondary Storage', 'warehouse')
RETURNING id AS second_location_id \gset

-- Get a lot to transfer
SELECT id AS lot_to_transfer FROM item_lots 
WHERE item_id = :test_item_id 
AND qty > 0 
LIMIT 1 \gset

-- Test inventory transfer
SELECT lives_ok(
  $$SELECT inventory_transfer(
    $1::uuid, 10::decimal, $2::uuid, $3::uuid, 
    'Test transfer'::text
  )$$,
  'Inventory transfer should succeed'
) FROM (VALUES (:lot_to_transfer, :test_location_id, :'second_location_id')) AS t;

-- Verify transfer transaction
SELECT ok(
  EXISTS(
    SELECT 1 FROM inventory_transactions 
    WHERE item_id = :test_item_id 
    AND type = 'transfer'
    AND from_location_id = :test_location_id
    AND to_location_id = :'second_location_id'
  ),
  'Transfer transaction should be created'
);

-- =============================================================================
-- TEST: FIFO Consumption
-- =============================================================================

-- Test FIFO consumption
SELECT ok(
  (SELECT COUNT(*) FROM consume_inventory_fifo(
    :test_item_id, 60::decimal, 'lb'::text, :test_location_id,
    'production'::text, gen_random_uuid()
  )) >= 1,
  'FIFO consumption should return consumed lots'
);

-- Verify LOT001 was consumed first
SELECT ok(
  (SELECT qty FROM item_lots WHERE lot_code = 'LOT001') < 50,
  'LOT001 should be consumed first per FIFO'
);

-- =============================================================================
-- TEST: PO Receipt Processing
-- =============================================================================

-- Create a purchase order
INSERT INTO purchase_orders (workspace_id, po_number, vendor_id, status)
VALUES (:test_workspace_id, 'PO-001', :test_vendor_id, 'approved')
RETURNING id AS test_po_id \gset

-- Create PO line
INSERT INTO po_lines (workspace_id, po_id, item_id, qty, uom, expected_unit_cost, location_id)
VALUES (:test_workspace_id, :test_po_id, :test_item_id, 100, 'lb', 15.00, :test_location_id)
RETURNING id AS test_po_line_id \gset

-- Create PO receipt
INSERT INTO po_receipts (workspace_id, po_id, receipt_number, received_by)
VALUES (:test_workspace_id, :test_po_id, 'REC-001', :test_user_id)
RETURNING id AS test_receipt_id \gset

-- Test receipt line creation (trigger should fire)
INSERT INTO po_receipt_lines (
  workspace_id, po_receipt_id, po_line_id, 
  qty_received, unit_cost, lot_code, location_id, created_by
)
VALUES (
  :test_workspace_id, :test_receipt_id, :test_po_line_id,
  50, 15.00, 'REC-LOT-001', :test_location_id, :test_user_id
);

-- Verify lot was created
SELECT ok(
  EXISTS(
    SELECT 1 FROM item_lots 
    WHERE lot_code = 'REC-LOT-001'
    AND item_id = :test_item_id
    AND qty = 50
  ),
  'Receipt should create item lot'
);

-- Verify inventory transaction was created
SELECT ok(
  EXISTS(
    SELECT 1 FROM inventory_transactions 
    WHERE item_id = :test_item_id 
    AND type = 'receive'
    AND qty = 50
  ),
  'Receipt should create inventory transaction'
);

-- Verify supplier price history was updated
SELECT ok(
  EXISTS(
    SELECT 1 FROM supplier_price_history 
    WHERE item_id = :test_item_id 
    AND vendor_id = :test_vendor_id
    AND unit_cost = 15.00
  ),
  'Receipt should update supplier price history'
);

-- =============================================================================
-- TEST: Materialized Views
-- =============================================================================

-- Refresh materialized views
SELECT refresh_inventory_views();

-- Test inventory on-hand view
SELECT ok(
  EXISTS(
    SELECT 1 FROM inventory_on_hand_by_item_location
    WHERE item_id = :test_item_id
    AND workspace_id = :test_workspace_id
  ),
  'Inventory on-hand view should contain test item'
);

-- Test inventory value view
SELECT ok(
  EXISTS(
    SELECT 1 FROM inventory_value
    WHERE workspace_id = :test_workspace_id
    AND item_type = 'raw'
  ),
  'Inventory value view should contain workspace data'
);

-- =============================================================================
-- TEST: Get Inventory Value Function
-- =============================================================================

-- Test actual cost method
SELECT ok(
  (SELECT COUNT(*) FROM get_inventory_value(:test_workspace_id, 'actual')) > 0,
  'Get inventory value with actual method should return results'
);

-- Test latest cost method
SELECT ok(
  (SELECT COUNT(*) FROM get_inventory_value(:test_workspace_id, 'latest')) > 0,
  'Get inventory value with latest method should return results'
);

-- =============================================================================
-- TEST: Permission Checks
-- =============================================================================

-- Set JWT for non-inventory user (brewer role)
SELECT set_config('request.jwt.claims', 
  json_build_object(
    'sub', gen_random_uuid()::text,
    'workspace_id', :test_workspace_id::text,
    'role', 'brewer'
  )::text, true);

-- Create brewer user and assign role
INSERT INTO users (id, email, full_name)
VALUES ('00000000-0000-0000-0000-000000000007', 'brewer@test.com', 'Brewer User');

INSERT INTO user_workspace_roles (user_id, workspace_id, role)
VALUES ('00000000-0000-0000-0000-000000000007', :test_workspace_id, 'brewer');

SELECT set_config('request.jwt.claims', 
  json_build_object(
    'sub', '00000000-0000-0000-0000-000000000007'::text,
    'workspace_id', :test_workspace_id::text,
    'role', 'brewer'
  )::text, true);

-- Test that brewer cannot adjust inventory
SELECT throws_ok(
  $$SELECT inventory_adjust(
    $1::uuid, 10::decimal, 'lb'::text, $2::uuid, 
    'Test'::text, null::text
  )$$,
  'P0001',
  'Insufficient permissions for inventory adjustment',
  'Brewer should not be able to adjust inventory'
) FROM (VALUES (:test_item_id, :test_location_id)) AS t;

-- =============================================================================
-- TEST: Negative Inventory Prevention
-- =============================================================================

-- Set JWT back to inventory user
SELECT set_config('request.jwt.claims', 
  json_build_object(
    'sub', :test_user_id::text,
    'workspace_id', :test_workspace_id::text,
    'role', 'inventory'
  )::text, true);

-- Try to consume more than available (should fail for non-admin)
SELECT throws_ok(
  $$SELECT consume_inventory_fifo(
    $1::uuid, 10000::decimal, 'lb'::text, $2::uuid,
    'test'::text, gen_random_uuid()
  )$$,
  'P0001',
  '%Insufficient inventory%',
  'Should not allow consuming more than available inventory'
) FROM (VALUES (:test_item_id, :test_location_id)) AS t;

-- =============================================================================
-- TEST: Audit Log Creation
-- =============================================================================

-- Check that audit logs were created for adjustments
SELECT ok(
  EXISTS(
    SELECT 1 FROM audit_logs 
    WHERE entity_table = 'inventory_transactions'
    AND action = 'command'
    AND after->>'command' = 'inventory_adjust'
  ),
  'Audit log should be created for inventory adjustments'
);

-- Check that audit logs were created for transfers
SELECT ok(
  EXISTS(
    SELECT 1 FROM audit_logs 
    WHERE entity_table = 'inventory_transactions'
    AND action = 'command'
    AND after->>'command' = 'inventory_transfer'
  ),
  'Audit log should be created for inventory transfers'
);

-- =============================================================================
-- TEST: Low Stock Detection
-- =============================================================================

-- Update item quantity to be below reorder level
UPDATE item_lots 
SET qty = 2 
WHERE item_id = :test_item_id 
AND lot_code = 'LOT002';

-- Refresh views
SELECT refresh_inventory_views();

-- Check if low stock is detected (reorder level is 10)
SELECT ok(
  (SELECT SUM(qty_on_hand) FROM inventory_on_hand_by_item_location 
   WHERE item_id = :test_item_id) < 10,
  'Item should be below reorder level'
);

-- =============================================================================
-- CLEANUP (commented out for review, uncomment to clean)
-- =============================================================================

-- DELETE FROM po_receipt_lines WHERE workspace_id = :test_workspace_id;
-- DELETE FROM po_receipts WHERE workspace_id = :test_workspace_id;
-- DELETE FROM po_lines WHERE workspace_id = :test_workspace_id;
-- DELETE FROM purchase_orders WHERE workspace_id = :test_workspace_id;
-- DELETE FROM inventory_transactions WHERE workspace_id = :test_workspace_id;
-- DELETE FROM item_lots WHERE workspace_id = :test_workspace_id;
-- DELETE FROM items WHERE workspace_id = :test_workspace_id;
-- DELETE FROM vendors WHERE workspace_id = :test_workspace_id;
-- DELETE FROM inventory_locations WHERE workspace_id = :test_workspace_id;
-- DELETE FROM user_workspace_roles WHERE workspace_id = :test_workspace_id;
-- DELETE FROM users WHERE id IN (:test_user_id, :test_admin_id, '00000000-0000-0000-0000-000000000007');
-- DELETE FROM workspaces WHERE id = :test_workspace_id;

-- Finish tests
SELECT * FROM finish();

ROLLBACK;
-- ============================================================================
-- COMPREHENSIVE PURCHASE ORDER INTEGRATION TESTS
-- Tests the complete PO lifecycle with production scenarios
-- ============================================================================

BEGIN;

-- Set up test environment
SELECT plan(50); -- We'll run 50 tests

-- ============================================================================
-- TEST SETUP: Create test workspace and users
-- ============================================================================

-- Create test workspace
INSERT INTO workspaces (id, name, plan) 
VALUES ('test-ws-001', 'Test Brewery', 'trial');

-- Create test users with different roles
INSERT INTO auth.users (id, email) VALUES
  ('admin-user', 'admin@test.com'),
  ('inventory-user', 'inventory@test.com'),
  ('accounting-user', 'accounting@test.com'),
  ('brewer-user', 'brewer@test.com');

INSERT INTO users (id, email, full_name) VALUES
  ('admin-user', 'admin@test.com', 'Admin User'),
  ('inventory-user', 'inventory@test.com', 'Inventory User'),
  ('accounting-user', 'accounting@test.com', 'Accounting User'),
  ('brewer-user', 'brewer@test.com', 'Brewer User');

INSERT INTO user_workspace_roles (user_id, workspace_id, role) VALUES
  ('admin-user', 'test-ws-001', 'admin'),
  ('inventory-user', 'test-ws-001', 'inventory'),
  ('accounting-user', 'test-ws-001', 'accounting'),
  ('brewer-user', 'test-ws-001', 'brewer');

-- Create test vendor
INSERT INTO vendors (id, workspace_id, name, email, terms)
VALUES ('vendor-001', 'test-ws-001', 'Test Vendor', 'vendor@test.com', 'Net 30');

-- Create test location
INSERT INTO inventory_locations (id, workspace_id, name, type)
VALUES ('loc-001', 'test-ws-001', 'Main Warehouse', 'warehouse');

-- Create test items
INSERT INTO items (id, workspace_id, name, type, uom, reorder_level, vendor_id)
VALUES 
  ('item-001', 'test-ws-001', '2-Row Malt', 'raw', 'lb', 500, 'vendor-001'),
  ('item-002', 'test-ws-001', 'Cascade Hops', 'raw', 'oz', 50, 'vendor-001'),
  ('item-003', 'test-ws-001', 'Yeast US-05', 'raw', 'pack', 10, 'vendor-001');

-- ============================================================================
-- TEST 1: PO Creation with Proper Validation
-- ============================================================================

-- Set context as inventory user
SET LOCAL jwt.claims.sub = 'inventory-user';
SET LOCAL jwt.claims.workspace_id = 'test-ws-001';
SET LOCAL jwt.claims.role = 'inventory';

-- Test 1.1: Create PO successfully
SELECT lives_ok(
  $$
    SELECT create_purchase_order(
      'vendor-001'::uuid,
      '2025-02-01'::date,
      'Net 30',
      'Test PO',
      jsonb_build_array(
        jsonb_build_object(
          'item_id', 'item-001',
          'qty', 1000,
          'uom', 'lb',
          'expected_unit_cost', 0.65,
          'line_number', 1
        ),
        jsonb_build_object(
          'item_id', 'item-002',
          'qty', 16,
          'uom', 'oz',
          'expected_unit_cost', 1.25,
          'line_number', 2
        )
      )
    )
  $$,
  'Inventory user can create PO'
);

-- Get the created PO ID for further tests
CREATE TEMP TABLE test_po AS
SELECT id, po_number, status, total 
FROM purchase_orders 
WHERE workspace_id = 'test-ws-001'
ORDER BY created_at DESC
LIMIT 1;

-- Test 1.2: Verify PO created with correct status
SELECT is(
  (SELECT status FROM test_po),
  'draft',
  'New PO has draft status'
);

-- Test 1.3: Verify total calculation
SELECT is(
  (SELECT total FROM test_po),
  670.00::numeric,
  'PO total calculated correctly (1000*0.65 + 16*1.25)'
);

-- Test 1.4: Verify line items created
SELECT is(
  (SELECT COUNT(*) FROM po_lines WHERE po_id = (SELECT id FROM test_po)),
  2::bigint,
  'Two line items created'
);

-- ============================================================================
-- TEST 2: RLS Policy Enforcement
-- ============================================================================

-- Test 2.1: Brewer cannot see costs
SET LOCAL jwt.claims.sub = 'brewer-user';
SET LOCAL jwt.claims.role = 'brewer';

SELECT is(
  (SELECT expected_unit_cost FROM v_po_lines_secure WHERE po_id = (SELECT id FROM test_po) LIMIT 1),
  NULL::numeric,
  'Brewer cannot see unit costs in secure view'
);

-- Test 2.2: Brewer cannot create PO
SELECT throws_ok(
  $$
    INSERT INTO purchase_orders (workspace_id, vendor_id, status)
    VALUES ('test-ws-001', 'vendor-001', 'draft')
  $$,
  'new row violates row-level security policy for table "purchase_orders"',
  'Brewer cannot create PO (RLS blocks)'
);

-- Test 2.3: Different workspace cannot see PO
SET LOCAL jwt.claims.workspace_id = 'different-workspace';
SELECT is(
  (SELECT COUNT(*) FROM purchase_orders WHERE id = (SELECT id FROM test_po)),
  0::bigint,
  'Different workspace cannot see PO'
);

-- Reset to correct workspace
SET LOCAL jwt.claims.workspace_id = 'test-ws-001';

-- ============================================================================
-- TEST 3: PO Approval Workflow
-- ============================================================================

-- Test 3.1: Inventory user cannot approve
SET LOCAL jwt.claims.sub = 'inventory-user';
SET LOCAL jwt.claims.role = 'inventory';

SELECT throws_ok(
  $$
    SELECT approve_purchase_order((SELECT id FROM test_po))
  $$,
  'Insufficient permissions to approve purchase orders',
  'Inventory user cannot approve PO'
);

-- Test 3.2: Accounting user can approve
SET LOCAL jwt.claims.sub = 'accounting-user';
SET LOCAL jwt.claims.role = 'accounting';

SELECT lives_ok(
  $$
    SELECT approve_purchase_order((SELECT id FROM test_po))
  $$,
  'Accounting user can approve PO'
);

-- Test 3.3: Verify approval updated status
SELECT is(
  (SELECT status FROM purchase_orders WHERE id = (SELECT id FROM test_po)),
  'approved',
  'PO status changed to approved'
);

-- Test 3.4: Verify approved_by is set
SELECT is(
  (SELECT approved_by FROM purchase_orders WHERE id = (SELECT id FROM test_po)),
  'accounting-user'::uuid,
  'Approved_by field set correctly'
);

-- ============================================================================
-- TEST 4: PO Receiving with Variance Detection
-- ============================================================================

-- Test 4.1: Create partial receipt
SET LOCAL jwt.claims.sub = 'inventory-user';
SET LOCAL jwt.claims.role = 'inventory';

SELECT lives_ok(
  $$
    SELECT receive_purchase_order(
      (SELECT id FROM test_po),
      jsonb_build_array(
        jsonb_build_object(
          'po_line_id', (SELECT id FROM po_lines WHERE po_id = (SELECT id FROM test_po) AND line_number = 1),
          'qty_received', 500,
          'unit_cost', 0.65,
          'lot_code', 'LOT-2025-001',
          'expiry', '2025-12-31',
          'location_id', 'loc-001'
        )
      ),
      'Partial receipt - first delivery'
    )
  $$,
  'Can create partial receipt'
);

-- Test 4.2: Verify PO status changed to partial
SELECT is(
  (SELECT status FROM purchase_orders WHERE id = (SELECT id FROM test_po)),
  'partial',
  'PO status changed to partial after partial receipt'
);

-- Test 4.3: Verify qty_received updated
SELECT is(
  (SELECT qty_received FROM po_lines WHERE po_id = (SELECT id FROM test_po) AND line_number = 1),
  500::numeric,
  'Quantity received updated on PO line'
);

-- Test 4.4: Verify item lot created
SELECT is(
  (SELECT COUNT(*) FROM item_lots WHERE lot_code = 'LOT-2025-001'),
  1::bigint,
  'Item lot created from receipt'
);

-- Test 4.5: Verify inventory transaction created
SELECT is(
  (SELECT COUNT(*) FROM inventory_transactions WHERE ref_type = 'po_receipt' AND type = 'receive'),
  1::bigint,
  'Inventory transaction created for receipt'
);

-- Test 4.6: Test over-receipt without override
SELECT throws_ok(
  $$
    SELECT receive_purchase_order(
      (SELECT id FROM test_po),
      jsonb_build_array(
        jsonb_build_object(
          'po_line_id', (SELECT id FROM po_lines WHERE po_id = (SELECT id FROM test_po) AND line_number = 1),
          'qty_received', 600,  -- This would exceed ordered qty
          'unit_cost', 0.65,
          'lot_code', 'LOT-2025-002',
          'expiry', '2025-12-31',
          'location_id', 'loc-001'
        )
      ),
      'Over-receipt test'
    )
  $$,
  'Over-receipt requires override reason',
  'Cannot over-receive without override reason'
);

-- Test 4.7: Test over-receipt with override
SELECT lives_ok(
  $$
    SELECT receive_purchase_order(
      (SELECT id FROM test_po),
      jsonb_build_array(
        jsonb_build_object(
          'po_line_id', (SELECT id FROM po_lines WHERE po_id = (SELECT id FROM test_po) AND line_number = 1),
          'qty_received', 600,
          'unit_cost', 0.65,
          'lot_code', 'LOT-2025-002',
          'expiry', '2025-12-31',
          'location_id', 'loc-001',
          'override_reason', 'Vendor sent extra as goodwill'
        )
      ),
      'Over-receipt with override'
    )
  $$,
  'Can over-receive with override reason'
);

-- ============================================================================
-- TEST 5: Supplier Price History
-- ============================================================================

-- Test 5.1: Verify price history created
SELECT is(
  (SELECT COUNT(*) FROM supplier_price_history WHERE item_id = 'item-001'),
  2::bigint,
  'Supplier price history records created from receipts'
);

-- Test 5.2: Test price variance detection
SELECT lives_ok(
  $$
    SELECT receive_purchase_order(
      (SELECT id FROM test_po),
      jsonb_build_array(
        jsonb_build_object(
          'po_line_id', (SELECT id FROM po_lines WHERE po_id = (SELECT id FROM test_po) AND line_number = 2),
          'qty_received', 16,
          'unit_cost', 1.50,  -- Higher than expected 1.25
          'lot_code', 'LOT-HOPS-001',
          'location_id', 'loc-001',
          'override_reason', 'Market price increase'
        )
      ),
      'Receipt with price variance'
    )
  $$,
  'Can receive with price variance when override provided'
);

-- ============================================================================
-- TEST 6: Edit PO (Draft Only)
-- ============================================================================

-- Create a new draft PO for editing tests
INSERT INTO purchase_orders (id, workspace_id, vendor_id, status, po_number)
VALUES ('po-edit-test', 'test-ws-001', 'vendor-001', 'draft', 'PO-EDIT-001');

INSERT INTO po_lines (workspace_id, po_id, item_id, qty, uom, expected_unit_cost, line_number)
VALUES ('test-ws-001', 'po-edit-test', 'item-001', 100, 'lb', 0.60, 1);

-- Test 6.1: Edit draft PO
SELECT lives_ok(
  $$
    SELECT edit_purchase_order(
      'po-edit-test'::uuid,
      '2025-02-15'::date,
      'Net 45',
      'Updated notes',
      jsonb_build_array(
        jsonb_build_object(
          'item_id', 'item-001',
          'qty', 200,
          'uom', 'lb',
          'expected_unit_cost', 0.62,
          'line_number', 1
        ),
        jsonb_build_object(
          'item_id', 'item-003',
          'qty', 5,
          'uom', 'pack',
          'expected_unit_cost', 8.50,
          'line_number', 2
        )
      )
    )
  $$,
  'Can edit draft PO'
);

-- Test 6.2: Verify changes applied
SELECT is(
  (SELECT due_date::text FROM purchase_orders WHERE id = 'po-edit-test'),
  '2025-02-15',
  'Due date updated on edited PO'
);

SELECT is(
  (SELECT COUNT(*) FROM po_lines WHERE po_id = 'po-edit-test'),
  2::bigint,
  'Line items updated on edited PO'
);

-- Test 6.3: Cannot edit approved PO (without admin)
UPDATE purchase_orders SET status = 'approved' WHERE id = 'po-edit-test';

SELECT throws_ok(
  $$
    SELECT edit_purchase_order(
      'po-edit-test'::uuid,
      '2025-02-20'::date,
      NULL,
      'Try to edit approved',
      NULL
    )
  $$,
  'Only draft POs can be edited',
  'Cannot edit approved PO without admin role'
);

-- ============================================================================
-- TEST 7: Cancel PO
-- ============================================================================

-- Create a PO for cancellation test
INSERT INTO purchase_orders (id, workspace_id, vendor_id, status, po_number)
VALUES ('po-cancel-test', 'test-ws-001', 'vendor-001', 'approved', 'PO-CANCEL-001');

-- Test 7.1: Cancel PO successfully
SELECT lives_ok(
  $$
    SELECT cancel_purchase_order(
      'po-cancel-test'::uuid,
      'Vendor discontinued product line'
    )
  $$,
  'Can cancel approved PO'
);

-- Test 7.2: Verify status changed
SELECT is(
  (SELECT status FROM purchase_orders WHERE id = 'po-cancel-test'),
  'cancelled',
  'PO status changed to cancelled'
);

-- Test 7.3: Cannot cancel PO with receipts
INSERT INTO po_receipts (workspace_id, po_id, received_by)
VALUES ('test-ws-001', (SELECT id FROM test_po), 'inventory-user');

SELECT throws_ok(
  $$
    SELECT cancel_purchase_order(
      (SELECT id FROM test_po)::uuid,
      'Try to cancel with receipts'
    )
  $$,
  'Cannot cancel PO with receipts',
  'Cannot cancel PO that has receipts'
);

-- ============================================================================
-- TEST 8: Reorder Suggestions with In-Transit
-- ============================================================================

-- Set up low stock scenario
INSERT INTO item_lots (workspace_id, item_id, lot_code, qty, uom, location_id)
VALUES ('test-ws-001', 'item-003', 'YEAST-LOW', 5, 'pack', 'loc-001');

-- Create an in-transit PO
INSERT INTO purchase_orders (id, workspace_id, vendor_id, status, po_number)
VALUES ('po-transit', 'test-ws-001', 'vendor-001', 'approved', 'PO-TRANSIT-001');

INSERT INTO po_lines (workspace_id, po_id, item_id, qty, uom, expected_unit_cost, line_number, qty_received)
VALUES ('test-ws-001', 'po-transit', 'item-003', 10, 'pack', 8.00, 1, 0);

-- Test 8.1: Reorder suggestions include in-transit
SELECT is(
  (SELECT in_transit FROM get_low_stock_reorder_suggestions('test-ws-001') WHERE item_id = 'item-003'),
  10::numeric,
  'Reorder suggestions show in-transit quantity'
);

SELECT is(
  (SELECT available_stock FROM get_low_stock_reorder_suggestions('test-ws-001') WHERE item_id = 'item-003'),
  15::numeric,
  'Available stock includes current + in-transit'
);

-- ============================================================================
-- TEST 9: Duplicate PO Number Prevention
-- ============================================================================

-- Test 9.1: Cannot create duplicate PO number
SELECT throws_ok(
  $$
    INSERT INTO purchase_orders (workspace_id, vendor_id, status, po_number)
    VALUES ('test-ws-001', 'vendor-001', 'draft', (SELECT po_number FROM test_po))
  $$,
  'duplicate key value violates unique constraint "unique_po_number_per_workspace"',
  'Cannot create duplicate PO number in same workspace'
);

-- Test 9.2: Can use same PO number in different workspace
INSERT INTO workspaces (id, name, plan) VALUES ('test-ws-002', 'Other Brewery', 'trial');

SELECT lives_ok(
  $$
    INSERT INTO purchase_orders (workspace_id, vendor_id, status, po_number)
    VALUES ('test-ws-002', 'vendor-001', 'draft', (SELECT po_number FROM test_po))
  $$,
  'Can use same PO number in different workspace'
);

-- ============================================================================
-- TEST 10: Audit Trail
-- ============================================================================

-- Test 10.1: Verify audit log entries created
SELECT cmp_ok(
  (SELECT COUNT(*) FROM audit_logs WHERE entity_table = 'purchase_orders'),
  '>=',
  3::bigint,
  'Audit logs created for PO operations'
);

-- Test 10.2: Verify audit log has correct action
SELECT is(
  (SELECT action FROM audit_logs WHERE entity_table = 'purchase_orders' AND entity_id = 'po-cancel-test' ORDER BY created_at DESC LIMIT 1),
  'cancel',
  'Cancel action recorded in audit log'
);

-- ============================================================================
-- TEST 11: CSV Export Data Integrity
-- ============================================================================

-- Test that the data structure is correct for CSV export
SELECT is(
  (SELECT COUNT(*) 
   FROM purchase_orders po
   JOIN vendors v ON v.id = po.vendor_id
   JOIN po_lines pl ON pl.po_id = po.id
   JOIN items i ON i.id = pl.item_id
   WHERE po.workspace_id = 'test-ws-001'),
  7::bigint,
  'All PO data properly joined for CSV export'
);

-- ============================================================================
-- TEST 12: Performance Indexes
-- ============================================================================

-- Test that critical indexes exist
SELECT has_index('purchase_orders', 'idx_purchase_orders_status_date', 'Performance index on status/date exists');
SELECT has_index('po_lines', 'idx_po_lines_po_item', 'Performance index on po/item exists');
SELECT has_index('supplier_price_history', 'idx_supplier_price_history_item_date', 'Performance index on price history exists');

-- ============================================================================
-- CLEANUP
-- ============================================================================

-- Rollback all test data
ROLLBACK;
-- Phase 3: Purchasing & Receiving Tests
-- Tests for PO lifecycle, approval workflow, receiving with variance, and reorder suggestions

BEGIN;
SELECT plan(40);

-- ============================================================================
-- TEST SETUP
-- ============================================================================

-- Create test workspace and users
INSERT INTO workspaces (id, name, plan) 
VALUES ('test-ws-po', 'Test Brewery PO', 'trial');

INSERT INTO users (id, email, full_name)
VALUES 
  ('test-admin-po', 'admin@test.com', 'Admin User'),
  ('test-inv-po', 'inventory@test.com', 'Inventory User'),
  ('test-acc-po', 'accounting@test.com', 'Accounting User');

INSERT INTO user_workspace_roles (user_id, workspace_id, role)
VALUES 
  ('test-admin-po', 'test-ws-po', 'admin'),
  ('test-inv-po', 'test-ws-po', 'inventory'),
  ('test-acc-po', 'test-ws-po', 'accounting');

-- Create test vendor
INSERT INTO vendors (id, workspace_id, name, email, terms)
VALUES ('test-vendor-1', 'test-ws-po', 'Test Supplier Co', 'supplier@test.com', 'Net 30');

-- Create test location
INSERT INTO inventory_locations (id, workspace_id, name, is_default)
VALUES ('test-loc-1', 'test-ws-po', 'Main Warehouse', true);

-- Create test items
INSERT INTO items (id, workspace_id, name, type, uom, reorder_level, reorder_qty, vendor_id)
VALUES 
  ('test-item-1', 'test-ws-po', 'Test Hops', 'raw', 'lb', 10, 50, 'test-vendor-1'),
  ('test-item-2', 'test-ws-po', 'Test Malt', 'raw', 'lb', 100, 500, 'test-vendor-1');

-- ============================================================================
-- PO NUMBER GENERATION TESTS
-- ============================================================================

SELECT is(
  generate_po_number('test-ws-po'::uuid),
  'PO-' || TO_CHAR(NOW(), 'YYYY') || '-00001',
  'Should generate first PO number of the year'
);

-- Test collision handling
INSERT INTO purchase_orders (workspace_id, po_number, vendor_id, status)
VALUES ('test-ws-po', 'PO-' || TO_CHAR(NOW(), 'YYYY') || '-00002', 'test-vendor-1', 'draft');

SELECT is(
  generate_po_number('test-ws-po'::uuid),
  'PO-' || TO_CHAR(NOW(), 'YYYY') || '-00003',
  'Should skip existing PO numbers'
);

-- ============================================================================
-- CREATE PURCHASE ORDER TESTS
-- ============================================================================

-- Set JWT to inventory user
SELECT set_config('request.jwt.claims', 
  jsonb_build_object(
    'sub', 'test-inv-po',
    'workspace_id', 'test-ws-po',
    'role', 'authenticated'
  )::text, true);

-- Test creating PO with lines
DO $$
DECLARE
  v_po_id uuid;
  v_lines jsonb;
BEGIN
  v_lines := jsonb_build_array(
    jsonb_build_object(
      'item_id', 'test-item-1',
      'qty', 25,
      'uom', 'lb',
      'expected_unit_cost', 5.50,
      'location_id', 'test-loc-1'
    ),
    jsonb_build_object(
      'item_id', 'test-item-2',
      'qty', 250,
      'uom', 'lb',
      'expected_unit_cost', 2.25,
      'location_id', 'test-loc-1'
    )
  );
  
  v_po_id := create_purchase_order(
    'test-vendor-1'::uuid,
    CURRENT_DATE + INTERVAL '7 days',
    'Net 30',
    'Test PO',
    v_lines
  );
  
  -- Store for later tests
  UPDATE purchase_orders SET id = 'test-po-1' WHERE id = v_po_id;
END $$;

SELECT is(
  (SELECT COUNT(*) FROM purchase_orders WHERE workspace_id = 'test-ws-po' AND id = 'test-po-1'),
  1::bigint,
  'Should create purchase order'
);

SELECT is(
  (SELECT status FROM purchase_orders WHERE id = 'test-po-1'),
  'draft'::po_status,
  'New PO should have draft status'
);

SELECT is(
  (SELECT COUNT(*) FROM po_lines WHERE po_id = 'test-po-1'),
  2::bigint,
  'Should create 2 PO lines'
);

SELECT is(
  (SELECT subtotal FROM purchase_orders WHERE id = 'test-po-1'),
  700.00::numeric,
  'Should calculate correct subtotal (25*5.50 + 250*2.25)'
);

-- Test telemetry event
SELECT is(
  (SELECT COUNT(*) FROM ui_events WHERE workspace_id = 'test-ws-po' AND event_name = 'po_created'),
  1::bigint,
  'Should fire po_created telemetry event'
);

-- ============================================================================
-- APPROVAL WORKFLOW TESTS
-- ============================================================================

-- Test approval with wrong role (should fail)
SELECT throws_ok(
  $$ SELECT approve_purchase_order('test-po-1'::uuid) $$,
  'Insufficient permissions to approve purchase orders',
  'Inventory role cannot approve POs'
);

-- Switch to accounting user
SELECT set_config('request.jwt.claims', 
  jsonb_build_object(
    'sub', 'test-acc-po',
    'workspace_id', 'test-ws-po',
    'role', 'authenticated'
  )::text, true);

-- Test successful approval
SELECT is(
  approve_purchase_order('test-po-1'::uuid, 'Approved for testing'),
  true,
  'Accounting role can approve PO'
);

SELECT is(
  (SELECT status FROM purchase_orders WHERE id = 'test-po-1'),
  'approved'::po_status,
  'PO status should change to approved'
);

SELECT is(
  (SELECT approved_by FROM purchase_orders WHERE id = 'test-po-1'),
  'test-acc-po'::uuid,
  'Should record approver'
);

SELECT isnt(
  (SELECT approved_at FROM purchase_orders WHERE id = 'test-po-1'),
  NULL,
  'Should record approval timestamp'
);

-- Test cannot approve twice
SELECT throws_ok(
  $$ SELECT approve_purchase_order('test-po-1'::uuid) $$,
  'Only draft purchase orders can be approved%',
  'Cannot approve already approved PO'
);

-- ============================================================================
-- RECEIVING TESTS
-- ============================================================================

-- Switch back to inventory user for receiving
SELECT set_config('request.jwt.claims', 
  jsonb_build_object(
    'sub', 'test-inv-po',
    'workspace_id', 'test-ws-po',
    'role', 'authenticated'
  )::text, true);

-- Test receiving against approved PO
DO $$
DECLARE
  v_receipt_id uuid;
  v_lines jsonb;
BEGIN
  -- Get PO line IDs
  v_lines := (
    SELECT jsonb_agg(
      jsonb_build_object(
        'po_line_id', pol.id,
        'qty_received', pol.qty / 2, -- Partial receipt
        'unit_cost', pol.expected_unit_cost * 1.05, -- 5% price increase
        'lot_code', 'TEST-LOT-' || row_number() OVER (),
        'location_id', pol.location_id
      )
    )
    FROM po_lines pol
    WHERE pol.po_id = 'test-po-1'
  );
  
  v_receipt_id := receive_purchase_order(
    'test-po-1'::uuid,
    v_lines,
    'Partial receipt with price variance'
  );
  
  -- Store for later tests
  UPDATE po_receipts SET id = 'test-receipt-1' WHERE id = v_receipt_id;
END $$;

SELECT is(
  (SELECT COUNT(*) FROM po_receipts WHERE id = 'test-receipt-1'),
  1::bigint,
  'Should create PO receipt'
);

SELECT is(
  (SELECT COUNT(*) FROM po_receipt_lines WHERE po_receipt_id = 'test-receipt-1'),
  2::bigint,
  'Should create receipt lines'
);

-- Check inventory lots were created
SELECT is(
  (SELECT COUNT(*) FROM item_lots WHERE workspace_id = 'test-ws-po' AND lot_code LIKE 'TEST-LOT-%'),
  2::bigint,
  'Should create inventory lots from receipt'
);

-- Check inventory transactions
SELECT is(
  (SELECT COUNT(*) FROM inventory_transactions 
   WHERE workspace_id = 'test-ws-po' 
   AND type = 'receive' 
   AND ref_type = 'po_receipt_line'),
  2::bigint,
  'Should create receive transactions'
);

-- Check PO status changed to partial
SELECT is(
  (SELECT status FROM purchase_orders WHERE id = 'test-po-1'),
  'partial'::po_status,
  'PO status should change to partial after partial receipt'
);

-- Check supplier price history was updated
SELECT is(
  (SELECT COUNT(*) FROM supplier_price_history 
   WHERE workspace_id = 'test-ws-po' 
   AND vendor_id = 'test-vendor-1'),
  2::bigint,
  'Should update supplier price history'
);

-- Test telemetry event
SELECT is(
  (SELECT COUNT(*) FROM ui_events WHERE workspace_id = 'test-ws-po' AND event_name = 'po_received'),
  1::bigint,
  'Should fire po_received telemetry event'
);

-- ============================================================================
-- VARIANCE ANALYSIS TESTS
-- ============================================================================

-- Test variance analysis function
SELECT is(
  (SELECT COUNT(*) FROM get_po_variance_analysis('test-po-1'::uuid)),
  2::bigint,
  'Variance analysis should return all PO lines'
);

SELECT ok(
  (SELECT cost_variance_pct > 0 
   FROM get_po_variance_analysis('test-po-1'::uuid)
   LIMIT 1),
  'Should detect positive cost variance (5% increase)'
);

-- ============================================================================
-- COMPLETE RECEIPT TESTS
-- ============================================================================

-- Receive remaining quantities
DO $$
DECLARE
  v_receipt_id uuid;
  v_lines jsonb;
BEGIN
  v_lines := (
    SELECT jsonb_agg(
      jsonb_build_object(
        'po_line_id', pol.id,
        'qty_received', pol.qty - COALESCE(pol.qty_received, 0),
        'unit_cost', pol.expected_unit_cost,
        'lot_code', 'TEST-LOT-FULL-' || row_number() OVER (),
        'location_id', pol.location_id
      )
    )
    FROM po_lines pol
    WHERE pol.po_id = 'test-po-1'
  );
  
  v_receipt_id := receive_purchase_order(
    'test-po-1'::uuid,
    v_lines,
    'Final receipt'
  );
END $$;

SELECT is(
  (SELECT status FROM purchase_orders WHERE id = 'test-po-1'),
  'received'::po_status,
  'PO status should change to received after full receipt'
);

-- ============================================================================
-- LOW STOCK REORDER TESTS
-- ============================================================================

-- Create low stock situation
UPDATE item_lots 
SET qty = 5 
WHERE item_id = 'test-item-1' AND workspace_id = 'test-ws-po';

-- Add consumption history for days_until_stockout calculation
INSERT INTO inventory_transactions (workspace_id, type, item_id, qty, uom, transaction_date, created_by)
SELECT 
  'test-ws-po', 
  'consume', 
  'test-item-1',
  -1,
  'lb',
  CURRENT_DATE - (n || ' days')::interval,
  'test-inv-po'
FROM generate_series(1, 10) n;

-- Test reorder suggestions
SELECT is(
  (SELECT COUNT(*) FROM get_low_stock_reorder_suggestions('test-ws-po'::uuid)),
  1::bigint,
  'Should identify low stock item'
);

SELECT is(
  (SELECT item_id FROM get_low_stock_reorder_suggestions('test-ws-po'::uuid) LIMIT 1),
  'test-item-1'::uuid,
  'Should identify correct low stock item'
);

SELECT is(
  (SELECT days_until_stockout FROM get_low_stock_reorder_suggestions('test-ws-po'::uuid) LIMIT 1),
  5,
  'Should calculate days until stockout based on consumption rate'
);

-- Test create PO from reorder suggestions
DO $$
DECLARE
  v_po_id uuid;
BEGIN
  v_po_id := create_po_from_reorder_suggestions(
    'test-vendor-1'::uuid,
    ARRAY['test-item-1'::uuid],
    CURRENT_DATE + INTERVAL '7 days'
  );
  
  UPDATE purchase_orders SET id = 'test-po-reorder' WHERE id = v_po_id;
END $$;

SELECT is(
  (SELECT COUNT(*) FROM purchase_orders WHERE id = 'test-po-reorder'),
  1::bigint,
  'Should create PO from reorder suggestions'
);

SELECT is(
  (SELECT COUNT(*) FROM po_lines WHERE po_id = 'test-po-reorder'),
  1::bigint,
  'Should create PO line for suggested item'
);

SELECT is(
  (SELECT qty FROM po_lines WHERE po_id = 'test-po-reorder' LIMIT 1),
  50::numeric,
  'Should use reorder quantity from item settings'
);

-- ============================================================================
-- OVER-RECEIPT TESTS
-- ============================================================================

-- Create new simple PO for over-receipt test
INSERT INTO purchase_orders (id, workspace_id, po_number, vendor_id, status, approved_by, approved_at)
VALUES ('test-po-over', 'test-ws-po', 'PO-TEST-OVER', 'test-vendor-1', 'approved', 'test-acc-po', NOW());

INSERT INTO po_lines (id, workspace_id, po_id, item_id, qty, uom, expected_unit_cost, location_id, line_number)
VALUES ('test-pol-over', 'test-ws-po', 'test-po-over', 'test-item-1', 10, 'lb', 5.00, 'test-loc-1', 1);

-- Test over-receipt rejection for non-admin
SELECT throws_ok(
  $$ 
    SELECT receive_purchase_order(
      'test-po-over'::uuid,
      jsonb_build_array(
        jsonb_build_object(
          'po_line_id', 'test-pol-over',
          'qty_received', 15, -- 50% over
          'unit_cost', 5.00,
          'lot_code', 'OVER-LOT',
          'location_id', 'test-loc-1'
        )
      ),
      'Over receipt test'
    )
  $$,
  'Over-receipt not allowed%',
  'Should reject over-receipt >10% for non-admin'
);

-- Test 10% tolerance allowance
DO $$
DECLARE
  v_receipt_id uuid;
BEGIN
  v_receipt_id := receive_purchase_order(
    'test-po-over'::uuid,
    jsonb_build_array(
      jsonb_build_object(
        'po_line_id', 'test-pol-over',
        'qty_received', 10.5, -- 5% over, within tolerance
        'unit_cost', 5.00,
        'lot_code', 'TOLERANCE-LOT',
        'location_id', 'test-loc-1'
      )
    ),
    'Within tolerance'
  );
END $$;

SELECT is(
  (SELECT qty_received FROM po_lines WHERE id = 'test-pol-over'),
  10.5::numeric,
  'Should allow receipt within 10% tolerance'
);

-- ============================================================================
-- PERMISSIONS TESTS
-- ============================================================================

-- Test brewer role cannot create PO
SELECT set_config('request.jwt.claims', 
  jsonb_build_object(
    'sub', 'test-brewer-po',
    'workspace_id', 'test-ws-po',
    'role', 'authenticated'
  )::text, true);

INSERT INTO users (id, email, full_name)
VALUES ('test-brewer-po', 'brewer@test.com', 'Brewer User');

INSERT INTO user_workspace_roles (user_id, workspace_id, role)
VALUES ('test-brewer-po', 'test-ws-po', 'brewer');

SELECT throws_ok(
  $$ SELECT create_purchase_order('test-vendor-1'::uuid) $$,
  'Insufficient permissions to create purchase orders',
  'Brewer role cannot create POs'
);

-- ============================================================================
-- CLEANUP
-- ============================================================================

ROLLBACK;
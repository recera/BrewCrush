-- Phase 3: Purchase Order Integration Test
-- This test verifies the complete PO workflow without requiring pgTAP

BEGIN;

-- Create test workspace and users
INSERT INTO workspaces (id, name, plan) 
VALUES ('f0000000-0000-0000-0000-000000000001', 'Test PO Workspace', 'trial');

-- First insert into auth.users
INSERT INTO auth.users (id, instance_id, email, role, aud, created_at, updated_at, email_confirmed_at)
VALUES 
  ('f0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'admin@test.com', 'authenticated', 'authenticated', NOW(), NOW(), NOW()),
  ('f0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'inventory@test.com', 'authenticated', 'authenticated', NOW(), NOW(), NOW()),
  ('f0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'accounting@test.com', 'authenticated', 'authenticated', NOW(), NOW(), NOW());

-- Then insert into public.users
INSERT INTO users (id, email, full_name)
VALUES 
  ('f0000000-0000-0000-0000-000000000002', 'admin@test.com', 'Admin User'),
  ('f0000000-0000-0000-0000-000000000003', 'inventory@test.com', 'Inventory User'),
  ('f0000000-0000-0000-0000-000000000004', 'accounting@test.com', 'Accounting User');

INSERT INTO user_workspace_roles (user_id, workspace_id, role)
VALUES 
  ('f0000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-000000000001', 'admin'),
  ('f0000000-0000-0000-0000-000000000003', 'f0000000-0000-0000-0000-000000000001', 'inventory'),
  ('f0000000-0000-0000-0000-000000000004', 'f0000000-0000-0000-0000-000000000001', 'accounting');

-- Create test vendor
INSERT INTO vendors (id, workspace_id, name, email, terms)
VALUES ('f0000000-0000-0000-0000-000000000005', 'f0000000-0000-0000-0000-000000000001', 'Test Supplier', 'supplier@test.com', 'Net 30');

-- Create test location
INSERT INTO inventory_locations (id, workspace_id, name, is_default)
VALUES ('f0000000-0000-0000-0000-000000000006', 'f0000000-0000-0000-0000-000000000001', 'Main Warehouse', true);

-- Create test items with reorder levels
INSERT INTO items (id, workspace_id, name, type, uom, reorder_level, reorder_qty, vendor_id)
VALUES 
  ('f0000000-0000-0000-0000-000000000007', 'f0000000-0000-0000-0000-000000000001', 'Test Hops', 'raw', 'lb', 10, 50, 'f0000000-0000-0000-0000-000000000005'),
  ('f0000000-0000-0000-0000-000000000008', 'f0000000-0000-0000-0000-000000000001', 'Test Malt', 'raw', 'lb', 100, 500, 'f0000000-0000-0000-0000-000000000005');

-- ====================
-- TEST 1: PO Creation
-- ====================
DO $$
DECLARE
  v_po_id UUID;
  v_po_number TEXT;
  v_lines JSONB;
BEGIN
  -- Set context for inventory user
  PERFORM set_config('request.jwt.claims', 
    jsonb_build_object(
      'sub', 'f0000000-0000-0000-0000-000000000003',
      'workspace_id', 'f0000000-0000-0000-0000-000000000001',
      'role', 'authenticated'
    )::text, true);
  
  -- Build PO lines
  v_lines := jsonb_build_array(
    jsonb_build_object(
      'item_id', 'f0000000-0000-0000-0000-000000000007',
      'qty', 25,
      'uom', 'lb',
      'expected_unit_cost', 5.50,
      'location_id', 'f0000000-0000-0000-0000-000000000006'
    ),
    jsonb_build_object(
      'item_id', 'f0000000-0000-0000-0000-000000000008',
      'qty', 250,
      'uom', 'lb',
      'expected_unit_cost', 2.25,
      'location_id', 'f0000000-0000-0000-0000-000000000006'
    )
  );
  
  -- Create PO
  v_po_id := create_purchase_order(
    'f0000000-0000-0000-0000-000000000005'::uuid,
    (CURRENT_DATE + INTERVAL '7 days')::date,
    'Net 30',
    'Integration Test PO',
    v_lines
  );
  
  -- Verify PO was created
  SELECT po_number INTO v_po_number
  FROM purchase_orders 
  WHERE id = v_po_id;
  
  IF v_po_number IS NULL THEN
    RAISE EXCEPTION 'PO creation failed';
  END IF;
  
  RAISE NOTICE 'TEST 1 PASSED: PO created with number %', v_po_number;
  
  -- Store PO ID in a temporary table for next tests
  CREATE TEMP TABLE IF NOT EXISTS test_po_ids (po_id UUID);
  INSERT INTO test_po_ids VALUES (v_po_id);
END $$;

-- ====================
-- TEST 2: PO Approval
-- ====================
DO $$
DECLARE
  v_status po_status;
  v_po_id UUID;
BEGIN
  SELECT po_id INTO v_po_id FROM test_po_ids LIMIT 1;
  -- Set context for accounting user
  PERFORM set_config('request.jwt.claims', 
    jsonb_build_object(
      'sub', 'f0000000-0000-0000-0000-000000000004',
      'workspace_id', 'f0000000-0000-0000-0000-000000000001',
      'role', 'authenticated'
    )::text, true);
  
  -- Approve the PO
  PERFORM approve_purchase_order(v_po_id, 'Approved for testing');
  
  -- Verify status changed
  SELECT status INTO v_status
  FROM purchase_orders
  WHERE id = v_po_id;
  
  IF v_status != 'approved' THEN
    RAISE EXCEPTION 'PO approval failed. Status: %', v_status;
  END IF;
  
  RAISE NOTICE 'TEST 2 PASSED: PO approved successfully';
END $$;

-- ====================
-- TEST 3: PO Receiving
-- ====================
DO $$
DECLARE
  v_receipt_id UUID;
  v_lines JSONB;
  v_lot_count INTEGER;
  v_po_id UUID;
BEGIN
  SELECT po_id INTO v_po_id FROM test_po_ids LIMIT 1;
  -- Set context for inventory user
  PERFORM set_config('request.jwt.claims', 
    jsonb_build_object(
      'sub', 'f0000000-0000-0000-0000-000000000003',
      'workspace_id', 'f0000000-0000-0000-0000-000000000001',
      'role', 'authenticated'
    )::text, true);
  
  -- Build receipt lines
  WITH numbered_lines AS (
    SELECT 
      pol.id,
      pol.qty,
      pol.expected_unit_cost,
      pol.location_id,
      row_number() OVER (ORDER BY pol.id) as rn
    FROM po_lines pol
    WHERE pol.po_id = v_po_id
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'po_line_id', id,
      'qty_received', qty,
      'unit_cost', expected_unit_cost,
      'lot_code', 'TEST-LOT-' || rn,
      'location_id', location_id
    )
  ) INTO v_lines
  FROM numbered_lines;
  
  -- Receive the PO
  v_receipt_id := receive_purchase_order(
    v_po_id,
    v_lines,
    'Full receipt test'
  );
  
  -- Verify lots were created
  SELECT COUNT(*) INTO v_lot_count
  FROM item_lots
  WHERE workspace_id = 'f0000000-0000-0000-0000-000000000001' 
    AND lot_code LIKE 'TEST-LOT-%';
  
  IF v_lot_count != 2 THEN
    RAISE EXCEPTION 'Lot creation failed. Expected 2, got %', v_lot_count;
  END IF;
  
  RAISE NOTICE 'TEST 3 PASSED: PO received, % lots created', v_lot_count;
END $$;

-- ====================
-- TEST 4: Variance Analysis
-- ====================
DO $$
DECLARE
  v_variance_count INTEGER;
  v_po_id UUID;
BEGIN
  SELECT po_id INTO v_po_id FROM test_po_ids LIMIT 1;
  
  -- Check variance analysis function
  SELECT COUNT(*) INTO v_variance_count
  FROM get_po_variance_analysis(v_po_id);
  
  IF v_variance_count != 2 THEN
    RAISE EXCEPTION 'Variance analysis failed. Expected 2 lines, got %', v_variance_count;
  END IF;
  
  RAISE NOTICE 'TEST 4 PASSED: Variance analysis returns % lines', v_variance_count;
END $$;

-- ====================
-- TEST 5: Low Stock Reorder
-- ====================
DO $$
DECLARE
  v_suggestion_count INTEGER;
  v_new_po_id UUID;
BEGIN
  -- Create low stock situation
  UPDATE item_lots 
  SET qty = 5 
  WHERE item_id = 'f0000000-0000-0000-0000-000000000007' AND workspace_id = 'f0000000-0000-0000-0000-000000000001';
  
  -- Add consumption history
  INSERT INTO inventory_transactions (workspace_id, type, item_id, qty, uom, transaction_date, created_by)
  SELECT 
    'f0000000-0000-0000-0000-000000000001', 
    'consume', 
    'f0000000-0000-0000-0000-000000000007',
    -1,
    'lb',
    CURRENT_DATE - (n || ' days')::interval,
    'f0000000-0000-0000-0000-000000000003'
  FROM generate_series(1, 5) n;
  
  -- Check reorder suggestions
  SELECT COUNT(*) INTO v_suggestion_count
  FROM get_low_stock_reorder_suggestions('f0000000-0000-0000-0000-000000000001'::uuid)
  WHERE item_id = 'f0000000-0000-0000-0000-000000000007';
  
  IF v_suggestion_count != 1 THEN
    RAISE EXCEPTION 'Reorder suggestion failed. Expected 1, got %', v_suggestion_count;
  END IF;
  
  -- Create PO from suggestions
  v_new_po_id := create_po_from_reorder_suggestions(
    'f0000000-0000-0000-0000-000000000005'::uuid,
    ARRAY['f0000000-0000-0000-0000-000000000007'::uuid],
    (CURRENT_DATE + INTERVAL '7 days')::date
  );
  
  IF v_new_po_id IS NULL THEN
    RAISE EXCEPTION 'Failed to create PO from reorder suggestions';
  END IF;
  
  RAISE NOTICE 'TEST 5 PASSED: Reorder PO created successfully';
END $$;

-- ====================
-- SUMMARY
-- ====================
DO $$
DECLARE
  v_po_count INTEGER;
  v_receipt_count INTEGER;
  v_lot_count INTEGER;
  v_transaction_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_po_count FROM purchase_orders WHERE workspace_id = 'f0000000-0000-0000-0000-000000000001';
  SELECT COUNT(*) INTO v_receipt_count FROM po_receipts WHERE workspace_id = 'f0000000-0000-0000-0000-000000000001';
  SELECT COUNT(*) INTO v_lot_count FROM item_lots WHERE workspace_id = 'f0000000-0000-0000-0000-000000000001';
  SELECT COUNT(*) INTO v_transaction_count FROM inventory_transactions WHERE workspace_id = 'f0000000-0000-0000-0000-000000000001';
  
  RAISE NOTICE '';
  RAISE NOTICE '=== PHASE 3 INTEGRATION TEST SUMMARY ===';
  RAISE NOTICE 'Purchase Orders Created: %', v_po_count;
  RAISE NOTICE 'Receipts Processed: %', v_receipt_count;
  RAISE NOTICE 'Inventory Lots Created: %', v_lot_count;
  RAISE NOTICE 'Inventory Transactions: %', v_transaction_count;
  RAISE NOTICE '';
  RAISE NOTICE 'ALL TESTS PASSED SUCCESSFULLY';
  RAISE NOTICE '========================================';
END $$;

-- Clean up
ROLLBACK;
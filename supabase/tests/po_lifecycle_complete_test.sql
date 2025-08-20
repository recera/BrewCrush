-- Comprehensive PO Lifecycle Integration Tests
-- Tests the complete purchase order flow from creation to closure

-- Setup test environment
BEGIN;

-- Set up workspace and user context for testing
DO $$
DECLARE
  v_workspace_id UUID := '11111111-1111-1111-1111-111111111111';
  v_admin_user_id UUID := gen_random_uuid();
  v_inventory_user_id UUID := gen_random_uuid();
  v_accounting_user_id UUID := gen_random_uuid();
  v_vendor_id UUID;
  v_item1_id UUID;
  v_item2_id UUID;
  v_location_id UUID;
  v_po_id UUID;
  v_receipt_id UUID;
  v_test_passed BOOLEAN := true;
  v_error_message TEXT := '';
BEGIN
  -- Create workspace first
  INSERT INTO workspaces (id, name, plan)
  VALUES (v_workspace_id, 'Test Workspace', 'trial')
  ON CONFLICT (id) DO NOTHING;
  
  -- Set JWT claims with admin role (bypass user/role tables for testing)
  -- This simulates an authenticated admin user
  PERFORM set_config('request.jwt.claims', 
    jsonb_build_object(
      'sub', v_admin_user_id,
      'workspace_id', v_workspace_id,
      'role', 'authenticated',
      'user_role', 'admin'  -- Add user_role directly to claims
    )::text, true);
  
  -- Also set the auth.uid() to return the test user ID
  PERFORM set_config('request.jwt.claim.sub', v_admin_user_id::text, true);

  -- ========================================
  -- TEST 1: Create Vendor
  -- ========================================
  BEGIN
    INSERT INTO vendors (id, workspace_id, name, email, terms, credit_limit)
    VALUES (
      gen_random_uuid(),
      v_workspace_id,
      'Test Vendor Co',
      'vendor@test.com',
      'Net 30',
      10000.00
    ) RETURNING id INTO v_vendor_id;
    
    IF v_vendor_id IS NULL THEN
      RAISE EXCEPTION 'TEST 1 FAILED: Could not create vendor';
    END IF;
    
    RAISE NOTICE 'TEST 1 PASSED: Vendor created successfully';
  EXCEPTION WHEN OTHERS THEN
    v_test_passed := false;
    v_error_message := SQLERRM;
    RAISE NOTICE 'TEST 1 FAILED: %', v_error_message;
  END;

  -- ========================================
  -- TEST 2: Create Items
  -- ========================================
  BEGIN
    -- Create test location
    INSERT INTO inventory_locations (id, workspace_id, name, type, is_default)
    VALUES (
      gen_random_uuid(),
      v_workspace_id,
      'Test Warehouse',
      'warehouse',
      true
    ) RETURNING id INTO v_location_id;

    -- Create test items
    INSERT INTO items (id, workspace_id, name, sku, type, uom, reorder_level, vendor_id)
    VALUES 
      (gen_random_uuid(), v_workspace_id, 'Test Item 1', 'TEST-001', 'raw', 'lb', 100, v_vendor_id)
    RETURNING id INTO v_item1_id;
    
    INSERT INTO items (id, workspace_id, name, sku, type, uom, reorder_level, vendor_id)
    VALUES 
      (gen_random_uuid(), v_workspace_id, 'Test Item 2', 'TEST-002', 'raw', 'kg', 50, v_vendor_id)
    RETURNING id INTO v_item2_id;
    
    RAISE NOTICE 'TEST 2 PASSED: Items created successfully';
  EXCEPTION WHEN OTHERS THEN
    v_test_passed := false;
    v_error_message := SQLERRM;
    RAISE NOTICE 'TEST 2 FAILED: %', v_error_message;
  END;

  -- ========================================
  -- TEST 3: Create Purchase Order
  -- ========================================
  BEGIN
    SELECT create_purchase_order(
      p_vendor_id := v_vendor_id,
      p_due_date := (CURRENT_DATE + INTERVAL '14 days')::date,
      p_terms := 'Net 30',
      p_notes := 'Test PO for integration testing',
      p_lines := jsonb_build_array(
        jsonb_build_object(
          'item_id', v_item1_id,
          'qty', 100,
          'uom', 'lb',
          'expected_unit_cost', 2.50,
          'line_number', 1
        ),
        jsonb_build_object(
          'item_id', v_item2_id,
          'qty', 50,
          'uom', 'kg',
          'expected_unit_cost', 5.00,
          'line_number', 2
        )
      )
    ) INTO v_po_id;
    
    IF v_po_id IS NULL THEN
      RAISE EXCEPTION 'TEST 3 FAILED: Could not create purchase order';
    END IF;
    
    -- Verify PO was created with correct status
    IF NOT EXISTS (
      SELECT 1 FROM purchase_orders 
      WHERE id = v_po_id 
      AND status = 'draft'
    ) THEN
      RAISE EXCEPTION 'TEST 3 FAILED: PO not in draft status';
    END IF;
    
    -- Verify PO lines were created
    IF (SELECT COUNT(*) FROM po_lines WHERE po_id = v_po_id) != 2 THEN
      RAISE EXCEPTION 'TEST 3 FAILED: Expected 2 PO lines, got %', 
        (SELECT COUNT(*) FROM po_lines WHERE po_id = v_po_id);
    END IF;
    
    RAISE NOTICE 'TEST 3 PASSED: Purchase order created with % lines', 
      (SELECT COUNT(*) FROM po_lines WHERE po_id = v_po_id);
  EXCEPTION WHEN OTHERS THEN
    v_test_passed := false;
    v_error_message := SQLERRM;
    RAISE NOTICE 'TEST 3 FAILED: %', v_error_message;
  END;

  -- ========================================
  -- TEST 4: Edit Purchase Order (while draft)
  -- ========================================
  BEGIN
    PERFORM update_purchase_order(
      p_po_id := v_po_id,
      p_lines := jsonb_build_array(
        jsonb_build_object(
          'item_id', v_item1_id,
          'qty', 150,  -- Changed from 100
          'uom', 'lb',
          'expected_unit_cost', 2.25,  -- Changed from 2.50
          'line_number', 1
        )
      ),
      p_notes := 'Updated test PO',
      p_due_date := (CURRENT_DATE + INTERVAL '21 days')::date
    );
    
    -- Verify changes were applied
    IF NOT EXISTS (
      SELECT 1 FROM po_lines 
      WHERE po_id = v_po_id 
      AND item_id = v_item1_id
      AND qty = 150
      AND expected_unit_cost = 2.25
    ) THEN
      RAISE EXCEPTION 'TEST 4 FAILED: PO edits not applied correctly';
    END IF;
    
    RAISE NOTICE 'TEST 4 PASSED: Purchase order edited successfully';
  EXCEPTION WHEN OTHERS THEN
    v_test_passed := false;
    v_error_message := SQLERRM;
    RAISE NOTICE 'TEST 4 FAILED: %', v_error_message;
  END;

  -- ========================================
  -- TEST 5: Approve Purchase Order
  -- ========================================
  BEGIN
    -- First restore the original lines
    PERFORM update_purchase_order(
      p_po_id := v_po_id,
      p_lines := jsonb_build_array(
        jsonb_build_object(
          'item_id', v_item1_id,
          'qty', 100,
          'uom', 'lb',
          'expected_unit_cost', 2.50,
          'line_number', 1
        ),
        jsonb_build_object(
          'item_id', v_item2_id,
          'qty', 50,
          'uom', 'kg',
          'expected_unit_cost', 5.00,
          'line_number', 2
        )
      ),
      p_notes := 'Test PO for integration testing',
      p_due_date := (CURRENT_DATE + INTERVAL '14 days')::date
    );
    
    -- Approve the PO
    PERFORM approve_purchase_order(
      p_po_id := v_po_id,
      p_notes := 'Approved for testing'
    );
    
    -- Verify status changed to approved
    IF NOT EXISTS (
      SELECT 1 FROM purchase_orders 
      WHERE id = v_po_id 
      AND status = 'approved'
    ) THEN
      RAISE EXCEPTION 'TEST 5 FAILED: PO not approved';
    END IF;
    
    RAISE NOTICE 'TEST 5 PASSED: Purchase order approved';
  EXCEPTION WHEN OTHERS THEN
    v_test_passed := false;
    v_error_message := SQLERRM;
    RAISE NOTICE 'TEST 5 FAILED: %', v_error_message;
  END;

  -- ========================================
  -- TEST 6: Attempt to Edit After Approval (should fail)
  -- ========================================
  BEGIN
    PERFORM update_purchase_order(
      p_po_id := v_po_id,
      p_lines := jsonb_build_array(
        jsonb_build_object(
          'item_id', v_item1_id,
          'qty', 200,
          'uom', 'lb',
          'expected_unit_cost', 3.00,
          'line_number', 1
        )
      ),
      p_notes := 'Should not work',
      p_due_date := (CURRENT_DATE + INTERVAL '30 days')::date
    );
    
    -- If we get here, the test failed
    RAISE EXCEPTION 'TEST 6 FAILED: Should not be able to edit approved PO';
  EXCEPTION 
    WHEN OTHERS THEN
      IF SQLERRM LIKE '%Only draft POs can be edited%' THEN
        RAISE NOTICE 'TEST 6 PASSED: Cannot edit approved PO (expected behavior)';
      ELSE
        RAISE NOTICE 'TEST 6 FAILED: Unexpected error: %', SQLERRM;
      END IF;
  END;

  -- ========================================
  -- TEST 7: Partial Receipt
  -- ========================================
  BEGIN
    SELECT receive_purchase_order(
      p_po_id := v_po_id,
      p_receipt_lines := jsonb_build_array(
        jsonb_build_object(
          'po_line_id', (SELECT id FROM po_lines WHERE po_id = v_po_id AND line_number = 1),
          'qty_received', 60,  -- Partial: 60 of 100
          'unit_cost', 2.50,
          'lot_code', 'LOT-001',
          'expiry_date', (CURRENT_DATE + INTERVAL '90 days')::DATE
        )
      ),
      p_notes := 'Partial receipt - first delivery'
    ) INTO v_receipt_id;
    
    -- Verify PO status changed to partial
    IF NOT EXISTS (
      SELECT 1 FROM purchase_orders 
      WHERE id = v_po_id 
      AND status = 'partial'
    ) THEN
      RAISE EXCEPTION 'TEST 7 FAILED: PO status not updated to partial';
    END IF;
    
    -- Verify inventory was created
    IF NOT EXISTS (
      SELECT 1 FROM item_lots 
      WHERE item_id = v_item1_id 
      AND lot_code = 'LOT-001'
      AND qty = 60
    ) THEN
      RAISE EXCEPTION 'TEST 7 FAILED: Inventory lot not created';
    END IF;
    
    RAISE NOTICE 'TEST 7 PASSED: Partial receipt processed';
  EXCEPTION WHEN OTHERS THEN
    v_test_passed := false;
    v_error_message := SQLERRM;
    RAISE NOTICE 'TEST 7 FAILED: %', v_error_message;
  END;

  -- ========================================
  -- TEST 8: Complete Receipt with Variance
  -- ========================================
  BEGIN
    SELECT receive_purchase_order(
      p_po_id := v_po_id,
      p_receipt_lines := jsonb_build_array(
        jsonb_build_object(
          'po_line_id', (SELECT id FROM po_lines WHERE po_id = v_po_id AND line_number = 1),
          'qty_received', 45,  -- Over by 5 (total 105 vs 100 ordered)
          'unit_cost', 2.60,  -- Price variance
          'lot_code', 'LOT-002',
          'expiry_date', (CURRENT_DATE + INTERVAL '90 days')::DATE,
          'override_reason', 'Vendor sent extra at slightly higher price'
        ),
        jsonb_build_object(
          'po_line_id', (SELECT id FROM po_lines WHERE po_id = v_po_id AND line_number = 2),
          'qty_received', 50,
          'unit_cost', 5.00,
          'lot_code', 'LOT-003',
          'expiry_date', (CURRENT_DATE + INTERVAL '120 days')::DATE
        )
      ),
      p_notes := 'Final receipt with slight overage'
    ) INTO v_receipt_id;
    
    -- Verify PO status changed to received
    IF NOT EXISTS (
      SELECT 1 FROM purchase_orders 
      WHERE id = v_po_id 
      AND status = 'received'
    ) THEN
      RAISE EXCEPTION 'TEST 8 FAILED: PO status not updated to received';
    END IF;
    
    -- Verify variance was recorded
    IF NOT EXISTS (
      SELECT 1 FROM po_receipt_lines 
      WHERE po_receipt_id = v_receipt_id 
      AND override_reason IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'TEST 8 FAILED: Override reason not recorded';
    END IF;
    
    RAISE NOTICE 'TEST 8 PASSED: Complete receipt with variance processed';
  EXCEPTION WHEN OTHERS THEN
    v_test_passed := false;
    v_error_message := SQLERRM;
    RAISE NOTICE 'TEST 8 FAILED: %', v_error_message;
  END;

  -- ========================================
  -- TEST 9: Supplier Price History
  -- ========================================
  BEGIN
    -- Check that price history was updated
    IF NOT EXISTS (
      SELECT 1 FROM supplier_price_history 
      WHERE item_id = v_item1_id 
      AND vendor_id = v_vendor_id
    ) THEN
      RAISE EXCEPTION 'TEST 9 FAILED: Supplier price history not updated';
    END IF;
    
    -- Verify latest price reflects most recent receipt
    IF (
      SELECT unit_cost 
      FROM supplier_price_history 
      WHERE item_id = v_item1_id 
      ORDER BY receipt_date DESC 
      LIMIT 1
    ) != 2.60 THEN
      RAISE EXCEPTION 'TEST 9 FAILED: Latest price not correct';
    END IF;
    
    RAISE NOTICE 'TEST 9 PASSED: Supplier price history updated correctly';
  EXCEPTION WHEN OTHERS THEN
    v_test_passed := false;
    v_error_message := SQLERRM;
    RAISE NOTICE 'TEST 9 FAILED: %', v_error_message;
  END;

  -- ========================================
  -- TEST 10: Reorder Suggestions
  -- ========================================
  BEGIN
    -- Set reorder level to trigger suggestion
    UPDATE items 
    SET reorder_level = 200 
    WHERE id = v_item1_id;
    
    -- Check reorder suggestions
    IF NOT EXISTS (
      SELECT 1 
      FROM get_low_stock_reorder_suggestions(v_workspace_id)
      WHERE item_id = v_item1_id
    ) THEN
      RAISE EXCEPTION 'TEST 10 FAILED: Item not appearing in reorder suggestions';
    END IF;
    
    -- Create another PO to test in-transit calculation
    DECLARE
      v_new_po_id UUID;
    BEGIN
      SELECT create_purchase_order(
        p_vendor_id := v_vendor_id,
        p_due_date := (CURRENT_DATE + INTERVAL '7 days')::date,
        p_terms := 'Net 30',
        p_notes := 'Reorder PO',
        p_lines := jsonb_build_array(
          jsonb_build_object(
            'item_id', v_item1_id,
            'qty', 100,
            'uom', 'lb',
            'expected_unit_cost', 2.50,
            'line_number', 1
          )
        )
      ) INTO v_new_po_id;
      
      -- Approve it to make it in-transit
      PERFORM approve_purchase_order(v_new_po_id, 'Auto-approved for reorder');
      
      -- Now check that in-transit is considered
      IF (
        SELECT in_transit 
        FROM get_low_stock_reorder_suggestions(v_workspace_id)
        WHERE item_id = v_item1_id
      ) != 100 THEN
        RAISE EXCEPTION 'TEST 10 FAILED: In-transit quantity not calculated correctly';
      END IF;
    END;
    
    RAISE NOTICE 'TEST 10 PASSED: Reorder suggestions include in-transit inventory';
  EXCEPTION WHEN OTHERS THEN
    v_test_passed := false;
    v_error_message := SQLERRM;
    RAISE NOTICE 'TEST 10 FAILED: %', v_error_message;
  END;

  -- ========================================
  -- TEST 11: Duplicate Purchase Order
  -- ========================================
  BEGIN
    DECLARE
      v_duplicated_po_id UUID;
    BEGIN
      SELECT duplicate_purchase_order(
        p_po_id := v_po_id,
        p_new_due_date := (CURRENT_DATE + INTERVAL '30 days')::date
      ) INTO v_duplicated_po_id;
      
      -- Verify new PO was created
      IF NOT EXISTS (
        SELECT 1 FROM purchase_orders 
        WHERE id = v_duplicated_po_id 
        AND status = 'draft'
        AND vendor_id = v_vendor_id
      ) THEN
        RAISE EXCEPTION 'TEST 11 FAILED: Duplicated PO not created correctly';
      END IF;
      
      -- Verify lines were copied
      IF (SELECT COUNT(*) FROM po_lines WHERE po_id = v_duplicated_po_id) != 2 THEN
        RAISE EXCEPTION 'TEST 11 FAILED: PO lines not duplicated correctly';
      END IF;
      
      RAISE NOTICE 'TEST 11 PASSED: Purchase order duplicated successfully';
    END;
  EXCEPTION WHEN OTHERS THEN
    v_test_passed := false;
    v_error_message := SQLERRM;
    RAISE NOTICE 'TEST 11 FAILED: %', v_error_message;
  END;

  -- ========================================
  -- TEST 12: Cancel Purchase Order
  -- ========================================
  BEGIN
    DECLARE
      v_cancel_po_id UUID;
    BEGIN
      -- Create a new draft PO to cancel
      SELECT create_purchase_order(
        p_vendor_id := v_vendor_id,
        p_due_date := (CURRENT_DATE + INTERVAL '7 days')::date,
        p_terms := 'Net 30',
        p_notes := 'PO to be cancelled',
        p_lines := jsonb_build_array(
          jsonb_build_object(
            'item_id', v_item1_id,
            'qty', 50,
            'uom', 'lb',
            'expected_unit_cost', 2.50,
            'line_number', 1
          )
        )
      ) INTO v_cancel_po_id;
      
      -- Cancel it
      PERFORM cancel_purchase_order(
        p_po_id := v_cancel_po_id,
        p_reason := 'Test cancellation'
      );
      
      -- Verify status
      IF NOT EXISTS (
        SELECT 1 FROM purchase_orders 
        WHERE id = v_cancel_po_id 
        AND status = 'cancelled'
      ) THEN
        RAISE EXCEPTION 'TEST 12 FAILED: PO not cancelled';
      END IF;
      
      -- Try to cancel a received PO (should fail)
      BEGIN
        PERFORM cancel_purchase_order(
          p_po_id := v_po_id,
          p_reason := 'Should not work'
        );
        RAISE EXCEPTION 'TEST 12 FAILED: Should not be able to cancel received PO';
      EXCEPTION 
        WHEN OTHERS THEN
          IF SQLERRM LIKE '%Cannot cancel PO with receipts%' THEN
            NULL; -- Expected
          ELSE
            RAISE;
          END IF;
      END;
      
      RAISE NOTICE 'TEST 12 PASSED: Purchase order cancellation working correctly';
    END;
  EXCEPTION WHEN OTHERS THEN
    v_test_passed := false;
    v_error_message := SQLERRM;
    RAISE NOTICE 'TEST 12 FAILED: %', v_error_message;
  END;

  -- ========================================
  -- TEST 13: Variance Analysis
  -- ========================================
  BEGIN
    DECLARE
      v_variance_data RECORD;
    BEGIN
      SELECT * INTO v_variance_data
      FROM get_po_variance_analysis(v_po_id);
      
      IF v_variance_data IS NULL THEN
        RAISE EXCEPTION 'TEST 13 FAILED: Could not get variance analysis';
      END IF;
      
      -- We know item1 had variance (105 received vs 100 ordered)
      IF v_variance_data.total_variance_qty != 5 THEN
        RAISE EXCEPTION 'TEST 13 FAILED: Variance quantity calculation incorrect';
      END IF;
      
      RAISE NOTICE 'TEST 13 PASSED: Variance analysis calculated correctly';
    END;
  EXCEPTION WHEN OTHERS THEN
    v_test_passed := false;
    v_error_message := SQLERRM;
    RAISE NOTICE 'TEST 13 FAILED: %', v_error_message;
  END;

  -- ========================================
  -- TEST 14: Audit Trail
  -- ========================================
  BEGIN
    -- Check that audit logs were created
    IF NOT EXISTS (
      SELECT 1 FROM audit_logs 
      WHERE entity_table = 'purchase_orders' 
      AND entity_id = v_po_id
      AND action IN ('create', 'update', 'approve')
    ) THEN
      RAISE EXCEPTION 'TEST 14 FAILED: Audit logs not created';
    END IF;
    
    -- Verify audit log integrity (hash chain)
    DECLARE
      v_invalid_audit BOOLEAN;
    BEGIN
      SELECT EXISTS (
        SELECT 1 
        FROM audit_logs a1
        LEFT JOIN audit_logs a2 ON a1.prev_hash = a2.curr_hash
        WHERE a1.prev_hash IS NOT NULL 
        AND a2.curr_hash IS NULL
      ) INTO v_invalid_audit;
      
      IF v_invalid_audit THEN
        RAISE EXCEPTION 'TEST 14 FAILED: Audit log hash chain broken';
      END IF;
    END;
    
    RAISE NOTICE 'TEST 14 PASSED: Audit trail maintained correctly';
  EXCEPTION WHEN OTHERS THEN
    v_test_passed := false;
    v_error_message := SQLERRM;
    RAISE NOTICE 'TEST 14 FAILED: %', v_error_message;
  END;

  -- ========================================
  -- FINAL SUMMARY
  -- ========================================
  IF v_test_passed THEN
    RAISE NOTICE '';
    RAISE NOTICE '========================================';
    RAISE NOTICE 'ALL PO LIFECYCLE TESTS PASSED ✓';
    RAISE NOTICE '========================================';
    RAISE NOTICE '';
    RAISE NOTICE 'Summary:';
    RAISE NOTICE '  ✓ Vendor and item creation';
    RAISE NOTICE '  ✓ PO creation with multiple lines';
    RAISE NOTICE '  ✓ PO editing (draft only)';
    RAISE NOTICE '  ✓ PO approval workflow';
    RAISE NOTICE '  ✓ Partial receipts';
    RAISE NOTICE '  ✓ Complete receipts with variance';
    RAISE NOTICE '  ✓ Supplier price history tracking';
    RAISE NOTICE '  ✓ Reorder suggestions with in-transit';
    RAISE NOTICE '  ✓ PO duplication';
    RAISE NOTICE '  ✓ PO cancellation';
    RAISE NOTICE '  ✓ Variance analysis';
    RAISE NOTICE '  ✓ Audit trail integrity';
  ELSE
    RAISE NOTICE '';
    RAISE NOTICE '========================================';
    RAISE NOTICE 'SOME TESTS FAILED ✗';
    RAISE NOTICE '========================================';
  END IF;
END $$;

-- Rollback test data
ROLLBACK;
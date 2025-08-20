-- Phase 3: Purchasing & Receiving Enhancements
-- Complete PO lifecycle RPCs, approval workflow, and receiving with variance detection

-- ============================================================================
-- PO NUMBER GENERATION
-- ============================================================================

-- Function to generate next PO number
CREATE OR REPLACE FUNCTION generate_po_number(p_workspace_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_year TEXT;
  v_count INTEGER;
  v_po_number TEXT;
BEGIN
  v_year := TO_CHAR(NOW(), 'YYYY');
  
  -- Get count of POs this year for this workspace
  SELECT COUNT(*) + 1
  INTO v_count
  FROM purchase_orders
  WHERE workspace_id = p_workspace_id
    AND EXTRACT(YEAR FROM created_at) = EXTRACT(YEAR FROM NOW());
  
  -- Format: PO-YYYY-00001
  v_po_number := 'PO-' || v_year || '-' || LPAD(v_count::TEXT, 5, '0');
  
  -- Check for collision and increment if needed
  WHILE EXISTS (
    SELECT 1 FROM purchase_orders 
    WHERE workspace_id = p_workspace_id AND po_number = v_po_number
  ) LOOP
    v_count := v_count + 1;
    v_po_number := 'PO-' || v_year || '-' || LPAD(v_count::TEXT, 5, '0');
  END LOOP;
  
  RETURN v_po_number;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- CREATE PURCHASE ORDER RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION create_purchase_order(
  p_vendor_id UUID,
  p_due_date DATE DEFAULT NULL,
  p_terms TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_lines JSONB DEFAULT '[]'::jsonb
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_workspace_id UUID;
  v_po_id UUID;
  v_po_number TEXT;
  v_line JSONB;
  v_line_number INTEGER := 1;
  v_subtotal DECIMAL := 0;
BEGIN
  -- Get workspace ID from JWT
  v_workspace_id := get_jwt_workspace_id();
  
  -- Check permissions (must have inventory role or admin)
  IF NOT (has_role('inventory') OR has_role('admin')) THEN
    RAISE EXCEPTION 'Insufficient permissions to create purchase orders';
  END IF;
  
  -- Generate PO number
  v_po_number := generate_po_number(v_workspace_id);
  
  -- Create the purchase order
  INSERT INTO purchase_orders (
    workspace_id, po_number, vendor_id, status,
    order_date, due_date, terms, notes,
    created_by, updated_by
  ) VALUES (
    v_workspace_id, v_po_number, p_vendor_id, 'draft',
    CURRENT_DATE, p_due_date, p_terms, p_notes,
    auth.uid(), auth.uid()
  )
  RETURNING id INTO v_po_id;
  
  -- Add PO lines if provided
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    INSERT INTO po_lines (
      workspace_id, po_id, item_id, qty, uom,
      expected_unit_cost, location_id, notes, line_number,
      created_by, updated_by
    ) VALUES (
      v_workspace_id, 
      v_po_id,
      (v_line->>'item_id')::UUID,
      (v_line->>'qty')::DECIMAL,
      v_line->>'uom',
      (v_line->>'expected_unit_cost')::DECIMAL,
      (v_line->>'location_id')::UUID,
      v_line->>'notes',
      v_line_number,
      auth.uid(), 
      auth.uid()
    );
    
    -- Calculate subtotal
    v_subtotal := v_subtotal + ((v_line->>'qty')::DECIMAL * (v_line->>'expected_unit_cost')::DECIMAL);
    v_line_number := v_line_number + 1;
  END LOOP;
  
  -- Update PO totals
  UPDATE purchase_orders
  SET 
    subtotal = v_subtotal,
    total = v_subtotal, -- Tax calculation would go here
    updated_at = NOW()
  WHERE id = v_po_id;
  
  -- Log audit
  INSERT INTO audit_logs (
    workspace_id, entity_table, entity_id, action,
    after, actor_user_id
  ) VALUES (
    v_workspace_id, 'purchase_orders', v_po_id, 'insert',
    jsonb_build_object(
      'po_number', v_po_number,
      'vendor_id', p_vendor_id,
      'status', 'draft',
      'total', v_subtotal
    ),
    auth.uid()
  );
  
  -- Fire telemetry event
  INSERT INTO ui_events (
    workspace_id, event_name, entity_type, entity_id,
    user_id, role
  ) VALUES (
    v_workspace_id, 'po_created', 'purchase_order', v_po_id,
    auth.uid(), get_current_user_role()
  );
  
  RETURN v_po_id;
END;
$$;

-- ============================================================================
-- APPROVE PURCHASE ORDER RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION approve_purchase_order(
  p_po_id UUID,
  p_notes TEXT DEFAULT NULL
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_workspace_id UUID;
  v_current_status po_status;
  v_po_number TEXT;
BEGIN
  -- Get workspace ID from JWT
  v_workspace_id := get_jwt_workspace_id();
  
  -- Check permissions (must have accounting role or admin)
  IF NOT (has_role('accounting') OR has_role('admin')) THEN
    RAISE EXCEPTION 'Insufficient permissions to approve purchase orders';
  END IF;
  
  -- Get current PO status
  SELECT status, po_number
  INTO v_current_status, v_po_number
  FROM purchase_orders
  WHERE id = p_po_id AND workspace_id = v_workspace_id;
  
  IF v_current_status IS NULL THEN
    RAISE EXCEPTION 'Purchase order not found';
  END IF;
  
  IF v_current_status != 'draft' THEN
    RAISE EXCEPTION 'Only draft purchase orders can be approved. Current status: %', v_current_status;
  END IF;
  
  -- Validate PO has lines
  IF NOT EXISTS (
    SELECT 1 FROM po_lines 
    WHERE po_id = p_po_id AND workspace_id = v_workspace_id
  ) THEN
    RAISE EXCEPTION 'Cannot approve PO without line items';
  END IF;
  
  -- Update PO status
  UPDATE purchase_orders
  SET 
    status = 'approved',
    approved_by = auth.uid(),
    approved_at = NOW(),
    notes = CASE 
      WHEN p_notes IS NOT NULL 
      THEN COALESCE(notes || E'\n' || 'Approval note: ' || p_notes, 'Approval note: ' || p_notes)
      ELSE notes
    END,
    updated_at = NOW(),
    updated_by = auth.uid()
  WHERE id = p_po_id;
  
  -- Log audit
  INSERT INTO audit_logs (
    workspace_id, entity_table, entity_id, action,
    before, after, actor_user_id
  ) VALUES (
    v_workspace_id, 'purchase_orders', p_po_id, 'update',
    jsonb_build_object('status', v_current_status),
    jsonb_build_object(
      'status', 'approved',
      'approved_by', auth.uid(),
      'approved_at', NOW()
    ),
    auth.uid()
  );
  
  RETURN TRUE;
END;
$$;

-- ============================================================================
-- RECEIVE PURCHASE ORDER RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION receive_purchase_order(
  p_po_id UUID,
  p_receipt_lines JSONB,
  p_notes TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_workspace_id UUID;
  v_receipt_id UUID;
  v_receipt_number TEXT;
  v_current_status po_status;
  v_line JSONB;
  v_po_line_qty DECIMAL;
  v_po_line_received DECIMAL;
  v_expected_cost DECIMAL;
  v_variance_pct DECIMAL;
  v_has_variance BOOLEAN := FALSE;
BEGIN
  -- Get workspace ID from JWT
  v_workspace_id := get_jwt_workspace_id();
  
  -- Check permissions (must have inventory role or admin)
  IF NOT (has_role('inventory') OR has_role('admin')) THEN
    RAISE EXCEPTION 'Insufficient permissions to receive purchase orders';
  END IF;
  
  -- Get PO status
  SELECT status
  INTO v_current_status
  FROM purchase_orders
  WHERE id = p_po_id AND workspace_id = v_workspace_id;
  
  IF v_current_status IS NULL THEN
    RAISE EXCEPTION 'Purchase order not found';
  END IF;
  
  IF v_current_status NOT IN ('approved', 'partial') THEN
    RAISE EXCEPTION 'Can only receive approved or partially received POs. Current status: %', v_current_status;
  END IF;
  
  -- Generate receipt number
  v_receipt_number := 'REC-' || TO_CHAR(NOW(), 'YYYYMMDD-HH24MISS');
  
  -- Create receipt header
  INSERT INTO po_receipts (
    workspace_id, po_id, receipt_number,
    received_by, received_at, notes, created_by
  ) VALUES (
    v_workspace_id, p_po_id, v_receipt_number,
    auth.uid(), NOW(), p_notes, auth.uid()
  )
  RETURNING id INTO v_receipt_id;
  
  -- Process each receipt line
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_receipt_lines)
  LOOP
    -- Get PO line details
    SELECT qty, COALESCE(qty_received, 0), expected_unit_cost
    INTO v_po_line_qty, v_po_line_received, v_expected_cost
    FROM po_lines
    WHERE id = (v_line->>'po_line_id')::UUID
      AND po_id = p_po_id
      AND workspace_id = v_workspace_id;
    
    IF v_po_line_qty IS NULL THEN
      RAISE EXCEPTION 'PO line not found: %', v_line->>'po_line_id';
    END IF;
    
    -- Check for over-receipt
    IF v_po_line_received + (v_line->>'qty_received')::DECIMAL > v_po_line_qty THEN
      -- Allow with admin override or if variance is within 10%
      IF NOT has_role('admin') AND 
         (v_po_line_received + (v_line->>'qty_received')::DECIMAL) > (v_po_line_qty * 1.1) THEN
        RAISE EXCEPTION 'Over-receipt not allowed. Ordered: %, Already received: %, Trying to receive: %',
          v_po_line_qty, v_po_line_received, (v_line->>'qty_received')::DECIMAL;
      END IF;
    END IF;
    
    -- Check for price variance
    v_variance_pct := ABS(((v_line->>'unit_cost')::DECIMAL - v_expected_cost) / v_expected_cost * 100);
    IF v_variance_pct > 5 THEN
      v_has_variance := TRUE;
    END IF;
    
    -- Create receipt line (trigger will handle lot creation and inventory)
    INSERT INTO po_receipt_lines (
      workspace_id, po_receipt_id, po_line_id,
      qty_received, unit_cost, lot_code, expiry,
      location_id, created_by
    ) VALUES (
      v_workspace_id, 
      v_receipt_id,
      (v_line->>'po_line_id')::UUID,
      (v_line->>'qty_received')::DECIMAL,
      (v_line->>'unit_cost')::DECIMAL,
      COALESCE(v_line->>'lot_code', 'LOT-' || TO_CHAR(NOW(), 'YYYYMMDD-HH24MISS')),
      (v_line->>'expiry')::DATE,
      (v_line->>'location_id')::UUID,
      auth.uid()
    );
  END LOOP;
  
  -- Log audit with variance flag
  INSERT INTO audit_logs (
    workspace_id, entity_table, entity_id, action,
    after, actor_user_id
  ) VALUES (
    v_workspace_id, 'po_receipts', v_receipt_id, 'insert',
    jsonb_build_object(
      'po_id', p_po_id,
      'receipt_number', v_receipt_number,
      'has_price_variance', v_has_variance,
      'line_count', jsonb_array_length(p_receipt_lines)
    ),
    auth.uid()
  );
  
  -- Fire telemetry event
  INSERT INTO ui_events (
    workspace_id, event_name, entity_type, entity_id,
    user_id, role
  ) VALUES (
    v_workspace_id, 'po_received', 'po_receipt', v_receipt_id,
    auth.uid(), get_current_user_role()
  );
  
  RETURN v_receipt_id;
END;
$$;

-- ============================================================================
-- GET PO VARIANCE ANALYSIS
-- ============================================================================

CREATE OR REPLACE FUNCTION get_po_variance_analysis(p_po_id UUID)
RETURNS TABLE (
  po_line_id UUID,
  item_name TEXT,
  ordered_qty DECIMAL,
  received_qty DECIMAL,
  qty_variance DECIMAL,
  expected_cost DECIMAL,
  actual_avg_cost DECIMAL,
  cost_variance_pct DECIMAL,
  total_value_variance DECIMAL
)
LANGUAGE sql
STABLE
AS $$
  SELECT 
    pol.id as po_line_id,
    i.name as item_name,
    pol.qty as ordered_qty,
    COALESCE(pol.qty_received, 0) as received_qty,
    pol.qty - COALESCE(pol.qty_received, 0) as qty_variance,
    pol.expected_unit_cost as expected_cost,
    COALESCE(
      AVG(prl.unit_cost),
      pol.expected_unit_cost
    ) as actual_avg_cost,
    CASE 
      WHEN pol.expected_unit_cost > 0 THEN
        ((COALESCE(AVG(prl.unit_cost), pol.expected_unit_cost) - pol.expected_unit_cost) 
          / pol.expected_unit_cost * 100)
      ELSE 0
    END as cost_variance_pct,
    COALESCE(pol.qty_received, 0) * 
      (COALESCE(AVG(prl.unit_cost), pol.expected_unit_cost) - pol.expected_unit_cost) 
      as total_value_variance
  FROM po_lines pol
  JOIN items i ON i.id = pol.item_id
  LEFT JOIN po_receipt_lines prl ON prl.po_line_id = pol.id
  WHERE pol.po_id = p_po_id
  GROUP BY pol.id, i.name, pol.qty, pol.qty_received, pol.expected_unit_cost
  ORDER BY pol.line_number;
$$;

-- ============================================================================
-- GET LOW STOCK ITEMS WITH REORDER SUGGESTIONS
-- ============================================================================

CREATE OR REPLACE FUNCTION get_low_stock_reorder_suggestions(
  p_workspace_id UUID DEFAULT NULL
)
RETURNS TABLE (
  item_id UUID,
  item_name TEXT,
  sku TEXT,
  vendor_id UUID,
  vendor_name TEXT,
  current_qty DECIMAL,
  reorder_level DECIMAL,
  reorder_qty DECIMAL,
  last_unit_cost DECIMAL,
  estimated_value DECIMAL,
  days_until_stockout INTEGER
)
LANGUAGE sql
STABLE
AS $$
  WITH inventory_summary AS (
    SELECT 
      i.id as item_id,
      i.name as item_name,
      i.sku,
      i.vendor_id,
      v.name as vendor_name,
      i.reorder_level,
      i.reorder_qty,
      COALESCE(SUM(il.qty), 0) as current_qty
    FROM items i
    LEFT JOIN item_lots il ON il.item_id = i.id AND il.qty > 0
    LEFT JOIN vendors v ON v.id = i.vendor_id
    WHERE i.workspace_id = COALESCE(p_workspace_id, get_jwt_workspace_id())
      AND i.is_active = true
      AND i.reorder_level IS NOT NULL
    GROUP BY i.id, i.name, i.sku, i.vendor_id, v.name, i.reorder_level, i.reorder_qty
  ),
  recent_costs AS (
    SELECT DISTINCT ON (item_id)
      item_id,
      unit_cost
    FROM supplier_price_history
    WHERE workspace_id = COALESCE(p_workspace_id, get_jwt_workspace_id())
    ORDER BY item_id, receipt_date DESC
  ),
  consumption_rate AS (
    SELECT 
      item_id,
      AVG(daily_usage) as avg_daily_usage
    FROM (
      SELECT 
        item_id,
        DATE_TRUNC('day', transaction_date) as day,
        SUM(ABS(qty)) as daily_usage
      FROM inventory_transactions
      WHERE workspace_id = COALESCE(p_workspace_id, get_jwt_workspace_id())
        AND type IN ('consume', 'ship')
        AND transaction_date >= CURRENT_DATE - INTERVAL '30 days'
      GROUP BY item_id, DATE_TRUNC('day', transaction_date)
    ) daily
    GROUP BY item_id
  )
  SELECT 
    inv.item_id,
    inv.item_name,
    inv.sku,
    inv.vendor_id,
    inv.vendor_name,
    inv.current_qty,
    inv.reorder_level,
    COALESCE(inv.reorder_qty, inv.reorder_level * 2) as reorder_qty,
    rc.unit_cost as last_unit_cost,
    COALESCE(inv.reorder_qty, inv.reorder_level * 2) * rc.unit_cost as estimated_value,
    CASE 
      WHEN cr.avg_daily_usage > 0 THEN 
        FLOOR(inv.current_qty / cr.avg_daily_usage)::INTEGER
      ELSE NULL
    END as days_until_stockout
  FROM inventory_summary inv
  LEFT JOIN recent_costs rc ON rc.item_id = inv.item_id
  LEFT JOIN consumption_rate cr ON cr.item_id = inv.item_id
  WHERE inv.current_qty <= inv.reorder_level
  ORDER BY 
    CASE 
      WHEN cr.avg_daily_usage > 0 THEN inv.current_qty / cr.avg_daily_usage
      ELSE 999999
    END ASC;
$$;

-- ============================================================================
-- CREATE PO FROM REORDER SUGGESTIONS
-- ============================================================================

CREATE OR REPLACE FUNCTION create_po_from_reorder_suggestions(
  p_vendor_id UUID,
  p_item_ids UUID[],
  p_due_date DATE DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_workspace_id UUID;
  v_po_id UUID;
  v_lines JSONB := '[]'::jsonb;
  v_item RECORD;
  v_default_location UUID;
BEGIN
  -- Get workspace ID from JWT
  v_workspace_id := get_jwt_workspace_id();
  
  -- Get default location
  SELECT id INTO v_default_location
  FROM inventory_locations
  WHERE workspace_id = v_workspace_id AND is_default = true
  LIMIT 1;
  
  IF v_default_location IS NULL THEN
    SELECT id INTO v_default_location
    FROM inventory_locations
    WHERE workspace_id = v_workspace_id
    LIMIT 1;
  END IF;
  
  -- Build lines array from reorder suggestions
  FOR v_item IN 
    SELECT * FROM get_low_stock_reorder_suggestions(v_workspace_id)
    WHERE vendor_id = p_vendor_id
      AND item_id = ANY(p_item_ids)
  LOOP
    v_lines := v_lines || jsonb_build_object(
      'item_id', v_item.item_id,
      'qty', v_item.reorder_qty,
      'uom', (SELECT uom FROM items WHERE id = v_item.item_id),
      'expected_unit_cost', COALESCE(v_item.last_unit_cost, 0),
      'location_id', v_default_location,
      'notes', 'Auto-generated from reorder suggestion'
    );
  END LOOP;
  
  -- Create the PO
  v_po_id := create_purchase_order(
    p_vendor_id,
    COALESCE(p_due_date, (CURRENT_DATE + INTERVAL '7 days')::date),
    NULL,
    'Generated from low stock reorder suggestions',
    v_lines
  );
  
  RETURN v_po_id;
END;
$$;

-- ============================================================================
-- INDEXES FOR PERFORMANCE
-- ============================================================================

-- Index for PO lookups
CREATE INDEX IF NOT EXISTS idx_purchase_orders_workspace_status 
  ON purchase_orders(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_vendor 
  ON purchase_orders(workspace_id, vendor_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_created 
  ON purchase_orders(workspace_id, created_at DESC);

-- Index for PO lines
CREATE INDEX IF NOT EXISTS idx_po_lines_po_id 
  ON po_lines(po_id);
CREATE INDEX IF NOT EXISTS idx_po_lines_item 
  ON po_lines(workspace_id, item_id);

-- Index for receipts
CREATE INDEX IF NOT EXISTS idx_po_receipts_po 
  ON po_receipts(po_id);
CREATE INDEX IF NOT EXISTS idx_po_receipt_lines_receipt 
  ON po_receipt_lines(po_receipt_id);

-- Index for supplier price history
CREATE INDEX IF NOT EXISTS idx_supplier_price_history_item_date 
  ON supplier_price_history(workspace_id, item_id, receipt_date DESC);

-- ============================================================================
-- GRANT PERMISSIONS
-- ============================================================================

-- Grant execute permissions on functions
GRANT EXECUTE ON FUNCTION generate_po_number TO authenticated;
GRANT EXECUTE ON FUNCTION create_purchase_order TO authenticated;
GRANT EXECUTE ON FUNCTION approve_purchase_order TO authenticated;
GRANT EXECUTE ON FUNCTION receive_purchase_order TO authenticated;
GRANT EXECUTE ON FUNCTION get_po_variance_analysis TO authenticated;
GRANT EXECUTE ON FUNCTION get_low_stock_reorder_suggestions TO authenticated;
GRANT EXECUTE ON FUNCTION create_po_from_reorder_suggestions TO authenticated;
-- Phase 3 Security & Completeness Migration
-- This migration addresses critical security vulnerabilities and missing production requirements
-- for the purchasing and receiving system

-- ============================================================================
-- PART 1: CRITICAL RLS POLICIES (Security Vulnerability Fix)
-- ============================================================================

-- Enable RLS on all PO-related tables (if not already enabled)
ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE po_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE po_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE po_receipt_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;

-- Drop existing basic policies to rebuild comprehensively
DROP POLICY IF EXISTS po_receipts_workspace ON po_receipts;
DROP POLICY IF EXISTS po_receipts_insert ON po_receipts;
DROP POLICY IF EXISTS po_receipts_update ON po_receipts;
DROP POLICY IF EXISTS po_receipt_lines_workspace ON po_receipt_lines;
DROP POLICY IF EXISTS po_receipt_lines_insert ON po_receipt_lines;
DROP POLICY IF EXISTS po_lines_cost_visibility ON po_lines;
DROP POLICY IF EXISTS vendors_workspace ON vendors;
DROP POLICY IF EXISTS workspace_isolation_vendors ON vendors;

-- ============================================================================
-- Purchase Orders RLS Policies
-- ============================================================================

-- View POs (all authenticated users in workspace)
CREATE POLICY po_select ON purchase_orders
  FOR SELECT
  USING (workspace_id = get_jwt_workspace_id());

-- Create POs (inventory and admin only)
CREATE POLICY po_insert ON purchase_orders
  FOR INSERT
  WITH CHECK (
    workspace_id = get_jwt_workspace_id()
    AND (has_role('inventory') OR has_role('admin'))
  );

-- Update POs (inventory and admin, only draft status)
CREATE POLICY po_update ON purchase_orders
  FOR UPDATE
  USING (
    workspace_id = get_jwt_workspace_id()
    AND (has_role('inventory') OR has_role('admin'))
  )
  WITH CHECK (
    workspace_id = get_jwt_workspace_id()
    AND (has_role('inventory') OR has_role('admin'))
    -- Can only edit draft POs unless admin
    AND (status = 'draft' OR has_role('admin'))
  );

-- Delete POs (admin only, draft only)
CREATE POLICY po_delete ON purchase_orders
  FOR DELETE
  USING (
    workspace_id = get_jwt_workspace_id()
    AND has_role('admin')
    AND status = 'draft'
  );

-- ============================================================================
-- PO Lines RLS Policies with Cost Visibility
-- ============================================================================

-- View PO lines (with cost redaction for non-authorized roles)
CREATE POLICY po_lines_select ON po_lines
  FOR SELECT
  USING (workspace_id = get_jwt_workspace_id());

-- Create PO lines
CREATE POLICY po_lines_insert ON po_lines
  FOR INSERT
  WITH CHECK (
    workspace_id = get_jwt_workspace_id()
    AND (has_role('inventory') OR has_role('admin'))
    AND EXISTS (
      SELECT 1 FROM purchase_orders
      WHERE id = po_lines.po_id
      AND workspace_id = get_jwt_workspace_id()
      AND status = 'draft'
    )
  );

-- Update PO lines (only on draft POs)
CREATE POLICY po_lines_update ON po_lines
  FOR UPDATE
  USING (
    workspace_id = get_jwt_workspace_id()
    AND (has_role('inventory') OR has_role('admin'))
    AND EXISTS (
      SELECT 1 FROM purchase_orders
      WHERE id = po_lines.po_id
      AND status = 'draft'
    )
  )
  WITH CHECK (
    workspace_id = get_jwt_workspace_id()
    AND (has_role('inventory') OR has_role('admin'))
  );

-- Delete PO lines (only on draft POs)
CREATE POLICY po_lines_delete ON po_lines
  FOR DELETE
  USING (
    workspace_id = get_jwt_workspace_id()
    AND (has_role('inventory') OR has_role('admin'))
    AND EXISTS (
      SELECT 1 FROM purchase_orders
      WHERE id = po_lines.po_id
      AND status = 'draft'
    )
  );

-- ============================================================================
-- PO Receipts RLS Policies
-- ============================================================================

-- View receipts
CREATE POLICY po_receipts_select ON po_receipts
  FOR SELECT
  USING (workspace_id = get_jwt_workspace_id());

-- Create receipts (inventory and admin only)
CREATE POLICY po_receipts_insert ON po_receipts
  FOR INSERT
  WITH CHECK (
    workspace_id = get_jwt_workspace_id()
    AND (has_role('inventory') OR has_role('admin'))
    AND EXISTS (
      SELECT 1 FROM purchase_orders
      WHERE id = po_receipts.po_id
      AND workspace_id = get_jwt_workspace_id()
      AND status IN ('approved', 'partial')
    )
  );

-- Update receipts (admin only, for corrections)
CREATE POLICY po_receipts_update ON po_receipts
  FOR UPDATE
  USING (
    workspace_id = get_jwt_workspace_id()
    AND has_role('admin')
  )
  WITH CHECK (
    workspace_id = get_jwt_workspace_id()
    AND has_role('admin')
  );

-- Delete receipts (admin only)
CREATE POLICY po_receipts_delete ON po_receipts
  FOR DELETE
  USING (
    workspace_id = get_jwt_workspace_id()
    AND has_role('admin')
  );

-- ============================================================================
-- PO Receipt Lines RLS Policies
-- ============================================================================

-- View receipt lines
CREATE POLICY po_receipt_lines_select ON po_receipt_lines
  FOR SELECT
  USING (workspace_id = get_jwt_workspace_id());

-- Create receipt lines
CREATE POLICY po_receipt_lines_insert ON po_receipt_lines
  FOR INSERT
  WITH CHECK (
    workspace_id = get_jwt_workspace_id()
    AND (has_role('inventory') OR has_role('admin'))
  );

-- Update receipt lines (admin only)
CREATE POLICY po_receipt_lines_update ON po_receipt_lines
  FOR UPDATE
  USING (
    workspace_id = get_jwt_workspace_id()
    AND has_role('admin')
  )
  WITH CHECK (
    workspace_id = get_jwt_workspace_id()
    AND has_role('admin')
  );

-- Delete receipt lines (admin only)
CREATE POLICY po_receipt_lines_delete ON po_receipt_lines
  FOR DELETE
  USING (
    workspace_id = get_jwt_workspace_id()
    AND has_role('admin')
  );

-- ============================================================================
-- Vendors RLS Policies
-- ============================================================================

-- View vendors
CREATE POLICY vendors_select ON vendors
  FOR SELECT
  USING (workspace_id = get_jwt_workspace_id());

-- Create vendors
CREATE POLICY vendors_insert ON vendors
  FOR INSERT
  WITH CHECK (
    workspace_id = get_jwt_workspace_id()
    AND (has_role('inventory') OR has_role('admin'))
  );

-- Update vendors
CREATE POLICY vendors_update ON vendors
  FOR UPDATE
  USING (
    workspace_id = get_jwt_workspace_id()
    AND (has_role('inventory') OR has_role('admin'))
  )
  WITH CHECK (
    workspace_id = get_jwt_workspace_id()
    AND (has_role('inventory') OR has_role('admin'))
  );

-- Delete vendors (admin only, only if no POs)
CREATE POLICY vendors_delete ON vendors
  FOR DELETE
  USING (
    workspace_id = get_jwt_workspace_id()
    AND has_role('admin')
    AND NOT EXISTS (
      SELECT 1 FROM purchase_orders
      WHERE vendor_id = vendors.id
    )
  );

-- ============================================================================
-- PART 2: MISSING DATABASE CONSTRAINTS (Data Integrity)
-- ============================================================================

-- Purchase Orders constraints
ALTER TABLE purchase_orders 
  ADD CONSTRAINT check_po_total_positive 
  CHECK (total IS NULL OR total >= 0);

-- PO Lines constraints
ALTER TABLE po_lines
  ADD CONSTRAINT check_po_line_qty_positive
  CHECK (qty > 0);

ALTER TABLE po_lines
  ADD CONSTRAINT check_po_line_cost_non_negative
  CHECK (expected_unit_cost >= 0);

ALTER TABLE po_lines
  ADD CONSTRAINT check_po_line_number_positive
  CHECK (line_number > 0);

-- PO Receipt Lines constraints
ALTER TABLE po_receipt_lines
  ADD CONSTRAINT check_receipt_qty_positive
  CHECK (qty_received > 0);

ALTER TABLE po_receipt_lines
  ADD CONSTRAINT check_receipt_cost_non_negative
  CHECK (unit_cost >= 0);

-- Vendor constraints
ALTER TABLE vendors
  ADD CONSTRAINT check_vendor_credit_limit
  CHECK (credit_limit IS NULL OR credit_limit >= 0);

-- Add unique constraint to prevent duplicate PO numbers (if not exists)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'unique_po_number_per_workspace'
  ) THEN
    ALTER TABLE purchase_orders
      ADD CONSTRAINT unique_po_number_per_workspace
      UNIQUE (workspace_id, po_number);
  END IF;
END $$;

-- ============================================================================
-- PART 3: PERFORMANCE INDEXES
-- ============================================================================

-- Composite indexes for common queries
CREATE INDEX IF NOT EXISTS idx_po_lines_po_item 
  ON po_lines(po_id, item_id);

CREATE INDEX IF NOT EXISTS idx_purchase_orders_status_date 
  ON purchase_orders(workspace_id, status, due_date);

CREATE INDEX IF NOT EXISTS idx_po_receipts_po_date 
  ON po_receipts(po_id, received_at);

CREATE INDEX IF NOT EXISTS idx_supplier_price_history_item_date 
  ON supplier_price_history(item_id, vendor_id, receipt_date DESC);

-- Index for reorder suggestions
CREATE INDEX IF NOT EXISTS idx_items_reorder 
  ON items(workspace_id, reorder_level) 
  WHERE reorder_level IS NOT NULL;

-- ============================================================================
-- PART 4: COST VISIBILITY VIEWS (Redacted for Brewer Role)
-- ============================================================================

-- Create cost-redacted view for PO lines
CREATE OR REPLACE VIEW v_po_lines_secure AS
SELECT 
  id,
  workspace_id,
  po_id,
  item_id,
  qty,
  uom,
  CASE 
    WHEN has_cost_visibility() THEN expected_unit_cost
    ELSE NULL
  END as expected_unit_cost,
  CASE 
    WHEN has_cost_visibility() THEN qty * expected_unit_cost
    ELSE NULL
  END as line_total,
  line_number,
  notes,
  created_at,
  updated_at
FROM po_lines;

-- Create cost-redacted view for receipts
CREATE OR REPLACE VIEW v_po_receipt_lines_secure AS
SELECT 
  id,
  workspace_id,
  po_receipt_id,
  po_line_id,
  qty_received,
  CASE 
    WHEN has_cost_visibility() THEN unit_cost
    ELSE NULL
  END as unit_cost,
  lot_code,
  expiry,
  location_id,
  override_reason,
  created_at
FROM po_receipt_lines;

-- ============================================================================
-- PART 5: AUDIT TRIGGER FOR PO MODIFICATIONS
-- ============================================================================

-- Create audit trigger for purchase orders
CREATE OR REPLACE FUNCTION audit_purchase_order_changes()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- Log significant changes
    IF OLD.status != NEW.status OR 
       OLD.total != NEW.total OR
       OLD.approved_by IS DISTINCT FROM NEW.approved_by THEN
      INSERT INTO audit_logs (
        workspace_id,
        entity_table,
        entity_id,
        action,
        before,
        after,
        actor_user_id,
        created_at
      ) VALUES (
        NEW.workspace_id,
        'purchase_orders',
        NEW.id,
        'update',
        jsonb_build_object(
          'status', OLD.status,
          'total', OLD.total,
          'approved_by', OLD.approved_by
        ),
        jsonb_build_object(
          'status', NEW.status,
          'total', NEW.total,
          'approved_by', NEW.approved_by
        ),
        auth.uid(),
        now()
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Attach audit trigger
DROP TRIGGER IF EXISTS audit_po_changes ON purchase_orders;
CREATE TRIGGER audit_po_changes
  AFTER UPDATE ON purchase_orders
  FOR EACH ROW
  EXECUTE FUNCTION audit_purchase_order_changes();

-- ============================================================================
-- PART 6: FUNCTIONS FOR EDIT/CANCEL PO (Missing Core Functionality)
-- ============================================================================

-- Function to safely edit a purchase order
CREATE OR REPLACE FUNCTION edit_purchase_order(
  p_po_id UUID,
  p_due_date DATE DEFAULT NULL,
  p_terms TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_lines JSONB DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_workspace_id UUID;
  v_status TEXT;
  v_line JSONB;
BEGIN
  -- Get PO details and validate
  SELECT workspace_id, status 
  INTO v_workspace_id, v_status
  FROM purchase_orders
  WHERE id = p_po_id;
  
  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'Purchase order not found';
  END IF;
  
  IF v_workspace_id != get_jwt_workspace_id() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  
  -- Only draft POs can be edited (unless admin)
  IF v_status != 'draft' AND NOT has_role('admin') THEN
    RAISE EXCEPTION 'Only draft POs can be edited';
  END IF;
  
  -- Update PO header
  UPDATE purchase_orders
  SET 
    due_date = COALESCE(p_due_date, due_date),
    terms = COALESCE(p_terms, terms),
    notes = COALESCE(p_notes, notes),
    updated_at = now(),
    updated_by = auth.uid()
  WHERE id = p_po_id;
  
  -- Update lines if provided
  IF p_lines IS NOT NULL THEN
    -- Delete existing lines
    DELETE FROM po_lines WHERE po_id = p_po_id;
    
    -- Insert new lines
    FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
    LOOP
      INSERT INTO po_lines (
        workspace_id,
        po_id,
        item_id,
        qty,
        uom,
        expected_unit_cost,
        line_number,
        notes
      ) VALUES (
        v_workspace_id,
        p_po_id,
        (v_line->>'item_id')::UUID,
        (v_line->>'qty')::NUMERIC,
        v_line->>'uom',
        (v_line->>'expected_unit_cost')::NUMERIC,
        (v_line->>'line_number')::INT,
        v_line->>'notes'
      );
    END LOOP;
    
    -- Update total
    UPDATE purchase_orders
    SET total = (
      SELECT SUM(qty * expected_unit_cost)
      FROM po_lines
      WHERE po_id = p_po_id
    )
    WHERE id = p_po_id;
  END IF;
  
  RETURN p_po_id;
END;
$$;

-- Function to cancel a purchase order
DROP FUNCTION IF EXISTS cancel_purchase_order(UUID, TEXT);
CREATE OR REPLACE FUNCTION cancel_purchase_order(
  p_po_id UUID,
  p_reason TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_workspace_id UUID;
  v_status TEXT;
  v_has_receipts BOOLEAN;
BEGIN
  -- Get PO details
  SELECT workspace_id, status 
  INTO v_workspace_id, v_status
  FROM purchase_orders
  WHERE id = p_po_id;
  
  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'Purchase order not found';
  END IF;
  
  IF v_workspace_id != get_jwt_workspace_id() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  
  -- Check if PO has receipts
  SELECT EXISTS(
    SELECT 1 FROM po_receipts WHERE po_id = p_po_id
  ) INTO v_has_receipts;
  
  IF v_has_receipts THEN
    RAISE EXCEPTION 'Cannot cancel PO with receipts';
  END IF;
  
  IF v_status IN ('closed', 'cancelled') THEN
    RAISE EXCEPTION 'PO is already %', v_status;
  END IF;
  
  -- Cancel the PO
  UPDATE purchase_orders
  SET 
    status = 'cancelled',
    notes = COALESCE(notes || E'\n', '') || 'Cancelled: ' || p_reason,
    updated_at = now(),
    updated_by = auth.uid()
  WHERE id = p_po_id;
  
  -- Log cancellation
  INSERT INTO audit_logs (
    workspace_id,
    entity_table,
    entity_id,
    action,
    after,
    actor_user_id,
    created_at
  ) VALUES (
    v_workspace_id,
    'purchase_orders',
    p_po_id,
    'cancel',
    jsonb_build_object('reason', p_reason),
    auth.uid(),
    now()
  );
END;
$$;

-- ============================================================================
-- PART 7: FIX RACE CONDITIONS IN RECEIVING
-- ============================================================================

-- Enhanced receive function with row-level locking
CREATE OR REPLACE FUNCTION receive_purchase_order(
  p_po_id UUID,
  p_receipt_lines JSONB,
  p_notes TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_workspace_id UUID;
  v_receipt_id UUID;
  v_po_status TEXT;
  v_line JSONB;
  v_po_line RECORD;
  v_total_ordered NUMERIC;
  v_total_received NUMERIC;
  v_new_status TEXT;
BEGIN
  -- Lock the PO row to prevent concurrent modifications
  SELECT workspace_id, status
  INTO v_workspace_id, v_po_status
  FROM purchase_orders
  WHERE id = p_po_id
  FOR UPDATE;
  
  -- Validations
  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'Purchase order not found';
  END IF;
  
  IF v_workspace_id != get_jwt_workspace_id() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  
  IF v_po_status NOT IN ('approved', 'partial') THEN
    RAISE EXCEPTION 'PO must be approved to receive. Current status: %', v_po_status;
  END IF;
  
  IF NOT (has_role('inventory') OR has_role('admin')) THEN
    RAISE EXCEPTION 'Insufficient permissions to receive purchase orders';
  END IF;
  
  -- Create receipt header
  v_receipt_id := gen_random_uuid();
  INSERT INTO po_receipts (
    id,
    workspace_id,
    po_id,
    received_by,
    received_at,
    notes
  ) VALUES (
    v_receipt_id,
    v_workspace_id,
    p_po_id,
    auth.uid(),
    now(),
    p_notes
  );
  
  -- Process receipt lines
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_receipt_lines)
  LOOP
    -- Lock and validate the PO line
    SELECT * INTO v_po_line
    FROM po_lines
    WHERE id = (v_line->>'po_line_id')::UUID
    FOR UPDATE;
    
    IF v_po_line.po_id != p_po_id THEN
      RAISE EXCEPTION 'PO line does not belong to this PO';
    END IF;
    
    -- Check for over-receipt
    IF (v_line->>'qty_received')::NUMERIC > 
       (v_po_line.qty - COALESCE(v_po_line.qty_received, 0)) * 1.1 -- 10% tolerance
       AND (v_line->>'override_reason') IS NULL THEN
      RAISE EXCEPTION 'Over-receipt requires override reason';
    END IF;
    
    -- Create receipt line
    INSERT INTO po_receipt_lines (
      workspace_id,
      po_receipt_id,
      po_line_id,
      qty_received,
      unit_cost,
      lot_code,
      expiry,
      location_id,
      override_reason
    ) VALUES (
      v_workspace_id,
      v_receipt_id,
      (v_line->>'po_line_id')::UUID,
      (v_line->>'qty_received')::NUMERIC,
      (v_line->>'unit_cost')::NUMERIC,
      v_line->>'lot_code',
      (v_line->>'expiry')::DATE,
      (v_line->>'location_id')::UUID,
      v_line->>'override_reason'
    );
    
    -- Update cumulative received quantity
    UPDATE po_lines
    SET qty_received = COALESCE(qty_received, 0) + (v_line->>'qty_received')::NUMERIC
    WHERE id = (v_line->>'po_line_id')::UUID;
  END LOOP;
  
  -- Calculate new PO status
  SELECT 
    SUM(qty) as total_ordered,
    SUM(COALESCE(qty_received, 0)) as total_received
  INTO v_total_ordered, v_total_received
  FROM po_lines
  WHERE po_id = p_po_id;
  
  IF v_total_received >= v_total_ordered THEN
    v_new_status := 'received';
  ELSE
    v_new_status := 'partial';
  END IF;
  
  -- Update PO status
  UPDATE purchase_orders
  SET 
    status = v_new_status,
    updated_at = now(),
    updated_by = auth.uid()
  WHERE id = p_po_id;
  
  RETURN v_receipt_id;
END;
$$;

-- ============================================================================
-- PART 8: STATUS RECALCULATION TRIGGER
-- ============================================================================

-- Function to recalculate PO status when receipts change
CREATE OR REPLACE FUNCTION recalculate_po_status()
RETURNS TRIGGER AS $$
DECLARE
  v_po_id UUID;
  v_total_ordered NUMERIC;
  v_total_received NUMERIC;
  v_new_status TEXT;
BEGIN
  -- Get the PO ID from the receipt
  IF TG_OP = 'DELETE' THEN
    SELECT po_id INTO v_po_id FROM po_receipts WHERE id = OLD.po_receipt_id;
  ELSE
    SELECT po_id INTO v_po_id FROM po_receipts WHERE id = NEW.po_receipt_id;
  END IF;
  
  -- Recalculate quantities
  SELECT 
    SUM(qty) as total_ordered,
    SUM(COALESCE(qty_received, 0)) as total_received
  INTO v_total_ordered, v_total_received
  FROM po_lines
  WHERE po_id = v_po_id;
  
  -- Determine new status
  IF v_total_received = 0 THEN
    v_new_status := 'approved';
  ELSIF v_total_received >= v_total_ordered THEN
    v_new_status := 'received';
  ELSE
    v_new_status := 'partial';
  END IF;
  
  -- Update PO status if it's not cancelled or closed
  UPDATE purchase_orders
  SET status = v_new_status
  WHERE id = v_po_id
  AND status NOT IN ('cancelled', 'closed');
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Attach trigger for receipt line changes
DROP TRIGGER IF EXISTS recalc_po_status_on_receipt ON po_receipt_lines;
CREATE TRIGGER recalc_po_status_on_receipt
  AFTER INSERT OR UPDATE OR DELETE ON po_receipt_lines
  FOR EACH ROW
  EXECUTE FUNCTION recalculate_po_status();

-- ============================================================================
-- PART 9: ENHANCED REORDER SUGGESTIONS (Include In-Transit)
-- ============================================================================

-- Drop and recreate the function with in-transit consideration
DROP FUNCTION IF EXISTS get_low_stock_reorder_suggestions;

CREATE OR REPLACE FUNCTION get_low_stock_reorder_suggestions(
  p_workspace_id UUID DEFAULT NULL
)
RETURNS TABLE (
  item_id UUID,
  item_name TEXT,
  sku TEXT,
  current_stock NUMERIC,
  reorder_level NUMERIC,
  in_transit NUMERIC,
  available_stock NUMERIC,
  suggested_order_qty NUMERIC,
  vendor_id UUID,
  vendor_name TEXT,
  last_unit_cost NUMERIC,
  days_until_stockout INTEGER
) 
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  WITH stock_levels AS (
    SELECT 
      i.id as item_id,
      i.name as item_name,
      i.sku,
      i.reorder_level,
      i.reorder_qty,
      i.vendor_id,
      COALESCE(SUM(il.qty), 0) as current_stock
    FROM items i
    LEFT JOIN item_lots il ON il.item_id = i.id
    WHERE i.workspace_id = COALESCE(p_workspace_id, get_jwt_workspace_id())
      AND i.reorder_level IS NOT NULL
    GROUP BY i.id
  ),
  in_transit_qty AS (
    SELECT 
      pl.item_id,
      SUM(pl.qty - COALESCE(pl.qty_received, 0)) as in_transit
    FROM po_lines pl
    JOIN purchase_orders po ON po.id = pl.po_id
    WHERE po.workspace_id = COALESCE(p_workspace_id, get_jwt_workspace_id())
      AND po.status IN ('approved', 'partial')
    GROUP BY pl.item_id
  ),
  last_prices AS (
    SELECT DISTINCT ON (item_id)
      item_id,
      unit_cost
    FROM supplier_price_history
    WHERE workspace_id = COALESCE(p_workspace_id, get_jwt_workspace_id())
    ORDER BY item_id, receipt_date DESC
  ),
  usage_rates AS (
    SELECT 
      item_id,
      AVG(daily_usage) as avg_daily_usage
    FROM (
      SELECT 
        il.item_id,
        DATE(it.created_at) as usage_date,
        SUM(ABS(it.qty)) as daily_usage
      FROM inventory_transactions it
      JOIN item_lots il ON il.id = it.item_lot_id
      WHERE it.workspace_id = COALESCE(p_workspace_id, get_jwt_workspace_id())
        AND it.type IN ('consume', 'ship')
        AND it.created_at > CURRENT_DATE - INTERVAL '30 days'
      GROUP BY il.item_id, DATE(it.created_at)
    ) daily_totals
    GROUP BY item_id
  )
  SELECT 
    sl.item_id,
    sl.item_name,
    sl.sku,
    sl.current_stock,
    sl.reorder_level,
    COALESCE(it.in_transit, 0) as in_transit,
    sl.current_stock + COALESCE(it.in_transit, 0) as available_stock,
    GREATEST(
      0,
      sl.reorder_level * 2 - sl.current_stock - COALESCE(it.in_transit, 0),
      COALESCE(sl.reorder_qty, sl.reorder_level)
    ) as suggested_order_qty,
    sl.vendor_id,
    v.name as vendor_name,
    lp.unit_cost as last_unit_cost,
    CASE 
      WHEN ur.avg_daily_usage > 0 THEN 
        FLOOR((sl.current_stock + COALESCE(it.in_transit, 0)) / ur.avg_daily_usage)::INTEGER
      ELSE NULL
    END as days_until_stockout
  FROM stock_levels sl
  LEFT JOIN in_transit_qty it ON it.item_id = sl.item_id
  LEFT JOIN vendors v ON v.id = sl.vendor_id
  LEFT JOIN last_prices lp ON lp.item_id = sl.item_id
  LEFT JOIN usage_rates ur ON ur.item_id = sl.item_id
  WHERE sl.current_stock + COALESCE(it.in_transit, 0) <= sl.reorder_level
  ORDER BY 
    CASE 
      WHEN ur.avg_daily_usage > 0 THEN 
        (sl.current_stock + COALESCE(it.in_transit, 0)) / ur.avg_daily_usage
      ELSE 999
    END ASC,
    sl.item_name;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION get_low_stock_reorder_suggestions TO authenticated;
GRANT EXECUTE ON FUNCTION edit_purchase_order TO authenticated;
GRANT EXECUTE ON FUNCTION cancel_purchase_order TO authenticated;

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================

-- Verify all RLS policies are in place
DO $$
BEGIN
  RAISE NOTICE 'RLS Policy Check:';
  RAISE NOTICE 'Purchase Orders: % policies', (SELECT COUNT(*) FROM pg_policies WHERE tablename = 'purchase_orders');
  RAISE NOTICE 'PO Lines: % policies', (SELECT COUNT(*) FROM pg_policies WHERE tablename = 'po_lines');
  RAISE NOTICE 'PO Receipts: % policies', (SELECT COUNT(*) FROM pg_policies WHERE tablename = 'po_receipts');
  RAISE NOTICE 'PO Receipt Lines: % policies', (SELECT COUNT(*) FROM pg_policies WHERE tablename = 'po_receipt_lines');
  RAISE NOTICE 'Vendors: % policies', (SELECT COUNT(*) FROM pg_policies WHERE tablename = 'vendors');
END $$;
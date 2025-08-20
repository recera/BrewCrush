-- Phase 3 Critical Fixes: Security, RLS, Constraints, and Performance
-- This migration addresses all critical issues identified in the Phase 3 audit

-- ========================================
-- 1. ADD MISSING CHECK CONSTRAINTS
-- ========================================

-- Ensure positive quantities and costs
ALTER TABLE po_lines 
  ADD CONSTRAINT check_positive_qty CHECK (qty > 0),
  ADD CONSTRAINT check_positive_cost CHECK (expected_unit_cost >= 0);

ALTER TABLE po_receipt_lines 
  ADD CONSTRAINT check_qty_received CHECK (qty_received > 0),
  ADD CONSTRAINT check_positive_actual_cost CHECK (unit_cost >= 0);

-- Add cancelled status to po_status enum if it doesn't exist
DO $$ 
BEGIN
  -- Check if 'cancelled' value exists in po_status enum
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum 
    WHERE enumlabel = 'cancelled' 
    AND enumtypid = 'po_status'::regtype
  ) THEN
    ALTER TYPE po_status ADD VALUE 'cancelled' AFTER 'closed';
  END IF;
END $$;

-- Ensure valid status transitions (now including cancelled)
ALTER TABLE purchase_orders
  ADD CONSTRAINT check_valid_status CHECK (
    status::text IN ('draft', 'approved', 'partial', 'received', 'closed', 'cancelled')
  );

-- Prevent duplicate PO numbers per workspace
ALTER TABLE purchase_orders
  ADD CONSTRAINT unique_po_number_per_workspace 
  UNIQUE(workspace_id, po_number);

-- Ensure receipt quantities don't exceed ordered (will be enforced in function)
ALTER TABLE po_receipt_lines
  ADD COLUMN override_reason TEXT,
  ADD COLUMN override_approved_by UUID REFERENCES users(id);

-- ========================================
-- 2. ADD MISSING INDEXES FOR PERFORMANCE
-- ========================================

-- Composite indexes for common queries
CREATE INDEX IF NOT EXISTS idx_po_lines_po_item 
  ON po_lines(po_id, item_id);

CREATE INDEX IF NOT EXISTS idx_po_status_date 
  ON purchase_orders(status, due_date) 
  WHERE status NOT IN ('closed', 'cancelled');

CREATE INDEX IF NOT EXISTS idx_po_vendor_status 
  ON purchase_orders(vendor_id, status);

CREATE INDEX IF NOT EXISTS idx_supplier_price_history_item_date 
  ON supplier_price_history(item_id, receipt_date DESC);

CREATE INDEX IF NOT EXISTS idx_po_receipts_po_id 
  ON po_receipts(po_id);

CREATE INDEX IF NOT EXISTS idx_po_receipt_lines_receipt 
  ON po_receipt_lines(po_receipt_id);

-- Index for reorder suggestions (items below reorder level)
CREATE INDEX IF NOT EXISTS idx_items_reorder 
  ON items(workspace_id, reorder_level) 
  WHERE reorder_level IS NOT NULL;

-- ========================================
-- 3. ENABLE RLS ON ALL PO TABLES
-- ========================================

-- Enable RLS on po_receipts
ALTER TABLE po_receipts ENABLE ROW LEVEL SECURITY;

-- Enable RLS on po_receipt_lines
ALTER TABLE po_receipt_lines ENABLE ROW LEVEL SECURITY;

-- ========================================
-- 4. CREATE RLS POLICIES
-- ========================================

-- Policies for po_receipts
CREATE POLICY po_receipts_workspace ON po_receipts
  FOR ALL
  USING (workspace_id = get_jwt_workspace_id());

CREATE POLICY po_receipts_insert ON po_receipts
  FOR INSERT 
  WITH CHECK (
    workspace_id = get_jwt_workspace_id() 
    AND (has_role('inventory'::role) OR has_role('admin'::role))
  );

CREATE POLICY po_receipts_update ON po_receipts
  FOR UPDATE
  USING (
    workspace_id = get_jwt_workspace_id() 
    AND (has_role('inventory'::role) OR has_role('admin'::role))
  );

-- Policies for po_receipt_lines
CREATE POLICY po_receipt_lines_workspace ON po_receipt_lines
  FOR ALL
  USING (workspace_id = get_jwt_workspace_id());

CREATE POLICY po_receipt_lines_insert ON po_receipt_lines
  FOR INSERT
  WITH CHECK (
    workspace_id = get_jwt_workspace_id() 
    AND (has_role('inventory'::role) OR has_role('admin'::role))
  );

-- Cost visibility policy for po_lines (SELECT only)
CREATE POLICY po_lines_cost_visibility ON po_lines
  FOR SELECT
  USING (
    workspace_id = get_jwt_workspace_id()
    AND (
      has_cost_visibility() 
      OR expected_unit_cost IS NULL
      OR has_role('admin'::role)
    )
  );

-- Vendor table policies
CREATE POLICY vendors_workspace ON vendors
  FOR ALL
  USING (workspace_id = get_jwt_workspace_id());

-- ========================================
-- 5. ADD PO APPROVAL WORKFLOW TABLES
-- ========================================

CREATE TABLE IF NOT EXISTS po_approval_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  min_amount DECIMAL(12,2),
  max_amount DECIMAL(12,2),
  required_role role NOT NULL,
  required_approvals INT DEFAULT 1,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ DEFAULT now(),
  updated_by UUID REFERENCES users(id),
  CONSTRAINT check_amount_range CHECK (
    (min_amount IS NULL OR min_amount >= 0) 
    AND (max_amount IS NULL OR max_amount >= 0)
    AND (min_amount IS NULL OR max_amount IS NULL OR min_amount <= max_amount)
  )
);

CREATE TABLE IF NOT EXISTS po_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  po_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  approver_id UUID NOT NULL REFERENCES users(id),
  approved_at TIMESTAMPTZ DEFAULT now(),
  approval_status TEXT CHECK (approval_status IN ('approved', 'rejected')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS on approval tables
ALTER TABLE po_approval_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE po_approvals ENABLE ROW LEVEL SECURITY;

-- Policies for approval tables
CREATE POLICY po_approval_rules_workspace ON po_approval_rules
  FOR ALL
  USING (workspace_id = get_jwt_workspace_id());

CREATE POLICY po_approvals_workspace ON po_approvals
  FOR ALL
  USING (workspace_id = get_jwt_workspace_id());

-- ========================================
-- 6. ADD STATUS TRANSITION VALIDATION
-- ========================================

CREATE OR REPLACE FUNCTION validate_po_status_transition()
RETURNS TRIGGER AS $$
DECLARE
  v_old_status po_status;
  v_new_status po_status;
BEGIN
  v_old_status := OLD.status;
  v_new_status := NEW.status;
  
  -- Allow any transition if old status is null (new record)
  IF v_old_status IS NULL THEN
    RETURN NEW;
  END IF;
  
  -- Define valid transitions
  CASE v_old_status
    WHEN 'draft' THEN
      IF v_new_status NOT IN ('approved', 'cancelled') THEN
        RAISE EXCEPTION 'Invalid status transition from draft to %', v_new_status;
      END IF;
    WHEN 'approved' THEN
      IF v_new_status NOT IN ('partial', 'received', 'cancelled') THEN
        RAISE EXCEPTION 'Invalid status transition from approved to %', v_new_status;
      END IF;
    WHEN 'partial' THEN
      IF v_new_status NOT IN ('received', 'closed', 'cancelled') THEN
        RAISE EXCEPTION 'Invalid status transition from partial to %', v_new_status;
      END IF;
    WHEN 'received' THEN
      IF v_new_status NOT IN ('closed') THEN
        RAISE EXCEPTION 'Invalid status transition from received to %', v_new_status;
      END IF;
    WHEN 'closed' THEN
      RAISE EXCEPTION 'Cannot change status from closed';
    WHEN 'cancelled' THEN
      RAISE EXCEPTION 'Cannot change status from cancelled';
  END CASE;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger for status validation
CREATE TRIGGER validate_po_status_transition_trigger
  BEFORE UPDATE OF status ON purchase_orders
  FOR EACH ROW
  EXECUTE FUNCTION validate_po_status_transition();

-- ========================================
-- 7. FIX RACE CONDITIONS WITH ROW LOCKING
-- ========================================

CREATE OR REPLACE FUNCTION receive_purchase_order(
  p_po_id UUID,
  p_receipt_lines JSONB,
  p_notes TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_workspace_id UUID;
  v_receipt_id UUID;
  v_po_status po_status;
  v_line JSONB;
  v_ordered_qty NUMERIC;
  v_already_received NUMERIC;
  v_now_receiving NUMERIC;
  v_total_received NUMERIC;
  v_variance_pct NUMERIC;
  v_override_required BOOLEAN := false;
  v_item_lot_id UUID;
BEGIN
  -- Lock the PO row to prevent concurrent modifications
  SELECT workspace_id, status INTO v_workspace_id, v_po_status
  FROM purchase_orders
  WHERE id = p_po_id
  FOR UPDATE;
  
  -- Check if PO exists and can be received
  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'Purchase order not found';
  END IF;
  
  IF v_workspace_id != get_jwt_workspace_id() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  
  IF v_po_status NOT IN ('approved', 'partial') THEN
    RAISE EXCEPTION 'PO must be approved or partially received. Current status: %', v_po_status;
  END IF;
  
  -- Create receipt record
  INSERT INTO po_receipts (workspace_id, po_id, received_by, notes)
  VALUES (v_workspace_id, p_po_id, auth.uid(), p_notes)
  RETURNING id INTO v_receipt_id;
  
  -- Process each receipt line
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_receipt_lines)
  LOOP
    -- Get ordered quantity and lock the line
    SELECT qty INTO v_ordered_qty
    FROM po_lines
    WHERE id = (v_line->>'po_line_id')::UUID
    AND po_id = p_po_id
    FOR UPDATE;
    
    IF v_ordered_qty IS NULL THEN
      RAISE EXCEPTION 'PO line not found: %', v_line->>'po_line_id';
    END IF;
    
    -- Calculate already received quantity
    SELECT COALESCE(SUM(qty_received), 0) INTO v_already_received
    FROM po_receipt_lines prl
    JOIN po_receipts pr ON prl.po_receipt_id = pr.id
    WHERE pr.po_id = p_po_id
    AND prl.po_line_id = (v_line->>'po_line_id')::UUID;
    
    v_now_receiving := (v_line->>'qty_received')::NUMERIC;
    v_total_received := v_already_received + v_now_receiving;
    
    -- Check for over-receipt
    IF v_total_received > v_ordered_qty THEN
      v_variance_pct := ((v_total_received - v_ordered_qty) / v_ordered_qty) * 100;
      
      -- Allow up to 10% over-receipt without override
      IF v_variance_pct > 10 AND (v_line->>'override_reason') IS NULL THEN
        RAISE EXCEPTION 'Over-receipt by %.2f%% requires override reason', v_variance_pct;
      END IF;
      
      v_override_required := true;
    END IF;
    
    -- Create receipt line
    INSERT INTO po_receipt_lines (
      workspace_id,
      po_receipt_id,
      po_line_id,
      qty_received,
      unit_cost,
      lot_code,
      expiry_date,
      override_reason,
      override_approved_by
    ) VALUES (
      v_workspace_id,
      v_receipt_id,
      (v_line->>'po_line_id')::UUID,
      v_now_receiving,
      COALESCE((v_line->>'unit_cost')::NUMERIC, 
        (SELECT expected_unit_cost FROM po_lines WHERE id = (v_line->>'po_line_id')::UUID)),
      v_line->>'lot_code',
      (v_line->>'expiry_date')::DATE,
      CASE WHEN v_override_required THEN v_line->>'override_reason' ELSE NULL END,
      CASE WHEN v_override_required THEN auth.uid() ELSE NULL END
    );
  END LOOP;
  
  -- Update PO status based on total receipts
  PERFORM update_po_status_on_receipt(p_po_id);
  
  -- Write audit log
  INSERT INTO audit_logs (
    workspace_id,
    entity_table,
    entity_id,
    action,
    actor_user_id,
    after
  ) VALUES (
    v_workspace_id,
    'po_receipts',
    v_receipt_id,
    'create',
    auth.uid(),
    jsonb_build_object(
      'po_id', p_po_id,
      'receipt_id', v_receipt_id,
      'lines_received', jsonb_array_length(p_receipt_lines)
    )
  );
  
  RETURN v_receipt_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ========================================
-- 8. FIX REORDER SUGGESTIONS TO INCLUDE IN-TRANSIT
-- ========================================

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
) AS $$
BEGIN
  RETURN QUERY
  WITH current_inventory AS (
    SELECT 
      il.item_id,
      SUM(il.qty) as on_hand
    FROM item_lots il
    WHERE il.workspace_id = COALESCE(p_workspace_id, get_jwt_workspace_id())
    GROUP BY il.item_id
  ),
  in_transit_inventory AS (
    SELECT 
      pl.item_id,
      SUM(pl.qty - COALESCE(received.qty_received, 0)) as in_transit_qty
    FROM po_lines pl
    JOIN purchase_orders po ON pl.po_id = po.id
    LEFT JOIN (
      SELECT 
        prl.po_line_id,
        SUM(prl.qty_received) as qty_received
      FROM po_receipt_lines prl
      GROUP BY prl.po_line_id
    ) received ON received.po_line_id = pl.id
    WHERE po.workspace_id = COALESCE(p_workspace_id, get_jwt_workspace_id())
    AND po.status IN ('approved', 'partial')
    GROUP BY pl.item_id
  ),
  consumption_rate AS (
    SELECT 
      it.item_id,
      AVG(ABS(it.qty)) as daily_consumption
    FROM inventory_transactions it
    WHERE it.workspace_id = COALESCE(p_workspace_id, get_jwt_workspace_id())
    AND it.type IN ('consume', 'ship')
    AND it.created_at >= CURRENT_DATE - INTERVAL '30 days'
    GROUP BY it.item_id
  )
  SELECT 
    i.id as item_id,
    i.name as item_name,
    i.sku,
    COALESCE(ci.on_hand, 0) as current_stock,
    i.reorder_level,
    COALESCE(iti.in_transit_qty, 0) as in_transit,
    COALESCE(ci.on_hand, 0) + COALESCE(iti.in_transit_qty, 0) as available_stock,
    GREATEST(
      i.reorder_level * 2 - (COALESCE(ci.on_hand, 0) + COALESCE(iti.in_transit_qty, 0)),
      0
    ) as suggested_order_qty,
    i.vendor_id,
    v.name as vendor_name,
    (
      SELECT sph.unit_cost 
      FROM supplier_price_history sph
      WHERE sph.item_id = i.id
      ORDER BY sph.receipt_date DESC
      LIMIT 1
    ) as last_unit_cost,
    CASE 
      WHEN COALESCE(cr.daily_consumption, 0) > 0 
      THEN FLOOR((COALESCE(ci.on_hand, 0) + COALESCE(iti.in_transit_qty, 0)) / cr.daily_consumption)::INTEGER
      ELSE NULL
    END as days_until_stockout
  FROM items i
  LEFT JOIN current_inventory ci ON ci.item_id = i.id
  LEFT JOIN in_transit_inventory iti ON iti.item_id = i.id
  LEFT JOIN consumption_rate cr ON cr.item_id = i.id
  LEFT JOIN vendors v ON v.id = i.vendor_id
  WHERE i.workspace_id = COALESCE(p_workspace_id, get_jwt_workspace_id())
  AND i.reorder_level IS NOT NULL
  AND COALESCE(ci.on_hand, 0) + COALESCE(iti.in_transit_qty, 0) < i.reorder_level
  ORDER BY days_until_stockout ASC NULLS LAST, i.name;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ========================================
-- 9. ADD STATUS ROLLBACK ON RECEIPT DELETION
-- ========================================

CREATE OR REPLACE FUNCTION recalculate_po_status_on_receipt_change()
RETURNS TRIGGER AS $$
DECLARE
  v_po_id UUID;
  v_total_ordered NUMERIC;
  v_total_received NUMERIC;
  v_new_status po_status;
BEGIN
  -- Get PO ID from the receipt
  IF TG_OP = 'DELETE' THEN
    SELECT po_id INTO v_po_id FROM po_receipts WHERE id = OLD.po_receipt_id;
  ELSE
    SELECT po_id INTO v_po_id FROM po_receipts WHERE id = NEW.po_receipt_id;
  END IF;
  
  -- Calculate total ordered and received
  SELECT 
    SUM(pl.qty) as total_ordered,
    SUM(COALESCE(received.qty_received, 0)) as total_received
  INTO v_total_ordered, v_total_received
  FROM po_lines pl
  LEFT JOIN (
    SELECT 
      prl.po_line_id,
      SUM(prl.qty_received) as qty_received
    FROM po_receipt_lines prl
    JOIN po_receipts pr ON prl.po_receipt_id = pr.id
    WHERE pr.po_id = v_po_id
    GROUP BY prl.po_line_id
  ) received ON received.po_line_id = pl.id
  WHERE pl.po_id = v_po_id;
  
  -- Determine new status
  IF v_total_received = 0 THEN
    v_new_status := 'approved';
  ELSIF v_total_received < v_total_ordered THEN
    v_new_status := 'partial';
  ELSE
    v_new_status := 'received';
  END IF;
  
  -- Update PO status
  UPDATE purchase_orders 
  SET status = v_new_status,
      updated_at = now()
  WHERE id = v_po_id;
  
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger for receipt line changes
CREATE TRIGGER recalculate_po_status_on_receipt_change_trigger
  AFTER INSERT OR UPDATE OR DELETE ON po_receipt_lines
  FOR EACH ROW
  EXECUTE FUNCTION recalculate_po_status_on_receipt_change();

-- ========================================
-- 10. ADD VENDOR CREDIT LIMITS
-- ========================================

ALTER TABLE vendors
  ADD COLUMN IF NOT EXISTS credit_limit DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS current_balance DECIMAL(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_terms_days INTEGER DEFAULT 30;

-- ========================================
-- 11. CREATE MATERIALIZED VIEW FOR PO SUMMARY
-- ========================================

CREATE MATERIALIZED VIEW IF NOT EXISTS po_summary_by_vendor AS
SELECT 
  po.vendor_id,
  v.name as vendor_name,
  COUNT(DISTINCT po.id) as total_pos,
  COUNT(DISTINCT CASE WHEN po.status = 'draft' THEN po.id END) as draft_count,
  COUNT(DISTINCT CASE WHEN po.status = 'approved' THEN po.id END) as approved_count,
  COUNT(DISTINCT CASE WHEN po.status IN ('partial', 'received') THEN po.id END) as in_progress_count,
  COUNT(DISTINCT CASE WHEN po.status = 'closed' THEN po.id END) as closed_count,
  COUNT(DISTINCT CASE WHEN po.status = 'cancelled' THEN po.id END) as cancelled_count,
  SUM(
    CASE 
      WHEN po.status NOT IN ('cancelled', 'draft') 
      THEN COALESCE(
        (SELECT SUM(pl.qty * pl.expected_unit_cost) 
         FROM po_lines pl 
         WHERE pl.po_id = po.id), 0)
      ELSE 0 
    END
  ) as total_value,
  AVG(
    CASE 
      WHEN po.status = 'closed' 
      THEN DATE_PART('day', po.updated_at - po.created_at)
      ELSE NULL 
    END
  ) as avg_days_to_close,
  MAX(po.created_at) as last_po_date
FROM purchase_orders po
JOIN vendors v ON v.id = po.vendor_id
GROUP BY po.vendor_id, v.name;

-- Create index on the materialized view
CREATE INDEX idx_po_summary_vendor ON po_summary_by_vendor(vendor_id);

-- ========================================
-- 12. ADD FUNCTION TO UPDATE PO LINES
-- ========================================

CREATE OR REPLACE FUNCTION update_purchase_order(
  p_po_id UUID,
  p_lines JSONB,
  p_notes TEXT DEFAULT NULL,
  p_due_date DATE DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_workspace_id UUID;
  v_po_status po_status;
  v_line JSONB;
  v_line_id UUID;
BEGIN
  -- Get PO details and lock it
  SELECT workspace_id, status INTO v_workspace_id, v_po_status
  FROM purchase_orders
  WHERE id = p_po_id
  FOR UPDATE;
  
  -- Validate
  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'Purchase order not found';
  END IF;
  
  IF v_workspace_id != get_jwt_workspace_id() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  
  -- Only draft POs can be edited
  IF v_po_status != 'draft' THEN
    RAISE EXCEPTION 'Only draft POs can be edited. Current status: %', v_po_status;
  END IF;
  
  -- Update PO header
  UPDATE purchase_orders
  SET 
    notes = COALESCE(p_notes, notes),
    due_date = COALESCE(p_due_date, due_date),
    updated_at = now(),
    updated_by = auth.uid()
  WHERE id = p_po_id;
  
  -- Mark existing lines as deleted (soft delete)
  UPDATE po_lines
  SET deleted_at = now()
  WHERE po_id = p_po_id
  AND deleted_at IS NULL;
  
  -- Insert new/updated lines
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_line_id := COALESCE((v_line->>'id')::UUID, gen_random_uuid());
    
    INSERT INTO po_lines (
      id,
      workspace_id,
      po_id,
      item_id,
      qty,
      uom,
      expected_unit_cost,
      line_number,
      notes
    ) VALUES (
      v_line_id,
      v_workspace_id,
      p_po_id,
      (v_line->>'item_id')::UUID,
      (v_line->>'qty')::NUMERIC,
      v_line->>'uom',
      (v_line->>'expected_unit_cost')::NUMERIC,
      (v_line->>'line_number')::INTEGER,
      v_line->>'notes'
    )
    ON CONFLICT (id) DO UPDATE SET
      qty = EXCLUDED.qty,
      expected_unit_cost = EXCLUDED.expected_unit_cost,
      notes = EXCLUDED.notes,
      deleted_at = NULL;
  END LOOP;
  
  -- Audit log
  INSERT INTO audit_logs (
    workspace_id,
    entity_table,
    entity_id,
    action,
    actor_user_id,
    after
  ) VALUES (
    v_workspace_id,
    'purchase_orders',
    p_po_id,
    'update',
    auth.uid(),
    jsonb_build_object(
      'po_id', p_po_id,
      'lines_updated', jsonb_array_length(p_lines)
    )
  );
  
  RETURN p_po_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ========================================
-- 13. ADD FUNCTION TO CANCEL PO
-- ========================================

CREATE OR REPLACE FUNCTION cancel_purchase_order(
  p_po_id UUID,
  p_reason TEXT
)
RETURNS BOOLEAN AS $$
DECLARE
  v_workspace_id UUID;
  v_po_status po_status;
BEGIN
  -- Get PO details
  SELECT workspace_id, status INTO v_workspace_id, v_po_status
  FROM purchase_orders
  WHERE id = p_po_id;
  
  -- Validate
  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'Purchase order not found';
  END IF;
  
  IF v_workspace_id != get_jwt_workspace_id() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  
  -- Check if PO can be cancelled
  IF v_po_status IN ('closed', 'cancelled') THEN
    RAISE EXCEPTION 'Cannot cancel a % PO', v_po_status;
  END IF;
  
  -- Check if there are any receipts
  IF EXISTS (
    SELECT 1 FROM po_receipts 
    WHERE po_id = p_po_id
  ) THEN
    RAISE EXCEPTION 'Cannot cancel PO with receipts. Please reverse receipts first.';
  END IF;
  
  -- Update status to cancelled
  UPDATE purchase_orders
  SET 
    status = 'cancelled',
    notes = COALESCE(notes || E'\n', '') || 'CANCELLED: ' || p_reason,
    updated_at = now(),
    updated_by = auth.uid()
  WHERE id = p_po_id;
  
  -- Audit log
  INSERT INTO audit_logs (
    workspace_id,
    entity_table,
    entity_id,
    action,
    actor_user_id,
    after
  ) VALUES (
    v_workspace_id,
    'purchase_orders',
    p_po_id,
    'cancel',
    auth.uid(),
    jsonb_build_object(
      'reason', p_reason,
      'previous_status', v_po_status
    )
  );
  
  RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ========================================
-- 14. ADD PO DUPLICATION FUNCTION
-- ========================================

CREATE OR REPLACE FUNCTION duplicate_purchase_order(
  p_po_id UUID,
  p_new_due_date DATE DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_workspace_id UUID;
  v_new_po_id UUID := gen_random_uuid();
  v_new_po_number TEXT;
BEGIN
  -- Get workspace
  SELECT workspace_id INTO v_workspace_id
  FROM purchase_orders
  WHERE id = p_po_id;
  
  IF v_workspace_id != get_jwt_workspace_id() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  
  -- Generate new PO number
  v_new_po_number := generate_po_number(v_workspace_id);
  
  -- Copy PO header
  INSERT INTO purchase_orders (
    id,
    workspace_id,
    po_number,
    vendor_id,
    status,
    order_date,
    due_date,
    terms,
    notes,
    created_by
  )
  SELECT 
    v_new_po_id,
    workspace_id,
    v_new_po_number,
    vendor_id,
    'draft',
    CURRENT_DATE,
    COALESCE(p_new_due_date, due_date),
    terms,
    'Duplicated from PO ' || po_number,
    auth.uid()
  FROM purchase_orders
  WHERE id = p_po_id;
  
  -- Copy PO lines
  INSERT INTO po_lines (
    workspace_id,
    po_id,
    item_id,
    qty,
    uom,
    expected_unit_cost,
    line_number,
    notes
  )
  SELECT 
    workspace_id,
    v_new_po_id,
    item_id,
    qty,
    uom,
    expected_unit_cost,
    line_number,
    notes
  FROM po_lines
  WHERE po_id = p_po_id
  AND deleted_at IS NULL;
  
  RETURN v_new_po_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ========================================
-- 15. GRANT PERMISSIONS
-- ========================================

-- Grant permissions to authenticated users
GRANT SELECT ON po_summary_by_vendor TO authenticated;
GRANT SELECT, INSERT, UPDATE ON po_approval_rules TO authenticated;
GRANT SELECT, INSERT ON po_approvals TO authenticated;

-- Grant execute permissions on functions
GRANT EXECUTE ON FUNCTION validate_po_status_transition() TO authenticated;
GRANT EXECUTE ON FUNCTION recalculate_po_status_on_receipt_change() TO authenticated;
GRANT EXECUTE ON FUNCTION update_purchase_order(UUID, JSONB, TEXT, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION cancel_purchase_order(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION duplicate_purchase_order(UUID, DATE) TO authenticated;

-- ========================================
-- 16. ADD SOFT DELETE SUPPORT
-- ========================================

ALTER TABLE po_lines
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Update views to exclude deleted lines
CREATE OR REPLACE VIEW active_po_lines AS
SELECT * FROM po_lines WHERE deleted_at IS NULL;

-- ========================================
-- 17. REFRESH MATERIALIZED VIEWS
-- ========================================

-- Create function to refresh PO summary
CREATE OR REPLACE FUNCTION refresh_po_summary()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY po_summary_by_vendor;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Schedule refresh via pg_cron (if available) or trigger
CREATE OR REPLACE FUNCTION trigger_refresh_po_summary()
RETURNS TRIGGER AS $$
BEGIN
  -- Refresh asynchronously to avoid blocking
  PERFORM pg_notify('refresh_po_summary', '');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger on PO changes
CREATE TRIGGER refresh_po_summary_trigger
  AFTER INSERT OR UPDATE OR DELETE ON purchase_orders
  FOR EACH STATEMENT
  EXECUTE FUNCTION trigger_refresh_po_summary();
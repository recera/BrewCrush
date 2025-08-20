-- Phase 2: Inventory Enhancements
-- RPCs, Materialized Views, FIFO Logic, and Enhanced Transaction Tracking

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Function to get FIFO lots for an item at a location
CREATE OR REPLACE FUNCTION get_fifo_lots(
  p_workspace_id UUID,
  p_item_id UUID,
  p_location_id UUID DEFAULT NULL
) RETURNS TABLE (
  lot_id UUID,
  lot_code TEXT,
  qty DECIMAL,
  unit_cost DECIMAL,
  expiry DATE,
  location_id UUID,
  fifo_index INTEGER
) 
LANGUAGE sql STABLE
AS $$
  SELECT 
    il.id as lot_id,
    il.lot_code,
    il.qty,
    il.unit_cost,
    il.expiry,
    il.location_id,
    il.fifo_index
  FROM item_lots il
  WHERE il.workspace_id = p_workspace_id
    AND il.item_id = p_item_id
    AND il.qty > 0
    AND (p_location_id IS NULL OR il.location_id = p_location_id)
  ORDER BY 
    il.fifo_index ASC NULLS LAST,
    il.received_date ASC NULLS LAST,
    il.created_at ASC;
$$;

-- ============================================================================
-- INVENTORY ADJUSTMENT RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION inventory_adjust(
  p_item_id UUID,
  p_qty DECIMAL,
  p_uom TEXT,
  p_location_id UUID,
  p_reason TEXT,
  p_notes TEXT DEFAULT NULL,
  p_lot_id UUID DEFAULT NULL,
  p_unit_cost DECIMAL DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_workspace_id UUID;
  v_transaction_id UUID;
  v_current_qty DECIMAL;
  v_item_name TEXT;
  v_lot_code TEXT DEFAULT 'ADJ-' || TO_CHAR(NOW(), 'YYYYMMDD-HH24MISS');
BEGIN
  -- Get workspace ID from JWT
  v_workspace_id := get_jwt_workspace_id();
  
  -- Check permissions (must have inventory role or admin)
  IF NOT (has_role('inventory') OR has_role('admin')) THEN
    RAISE EXCEPTION 'Insufficient permissions for inventory adjustment';
  END IF;
  
  -- Get item details for audit
  SELECT name INTO v_item_name
  FROM items
  WHERE id = p_item_id AND workspace_id = v_workspace_id;
  
  IF v_item_name IS NULL THEN
    RAISE EXCEPTION 'Item not found';
  END IF;
  
  -- If adjusting a specific lot
  IF p_lot_id IS NOT NULL THEN
    -- Get current qty of the lot
    SELECT qty INTO v_current_qty
    FROM item_lots
    WHERE id = p_lot_id AND workspace_id = v_workspace_id;
    
    -- Check if adjustment would make qty negative
    IF v_current_qty + p_qty < 0 THEN
      -- Only admins can force negative inventory
      IF NOT has_role('admin') THEN
        RAISE EXCEPTION 'Adjustment would result in negative inventory. Current qty: %, adjustment: %', 
          v_current_qty, p_qty;
      END IF;
    END IF;
    
    -- Update the lot quantity
    UPDATE item_lots
    SET 
      qty = qty + p_qty,
      updated_at = NOW(),
      updated_by = auth.uid()
    WHERE id = p_lot_id;
    
  ELSE
    -- Create adjustment lot (positive adjustment creates new lot, negative picks from FIFO)
    IF p_qty > 0 THEN
      -- Create new lot for positive adjustment
      INSERT INTO item_lots (
        workspace_id, item_id, lot_code, qty, uom, 
        unit_cost, location_id, received_date,
        created_by, updated_by
      ) VALUES (
        v_workspace_id, p_item_id, v_lot_code, p_qty, p_uom,
        p_unit_cost, p_location_id, CURRENT_DATE,
        auth.uid(), auth.uid()
      )
      RETURNING id INTO p_lot_id;
    ELSE
      -- For negative adjustment without specific lot, use FIFO
      -- This will be handled by creating negative transaction
      p_lot_id := NULL;
    END IF;
  END IF;
  
  -- Create inventory transaction
  INSERT INTO inventory_transactions (
    workspace_id, type, item_id, item_lot_id,
    qty, uom, unit_cost, to_location_id,
    ref_type, notes, created_by
  ) VALUES (
    v_workspace_id, 'adjust', p_item_id, p_lot_id,
    p_qty, p_uom, p_unit_cost, p_location_id,
    'adjustment', 
    COALESCE(p_notes || ' | Reason: ' || p_reason, 'Reason: ' || p_reason),
    auth.uid()
  )
  RETURNING id INTO v_transaction_id;
  
  -- Log audit
  INSERT INTO audit_logs (
    workspace_id, entity_table, entity_id, action,
    after, actor_user_id
  ) VALUES (
    v_workspace_id, 'inventory_transactions', v_transaction_id, 'command',
    jsonb_build_object(
      'command', 'inventory_adjust',
      'item_id', p_item_id,
      'item_name', v_item_name,
      'qty', p_qty,
      'uom', p_uom,
      'location_id', p_location_id,
      'reason', p_reason,
      'notes', p_notes
    ),
    auth.uid()
  );
  
  RETURN v_transaction_id;
END;
$$;

-- ============================================================================
-- INVENTORY TRANSFER RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION inventory_transfer(
  p_item_lot_id UUID,
  p_qty DECIMAL,
  p_from_location_id UUID,
  p_to_location_id UUID,
  p_notes TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_workspace_id UUID;
  v_transaction_id UUID;
  v_item_id UUID;
  v_current_qty DECIMAL;
  v_uom TEXT;
  v_unit_cost DECIMAL;
  v_lot_code TEXT;
  v_new_lot_id UUID;
BEGIN
  -- Get workspace ID from JWT
  v_workspace_id := get_jwt_workspace_id();
  
  -- Check permissions
  IF NOT (has_role('inventory') OR has_role('admin')) THEN
    RAISE EXCEPTION 'Insufficient permissions for inventory transfer';
  END IF;
  
  -- Get lot details and validate
  SELECT 
    il.item_id, il.qty, il.uom, il.unit_cost, il.lot_code
  INTO 
    v_item_id, v_current_qty, v_uom, v_unit_cost, v_lot_code
  FROM item_lots il
  WHERE il.id = p_item_lot_id 
    AND il.workspace_id = v_workspace_id
    AND il.location_id = p_from_location_id;
  
  IF v_item_id IS NULL THEN
    RAISE EXCEPTION 'Lot not found at source location';
  END IF;
  
  -- Check if sufficient quantity
  IF v_current_qty < p_qty THEN
    RAISE EXCEPTION 'Insufficient quantity. Available: %, Requested: %', 
      v_current_qty, p_qty;
  END IF;
  
  -- Check if destination lot exists
  SELECT id INTO v_new_lot_id
  FROM item_lots
  WHERE workspace_id = v_workspace_id
    AND item_id = v_item_id
    AND lot_code = v_lot_code
    AND location_id = p_to_location_id;
  
  IF v_new_lot_id IS NULL THEN
    -- Create new lot at destination
    INSERT INTO item_lots (
      workspace_id, item_id, lot_code, qty, uom,
      unit_cost, location_id, received_date,
      created_by, updated_by
    ) VALUES (
      v_workspace_id, v_item_id, v_lot_code, 0, v_uom,
      v_unit_cost, p_to_location_id, CURRENT_DATE,
      auth.uid(), auth.uid()
    )
    RETURNING id INTO v_new_lot_id;
  END IF;
  
  -- Update source lot (decrease qty)
  UPDATE item_lots
  SET 
    qty = qty - p_qty,
    updated_at = NOW(),
    updated_by = auth.uid()
  WHERE id = p_item_lot_id;
  
  -- Update destination lot (increase qty)
  UPDATE item_lots
  SET 
    qty = qty + p_qty,
    updated_at = NOW(),
    updated_by = auth.uid()
  WHERE id = v_new_lot_id;
  
  -- Create inventory transaction
  INSERT INTO inventory_transactions (
    workspace_id, type, item_id, item_lot_id,
    qty, uom, unit_cost,
    from_location_id, to_location_id,
    ref_type, notes, created_by
  ) VALUES (
    v_workspace_id, 'transfer', v_item_id, p_item_lot_id,
    p_qty, v_uom, v_unit_cost,
    p_from_location_id, p_to_location_id,
    'transfer', p_notes, auth.uid()
  )
  RETURNING id INTO v_transaction_id;
  
  -- Log audit
  INSERT INTO audit_logs (
    workspace_id, entity_table, entity_id, action,
    after, actor_user_id
  ) VALUES (
    v_workspace_id, 'inventory_transactions', v_transaction_id, 'command',
    jsonb_build_object(
      'command', 'inventory_transfer',
      'item_lot_id', p_item_lot_id,
      'qty', p_qty,
      'from_location_id', p_from_location_id,
      'to_location_id', p_to_location_id,
      'notes', p_notes
    ),
    auth.uid()
  );
  
  RETURN v_transaction_id;
END;
$$;

-- ============================================================================
-- CONSUME INVENTORY WITH FIFO
-- ============================================================================

CREATE OR REPLACE FUNCTION consume_inventory_fifo(
  p_item_id UUID,
  p_qty DECIMAL,
  p_uom TEXT,
  p_location_id UUID,
  p_ref_type TEXT,
  p_ref_id UUID,
  p_override_lot_id UUID DEFAULT NULL
) RETURNS TABLE (
  lot_id UUID,
  qty_consumed DECIMAL,
  unit_cost DECIMAL
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_workspace_id UUID;
  v_remaining_qty DECIMAL;
  v_lot RECORD;
  v_consume_qty DECIMAL;
  v_transaction_id UUID;
BEGIN
  -- Get workspace ID
  v_workspace_id := get_jwt_workspace_id();
  v_remaining_qty := p_qty;
  
  -- If specific lot override provided
  IF p_override_lot_id IS NOT NULL THEN
    -- Consume from specific lot
    UPDATE item_lots
    SET 
      qty = qty - p_qty,
      updated_at = NOW(),
      updated_by = auth.uid()
    WHERE id = p_override_lot_id
      AND workspace_id = v_workspace_id
    RETURNING 
      id, p_qty, unit_cost
    INTO lot_id, qty_consumed, unit_cost;
    
    -- Create transaction
    INSERT INTO inventory_transactions (
      workspace_id, type, item_id, item_lot_id,
      qty, uom, unit_cost, from_location_id,
      ref_type, ref_id, created_by
    ) VALUES (
      v_workspace_id, 'consume', p_item_id, p_override_lot_id,
      -p_qty, p_uom, unit_cost, p_location_id,
      p_ref_type, p_ref_id, auth.uid()
    );
    
    RETURN NEXT;
    RETURN;
  END IF;
  
  -- FIFO consumption
  FOR v_lot IN 
    SELECT * FROM get_fifo_lots(v_workspace_id, p_item_id, p_location_id)
  LOOP
    EXIT WHEN v_remaining_qty <= 0;
    
    -- Calculate how much to consume from this lot
    v_consume_qty := LEAST(v_lot.qty, v_remaining_qty);
    
    -- Update lot quantity
    UPDATE item_lots
    SET 
      qty = qty - v_consume_qty,
      updated_at = NOW(),
      updated_by = auth.uid()
    WHERE id = v_lot.lot_id;
    
    -- Create transaction
    INSERT INTO inventory_transactions (
      workspace_id, type, item_id, item_lot_id,
      qty, uom, unit_cost, from_location_id,
      ref_type, ref_id, created_by
    ) VALUES (
      v_workspace_id, 'consume', p_item_id, v_lot.lot_id,
      -v_consume_qty, p_uom, v_lot.unit_cost, v_lot.location_id,
      p_ref_type, p_ref_id, auth.uid()
    );
    
    -- Return consumed lot info
    lot_id := v_lot.lot_id;
    qty_consumed := v_consume_qty;
    unit_cost := v_lot.unit_cost;
    RETURN NEXT;
    
    -- Update remaining quantity
    v_remaining_qty := v_remaining_qty - v_consume_qty;
  END LOOP;
  
  -- Check if we consumed everything requested
  IF v_remaining_qty > 0 THEN
    -- Only raise error if not admin
    IF NOT has_role('admin') THEN
      RAISE EXCEPTION 'Insufficient inventory. Short by % %', v_remaining_qty, p_uom;
    END IF;
  END IF;
END;
$$;

-- ============================================================================
-- PO RECEIPT TRIGGER - Auto-create lots and update supplier price history
-- ============================================================================

CREATE OR REPLACE FUNCTION process_po_receipt()
RETURNS TRIGGER AS $$
DECLARE
  v_item_id UUID;
  v_workspace_id UUID;
  v_vendor_id UUID;
  v_lot_id UUID;
BEGIN
  -- Get item_id and workspace_id from PO line
  SELECT 
    pol.item_id, 
    pol.workspace_id,
    po.vendor_id
  INTO 
    v_item_id, 
    v_workspace_id,
    v_vendor_id
  FROM po_lines pol
  JOIN purchase_orders po ON po.id = pol.po_id
  WHERE pol.id = NEW.po_line_id;
  
  -- Create or update item lot
  INSERT INTO item_lots (
    workspace_id, item_id, lot_code, qty, uom,
    unit_cost, expiry, location_id, received_date,
    fifo_index, created_by, updated_by
  ) VALUES (
    v_workspace_id, v_item_id, NEW.lot_code, NEW.qty_received, 
    (SELECT uom FROM po_lines WHERE id = NEW.po_line_id),
    NEW.unit_cost, NEW.expiry, NEW.location_id, CURRENT_DATE,
    EXTRACT(EPOCH FROM NOW())::INTEGER, -- Use timestamp as FIFO index
    NEW.created_by, NEW.created_by
  )
  ON CONFLICT (workspace_id, item_id, lot_code) 
  DO UPDATE SET
    qty = item_lots.qty + NEW.qty_received,
    updated_at = NOW(),
    updated_by = NEW.created_by
  RETURNING id INTO v_lot_id;
  
  -- Update the receipt line with the lot_id
  NEW.item_lot_id := v_lot_id;
  
  -- Create inventory transaction
  INSERT INTO inventory_transactions (
    workspace_id, type, item_id, item_lot_id,
    qty, uom, unit_cost, to_location_id,
    ref_type, ref_id, created_by
  ) VALUES (
    v_workspace_id, 'receive', v_item_id, v_lot_id,
    NEW.qty_received, 
    (SELECT uom FROM po_lines WHERE id = NEW.po_line_id),
    NEW.unit_cost, NEW.location_id,
    'po_receipt_line', NEW.id, NEW.created_by
  );
  
  -- Update supplier price history
  INSERT INTO supplier_price_history (
    workspace_id, item_id, vendor_id, receipt_date,
    unit_cost, uom, qty_received, po_number, created_by
  ) VALUES (
    v_workspace_id, v_item_id, v_vendor_id, CURRENT_DATE,
    NEW.unit_cost, 
    (SELECT uom FROM po_lines WHERE id = NEW.po_line_id),
    NEW.qty_received,
    (SELECT po_number FROM purchase_orders WHERE id = NEW.po_receipt_id),
    NEW.created_by
  );
  
  -- Update PO line received quantity
  UPDATE po_lines
  SET 
    qty_received = COALESCE(qty_received, 0) + NEW.qty_received,
    updated_at = NOW(),
    updated_by = NEW.created_by
  WHERE id = NEW.po_line_id;
  
  -- Check if PO is fully received and update status
  PERFORM update_po_status_on_receipt(
    (SELECT po_id FROM po_lines WHERE id = NEW.po_line_id)
  );
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger if not exists
DROP TRIGGER IF EXISTS process_po_receipt_trigger ON po_receipt_lines;
CREATE TRIGGER process_po_receipt_trigger
  BEFORE INSERT ON po_receipt_lines
  FOR EACH ROW
  EXECUTE FUNCTION process_po_receipt();

-- Function to update PO status based on receipts
CREATE OR REPLACE FUNCTION update_po_status_on_receipt(p_po_id UUID)
RETURNS VOID AS $$
DECLARE
  v_total_ordered DECIMAL;
  v_total_received DECIMAL;
BEGIN
  -- Calculate totals
  SELECT 
    SUM(qty),
    SUM(COALESCE(qty_received, 0))
  INTO 
    v_total_ordered,
    v_total_received
  FROM po_lines
  WHERE po_id = p_po_id;
  
  -- Update PO status
  UPDATE purchase_orders
  SET 
    status = CASE
      WHEN v_total_received = 0 THEN status -- Keep current if nothing received
      WHEN v_total_received < v_total_ordered THEN 'partial'
      WHEN v_total_received >= v_total_ordered THEN 'received'
      ELSE status
    END,
    updated_at = NOW(),
    updated_by = auth.uid()
  WHERE id = p_po_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- MATERIALIZED VIEWS
-- ============================================================================

-- Inventory on-hand by item and location
CREATE MATERIALIZED VIEW IF NOT EXISTS inventory_on_hand_by_item_location AS
SELECT 
  il.workspace_id,
  il.item_id,
  i.name as item_name,
  i.sku,
  i.type as item_type,
  il.location_id,
  loc.name as location_name,
  i.uom as primary_uom,
  SUM(il.qty) as qty_on_hand,
  COUNT(DISTINCT il.lot_code) as lot_count,
  AVG(il.unit_cost) as avg_unit_cost,
  MIN(il.expiry) FILTER (WHERE il.expiry > CURRENT_DATE) as next_expiry
FROM item_lots il
JOIN items i ON i.id = il.item_id
JOIN inventory_locations loc ON loc.id = il.location_id
WHERE il.qty > 0
GROUP BY 
  il.workspace_id, il.item_id, i.name, i.sku, 
  i.type, il.location_id, loc.name, i.uom;

-- Create index for performance
CREATE UNIQUE INDEX idx_inventory_on_hand_unique 
ON inventory_on_hand_by_item_location (workspace_id, item_id, location_id);

CREATE INDEX idx_inventory_on_hand_workspace 
ON inventory_on_hand_by_item_location (workspace_id);

-- Inventory value view
CREATE MATERIALIZED VIEW IF NOT EXISTS inventory_value AS
SELECT 
  il.workspace_id,
  i.type as item_type,
  i.category,
  COUNT(DISTINCT i.id) as item_count,
  SUM(il.qty) as total_qty,
  SUM(il.qty * COALESCE(il.unit_cost, 0)) as total_value,
  AVG(il.unit_cost) as avg_unit_cost
FROM item_lots il
JOIN items i ON i.id = il.item_id
WHERE il.qty > 0
GROUP BY il.workspace_id, i.type, i.category;

-- Create index
CREATE INDEX idx_inventory_value_workspace 
ON inventory_value (workspace_id);

-- ============================================================================
-- REFRESH FUNCTIONS FOR MATERIALIZED VIEWS
-- ============================================================================

CREATE OR REPLACE FUNCTION refresh_inventory_views()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY inventory_on_hand_by_item_location;
  REFRESH MATERIALIZED VIEW CONCURRENTLY inventory_value;
END;
$$;

-- Function to be called after inventory changes
CREATE OR REPLACE FUNCTION notify_inventory_change()
RETURNS trigger AS $$
BEGIN
  -- Notify listeners about inventory change
  PERFORM pg_notify(
    'inventory_change',
    json_build_object(
      'workspace_id', NEW.workspace_id,
      'table', TG_TABLE_NAME,
      'operation', TG_OP
    )::text
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add triggers for real-time notifications
CREATE TRIGGER notify_inventory_transactions
  AFTER INSERT OR UPDATE ON inventory_transactions
  FOR EACH ROW
  EXECUTE FUNCTION notify_inventory_change();

CREATE TRIGGER notify_item_lots
  AFTER INSERT OR UPDATE OR DELETE ON item_lots
  FOR EACH ROW
  EXECUTE FUNCTION notify_inventory_change();

-- ============================================================================
-- ADDITIONAL HELPER FUNCTIONS
-- ============================================================================

-- Get current inventory value by method
CREATE OR REPLACE FUNCTION get_inventory_value(
  p_workspace_id UUID,
  p_method TEXT DEFAULT 'actual' -- 'actual', 'moving_avg', 'latest'
) RETURNS TABLE (
  item_id UUID,
  item_name TEXT,
  qty_on_hand DECIMAL,
  unit_cost DECIMAL,
  total_value DECIMAL
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  IF p_method = 'actual' THEN
    -- Use actual lot costs
    RETURN QUERY
    SELECT 
      i.id,
      i.name,
      SUM(il.qty),
      AVG(il.unit_cost),
      SUM(il.qty * COALESCE(il.unit_cost, 0))
    FROM items i
    LEFT JOIN item_lots il ON il.item_id = i.id AND il.qty > 0
    WHERE i.workspace_id = p_workspace_id
    GROUP BY i.id, i.name;
    
  ELSIF p_method = 'latest' THEN
    -- Use latest cost from supplier price history
    RETURN QUERY
    WITH latest_costs AS (
      SELECT DISTINCT ON (item_id)
        item_id,
        unit_cost
      FROM supplier_price_history
      WHERE workspace_id = p_workspace_id
      ORDER BY item_id, receipt_date DESC
    )
    SELECT 
      i.id,
      i.name,
      SUM(il.qty),
      lc.unit_cost,
      SUM(il.qty * COALESCE(lc.unit_cost, 0))
    FROM items i
    LEFT JOIN item_lots il ON il.item_id = i.id AND il.qty > 0
    LEFT JOIN latest_costs lc ON lc.item_id = i.id
    WHERE i.workspace_id = p_workspace_id
    GROUP BY i.id, i.name, lc.unit_cost;
    
  ELSE
    -- Default to actual
    RETURN QUERY
    SELECT * FROM get_inventory_value(p_workspace_id, 'actual');
  END IF;
END;
$$;

-- ============================================================================
-- GRANTS (ensure proper access)
-- ============================================================================

-- Grant execute permissions on functions
GRANT EXECUTE ON FUNCTION inventory_adjust TO authenticated;
GRANT EXECUTE ON FUNCTION inventory_transfer TO authenticated;
GRANT EXECUTE ON FUNCTION consume_inventory_fifo TO authenticated;
GRANT EXECUTE ON FUNCTION get_fifo_lots TO authenticated;
GRANT EXECUTE ON FUNCTION get_inventory_value TO authenticated;
GRANT EXECUTE ON FUNCTION refresh_inventory_views TO authenticated;

-- Grant select on materialized views
GRANT SELECT ON inventory_on_hand_by_item_location TO authenticated;
GRANT SELECT ON inventory_value TO authenticated;

-- Add comment for documentation
COMMENT ON FUNCTION inventory_adjust IS 'Adjusts inventory quantity for an item at a location. Positive values add inventory, negative values remove it using FIFO if no specific lot is provided.';
COMMENT ON FUNCTION inventory_transfer IS 'Transfers inventory from one location to another, maintaining lot tracking and creating appropriate transactions.';
COMMENT ON FUNCTION consume_inventory_fifo IS 'Consumes inventory using FIFO method unless a specific lot is provided as override. Returns details of consumed lots.';
COMMENT ON MATERIALIZED VIEW inventory_on_hand_by_item_location IS 'Aggregated view of current inventory on-hand grouped by item and location. Refresh periodically or after major inventory changes.';
COMMENT ON MATERIALIZED VIEW inventory_value IS 'Summary view of inventory value by item type and category. Used for dashboards and reports.';
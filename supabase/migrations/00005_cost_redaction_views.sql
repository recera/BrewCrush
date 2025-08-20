-- Phase 1: Cost Visibility Redaction Views
-- This migration creates views that automatically redact cost information
-- for users without appropriate permissions

-- =====================================================
-- INVENTORY COST REDACTION VIEWS
-- =====================================================

-- View for item_lots with cost redaction
CREATE OR REPLACE VIEW v_item_lots AS
SELECT 
  id,
  workspace_id,
  item_id,
  lot_code,
  qty,
  uom,
  CASE 
    WHEN has_cost_visibility() THEN unit_cost
    ELSE NULL
  END AS unit_cost,
  expiry,
  location_id,
  created_at,
  created_by,
  updated_at,
  updated_by
FROM item_lots;

-- Grant access to the view
GRANT SELECT ON v_item_lots TO authenticated;

-- View for items with cost information redacted
CREATE OR REPLACE VIEW v_items_with_costs AS
SELECT 
  i.id,
  i.workspace_id,
  i.name,
  i.type,
  i.uom,
  i.conversions,
  i.reorder_level,
  i.vendor_id,
  -- default_cost column doesn't exist, so we'll skip it
  -- CASE 
  --   WHEN has_cost_visibility() THEN i.default_cost
  --   ELSE NULL
  -- END AS default_cost,
  CASE 
    WHEN has_cost_visibility() THEN (
      SELECT AVG(unit_cost) 
      FROM item_lots 
      WHERE item_id = i.id AND workspace_id = i.workspace_id
    )
    ELSE NULL
  END AS avg_cost,
  i.created_at,
  i.updated_at
FROM items i;

GRANT SELECT ON v_items_with_costs TO authenticated;

-- =====================================================
-- PURCHASE ORDER COST REDACTION VIEWS
-- =====================================================

-- View for purchase orders with cost redaction
CREATE OR REPLACE VIEW v_purchase_orders AS
SELECT 
  po.id,
  po.workspace_id,
  po.vendor_id,
  po.status,
  po.po_number,
  po.order_date,
  po.due_date,
  po.notes,
  CASE 
    WHEN has_cost_visibility() THEN po.subtotal
    ELSE NULL
  END AS subtotal,
  CASE 
    WHEN has_cost_visibility() THEN po.tax
    ELSE NULL
  END AS tax,
  CASE 
    WHEN has_cost_visibility() THEN po.total
    ELSE NULL
  END AS total,
  po.created_at,
  po.created_by,
  po.updated_at,
  po.approved_by,
  po.approved_at
FROM purchase_orders po;

GRANT SELECT ON v_purchase_orders TO authenticated;

-- View for PO lines with cost redaction
CREATE OR REPLACE VIEW v_po_lines AS
SELECT 
  pol.id,
  pol.po_id,
  pol.item_id,
  pol.qty,
  pol.uom,
  CASE 
    WHEN has_cost_visibility() THEN pol.expected_unit_cost
    ELSE NULL
  END AS expected_unit_cost,
  CASE 
    WHEN has_cost_visibility() THEN (pol.qty * pol.expected_unit_cost)
    ELSE NULL
  END AS line_total,
  pol.location_id,
  pol.notes
FROM po_lines pol
INNER JOIN purchase_orders po ON po.id = pol.po_id;

GRANT SELECT ON v_po_lines TO authenticated;

-- =====================================================
-- BATCH AND RECIPE COST REDACTION VIEWS
-- =====================================================

-- View for recipes with cost redaction
CREATE OR REPLACE VIEW v_recipes_with_costs AS
SELECT 
  r.id,
  r.workspace_id,
  r.name,
  r.style,
  r.target_volume,
  r.target_og,
  r.target_fg,
  r.target_abv,
  r.efficiency_pct,
  -- overhead_pct doesn't exist in recipes table
  -- estimated_cost doesn't exist in recipes table  
  -- cost_per_unit doesn't exist in recipes table
  r.is_active,
  -- version doesn't exist in recipes table
  r.created_at,
  r.updated_at
FROM recipes r;

GRANT SELECT ON v_recipes_with_costs TO authenticated;

-- View for batches with cost redaction
CREATE OR REPLACE VIEW v_batches_with_costs AS
SELECT 
  b.id,
  b.workspace_id,
  b.batch_number,
  b.recipe_version_id,
  b.status,
  b.tank_id,
  b.target_volume,
  b.actual_volume,
  b.brew_date,
  -- package_date doesn't exist yet
  -- actual_cost doesn't exist yet
  -- cost_per_unit doesn't exist yet
  b.owner_entity_id,
  b.in_bond,
  b.created_at,
  b.updated_at
FROM batches b;

GRANT SELECT ON v_batches_with_costs TO authenticated;

-- =====================================================
-- INVENTORY TRANSACTION COST REDACTION
-- =====================================================

-- View for inventory transactions with cost redaction
CREATE OR REPLACE VIEW v_inventory_transactions AS
SELECT 
  it.id,
  it.workspace_id,
  it.type,
  it.item_id,
  it.item_lot_id,
  it.qty,
  it.uom,
  CASE 
    WHEN has_cost_visibility() THEN it.unit_cost
    ELSE NULL
  END AS unit_cost,
  CASE 
    WHEN has_cost_visibility() THEN (it.qty * it.unit_cost)
    ELSE NULL
  END AS total_cost,
  it.ref_type,
  it.ref_id,
  it.notes,
  it.created_at,
  it.created_by
FROM inventory_transactions it;

GRANT SELECT ON v_inventory_transactions TO authenticated;

-- =====================================================
-- SUPPLIER PRICE HISTORY REDACTION
-- =====================================================

-- View for supplier price history with cost redaction
CREATE OR REPLACE VIEW v_supplier_price_history AS
SELECT 
  sph.id,
  sph.workspace_id,
  sph.item_id,
  sph.vendor_id,
  sph.receipt_date,
  CASE 
    WHEN has_cost_visibility() THEN sph.unit_cost
    ELSE NULL
  END AS unit_cost,
  sph.qty_received,
  sph.uom,
  sph.po_number,
  sph.created_at
FROM supplier_price_history sph;

GRANT SELECT ON v_supplier_price_history TO authenticated;

-- =====================================================
-- AGGREGATE COST VIEWS WITH REDACTION
-- =====================================================

-- Inventory value view (admin/accounting only)
CREATE OR REPLACE VIEW v_inventory_value AS
SELECT 
  workspace_id,
  CASE 
    WHEN has_cost_visibility() THEN 
      SUM(qty * unit_cost)
    ELSE NULL
  END AS total_value,
  COUNT(DISTINCT item_id) AS unique_items,
  SUM(qty) AS total_units
FROM item_lots
WHERE workspace_id = get_jwt_workspace_id()
GROUP BY workspace_id;

GRANT SELECT ON v_inventory_value TO authenticated;

-- COGS summary view
CREATE OR REPLACE VIEW v_cogs_summary AS
SELECT 
  b.workspace_id,
  b.batch_number,
  b.recipe_version_id,
  rv.name AS recipe_name,
  NULL AS batch_cost, -- actual_cost doesn't exist yet
  NULL AS cost_per_unit, -- cost_per_unit doesn't exist yet
  b.actual_volume
  -- package_date doesn't exist yet
FROM batches b
LEFT JOIN recipe_versions rv ON rv.id = b.recipe_version_id
WHERE b.workspace_id = get_jwt_workspace_id();

GRANT SELECT ON v_cogs_summary TO authenticated;

-- =====================================================
-- CONTRACT VIEWER RESTRICTIONS
-- =====================================================

-- Special view for contract viewers - only their batches
CREATE OR REPLACE VIEW v_contract_batches AS
SELECT 
  b.id,
  b.batch_number,
  b.recipe_version_id,
  rv.name AS recipe_name,
  b.status,
  b.target_volume,
  b.actual_volume,
  b.brew_date,
  -- package_date doesn't exist yet
  -- No cost information for contract viewers
  b.owner_entity_id
FROM batches b
LEFT JOIN recipe_versions rv ON rv.id = b.recipe_version_id
WHERE b.workspace_id = get_jwt_workspace_id()
  AND (
    -- Contract viewers can only see their own batches
    NOT is_contract_viewer() 
    OR b.owner_entity_id IN (
      SELECT entity_id 
      FROM user_contract_entities 
      WHERE user_id = get_jwt_user_id()
    )
  );

GRANT SELECT ON v_contract_batches TO authenticated;

-- =====================================================
-- HELPER FUNCTIONS FOR VIEWS
-- =====================================================

-- Function to get cost visibility for specific item (can be overridden per item)
CREATE OR REPLACE FUNCTION has_item_cost_visibility(item_id UUID) 
RETURNS BOOLEAN AS $$
DECLARE
  item_restriction BOOLEAN;
BEGIN
  -- Check if there's a specific restriction for this item
  SELECT restricted INTO item_restriction
  FROM item_cost_restrictions
  WHERE item_cost_restrictions.item_id = has_item_cost_visibility.item_id
    AND workspace_id = get_jwt_workspace_id();
  
  -- If item has specific restriction, respect it
  IF item_restriction IS NOT NULL AND item_restriction = true THEN
    -- Only admin can see restricted items
    RETURN has_role('admin');
  END IF;
  
  -- Otherwise use standard cost visibility rules
  RETURN has_cost_visibility();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Table for item-specific cost restrictions (optional)
CREATE TABLE IF NOT EXISTS item_cost_restrictions (
  item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  restricted BOOLEAN NOT NULL DEFAULT false,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  PRIMARY KEY (item_id, workspace_id)
);

ALTER TABLE item_cost_restrictions ENABLE ROW LEVEL SECURITY;

CREATE POLICY item_restrictions_select ON item_cost_restrictions
  FOR SELECT USING (workspace_id = get_jwt_workspace_id() AND has_role('admin'));

CREATE POLICY item_restrictions_insert ON item_cost_restrictions
  FOR INSERT WITH CHECK (workspace_id = get_jwt_workspace_id() AND has_role('admin'));

CREATE POLICY item_restrictions_update ON item_cost_restrictions
  FOR UPDATE USING (workspace_id = get_jwt_workspace_id() AND has_role('admin'));

-- =====================================================
-- INDEXES FOR PERFORMANCE
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_item_lots_workspace_item ON item_lots(workspace_id, item_id);
CREATE INDEX IF NOT EXISTS idx_batches_workspace_status ON batches(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_inventory_transactions_workspace ON inventory_transactions(workspace_id);

-- =====================================================
-- COMMENTS FOR DOCUMENTATION
-- =====================================================

COMMENT ON VIEW v_item_lots IS 'Item lots with automatic cost redaction based on user role';
COMMENT ON VIEW v_items_with_costs IS 'Items with cost information, redacted for users without cost visibility';
COMMENT ON VIEW v_purchase_orders IS 'Purchase orders with financial information redacted based on role';
COMMENT ON VIEW v_batches_with_costs IS 'Batch information with cost data redacted for unauthorized users';
COMMENT ON VIEW v_contract_batches IS 'Limited batch view for contract viewers, showing only their own production';
COMMENT ON FUNCTION has_cost_visibility IS 'Determines if current user can view cost information';
COMMENT ON FUNCTION has_item_cost_visibility IS 'Determines if current user can view costs for a specific item';
-- Batch Recipe Scaling Implementation
-- This migration adds the batch_recipe_items table and updates the use_recipe_for_batch function
-- to properly copy and scale recipe ingredients to batches

-- Create batch_recipe_items table to store scaled ingredients for each batch
CREATE TABLE IF NOT EXISTS batch_recipe_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  batch_id UUID NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES items(id),
  original_qty DECIMAL(10,3) NOT NULL,
  scaled_qty DECIMAL(10,3) NOT NULL,
  uom TEXT NOT NULL,
  phase TEXT,
  timing TEXT,
  notes TEXT,
  estimated_cost DECIMAL(10,2),
  actual_cost DECIMAL(10,2),
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES auth.users(id),
  CONSTRAINT unique_batch_item UNIQUE(batch_id, item_id, phase, timing)
);

-- Create indexes for performance
CREATE INDEX idx_batch_recipe_items_batch ON batch_recipe_items(batch_id);
CREATE INDEX idx_batch_recipe_items_item ON batch_recipe_items(item_id);
CREATE INDEX idx_batch_recipe_items_workspace ON batch_recipe_items(workspace_id);

-- Enable RLS
ALTER TABLE batch_recipe_items ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY batch_recipe_items_tenant_isolation ON batch_recipe_items
  FOR ALL USING (workspace_id = get_jwt_workspace_id());

CREATE POLICY batch_recipe_items_select ON batch_recipe_items
  FOR SELECT USING (workspace_id = get_jwt_workspace_id());

CREATE POLICY batch_recipe_items_insert ON batch_recipe_items
  FOR INSERT WITH CHECK (
    workspace_id = get_jwt_workspace_id() 
    AND (has_role('admin') OR has_role('brewer'))
  );

CREATE POLICY batch_recipe_items_update ON batch_recipe_items
  FOR UPDATE USING (
    workspace_id = get_jwt_workspace_id() 
    AND (has_role('admin') OR has_role('brewer'))
  );

-- Update the use_recipe_for_batch function to copy and scale ingredients
CREATE OR REPLACE FUNCTION use_recipe_for_batch(
  p_recipe_version_id UUID,
  p_batch_number TEXT,
  p_brew_date DATE DEFAULT CURRENT_DATE,
  p_tank_id UUID DEFAULT NULL,
  p_target_volume DECIMAL DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_workspace_id UUID;
  v_batch_id UUID;
  v_recipe_target_volume DECIMAL;
  v_recipe_targets RECORD;
  v_scaling_factor DECIMAL := 1;
  v_ingredient RECORD;
BEGIN
  -- Get recipe details
  SELECT 
    workspace_id, target_volume, target_og, target_fg, target_abv, target_ibu
  INTO v_workspace_id, v_recipe_target_volume, v_recipe_targets.target_og, 
       v_recipe_targets.target_fg, v_recipe_targets.target_abv, v_recipe_targets.target_ibu
  FROM recipe_versions
  WHERE id = p_recipe_version_id;

  IF v_workspace_id != get_jwt_workspace_id() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  -- Check permissions
  IF NOT (has_role('admin') OR has_role('brewer')) THEN
    RAISE EXCEPTION 'Insufficient permissions to create batch';
  END IF;

  -- Check for duplicate batch number
  IF EXISTS (
    SELECT 1 FROM batches 
    WHERE workspace_id = v_workspace_id 
    AND batch_number = p_batch_number
  ) THEN
    RAISE EXCEPTION 'Batch number % already exists', p_batch_number;
  END IF;

  -- Check tank availability if specified
  IF p_tank_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM tanks t
      JOIN batches b ON b.tank_id = t.id
      WHERE t.id = p_tank_id
      AND t.workspace_id = v_workspace_id
      AND b.status IN ('fermenting', 'conditioning')
    ) THEN
      RAISE EXCEPTION 'Tank is currently occupied';
    END IF;
  END IF;

  -- Calculate scaling factor if custom volume specified
  IF p_target_volume IS NOT NULL AND v_recipe_target_volume > 0 THEN
    v_scaling_factor := p_target_volume / v_recipe_target_volume;
  END IF;

  -- Create batch
  v_batch_id := uuid_generate_v4();
  
  INSERT INTO batches (
    id, workspace_id, batch_number, recipe_version_id, status,
    brew_date, target_volume, target_og, target_fg, target_abv, target_ibu,
    tank_id, created_by
  ) VALUES (
    v_batch_id, v_workspace_id, p_batch_number, p_recipe_version_id, 'planned',
    p_brew_date, COALESCE(p_target_volume, v_recipe_target_volume),
    v_recipe_targets.target_og, v_recipe_targets.target_fg,
    v_recipe_targets.target_abv, v_recipe_targets.target_ibu,
    p_tank_id, auth.uid()
  );

  -- Copy and scale recipe ingredients to batch
  FOR v_ingredient IN 
    SELECT 
      ri.item_id,
      ri.qty as original_qty,
      ri.uom,
      ri.phase,
      ri.timing,
      ri.notes,
      ri.sort_order,
      il.unit_cost
    FROM recipe_ingredients ri
    LEFT JOIN LATERAL (
      SELECT AVG(unit_cost) as unit_cost
      FROM item_lots
      WHERE item_id = ri.item_id
      AND workspace_id = v_workspace_id
      AND qty > 0
    ) il ON true
    WHERE ri.recipe_version_id = p_recipe_version_id
    ORDER BY ri.sort_order, ri.phase, ri.timing
  LOOP
    INSERT INTO batch_recipe_items (
      workspace_id,
      batch_id,
      item_id,
      original_qty,
      scaled_qty,
      uom,
      phase,
      timing,
      notes,
      estimated_cost,
      sort_order,
      created_by
    ) VALUES (
      v_workspace_id,
      v_batch_id,
      v_ingredient.item_id,
      v_ingredient.original_qty,
      ROUND(v_ingredient.original_qty * v_scaling_factor, 3),
      v_ingredient.uom,
      v_ingredient.phase,
      v_ingredient.timing,
      v_ingredient.notes,
      CASE 
        WHEN v_ingredient.unit_cost IS NOT NULL 
        THEN ROUND(v_ingredient.original_qty * v_scaling_factor * v_ingredient.unit_cost, 2)
        ELSE NULL
      END,
      v_ingredient.sort_order,
      auth.uid()
    );
  END LOOP;

  -- Update tank if assigned
  IF p_tank_id IS NOT NULL THEN
    UPDATE tanks
    SET current_batch_id = v_batch_id,
        updated_at = NOW(),
        updated_by = auth.uid()
    WHERE id = p_tank_id
    AND workspace_id = v_workspace_id;
  END IF;

  -- Audit log
  INSERT INTO audit_logs (
    entity_table,
    entity_id,
    action,
    after,
    created_by,
    workspace_id
  ) VALUES (
    'batches',
    v_batch_id,
    'insert',
    jsonb_build_object(
      'batch_number', p_batch_number,
      'recipe_version_id', p_recipe_version_id,
      'scaling_factor', v_scaling_factor,
      'ingredients_copied', (
        SELECT COUNT(*) 
        FROM batch_recipe_items 
        WHERE batch_id = v_batch_id
      )
    ),
    auth.uid(),
    v_workspace_id
  );

  RETURN v_batch_id;
END;
$$;

-- Function to get batch recipe items with current costs
CREATE OR REPLACE FUNCTION get_batch_recipe_items(p_batch_id UUID)
RETURNS TABLE (
  id UUID,
  item_id UUID,
  item_name TEXT,
  item_type TEXT,
  original_qty DECIMAL,
  scaled_qty DECIMAL,
  uom TEXT,
  phase TEXT,
  timing TEXT,
  notes TEXT,
  estimated_cost DECIMAL,
  current_cost DECIMAL,
  in_stock DECIMAL
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    bri.id,
    bri.item_id,
    i.name as item_name,
    i.type::TEXT as item_type,
    bri.original_qty,
    bri.scaled_qty,
    bri.uom,
    bri.phase,
    bri.timing,
    bri.notes,
    bri.estimated_cost,
    -- Calculate current cost based on latest lot prices
    ROUND(bri.scaled_qty * (
      SELECT AVG(il.unit_cost)
      FROM item_lots il
      WHERE il.item_id = bri.item_id
      AND il.workspace_id = bri.workspace_id
      AND il.qty > 0
    ), 2) as current_cost,
    -- Get current stock level
    (
      SELECT COALESCE(SUM(il.qty), 0)
      FROM item_lots il
      WHERE il.item_id = bri.item_id
      AND il.workspace_id = bri.workspace_id
    ) as in_stock
  FROM batch_recipe_items bri
  JOIN items i ON i.id = bri.item_id
  WHERE bri.batch_id = p_batch_id
  AND bri.workspace_id = get_jwt_workspace_id()
  ORDER BY bri.sort_order, bri.phase, bri.timing;
END;
$$;

-- Function to preview recipe scaling
CREATE OR REPLACE FUNCTION preview_recipe_scaling(
  p_recipe_version_id UUID,
  p_target_volume DECIMAL
)
RETURNS TABLE (
  item_id UUID,
  item_name TEXT,
  item_type TEXT,
  original_qty DECIMAL,
  scaled_qty DECIMAL,
  uom TEXT,
  phase TEXT,
  timing TEXT,
  estimated_cost DECIMAL,
  in_stock DECIMAL,
  stock_sufficient BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_workspace_id UUID;
  v_original_volume DECIMAL;
  v_scaling_factor DECIMAL := 1;
BEGIN
  -- Get recipe details
  SELECT workspace_id, target_volume
  INTO v_workspace_id, v_original_volume
  FROM recipe_versions
  WHERE id = p_recipe_version_id;

  IF v_workspace_id != get_jwt_workspace_id() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  -- Calculate scaling factor
  IF v_original_volume > 0 AND p_target_volume IS NOT NULL THEN
    v_scaling_factor := p_target_volume / v_original_volume;
  END IF;

  RETURN QUERY
  SELECT 
    ri.item_id,
    i.name as item_name,
    i.type::TEXT as item_type,
    ri.qty as original_qty,
    ROUND(ri.qty * v_scaling_factor, 3) as scaled_qty,
    ri.uom,
    ri.phase,
    ri.timing,
    -- Estimated cost based on current average lot prices
    ROUND(ri.qty * v_scaling_factor * (
      SELECT AVG(il.unit_cost)
      FROM item_lots il
      WHERE il.item_id = ri.item_id
      AND il.workspace_id = v_workspace_id
      AND il.qty > 0
    ), 2) as estimated_cost,
    -- Current stock level
    stock.in_stock,
    -- Check if we have enough stock
    (stock.in_stock >= ROUND(ri.qty * v_scaling_factor, 3)) as stock_sufficient
  FROM recipe_ingredients ri
  JOIN items i ON i.id = ri.item_id
  LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(il.qty), 0) as in_stock
    FROM item_lots il
    WHERE il.item_id = ri.item_id
    AND il.workspace_id = v_workspace_id
  ) stock ON true
  WHERE ri.recipe_version_id = p_recipe_version_id
  ORDER BY ri.sort_order, ri.phase, ri.timing;
END;
$$;

-- Grant permissions
GRANT ALL ON batch_recipe_items TO authenticated;
GRANT EXECUTE ON FUNCTION get_batch_recipe_items(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION preview_recipe_scaling(UUID, DECIMAL) TO authenticated;

-- Update triggers for updated_at
CREATE TRIGGER update_batch_recipe_items_updated_at
  BEFORE UPDATE ON batch_recipe_items
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
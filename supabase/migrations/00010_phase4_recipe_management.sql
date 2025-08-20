-- Phase 4.1: Recipe Management Database Enhancements
-- This migration enhances the recipe system with steps, QA specs, cost calculations, and versioning

-- Create recipe_steps table for brewing instructions with timers
CREATE TABLE recipe_steps (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  recipe_version_id UUID NOT NULL REFERENCES recipe_versions(id) ON DELETE CASCADE,
  step_number INTEGER NOT NULL,
  phase TEXT NOT NULL CHECK (phase IN ('mash', 'boil', 'fermentation', 'conditioning', 'packaging')),
  name TEXT NOT NULL,
  description TEXT,
  duration_minutes INTEGER,
  temperature DECIMAL,
  temperature_unit TEXT DEFAULT 'C',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES users(id),
  UNIQUE(recipe_version_id, step_number)
);

-- Enable RLS on recipe_steps
ALTER TABLE recipe_steps ENABLE ROW LEVEL SECURITY;

-- RLS Policy for recipe_steps
CREATE POLICY workspace_isolation_recipe_steps ON recipe_steps
  FOR ALL USING (workspace_id = get_jwt_workspace_id());

-- Add columns to recipe_versions for better QA tracking
ALTER TABLE recipe_versions 
  ADD COLUMN IF NOT EXISTS og_min DECIMAL,
  ADD COLUMN IF NOT EXISTS og_max DECIMAL,
  ADD COLUMN IF NOT EXISTS fg_min DECIMAL,
  ADD COLUMN IF NOT EXISTS fg_max DECIMAL,
  ADD COLUMN IF NOT EXISTS abv_min DECIMAL,
  ADD COLUMN IF NOT EXISTS abv_max DECIMAL,
  ADD COLUMN IF NOT EXISTS ibu_min DECIMAL,
  ADD COLUMN IF NOT EXISTS ibu_max DECIMAL,
  ADD COLUMN IF NOT EXISTS srm_min DECIMAL,
  ADD COLUMN IF NOT EXISTS srm_max DECIMAL,
  ADD COLUMN IF NOT EXISTS ph_min DECIMAL,
  ADD COLUMN IF NOT EXISTS ph_max DECIMAL,
  ADD COLUMN IF NOT EXISTS calculated_cost DECIMAL,
  ADD COLUMN IF NOT EXISTS cost_breakdown JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS is_locked BOOLEAN DEFAULT false; -- For immutable versions

-- Create indexes for better performance
CREATE INDEX idx_recipe_steps_recipe_version ON recipe_steps(recipe_version_id);
CREATE INDEX idx_recipe_ingredients_recipe_version ON recipe_ingredients(recipe_version_id);
CREATE INDEX idx_recipe_versions_recipe ON recipe_versions(recipe_id);
CREATE INDEX idx_batches_recipe_version ON batches(recipe_version_id);

-- Function to calculate recipe cost from ingredients
CREATE OR REPLACE FUNCTION calculate_recipe_cost(p_recipe_version_id UUID)
RETURNS TABLE (
  total_cost DECIMAL,
  cost_per_liter DECIMAL,
  ingredient_cost DECIMAL,
  overhead_cost DECIMAL,
  cost_breakdown JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_workspace_id UUID;
  v_target_volume DECIMAL;
  v_overhead_pct DECIMAL;
  v_ingredient_cost DECIMAL := 0;
  v_overhead_cost DECIMAL := 0;
  v_total_cost DECIMAL;
  v_cost_per_liter DECIMAL;
  v_breakdown JSONB := '[]'::jsonb;
  v_ingredient RECORD;
BEGIN
  -- Get workspace_id and recipe details
  SELECT rv.workspace_id, rv.target_volume, COALESCE(rv.overhead_pct, 0)
  INTO v_workspace_id, v_target_volume, v_overhead_pct
  FROM recipe_versions rv
  WHERE rv.id = p_recipe_version_id;

  -- Check permissions
  IF v_workspace_id != get_jwt_workspace_id() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  -- Calculate ingredient costs
  FOR v_ingredient IN
    SELECT 
      ri.item_id,
      ri.qty,
      ri.uom,
      i.name as item_name,
      COALESCE(
        -- Use latest cost from item_lots
        (SELECT unit_cost FROM item_lots 
         WHERE item_id = ri.item_id 
         AND workspace_id = v_workspace_id
         AND qty > 0
         ORDER BY created_at DESC 
         LIMIT 1),
        -- Fallback to moving average cost if available
        i.moving_avg_cost,
        0
      ) as unit_cost
    FROM recipe_ingredients ri
    JOIN items i ON i.id = ri.item_id
    WHERE ri.recipe_version_id = p_recipe_version_id
  LOOP
    -- Add to ingredient cost
    v_ingredient_cost := v_ingredient_cost + (v_ingredient.qty * v_ingredient.unit_cost);
    
    -- Add to breakdown
    v_breakdown := v_breakdown || jsonb_build_object(
      'item_id', v_ingredient.item_id,
      'item_name', v_ingredient.item_name,
      'qty', v_ingredient.qty,
      'uom', v_ingredient.uom,
      'unit_cost', v_ingredient.unit_cost,
      'total_cost', v_ingredient.qty * v_ingredient.unit_cost
    );
  END LOOP;

  -- Calculate overhead
  v_overhead_cost := v_ingredient_cost * (v_overhead_pct / 100);
  v_total_cost := v_ingredient_cost + v_overhead_cost;
  
  -- Calculate cost per liter
  IF v_target_volume > 0 THEN
    v_cost_per_liter := v_total_cost / v_target_volume;
  ELSE
    v_cost_per_liter := 0;
  END IF;

  RETURN QUERY SELECT 
    v_total_cost,
    v_cost_per_liter,
    v_ingredient_cost,
    v_overhead_cost,
    jsonb_build_object(
      'ingredients', v_breakdown,
      'ingredient_total', v_ingredient_cost,
      'overhead_pct', v_overhead_pct,
      'overhead_total', v_overhead_cost,
      'total', v_total_cost,
      'per_liter', v_cost_per_liter
    );
END;
$$;

-- Function to create a new recipe version
CREATE OR REPLACE FUNCTION create_recipe_version(
  p_recipe_id UUID,
  p_name TEXT DEFAULT NULL,
  p_copy_from_version_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_workspace_id UUID;
  v_new_version_id UUID;
  v_new_version_number INTEGER;
  v_recipe_name TEXT;
BEGIN
  -- Get workspace_id and validate access
  SELECT workspace_id, name INTO v_workspace_id, v_recipe_name
  FROM recipes
  WHERE id = p_recipe_id;

  IF v_workspace_id != get_jwt_workspace_id() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  -- Check if user can create recipes
  IF NOT (has_role('admin') OR has_role('brewer')) THEN
    RAISE EXCEPTION 'Insufficient permissions to create recipe versions';
  END IF;

  -- Get next version number
  SELECT COALESCE(MAX(version_number), 0) + 1
  INTO v_new_version_number
  FROM recipe_versions
  WHERE recipe_id = p_recipe_id;

  -- Create new version
  v_new_version_id := uuid_generate_v4();

  IF p_copy_from_version_id IS NOT NULL THEN
    -- Copy from existing version
    INSERT INTO recipe_versions (
      id, workspace_id, recipe_id, version_number, name,
      target_volume, target_og, target_fg, target_abv, target_ibu, target_srm, target_ph,
      efficiency_pct, mash_steps, boil_time, fermentation_steps, notes, qa_specs, overhead_pct,
      og_min, og_max, fg_min, fg_max, abv_min, abv_max, ibu_min, ibu_max, srm_min, srm_max, ph_min, ph_max,
      created_by
    )
    SELECT 
      v_new_version_id, workspace_id, recipe_id, v_new_version_number, 
      COALESCE(p_name, name || ' v' || v_new_version_number),
      target_volume, target_og, target_fg, target_abv, target_ibu, target_srm, target_ph,
      efficiency_pct, mash_steps, boil_time, fermentation_steps, notes, qa_specs, overhead_pct,
      og_min, og_max, fg_min, fg_max, abv_min, abv_max, ibu_min, ibu_max, srm_min, srm_max, ph_min, ph_max,
      auth.uid()
    FROM recipe_versions
    WHERE id = p_copy_from_version_id AND workspace_id = v_workspace_id;

    -- Copy ingredients
    INSERT INTO recipe_ingredients (
      workspace_id, recipe_version_id, item_id, qty, uom, phase, timing, notes, sort_order, created_by
    )
    SELECT 
      workspace_id, v_new_version_id, item_id, qty, uom, phase, timing, notes, sort_order, auth.uid()
    FROM recipe_ingredients
    WHERE recipe_version_id = p_copy_from_version_id;

    -- Copy steps
    INSERT INTO recipe_steps (
      workspace_id, recipe_version_id, step_number, phase, name, description, 
      duration_minutes, temperature, temperature_unit, notes, created_by
    )
    SELECT 
      workspace_id, v_new_version_id, step_number, phase, name, description,
      duration_minutes, temperature, temperature_unit, notes, auth.uid()
    FROM recipe_steps
    WHERE recipe_version_id = p_copy_from_version_id;
  ELSE
    -- Create blank version
    INSERT INTO recipe_versions (
      id, workspace_id, recipe_id, version_number, name, created_by
    )
    VALUES (
      v_new_version_id, v_workspace_id, p_recipe_id, v_new_version_number,
      COALESCE(p_name, v_recipe_name || ' v' || v_new_version_number),
      auth.uid()
    );
  END IF;

  -- Calculate and update cost
  UPDATE recipe_versions rv
  SET (calculated_cost, cost_breakdown) = (
    SELECT total_cost, cost_breakdown
    FROM calculate_recipe_cost(v_new_version_id)
  )
  WHERE rv.id = v_new_version_id;

  -- Audit log
  INSERT INTO audit_logs (
    workspace_id, entity_table, entity_id, action, after, actor_user_id
  ) VALUES (
    v_workspace_id, 'recipe_versions', v_new_version_id, 'insert',
    jsonb_build_object('recipe_id', p_recipe_id, 'version_number', v_new_version_number),
    auth.uid()
  );

  RETURN v_new_version_id;
END;
$$;

-- Function to lock a recipe version (make it immutable)
CREATE OR REPLACE FUNCTION lock_recipe_version(p_version_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_workspace_id UUID;
BEGIN
  -- Get workspace_id
  SELECT workspace_id INTO v_workspace_id
  FROM recipe_versions
  WHERE id = p_version_id;

  IF v_workspace_id != get_jwt_workspace_id() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  -- Check permissions
  IF NOT (has_role('admin') OR has_role('brewer')) THEN
    RAISE EXCEPTION 'Insufficient permissions to lock recipe version';
  END IF;

  -- Lock the version
  UPDATE recipe_versions
  SET is_locked = true,
      updated_at = NOW(),
      updated_by = auth.uid()
  WHERE id = p_version_id
  AND workspace_id = v_workspace_id
  AND is_locked = false;

  -- Audit log
  INSERT INTO audit_logs (
    workspace_id, entity_table, entity_id, action, after, actor_user_id
  ) VALUES (
    v_workspace_id, 'recipe_versions', p_version_id, 'update',
    jsonb_build_object('is_locked', true),
    auth.uid()
  );

  RETURN FOUND;
END;
$$;

-- Function to use recipe for batch (creates a new batch from recipe)
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
      AND b.status NOT IN ('completed', 'archived')
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
    workspace_id, entity_table, entity_id, action, after, actor_user_id
  ) VALUES (
    v_workspace_id, 'batches', v_batch_id, 'insert',
    jsonb_build_object(
      'batch_number', p_batch_number,
      'recipe_version_id', p_recipe_version_id,
      'brew_date', p_brew_date,
      'scaling_factor', v_scaling_factor
    ),
    auth.uid()
  );

  -- Emit telemetry event
  INSERT INTO ui_events (
    event_name, role, workspace_id, entity_type, entity_id
  ) VALUES (
    'batch_created', 
    (SELECT role FROM user_workspace_roles WHERE user_id = auth.uid() AND workspace_id = v_workspace_id),
    v_workspace_id, 'batch', v_batch_id
  );

  RETURN v_batch_id;
END;
$$;

-- Function to scale recipe ingredients for a different batch size
CREATE OR REPLACE FUNCTION scale_recipe_ingredients(
  p_recipe_version_id UUID,
  p_target_volume DECIMAL
)
RETURNS TABLE (
  item_id UUID,
  item_name TEXT,
  original_qty DECIMAL,
  scaled_qty DECIMAL,
  uom TEXT,
  phase TEXT,
  timing TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_workspace_id UUID;
  v_original_volume DECIMAL;
  v_scaling_factor DECIMAL;
BEGIN
  -- Get recipe volume
  SELECT workspace_id, target_volume
  INTO v_workspace_id, v_original_volume
  FROM recipe_versions
  WHERE id = p_recipe_version_id;

  IF v_workspace_id != get_jwt_workspace_id() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  -- Calculate scaling factor
  IF v_original_volume > 0 THEN
    v_scaling_factor := p_target_volume / v_original_volume;
  ELSE
    v_scaling_factor := 1;
  END IF;

  RETURN QUERY
  SELECT 
    ri.item_id,
    i.name as item_name,
    ri.qty as original_qty,
    ROUND(ri.qty * v_scaling_factor, 3) as scaled_qty,
    ri.uom,
    ri.phase,
    ri.timing
  FROM recipe_ingredients ri
  JOIN items i ON i.id = ri.item_id
  WHERE ri.recipe_version_id = p_recipe_version_id
  ORDER BY ri.sort_order, ri.phase, ri.timing;
END;
$$;

-- Add triggers to prevent editing locked recipe versions
CREATE OR REPLACE FUNCTION prevent_locked_recipe_edit()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' OR TG_OP = 'DELETE' THEN
    IF EXISTS (
      SELECT 1 FROM recipe_versions 
      WHERE id = OLD.recipe_version_id 
      AND is_locked = true
    ) THEN
      RAISE EXCEPTION 'Cannot modify locked recipe version';
    END IF;
  END IF;
  
  IF TG_OP = 'INSERT' THEN
    IF EXISTS (
      SELECT 1 FROM recipe_versions 
      WHERE id = NEW.recipe_version_id 
      AND is_locked = true
    ) THEN
      RAISE EXCEPTION 'Cannot add to locked recipe version';
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

CREATE TRIGGER prevent_locked_recipe_ingredients_edit
  BEFORE INSERT OR UPDATE OR DELETE ON recipe_ingredients
  FOR EACH ROW
  EXECUTE FUNCTION prevent_locked_recipe_edit();

CREATE TRIGGER prevent_locked_recipe_steps_edit
  BEFORE INSERT OR UPDATE OR DELETE ON recipe_steps
  FOR EACH ROW
  EXECUTE FUNCTION prevent_locked_recipe_edit();

-- View for recipes with cost visibility based on role
CREATE OR REPLACE VIEW v_recipes_with_costs AS
SELECT 
  r.*,
  rv.version_number as latest_version,
  rv.name as latest_version_name,
  CASE 
    WHEN has_cost_visibility() THEN rv.calculated_cost
    ELSE NULL
  END as calculated_cost,
  CASE 
    WHEN has_cost_visibility() THEN rv.cost_breakdown
    ELSE NULL
  END as cost_breakdown,
  (
    SELECT COUNT(*) 
    FROM batches b 
    WHERE b.recipe_version_id IN (
      SELECT id FROM recipe_versions WHERE recipe_id = r.id
    )
  ) as batch_count
FROM recipes r
LEFT JOIN LATERAL (
  SELECT * FROM recipe_versions 
  WHERE recipe_id = r.id 
  ORDER BY version_number DESC 
  LIMIT 1
) rv ON true
WHERE r.workspace_id = get_jwt_workspace_id();

-- Grant appropriate permissions
GRANT SELECT ON v_recipes_with_costs TO authenticated;
GRANT EXECUTE ON FUNCTION calculate_recipe_cost TO authenticated;
GRANT EXECUTE ON FUNCTION create_recipe_version TO authenticated;
GRANT EXECUTE ON FUNCTION lock_recipe_version TO authenticated;
GRANT EXECUTE ON FUNCTION use_recipe_for_batch TO authenticated;
GRANT EXECUTE ON FUNCTION scale_recipe_ingredients TO authenticated;
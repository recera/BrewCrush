-- Phase 5: Packaging, Finished Goods, Lot/Date Codes, and Labels
-- This migration implements the complete packaging workflow including:
-- - Finished SKUs (product definitions)
-- - Packaging runs with blend support
-- - Lot/date code generation with collision detection
-- - COGS allocation by volume for blends
-- - Label/manifest support

-- ============================================================================
-- FINISHED SKUS (Product Definitions)
-- ============================================================================

-- The finished_skus table was already created in migration 00003_production_schema.sql
-- We need to add missing columns to the existing table
ALTER TABLE finished_skus 
  ADD COLUMN IF NOT EXISTS code TEXT,
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS container_type TEXT,
  ADD COLUMN IF NOT EXISTS container_size_ml INTEGER,
  ADD COLUMN IF NOT EXISTS pack_size INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS barrels_per_unit NUMERIC(10,4),
  ADD COLUMN IF NOT EXISTS default_price_cents INTEGER,
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

-- Update container_type from existing type column if needed
UPDATE finished_skus 
SET container_type = type,
    container_size_ml = size_ml,
    pack_size = units_per_pack,
    code = sku_code
WHERE container_type IS NULL;

-- Add check constraint for container_type
ALTER TABLE finished_skus 
  DROP CONSTRAINT IF EXISTS finished_skus_container_type_check,
  ADD CONSTRAINT finished_skus_container_type_check 
  CHECK (container_type IN ('keg', 'can', 'bottle', 'growler', 'other'));

-- Calculate barrels_per_unit for existing records
UPDATE finished_skus 
SET barrels_per_unit = (container_size_ml * pack_size) / 117347.76
WHERE barrels_per_unit IS NULL;

-- Add unique constraint if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'finished_skus_workspace_code_key'
  ) THEN
    ALTER TABLE finished_skus ADD CONSTRAINT finished_skus_workspace_code_key UNIQUE(workspace_id, code);
  END IF;
END $$;

-- ============================================================================
-- LOT CODE TEMPLATES
-- ============================================================================

-- The lot_code_templates table was already created in migration 00003_production_schema.sql
-- We need to add missing columns to the existing table
ALTER TABLE lot_code_templates
  ADD COLUMN IF NOT EXISTS tokens_used TEXT[];

-- Add unique constraint if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'lot_code_templates_workspace_name_key'
  ) THEN
    ALTER TABLE lot_code_templates ADD CONSTRAINT lot_code_templates_workspace_name_key UNIQUE(workspace_id, name);
  END IF;
END $$;

-- ============================================================================
-- PACKAGING RUNS
-- ============================================================================

-- The packaging_runs table was already created in migration 00003_production_schema.sql
-- We need to add missing columns to the existing table
ALTER TABLE packaging_runs
  ADD COLUMN IF NOT EXISTS packaged_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS target_quantity INTEGER,
  ADD COLUMN IF NOT EXISTS actual_quantity INTEGER,
  ADD COLUMN IF NOT EXISTS loss_percentage NUMERIC(5,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_cogs_cents INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unit_cogs_cents INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lot_code_pattern TEXT,
  ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES inventory_locations(id),
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

-- Update packaged_at from packaging_date if needed
UPDATE packaging_runs
SET packaged_at = packaging_date,
    actual_quantity = total_produced,
    loss_percentage = loss_pct
WHERE packaged_at IS NULL;

-- ============================================================================
-- PACKAGING RUN SOURCES (for blends)
-- ============================================================================

-- The packaging_run_sources table was already created in migration 00003_production_schema.sql
-- We need to add missing columns to the existing table
ALTER TABLE packaging_run_sources
  ADD COLUMN IF NOT EXISTS packaging_run_id UUID,
  ADD COLUMN IF NOT EXISTS percentage_of_blend NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS allocated_cogs_cents INTEGER DEFAULT 0;

-- Update packaging_run_id from run_id if needed
UPDATE packaging_run_sources
SET packaging_run_id = run_id,
    percentage_of_blend = allocation_pct * 100
WHERE packaging_run_id IS NULL;

-- ============================================================================
-- FINISHED LOTS
-- ============================================================================

-- The finished_lots table was already created in migration 00003_production_schema.sql
-- We need to add missing columns to the existing table
ALTER TABLE finished_lots
  ADD COLUMN IF NOT EXISTS quantity INTEGER,
  ADD COLUMN IF NOT EXISTS quantity_remaining INTEGER,
  ADD COLUMN IF NOT EXISTS unit_cogs_cents INTEGER,
  ADD COLUMN IF NOT EXISTS expiry_date DATE,
  ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES inventory_locations(id),
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

-- Update quantity from existing columns if needed
UPDATE finished_lots
SET quantity = produced_qty,
    quantity_remaining = remaining_qty,
    unit_cogs_cents = COALESCE((unit_cost * 100)::INTEGER, 0)
WHERE quantity IS NULL;

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_finished_skus_workspace ON finished_skus(workspace_id);
CREATE INDEX IF NOT EXISTS idx_finished_skus_code ON finished_skus(workspace_id, code);
CREATE INDEX IF NOT EXISTS idx_packaging_runs_workspace ON packaging_runs(workspace_id);
CREATE INDEX IF NOT EXISTS idx_packaging_runs_sku ON packaging_runs(sku_id);
CREATE INDEX IF NOT EXISTS idx_packaging_runs_date ON packaging_runs(packaged_at);
CREATE INDEX IF NOT EXISTS idx_packaging_run_sources_run ON packaging_run_sources(run_id);
CREATE INDEX IF NOT EXISTS idx_packaging_run_sources_batch ON packaging_run_sources(batch_id);
CREATE INDEX IF NOT EXISTS idx_finished_lots_workspace ON finished_lots(workspace_id);
CREATE INDEX IF NOT EXISTS idx_finished_lots_sku ON finished_lots(sku_id);
CREATE INDEX IF NOT EXISTS idx_finished_lots_code ON finished_lots(lot_code);

-- ============================================================================
-- LOT CODE GENERATION FUNCTIONS
-- ============================================================================

-- Function to generate lot codes based on template
CREATE OR REPLACE FUNCTION generate_lot_code(
  p_pattern TEXT,
  p_batch_id UUID,
  p_sku_code TEXT,
  p_at TIMESTAMPTZ DEFAULT now()
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_code TEXT;
  v_batch_number TEXT;
BEGIN
  -- Get batch number for substitution (first 8 chars of UUID)
  IF p_batch_id IS NOT NULL THEN
    v_batch_number := SUBSTRING(p_batch_id::TEXT FROM 1 FOR 8);
  ELSE
    v_batch_number := 'BULK';
  END IF;

  -- Start with the pattern
  v_code := p_pattern;

  -- Replace tokens
  v_code := REPLACE(v_code, '{YYYY}', TO_CHAR(p_at, 'YYYY'));
  v_code := REPLACE(v_code, '{YY}', TO_CHAR(p_at, 'YY'));
  v_code := REPLACE(v_code, '{MM}', TO_CHAR(p_at, 'MM'));
  v_code := REPLACE(v_code, '{DD}', TO_CHAR(p_at, 'DD'));
  v_code := REPLACE(v_code, '{JJJ}', TO_CHAR(p_at, 'DDD')); -- Julian day
  v_code := REPLACE(v_code, '{BATCH}', v_batch_number);
  v_code := REPLACE(v_code, '{SKU}', COALESCE(p_sku_code, 'UNKNOWN'));
  v_code := REPLACE(v_code, '{HOUR}', TO_CHAR(p_at, 'HH24'));
  v_code := REPLACE(v_code, '{MIN}', TO_CHAR(p_at, 'MI'));

  RETURN v_code;
END;
$$;

-- Function to check for lot code collisions
CREATE OR REPLACE FUNCTION check_lot_code_collision(
  p_workspace_id UUID,
  p_lot_code TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM finished_lots
    WHERE workspace_id = p_workspace_id
    AND lot_code = p_lot_code
  );
END;
$$;

-- ============================================================================
-- COGS CALCULATION FUNCTIONS
-- ============================================================================

-- Function to calculate batch COGS for packaging
CREATE OR REPLACE FUNCTION calculate_batch_cogs_for_packaging(
  p_batch_id UUID,
  p_volume_used_liters NUMERIC
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_batch_record RECORD;
  v_total_batch_cogs_cents INTEGER;
  v_percentage_used NUMERIC;
  v_allocated_cogs_cents INTEGER;
BEGIN
  -- Get batch details including total volume and COGS
  SELECT 
    b.id,
    b.actual_volume_liters,
    COALESCE(b.total_cogs_cents, 0) as total_cogs_cents
  INTO v_batch_record
  FROM batches b
  WHERE b.id = p_batch_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Batch % not found', p_batch_id;
  END IF;

  -- Calculate percentage of batch being used
  IF v_batch_record.actual_volume_liters > 0 THEN
    v_percentage_used := p_volume_used_liters / v_batch_record.actual_volume_liters;
  ELSE
    v_percentage_used := 0;
  END IF;

  -- Allocate COGS proportionally
  v_allocated_cogs_cents := ROUND(v_batch_record.total_cogs_cents * v_percentage_used);

  RETURN v_allocated_cogs_cents;
END;
$$;

-- ============================================================================
-- MAIN PACKAGING RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION create_packaging_run(
  p_data JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_workspace_id UUID;
  v_user_id UUID;
  v_run_id UUID;
  v_sku_record RECORD;
  v_source JSONB;
  v_total_volume_liters NUMERIC;
  v_total_cogs_cents INTEGER := 0;
  v_lot_code TEXT;
  v_lot_code_pattern TEXT;
  v_finished_lot_id UUID;
  v_inventory_txn_id UUID;
  v_batch_cogs INTEGER;
  v_packaging_materials_cost INTEGER := 0;
  v_i INTEGER := 0;
  v_collision_attempts INTEGER := 0;
  v_actual_quantity INTEGER;
  v_loss_percentage NUMERIC;
BEGIN
  -- Get workspace and user from JWT
  v_workspace_id := get_jwt_workspace_id();
  v_user_id := auth.uid();

  -- Validate inputs
  IF p_data->>'sku_id' IS NULL THEN
    RAISE EXCEPTION 'SKU ID is required';
  END IF;

  IF p_data->>'sources' IS NULL OR jsonb_array_length(p_data->'sources') = 0 THEN
    RAISE EXCEPTION 'At least one source batch is required';
  END IF;

  -- Get SKU details
  SELECT * INTO v_sku_record
  FROM finished_skus
  WHERE id = (p_data->>'sku_id')::UUID
  AND workspace_id = v_workspace_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SKU not found';
  END IF;

  -- Calculate total volume from sources
  v_total_volume_liters := 0;
  FOR v_source IN SELECT * FROM jsonb_array_elements(p_data->'sources')
  LOOP
    v_total_volume_liters := v_total_volume_liters + (v_source->>'volume_liters')::NUMERIC;
  END LOOP;

  -- Check if dry_run
  IF COALESCE((p_data->>'dry_run')::BOOLEAN, false) THEN
    -- Calculate preview COGS without committing
    FOR v_source IN SELECT * FROM jsonb_array_elements(p_data->'sources')
    LOOP
      v_batch_cogs := calculate_batch_cogs_for_packaging(
        (v_source->>'batch_id')::UUID,
        (v_source->>'volume_liters')::NUMERIC
      );
      v_total_cogs_cents := v_total_cogs_cents + v_batch_cogs;
    END LOOP;

    -- Return preview data
    RETURN jsonb_build_object(
      'preview', true,
      'total_cogs_cents', v_total_cogs_cents,
      'unit_cogs_cents', v_total_cogs_cents / NULLIF((p_data->>'target_quantity')::INTEGER, 0),
      'total_volume_liters', v_total_volume_liters
    )::TEXT::UUID; -- Hack to return JSONB through UUID return type
  END IF;

  -- Calculate actual quantity after loss
  v_actual_quantity := COALESCE((p_data->>'actual_quantity')::INTEGER, (p_data->>'target_quantity')::INTEGER);
  v_loss_percentage := COALESCE((p_data->>'loss_percentage')::NUMERIC, 0);

  -- Get lot code pattern
  IF p_data->>'lot_code_template_id' IS NOT NULL THEN
    SELECT pattern INTO v_lot_code_pattern
    FROM lot_code_templates
    WHERE id = (p_data->>'lot_code_template_id')::UUID
    AND workspace_id = v_workspace_id;
  ELSE
    -- Use default pattern
    v_lot_code_pattern := '{YY}{JJJ}-{BATCH}-{SKU}';
  END IF;

  -- Create packaging run
  INSERT INTO packaging_runs (
    workspace_id,
    sku_id,
    packaged_at,
    target_quantity,
    actual_quantity,
    loss_percentage,
    cost_method_used,
    lot_code_template_id,
    lot_code_pattern,
    location_id,
    notes,
    metadata,
    created_by,
    updated_by
  ) VALUES (
    v_workspace_id,
    (p_data->>'sku_id')::UUID,
    COALESCE((p_data->>'packaged_at')::TIMESTAMPTZ, now()),
    (p_data->>'target_quantity')::INTEGER,
    v_actual_quantity,
    v_loss_percentage,
    COALESCE(p_data->>'cost_method_used', 'actual_lots'),
    (p_data->>'lot_code_template_id')::UUID,
    v_lot_code_pattern,
    (p_data->>'location_id')::UUID,
    p_data->>'notes',
    COALESCE(p_data->'metadata', '{}'),
    v_user_id,
    v_user_id
  )
  RETURNING id INTO v_run_id;

  -- Process each source batch
  FOR v_source IN SELECT * FROM jsonb_array_elements(p_data->'sources')
  LOOP
    -- Calculate COGS for this batch
    v_batch_cogs := calculate_batch_cogs_for_packaging(
      (v_source->>'batch_id')::UUID,
      (v_source->>'volume_liters')::NUMERIC
    );

    -- Insert packaging run source
    INSERT INTO packaging_run_sources (
      packaging_run_id,
      batch_id,
      volume_liters,
      percentage_of_blend,
      allocated_cogs_cents,
      created_by
    ) VALUES (
      v_run_id,
      (v_source->>'batch_id')::UUID,
      (v_source->>'volume_liters')::NUMERIC,
      ((v_source->>'volume_liters')::NUMERIC / v_total_volume_liters) * 100,
      v_batch_cogs,
      v_user_id
    );

    v_total_cogs_cents := v_total_cogs_cents + v_batch_cogs;

    -- Update batch status to indicate it's been packaged
    UPDATE batches
    SET 
      status = 'packaged',
      updated_at = now(),
      updated_by = v_user_id
    WHERE id = (v_source->>'batch_id')::UUID;
  END LOOP;

  -- TODO: Add packaging materials consumption and cost calculation here
  -- This would involve checking packaging inventory and consuming materials

  -- Update packaging run with total COGS
  UPDATE packaging_runs
  SET 
    total_cogs_cents = v_total_cogs_cents + v_packaging_materials_cost,
    unit_cogs_cents = (v_total_cogs_cents + v_packaging_materials_cost) / NULLIF(v_actual_quantity, 0)
  WHERE id = v_run_id;

  -- Generate lot code with collision detection
  v_collision_attempts := 0;
  LOOP
    -- Generate lot code
    IF jsonb_array_length(p_data->'sources') = 1 THEN
      -- Single batch - use batch ID in code
      v_lot_code := generate_lot_code(
        v_lot_code_pattern,
        (p_data->'sources'->0->>'batch_id')::UUID,
        v_sku_record.code,
        COALESCE((p_data->>'packaged_at')::TIMESTAMPTZ, now())
      );
    ELSE
      -- Blend - use run ID as batch identifier
      v_lot_code := generate_lot_code(
        v_lot_code_pattern,
        v_run_id,
        v_sku_record.code,
        COALESCE((p_data->>'packaged_at')::TIMESTAMPTZ, now())
      );
    END IF;

    -- Add suffix if collision
    IF v_collision_attempts > 0 THEN
      v_lot_code := v_lot_code || '-' || v_collision_attempts::TEXT;
    END IF;

    -- Check for collision
    EXIT WHEN NOT check_lot_code_collision(v_workspace_id, v_lot_code);

    v_collision_attempts := v_collision_attempts + 1;
    IF v_collision_attempts > 99 THEN
      RAISE EXCEPTION 'Unable to generate unique lot code after 100 attempts';
    END IF;
  END LOOP;

  -- Create finished lot
  INSERT INTO finished_lots (
    workspace_id,
    sku_id,
    packaging_run_id,
    lot_code,
    quantity,
    quantity_remaining,
    unit_cogs_cents,
    expiry_date,
    location_id,
    owner_entity_id,
    metadata,
    created_by,
    updated_by
  ) VALUES (
    v_workspace_id,
    (p_data->>'sku_id')::UUID,
    v_run_id,
    v_lot_code,
    v_actual_quantity,
    v_actual_quantity, -- Initially all quantity is remaining
    (v_total_cogs_cents + v_packaging_materials_cost) / NULLIF(v_actual_quantity, 0),
    (p_data->>'expiry_date')::DATE,
    (p_data->>'location_id')::UUID,
    (p_data->>'owner_entity_id')::UUID,
    COALESCE(p_data->'metadata', '{}'),
    v_user_id,
    v_user_id
  )
  RETURNING id INTO v_finished_lot_id;

  -- Create inventory transaction for production
  INSERT INTO inventory_transactions (
    workspace_id,
    transaction_type,
    item_id,
    quantity,
    unit_of_measure,
    ref_type,
    ref_id,
    location_id,
    notes,
    created_by
  ) VALUES (
    v_workspace_id,
    'produce',
    NULL, -- Finished goods don't link to items table directly
    v_actual_quantity,
    'units',
    'packaging_run',
    v_run_id,
    (p_data->>'location_id')::UUID,
    'Packaging run for ' || v_sku_record.name || ' - Lot: ' || v_lot_code,
    v_user_id
  );

  -- Log telemetry event
  INSERT INTO ui_events (
    event_name,
    workspace_id,
    entity_type,
    entity_id,
    metadata,
    created_by
  ) VALUES (
    'packaging_run_created',
    v_workspace_id,
    'packaging_run',
    v_run_id,
    jsonb_build_object(
      'sku_id', p_data->>'sku_id',
      'quantity', v_actual_quantity,
      'lot_code', v_lot_code,
      'source_count', jsonb_array_length(p_data->'sources'),
      'total_cogs_cents', v_total_cogs_cents
    ),
    v_user_id
  );

  -- Audit log
  INSERT INTO audit_logs (
    workspace_id,
    entity_table,
    entity_id,
    action,
    after_data,
    actor_user_id
  ) VALUES (
    v_workspace_id,
    'packaging_runs',
    v_run_id,
    'create',
    to_jsonb(row_to_json((SELECT pr FROM packaging_runs pr WHERE pr.id = v_run_id))),
    v_user_id
  );

  RETURN v_run_id;
END;
$$;

-- ============================================================================
-- HELPER FUNCTIONS FOR QUERIES
-- ============================================================================

-- Function to get available batches for packaging
CREATE OR REPLACE FUNCTION get_available_batches_for_packaging(
  p_workspace_id UUID DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  batch_number TEXT,
  recipe_name TEXT,
  volume_available_liters NUMERIC,
  status TEXT,
  brew_date DATE,
  tank_name TEXT,
  total_cogs_cents INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    b.id,
    b.batch_number,
    r.name as recipe_name,
    b.actual_volume_liters - COALESCE(
      (SELECT SUM(prs.volume_liters) 
       FROM packaging_run_sources prs 
       WHERE prs.batch_id = b.id), 0
    ) as volume_available_liters,
    b.status,
    b.brew_date,
    t.name as tank_name,
    b.total_cogs_cents
  FROM batches b
  JOIN recipe_versions rv ON b.recipe_version_id = rv.id
  JOIN recipes r ON rv.recipe_id = r.id
  LEFT JOIN tanks t ON b.current_tank_id = t.id
  WHERE b.workspace_id = COALESCE(p_workspace_id, get_jwt_workspace_id())
  AND b.status IN ('fermenting', 'conditioning', 'bright', 'ready')
  AND b.actual_volume_liters > COALESCE(
    (SELECT SUM(prs.volume_liters) 
     FROM packaging_run_sources prs 
     WHERE prs.batch_id = b.id), 0
  )
  ORDER BY b.brew_date DESC;
END;
$$;

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE finished_skus ENABLE ROW LEVEL SECURITY;
ALTER TABLE lot_code_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE packaging_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE packaging_run_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE finished_lots ENABLE ROW LEVEL SECURITY;

-- Finished SKUs policies
CREATE POLICY "Users can view finished SKUs in their workspace"
  ON finished_skus FOR SELECT
  USING (workspace_id = get_jwt_workspace_id());

CREATE POLICY "Users with inventory role can manage finished SKUs"
  ON finished_skus FOR ALL
  USING (workspace_id = get_jwt_workspace_id())
  WITH CHECK (
    workspace_id = get_jwt_workspace_id() 
    AND (has_role('admin') OR has_role('inventory'))
  );

-- Lot code templates policies
CREATE POLICY "Users can view lot code templates in their workspace"
  ON lot_code_templates FOR SELECT
  USING (workspace_id = get_jwt_workspace_id());

CREATE POLICY "Users with inventory role can manage lot code templates"
  ON lot_code_templates FOR ALL
  USING (workspace_id = get_jwt_workspace_id())
  WITH CHECK (
    workspace_id = get_jwt_workspace_id() 
    AND (has_role('admin') OR has_role('inventory'))
  );

-- Packaging runs policies
CREATE POLICY "Users can view packaging runs in their workspace"
  ON packaging_runs FOR SELECT
  USING (workspace_id = get_jwt_workspace_id());

CREATE POLICY "Users with appropriate roles can create packaging runs"
  ON packaging_runs FOR INSERT
  WITH CHECK (
    workspace_id = get_jwt_workspace_id() 
    AND (has_role('admin') OR has_role('brewer') OR has_role('inventory'))
  );

CREATE POLICY "Users with appropriate roles can update packaging runs"
  ON packaging_runs FOR UPDATE
  USING (
    workspace_id = get_jwt_workspace_id() 
    AND (has_role('admin') OR has_role('inventory'))
  );

-- Packaging run sources policies
CREATE POLICY "Users can view packaging run sources in their workspace"
  ON packaging_run_sources FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM packaging_runs pr
      WHERE pr.id = packaging_run_sources.packaging_run_id
      AND pr.workspace_id = get_jwt_workspace_id()
    )
  );

CREATE POLICY "Users with appropriate roles can manage packaging run sources"
  ON packaging_run_sources FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM packaging_runs pr
      WHERE pr.id = packaging_run_sources.packaging_run_id
      AND pr.workspace_id = get_jwt_workspace_id()
      AND (has_role('admin') OR has_role('brewer') OR has_role('inventory'))
    )
  );

-- Finished lots policies
CREATE POLICY "Users can view finished lots in their workspace"
  ON finished_lots FOR SELECT
  USING (workspace_id = get_jwt_workspace_id());

CREATE POLICY "Users with inventory role can manage finished lots"
  ON finished_lots FOR ALL
  USING (workspace_id = get_jwt_workspace_id())
  WITH CHECK (
    workspace_id = get_jwt_workspace_id() 
    AND (has_role('admin') OR has_role('inventory'))
  );

-- Contract viewers can only see their own finished lots
CREATE POLICY "Contract viewers can see their own finished lots"
  ON finished_lots FOR SELECT
  USING (
    has_role('contract_viewer')
    AND owner_entity_id IN (
      SELECT id FROM ownership_entities
      WHERE workspace_id = get_jwt_workspace_id()
    )
  );

-- ============================================================================
-- SEED DATA FOR TESTING
-- ============================================================================

-- Insert sample finished SKUs
INSERT INTO finished_skus (workspace_id, code, name, container_type, container_size_ml, pack_size, barrels_per_unit)
SELECT 
  w.id,
  sku.code,
  sku.name,
  sku.container_type,
  sku.container_size_ml,
  sku.pack_size,
  (sku.container_size_ml * sku.pack_size) / 117347.76
FROM workspaces w
CROSS JOIN (VALUES
  ('IPA-6PK', 'IPA 6-Pack Cans', 'can', 355, 6),
  ('IPA-CASE', 'IPA Case (24 cans)', 'can', 355, 24),
  ('LAGER-6PK', 'Lager 6-Pack Bottles', 'bottle', 355, 6),
  ('STOUT-KEG', 'Stout Half Barrel Keg', 'keg', 58674, 1),
  ('WHEAT-GROWL', 'Wheat Beer Growler', 'growler', 1893, 1)
) AS sku(code, name, container_type, container_size_ml, pack_size)
WHERE w.name = 'Demo Brewery'
ON CONFLICT (workspace_id, code) DO NOTHING;

-- Insert sample lot code templates
INSERT INTO lot_code_templates (workspace_id, name, pattern, is_default, tokens_used)
SELECT 
  w.id,
  template.name,
  template.pattern,
  template.is_default,
  template.tokens_used
FROM workspaces w
CROSS JOIN (VALUES
  ('Standard', '{YY}{JJJ}-{BATCH}-{SKU}', true, ARRAY['{YY}', '{JJJ}', '{BATCH}', '{SKU}']),
  ('Date Only', '{YYYY}{MM}{DD}', false, ARRAY['{YYYY}', '{MM}', '{DD}']),
  ('Julian with Hour', '{YY}{JJJ}-{HOUR}{MIN}', false, ARRAY['{YY}', '{JJJ}', '{HOUR}', '{MIN}'])
) AS template(name, pattern, is_default, tokens_used)
WHERE w.name = 'Demo Brewery'
ON CONFLICT (workspace_id, name) DO NOTHING;

-- ============================================================================
-- GRANTS
-- ============================================================================

GRANT SELECT ON finished_skus TO authenticated;
GRANT ALL ON finished_skus TO service_role;
GRANT SELECT ON lot_code_templates TO authenticated;
GRANT ALL ON lot_code_templates TO service_role;
GRANT SELECT ON packaging_runs TO authenticated;
GRANT ALL ON packaging_runs TO service_role;
GRANT SELECT ON packaging_run_sources TO authenticated;
GRANT ALL ON packaging_run_sources TO service_role;
GRANT SELECT ON finished_lots TO authenticated;
GRANT ALL ON finished_lots TO service_role;

-- Grant sequence permissions
-- Note: run_number in packaging_runs is TEXT, not SERIAL, so no sequence exists

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE finished_skus IS 'Product definitions for finished goods (SKUs)';
COMMENT ON TABLE lot_code_templates IS 'Templates for generating lot/date codes with tokens';
COMMENT ON TABLE packaging_runs IS 'Records of packaging operations converting batches to finished goods';
COMMENT ON TABLE packaging_run_sources IS 'Source batches for packaging runs (supports blends)';
COMMENT ON TABLE finished_lots IS 'Finished goods inventory lots created from packaging runs';

COMMENT ON FUNCTION create_packaging_run IS 'Main RPC for creating packaging runs with COGS allocation and lot code generation';
COMMENT ON FUNCTION generate_lot_code IS 'Generates lot codes based on templates with token substitution';
COMMENT ON FUNCTION check_lot_code_collision IS 'Checks if a lot code already exists in the workspace';
COMMENT ON FUNCTION calculate_batch_cogs_for_packaging IS 'Calculates allocated COGS for a batch based on volume used';
COMMENT ON FUNCTION get_available_batches_for_packaging IS 'Returns batches available for packaging with remaining volume';
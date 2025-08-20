-- Phase 4.3: Batch Management, Tank Management, Fermentation & Yeast Database Enhancements

-- Add batch timeline fields
ALTER TABLE batches 
  ADD COLUMN IF NOT EXISTS ferment_start_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ferment_end_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS conditioning_start_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS conditioning_end_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS package_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cogs_actual DECIMAL,
  ADD COLUMN IF NOT EXISTS cogs_method cost_method DEFAULT 'actual_lots',
  ADD COLUMN IF NOT EXISTS inventory_consumed JSONB DEFAULT '[]'::jsonb;

-- Add tank occupancy constraint
ALTER TABLE tanks
  ADD COLUMN IF NOT EXISTS next_available_date DATE,
  ADD COLUMN IF NOT EXISTS cip_required_after_batches INTEGER DEFAULT 5,
  ADD COLUMN IF NOT EXISTS batches_since_cip INTEGER DEFAULT 0;

-- Create function to check tank availability
CREATE OR REPLACE FUNCTION check_tank_availability(
  p_tank_id UUID,
  p_start_date DATE,
  p_end_date DATE
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_workspace_id UUID;
  v_is_available BOOLEAN := true;
BEGIN
  -- Get tank workspace
  SELECT workspace_id INTO v_workspace_id
  FROM tanks
  WHERE id = p_tank_id;

  IF v_workspace_id != get_jwt_workspace_id() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  -- Check if tank has any overlapping batches
  SELECT NOT EXISTS (
    SELECT 1 FROM batches b
    WHERE b.tank_id = p_tank_id
    AND b.status NOT IN ('completed', 'archived', 'cancelled')
    AND (
      (b.brew_date <= p_end_date AND COALESCE(b.package_date, b.ferment_end_date, b.brew_date + INTERVAL '14 days') >= p_start_date)
    )
  ) INTO v_is_available;

  RETURN v_is_available;
END;
$$;

-- Function to update batch status with validation
CREATE OR REPLACE FUNCTION update_batch_status(
  p_batch_id UUID,
  p_new_status batch_status,
  p_notes TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_workspace_id UUID;
  v_current_status batch_status;
  v_valid_transition BOOLEAN := false;
BEGIN
  -- Get current batch info
  SELECT workspace_id, status
  INTO v_workspace_id, v_current_status
  FROM batches
  WHERE id = p_batch_id;

  IF v_workspace_id != get_jwt_workspace_id() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  -- Check permissions
  IF NOT (has_role('admin') OR has_role('brewer')) THEN
    RAISE EXCEPTION 'Insufficient permissions to update batch status';
  END IF;

  -- Validate state transitions
  CASE v_current_status
    WHEN 'planned' THEN
      v_valid_transition := p_new_status IN ('brewing', 'cancelled');
    WHEN 'brewing' THEN
      v_valid_transition := p_new_status IN ('fermenting', 'cancelled');
    WHEN 'fermenting' THEN
      v_valid_transition := p_new_status IN ('conditioning', 'packaging', 'cancelled');
    WHEN 'conditioning' THEN
      v_valid_transition := p_new_status IN ('packaging', 'cancelled');
    WHEN 'packaging' THEN
      v_valid_transition := p_new_status IN ('completed');
    WHEN 'completed' THEN
      v_valid_transition := p_new_status IN ('archived');
    ELSE
      v_valid_transition := false;
  END CASE;

  IF NOT v_valid_transition THEN
    RAISE EXCEPTION 'Invalid status transition from % to %', v_current_status, p_new_status;
  END IF;

  -- Update status and set timeline dates
  UPDATE batches
  SET 
    status = p_new_status,
    ferment_start_date = CASE 
      WHEN p_new_status = 'fermenting' AND ferment_start_date IS NULL 
      THEN NOW() 
      ELSE ferment_start_date 
    END,
    ferment_end_date = CASE 
      WHEN p_new_status IN ('conditioning', 'packaging') AND ferment_end_date IS NULL 
      THEN NOW() 
      ELSE ferment_end_date 
    END,
    conditioning_start_date = CASE 
      WHEN p_new_status = 'conditioning' AND conditioning_start_date IS NULL 
      THEN NOW() 
      ELSE conditioning_start_date 
    END,
    conditioning_end_date = CASE 
      WHEN p_new_status = 'packaging' AND conditioning_end_date IS NULL 
      THEN NOW() 
      ELSE conditioning_end_date 
    END,
    package_date = CASE 
      WHEN p_new_status = 'completed' AND package_date IS NULL 
      THEN NOW() 
      ELSE package_date 
    END,
    notes = COALESCE(notes || E'\n' || p_notes, notes),
    updated_at = NOW(),
    updated_by = auth.uid()
  WHERE id = p_batch_id;

  -- Update tank status if completing
  IF p_new_status = 'completed' THEN
    UPDATE tanks t
    SET 
      current_batch_id = NULL,
      batches_since_cip = batches_since_cip + 1,
      cip_status = CASE 
        WHEN batches_since_cip + 1 >= cip_required_after_batches 
        THEN 'required'::cip_status 
        ELSE cip_status 
      END,
      updated_at = NOW(),
      updated_by = auth.uid()
    FROM batches b
    WHERE b.id = p_batch_id
    AND t.id = b.tank_id;
  END IF;

  -- Audit log
  INSERT INTO audit_logs (
    workspace_id, entity_table, entity_id, action, before, after, actor_user_id
  ) VALUES (
    v_workspace_id, 'batches', p_batch_id, 'update',
    jsonb_build_object('status', v_current_status),
    jsonb_build_object('status', p_new_status, 'notes', p_notes),
    auth.uid()
  );

  -- Telemetry
  INSERT INTO ui_events (
    event_name, role, workspace_id, entity_type, entity_id
  ) VALUES (
    'batch_status_changed', 
    (SELECT role FROM user_workspace_roles WHERE user_id = auth.uid() AND workspace_id = v_workspace_id),
    v_workspace_id, 'batch', p_batch_id
  );

  RETURN true;
END;
$$;

-- Function to start brew day and consume inventory
CREATE OR REPLACE FUNCTION start_brew_day(
  p_batch_id UUID,
  p_actual_og DECIMAL DEFAULT NULL,
  p_actual_volume DECIMAL DEFAULT NULL,
  p_consume_inventory BOOLEAN DEFAULT true
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_workspace_id UUID;
  v_recipe_version_id UUID;
  v_consumed_items JSONB := '[]'::jsonb;
  v_total_cost DECIMAL := 0;
  v_ingredient RECORD;
  v_lot_consumption RECORD;
BEGIN
  -- Get batch info
  SELECT workspace_id, recipe_version_id
  INTO v_workspace_id, v_recipe_version_id
  FROM batches
  WHERE id = p_batch_id;

  IF v_workspace_id != get_jwt_workspace_id() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  -- Update batch status to brewing
  PERFORM update_batch_status(p_batch_id, 'brewing');

  -- Update actual values if provided
  IF p_actual_og IS NOT NULL OR p_actual_volume IS NOT NULL THEN
    UPDATE batches
    SET 
      actual_og = COALESCE(p_actual_og, actual_og),
      actual_volume = COALESCE(p_actual_volume, actual_volume),
      updated_at = NOW(),
      updated_by = auth.uid()
    WHERE id = p_batch_id;
  END IF;

  -- Consume inventory if requested
  IF p_consume_inventory THEN
    FOR v_ingredient IN
      SELECT ri.item_id, ri.qty, ri.uom, i.name as item_name
      FROM recipe_ingredients ri
      JOIN items i ON i.id = ri.item_id
      WHERE ri.recipe_version_id = v_recipe_version_id
      ORDER BY ri.sort_order
    LOOP
      -- Consume using FIFO
      SELECT * INTO v_lot_consumption
      FROM consume_inventory_fifo(
        v_ingredient.item_id,
        v_ingredient.qty,
        'Batch ' || (SELECT batch_number FROM batches WHERE id = p_batch_id),
        'batch',
        p_batch_id
      );

      -- Track consumption
      v_consumed_items := v_consumed_items || jsonb_build_object(
        'item_id', v_ingredient.item_id,
        'item_name', v_ingredient.item_name,
        'qty', v_ingredient.qty,
        'uom', v_ingredient.uom,
        'cost', v_lot_consumption.total_cost,
        'lots_consumed', v_lot_consumption.lots_consumed
      );

      v_total_cost := v_total_cost + v_lot_consumption.total_cost;
    END LOOP;

    -- Update batch with consumption info
    UPDATE batches
    SET 
      inventory_consumed = v_consumed_items,
      cogs_actual = v_total_cost,
      updated_at = NOW(),
      updated_by = auth.uid()
    WHERE id = p_batch_id;
  END IF;

  -- Telemetry
  INSERT INTO ui_events (
    event_name, role, workspace_id, entity_type, entity_id
  ) VALUES (
    'brew_day_started', 
    (SELECT role FROM user_workspace_roles WHERE user_id = auth.uid() AND workspace_id = v_workspace_id),
    v_workspace_id, 'batch', p_batch_id
  );

  RETURN jsonb_build_object(
    'batch_id', p_batch_id,
    'status', 'brewing',
    'consumed_items', v_consumed_items,
    'total_cost', v_total_cost
  );
END;
$$;

-- Function to log fermentation reading with idempotency
CREATE OR REPLACE FUNCTION log_ferm_reading(
  p_batch_id UUID,
  p_sg DECIMAL DEFAULT NULL,
  p_temp DECIMAL DEFAULT NULL,
  p_ph DECIMAL DEFAULT NULL,
  p_pressure DECIMAL DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_workspace_id UUID;
  v_reading_id UUID;
BEGIN
  -- Get batch workspace
  SELECT workspace_id INTO v_workspace_id
  FROM batches
  WHERE id = p_batch_id;

  IF v_workspace_id != get_jwt_workspace_id() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  -- Check idempotency
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_reading_id
    FROM ferm_readings
    WHERE batch_id = p_batch_id
    AND notes LIKE '%idempotency:' || p_idempotency_key || '%';

    IF FOUND THEN
      RETURN v_reading_id;
    END IF;
  END IF;

  -- Insert reading
  v_reading_id := uuid_generate_v4();
  
  INSERT INTO ferm_readings (
    id, workspace_id, batch_id, sg, temp, ph, pressure, 
    notes, created_by
  ) VALUES (
    v_reading_id, v_workspace_id, p_batch_id, p_sg, p_temp, p_ph, p_pressure,
    CASE 
      WHEN p_idempotency_key IS NOT NULL 
      THEN COALESCE(p_notes, '') || ' [idempotency:' || p_idempotency_key || ']'
      ELSE p_notes
    END,
    auth.uid()
  );

  RETURN v_reading_id;
END;
$$;

-- Function to pitch yeast to batch
CREATE OR REPLACE FUNCTION pitch_yeast(
  p_batch_id UUID,
  p_yeast_batch_id UUID,
  p_pitch_rate DECIMAL DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_workspace_id UUID;
  v_link_id UUID;
  v_strain_name TEXT;
  v_generation INTEGER;
BEGIN
  -- Get batch workspace
  SELECT workspace_id INTO v_workspace_id
  FROM batches
  WHERE id = p_batch_id;

  IF v_workspace_id != get_jwt_workspace_id() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  -- Check permissions
  IF NOT (has_role('admin') OR has_role('brewer')) THEN
    RAISE EXCEPTION 'Insufficient permissions to pitch yeast';
  END IF;

  -- Get yeast info
  SELECT ys.name, yb.generation
  INTO v_strain_name, v_generation
  FROM yeast_batches yb
  JOIN yeast_strains ys ON ys.id = yb.strain_id
  WHERE yb.id = p_yeast_batch_id
  AND yb.workspace_id = v_workspace_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Yeast batch not found';
  END IF;

  -- Check if yeast already pitched
  IF EXISTS (
    SELECT 1 FROM batch_yeast_links
    WHERE batch_id = p_batch_id
    AND yeast_batch_id = p_yeast_batch_id
    AND role = 'pitched'
  ) THEN
    RAISE EXCEPTION 'Yeast already pitched to this batch';
  END IF;

  -- Create link
  v_link_id := uuid_generate_v4();
  
  INSERT INTO batch_yeast_links (
    id, workspace_id, batch_id, yeast_batch_id, role, pitch_rate, created_by
  ) VALUES (
    v_link_id, v_workspace_id, p_batch_id, p_yeast_batch_id, 'pitched', p_pitch_rate, auth.uid()
  );

  -- Update yeast batch
  UPDATE yeast_batches
  SET 
    pitch_date = CURRENT_DATE,
    notes = COALESCE(notes || E'\n', '') || 'Pitched to batch on ' || CURRENT_DATE || COALESCE(': ' || p_notes, ''),
    updated_at = NOW(),
    updated_by = auth.uid()
  WHERE id = p_yeast_batch_id;

  -- Update batch
  UPDATE batches
  SET 
    yeast_batch_id = p_yeast_batch_id,
    notes = COALESCE(notes || E'\n', '') || 'Pitched ' || v_strain_name || ' (Gen ' || v_generation || ')',
    updated_at = NOW(),
    updated_by = auth.uid()
  WHERE id = p_batch_id;

  -- Audit log
  INSERT INTO audit_logs (
    workspace_id, entity_table, entity_id, action, after, actor_user_id
  ) VALUES (
    v_workspace_id, 'batch_yeast_links', v_link_id, 'insert',
    jsonb_build_object(
      'batch_id', p_batch_id,
      'yeast_batch_id', p_yeast_batch_id,
      'strain', v_strain_name,
      'generation', v_generation
    ),
    auth.uid()
  );

  -- Telemetry
  INSERT INTO ui_events (
    event_name, role, workspace_id, entity_type, entity_id
  ) VALUES (
    'yeast_pitch_logged', 
    (SELECT role FROM user_workspace_roles WHERE user_id = auth.uid() AND workspace_id = v_workspace_id),
    v_workspace_id, 'yeast', p_yeast_batch_id
  );

  RETURN v_link_id;
END;
$$;

-- Function to harvest yeast from batch
CREATE OR REPLACE FUNCTION harvest_yeast(
  p_batch_id UUID,
  p_strain_id UUID,
  p_volume DECIMAL,
  p_cell_count DECIMAL DEFAULT NULL,
  p_viability_pct DECIMAL DEFAULT NULL,
  p_storage_location TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_workspace_id UUID;
  v_parent_yeast_id UUID;
  v_parent_generation INTEGER;
  v_new_yeast_id UUID;
  v_new_generation INTEGER;
  v_max_generation INTEGER;
BEGIN
  -- Get batch info
  SELECT workspace_id, yeast_batch_id
  INTO v_workspace_id, v_parent_yeast_id
  FROM batches
  WHERE id = p_batch_id;

  IF v_workspace_id != get_jwt_workspace_id() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  -- Check permissions
  IF NOT (has_role('admin') OR has_role('brewer')) THEN
    RAISE EXCEPTION 'Insufficient permissions to harvest yeast';
  END IF;

  -- Get parent generation and max generation
  IF v_parent_yeast_id IS NOT NULL THEN
    SELECT yb.generation, ys.recommended_max_generation
    INTO v_parent_generation, v_max_generation
    FROM yeast_batches yb
    JOIN yeast_strains ys ON ys.id = yb.strain_id
    WHERE yb.id = v_parent_yeast_id;
    
    v_new_generation := v_parent_generation + 1;
  ELSE
    -- First generation harvest
    v_new_generation := 1;
    SELECT recommended_max_generation INTO v_max_generation
    FROM yeast_strains
    WHERE id = p_strain_id;
  END IF;

  -- Warn if exceeding max generation
  IF v_new_generation > v_max_generation THEN
    RAISE WARNING 'Yeast generation % exceeds recommended maximum of %', v_new_generation, v_max_generation;
  END IF;

  -- Create new yeast batch
  v_new_yeast_id := uuid_generate_v4();
  
  INSERT INTO yeast_batches (
    id, workspace_id, strain_id, generation, source_batch_id,
    harvest_date, cell_count, viability_pct, volume, storage_location,
    notes, created_by
  ) VALUES (
    v_new_yeast_id, v_workspace_id, p_strain_id, v_new_generation, v_parent_yeast_id,
    CURRENT_DATE, p_cell_count, p_viability_pct, p_volume, p_storage_location,
    'Harvested from batch on ' || CURRENT_DATE || COALESCE(': ' || p_notes, ''),
    auth.uid()
  );

  -- Create link
  INSERT INTO batch_yeast_links (
    workspace_id, batch_id, yeast_batch_id, role, created_by
  ) VALUES (
    v_workspace_id, p_batch_id, v_new_yeast_id, 'harvested_from', auth.uid()
  );

  -- Optionally create inventory item for yeast if configured
  -- This would be added based on workspace settings

  -- Audit log
  INSERT INTO audit_logs (
    workspace_id, entity_table, entity_id, action, after, actor_user_id
  ) VALUES (
    v_workspace_id, 'yeast_batches', v_new_yeast_id, 'insert',
    jsonb_build_object(
      'batch_id', p_batch_id,
      'strain_id', p_strain_id,
      'generation', v_new_generation,
      'volume', p_volume
    ),
    auth.uid()
  );

  -- Telemetry
  INSERT INTO ui_events (
    event_name, role, workspace_id, entity_type, entity_id
  ) VALUES (
    'yeast_harvest_logged', 
    (SELECT role FROM user_workspace_roles WHERE user_id = auth.uid() AND workspace_id = v_workspace_id),
    v_workspace_id, 'yeast', v_new_yeast_id
  );

  RETURN v_new_yeast_id;
END;
$$;

-- Function to perform tank CIP
CREATE OR REPLACE FUNCTION perform_tank_cip(
  p_tank_id UUID,
  p_notes TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_workspace_id UUID;
BEGIN
  -- Get tank workspace
  SELECT workspace_id INTO v_workspace_id
  FROM tanks
  WHERE id = p_tank_id;

  IF v_workspace_id != get_jwt_workspace_id() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  -- Check permissions
  IF NOT (has_role('admin') OR has_role('brewer')) THEN
    RAISE EXCEPTION 'Insufficient permissions to perform CIP';
  END IF;

  -- Check tank is empty
  IF EXISTS (
    SELECT 1 FROM tanks 
    WHERE id = p_tank_id 
    AND current_batch_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Cannot CIP occupied tank';
  END IF;

  -- Update tank
  UPDATE tanks
  SET 
    cip_status = 'clean'::cip_status,
    last_cip_date = NOW(),
    batches_since_cip = 0,
    updated_at = NOW(),
    updated_by = auth.uid()
  WHERE id = p_tank_id;

  -- Audit log
  INSERT INTO audit_logs (
    workspace_id, entity_table, entity_id, action, after, actor_user_id
  ) VALUES (
    v_workspace_id, 'tanks', p_tank_id, 'update',
    jsonb_build_object('cip_performed', true, 'notes', p_notes),
    auth.uid()
  );

  RETURN true;
END;
$$;

-- View for batch timeline with calculations
CREATE OR REPLACE VIEW v_batch_timeline AS
SELECT 
  b.*,
  rv.name as recipe_name,
  t.name as tank_name,
  ys.name as yeast_strain,
  yb.generation as yeast_generation,
  CASE 
    WHEN b.ferment_start_date IS NOT NULL AND b.ferment_end_date IS NULL 
    THEN EXTRACT(DAY FROM NOW() - b.ferment_start_date)
    ELSE NULL
  END as days_in_fermentation,
  CASE 
    WHEN b.conditioning_start_date IS NOT NULL AND b.conditioning_end_date IS NULL 
    THEN EXTRACT(DAY FROM NOW() - b.conditioning_start_date)
    ELSE NULL
  END as days_in_conditioning,
  (
    SELECT COUNT(*) 
    FROM ferm_readings fr 
    WHERE fr.batch_id = b.id
  ) as reading_count,
  (
    SELECT MAX(fr.reading_at) 
    FROM ferm_readings fr 
    WHERE fr.batch_id = b.id
  ) as last_reading_at
FROM batches b
LEFT JOIN recipe_versions rv ON rv.id = b.recipe_version_id
LEFT JOIN tanks t ON t.id = b.tank_id
LEFT JOIN yeast_batches yb ON yb.id = b.yeast_batch_id
LEFT JOIN yeast_strains ys ON ys.id = yb.strain_id
WHERE b.workspace_id = get_jwt_workspace_id();

-- View for tank status
CREATE OR REPLACE VIEW v_tank_status AS
SELECT 
  t.*,
  b.batch_number as current_batch_number,
  b.status as current_batch_status,
  b.brew_date as current_batch_brew_date,
  CASE 
    WHEN t.batches_since_cip >= t.cip_required_after_batches 
    THEN 'Required'
    WHEN t.batches_since_cip >= t.cip_required_after_batches - 1 
    THEN 'Soon'
    ELSE 'OK'
  END as cip_status_text,
  CASE 
    WHEN b.id IS NOT NULL THEN false
    ELSE true
  END as is_available
FROM tanks t
LEFT JOIN batches b ON b.id = t.current_batch_id
WHERE t.workspace_id = get_jwt_workspace_id()
AND t.is_active = true;

-- View for yeast inventory
CREATE OR REPLACE VIEW v_yeast_inventory AS
SELECT 
  yb.*,
  ys.name as strain_name,
  ys.type as strain_type,
  ys.recommended_max_generation,
  CASE 
    WHEN yb.generation >= ys.recommended_max_generation 
    THEN 'Max generation reached'
    WHEN yb.generation >= ys.recommended_max_generation - 1 
    THEN 'Near max generation'
    ELSE 'OK'
  END as generation_status,
  CASE 
    WHEN yb.pitch_date IS NULL 
    THEN true
    ELSE false
  END as is_available,
  AGE(CURRENT_DATE, yb.harvest_date) as age
FROM yeast_batches yb
JOIN yeast_strains ys ON ys.id = yb.strain_id
WHERE yb.workspace_id = get_jwt_workspace_id()
AND yb.is_active = true
ORDER BY yb.harvest_date DESC, yb.generation;

-- Grant permissions
GRANT SELECT ON v_batch_timeline TO authenticated;
GRANT SELECT ON v_tank_status TO authenticated;
GRANT SELECT ON v_yeast_inventory TO authenticated;
GRANT EXECUTE ON FUNCTION check_tank_availability TO authenticated;
GRANT EXECUTE ON FUNCTION update_batch_status TO authenticated;
GRANT EXECUTE ON FUNCTION start_brew_day TO authenticated;
GRANT EXECUTE ON FUNCTION log_ferm_reading TO authenticated;
GRANT EXECUTE ON FUNCTION pitch_yeast TO authenticated;
GRANT EXECUTE ON FUNCTION harvest_yeast TO authenticated;
GRANT EXECUTE ON FUNCTION perform_tank_cip TO authenticated;
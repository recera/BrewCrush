-- Batch Detail Views and Functions
-- This migration adds views and functions needed for the comprehensive batch detail page

-- View for batch details with all related information
CREATE OR REPLACE VIEW v_batch_details AS
SELECT 
  b.id,
  b.workspace_id,
  b.batch_number,
  b.recipe_version_id,
  r.name as recipe_name,
  r.style as recipe_style,
  b.status,
  b.brew_date,
  b.target_volume,
  b.actual_volume,
  b.target_og,
  b.actual_og,
  b.target_fg,
  b.actual_fg,
  b.target_abv,
  b.actual_abv,
  b.target_ibu,
  b.target_srm,
  b.target_ph,
  b.tank_id,
  t.name as tank_name,
  b.ferment_start_date,
  b.ferment_end_date,
  b.condition_start_date,
  b.condition_end_date,
  b.package_date,
  b.total_cost,
  b.cost_per_liter,
  b.notes,
  b.created_at,
  b.updated_at,
  u.full_name as created_by,
  -- Yeast information
  CASE 
    WHEN yb.id IS NOT NULL THEN 
      jsonb_build_object(
        'id', yb.id,
        'strain_name', ys.name,
        'generation', yb.generation,
        'pitch_at', yb.pitch_at,
        'harvest_at', yb.harvest_at
      )
    ELSE NULL
  END as yeast_batch,
  -- Owner entity for contract brewing
  CASE 
    WHEN b.owner_entity_id IS NOT NULL THEN
      jsonb_build_object(
        'id', oe.id,
        'name', oe.name,
        'permit_number', oe.permit_number
      )
    ELSE NULL
  END as owner_entity
FROM batches b
LEFT JOIN recipe_versions rv ON rv.id = b.recipe_version_id
LEFT JOIN recipes r ON r.id = rv.recipe_id
LEFT JOIN tanks t ON t.id = b.tank_id
LEFT JOIN users u ON u.id = b.created_by
LEFT JOIN batch_yeast_links byl ON byl.batch_id = b.id AND byl.role = 'pitched'
LEFT JOIN yeast_batches yb ON yb.id = byl.yeast_batch_id
LEFT JOIN yeast_strains ys ON ys.id = yb.strain_id
LEFT JOIN ownership_entities oe ON oe.id = b.owner_entity_id;

-- View for packaging runs with details
CREATE OR REPLACE VIEW v_packaging_runs AS
SELECT 
  pr.id,
  pr.workspace_id,
  pr.at as run_at,
  pr.loss_pct as loss_percentage,
  pr.cost_method_used,
  fs.name as sku_name,
  fl.lot_code,
  fl.produced_qty as units_produced,
  -- Calculate cost per unit from finished lots
  CASE 
    WHEN fl.produced_qty > 0 THEN pr.total_cost / fl.produced_qty
    ELSE NULL
  END as cost_per_unit,
  pr.total_cost,
  -- Get batch IDs from packaging run sources
  prs.batch_id
FROM packaging_runs pr
JOIN packaging_run_sources prs ON prs.run_id = pr.id
JOIN finished_lots fl ON fl.run_id = pr.id
JOIN finished_skus fs ON fs.id = pr.sku_id;

-- View for batch consumption (ingredients and materials used)
CREATE OR REPLACE VIEW v_batch_consumption AS
SELECT 
  it.id,
  it.workspace_id,
  i.name as item_name,
  i.type as item_type,
  ABS(it.qty) as qty_consumed,
  it.uom,
  il.unit_cost,
  ABS(it.qty * il.unit_cost) as total_cost,
  il.lot_code,
  it.ref_id as batch_id
FROM inventory_transactions it
JOIN items i ON i.id = it.item_id
LEFT JOIN item_lots il ON il.id = it.item_lot_id
WHERE it.type = 'consume'
AND it.ref_type = 'batch';

-- View for batch events timeline
CREATE OR REPLACE VIEW v_batch_events AS
SELECT 
  al.id,
  CASE 
    WHEN al.action = 'insert' THEN 'created'
    WHEN al.action = 'update' AND al.after->>'status' != al.before->>'status' THEN 'status_change'
    WHEN al.action = 'update' THEN 'updated'
    ELSE al.action
  END as event_type,
  CASE 
    WHEN al.action = 'insert' THEN 'Batch created'
    WHEN al.action = 'update' AND al.after->>'status' != al.before->>'status' THEN 
      'Status changed from ' || (al.before->>'status') || ' to ' || (al.after->>'status')
    WHEN al.action = 'update' THEN 'Batch updated'
    ELSE al.action
  END as event_description,
  al.created_at as event_at,
  u.full_name as user_name,
  al.entity_id as batch_id,
  jsonb_build_object(
    'before_status', al.before->>'status',
    'after_status', al.after->>'status',
    'changes', al.after
  ) as metadata,
  al.workspace_id
FROM audit_logs al
LEFT JOIN users u ON u.id = al.created_by
WHERE al.entity_table = 'batches'

UNION ALL

-- Include fermentation readings as events
SELECT 
  fr.id,
  'reading' as event_type,
  'Fermentation reading logged: SG ' || COALESCE(fr.sg::text, 'N/A') || 
  ', Temp ' || COALESCE(fr.temp::text || '°C', 'N/A') as event_description,
  fr.reading_at as event_at,
  u.full_name as user_name,
  fr.batch_id,
  jsonb_build_object(
    'sg', fr.sg,
    'temp', fr.temp,
    'ph', fr.ph,
    'notes', fr.notes
  ) as metadata,
  fr.workspace_id
FROM ferm_readings fr
LEFT JOIN users u ON u.id = fr.created_by

UNION ALL

-- Include packaging runs as events
SELECT 
  pr.id,
  'packaging' as event_type,
  'Packaging run completed: ' || fs.name as event_description,
  pr.at as event_at,
  u.full_name as user_name,
  prs.batch_id,
  jsonb_build_object(
    'sku', fs.name,
    'units', fl.produced_qty,
    'lot_code', fl.lot_code
  ) as metadata,
  pr.workspace_id
FROM packaging_runs pr
JOIN packaging_run_sources prs ON prs.run_id = pr.id
JOIN finished_lots fl ON fl.run_id = pr.id
JOIN finished_skus fs ON fs.id = pr.sku_id
LEFT JOIN users u ON u.id = pr.created_by;

-- Function to update batch status with validation
CREATE OR REPLACE FUNCTION update_batch_status(
  p_batch_id UUID,
  p_new_status TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_workspace_id UUID;
  v_current_status TEXT;
  v_valid_transition BOOLEAN := FALSE;
BEGIN
  -- Get current batch info
  SELECT workspace_id, status 
  INTO v_workspace_id, v_current_status
  FROM batches
  WHERE id = p_batch_id;

  -- Check workspace access
  IF v_workspace_id != get_jwt_workspace_id() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  -- Check permissions
  IF NOT (has_role('admin') OR has_role('brewer')) THEN
    RAISE EXCEPTION 'Insufficient permissions to update batch status';
  END IF;

  -- Validate status transition
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
    ELSE
      v_valid_transition := FALSE;
  END CASE;

  IF NOT v_valid_transition THEN
    RAISE EXCEPTION 'Invalid status transition from % to %', v_current_status, p_new_status;
  END IF;

  -- Update the status and relevant dates
  UPDATE batches
  SET 
    status = p_new_status,
    ferment_start_date = CASE 
      WHEN p_new_status = 'fermenting' AND ferment_start_date IS NULL 
      THEN CURRENT_DATE 
      ELSE ferment_start_date 
    END,
    ferment_end_date = CASE 
      WHEN v_current_status = 'fermenting' AND p_new_status != 'fermenting' AND ferment_end_date IS NULL
      THEN CURRENT_DATE 
      ELSE ferment_end_date 
    END,
    condition_start_date = CASE 
      WHEN p_new_status = 'conditioning' AND condition_start_date IS NULL 
      THEN CURRENT_DATE 
      ELSE condition_start_date 
    END,
    condition_end_date = CASE 
      WHEN v_current_status = 'conditioning' AND p_new_status != 'conditioning' AND condition_end_date IS NULL
      THEN CURRENT_DATE 
      ELSE condition_end_date 
    END,
    package_date = CASE 
      WHEN p_new_status = 'packaging' AND package_date IS NULL 
      THEN CURRENT_DATE 
      ELSE package_date 
    END,
    updated_at = NOW(),
    updated_by = auth.uid()
  WHERE id = p_batch_id;

  -- Log the status change
  INSERT INTO audit_logs (
    entity_table,
    entity_id,
    action,
    before,
    after,
    created_by,
    workspace_id
  ) VALUES (
    'batches',
    p_batch_id,
    'update',
    jsonb_build_object('status', v_current_status),
    jsonb_build_object('status', p_new_status),
    auth.uid(),
    v_workspace_id
  );

  RETURN TRUE;
END;
$$;

-- Grant permissions
GRANT SELECT ON v_batch_details TO authenticated;
GRANT SELECT ON v_packaging_runs TO authenticated;
GRANT SELECT ON v_batch_consumption TO authenticated;
GRANT SELECT ON v_batch_events TO authenticated;
GRANT EXECUTE ON FUNCTION update_batch_status(UUID, TEXT) TO authenticated;

-- Add RLS policies
ALTER VIEW v_batch_details OWNER TO authenticated;
ALTER VIEW v_packaging_runs OWNER TO authenticated;
ALTER VIEW v_batch_consumption OWNER TO authenticated;
ALTER VIEW v_batch_events OWNER TO authenticated;
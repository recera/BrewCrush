-- Production Hub Support Functions and Views
-- This migration adds the necessary database functions and views for the unified production hub

-- Function to get production statistics
CREATE OR REPLACE FUNCTION get_production_stats()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_workspace_id UUID;
  v_stats JSON;
BEGIN
  v_workspace_id := get_jwt_workspace_id();
  
  SELECT json_build_object(
    'active_batches', (
      SELECT COUNT(*) FROM batches 
      WHERE workspace_id = v_workspace_id 
      AND status IN ('planned', 'brewing', 'fermenting', 'conditioning', 'packaging')
    ),
    'tanks_occupied', (
      SELECT COUNT(*) FROM tanks 
      WHERE workspace_id = v_workspace_id 
      AND current_batch_id IS NOT NULL
    ),
    'tanks_total', (
      SELECT COUNT(*) FROM tanks 
      WHERE workspace_id = v_workspace_id 
      AND is_active = true
    ),
    'tanks_need_cip', (
      SELECT COUNT(*) FROM tanks 
      WHERE workspace_id = v_workspace_id 
      AND cip_status = 'required'
    ),
    'yeast_batches_active', (
      SELECT COUNT(*) FROM yeast_batches 
      WHERE workspace_id = v_workspace_id 
      AND harvest_at IS NULL
    ),
    'yeast_harvest_ready', (
      SELECT COUNT(*) FROM yeast_batches yb
      JOIN batches b ON b.id = ANY(yb.linked_batch_ids)
      WHERE yb.workspace_id = v_workspace_id 
      AND yb.harvest_at IS NULL
      AND b.status IN ('conditioning', 'packaging')
    ),
    'upcoming_packages', (
      SELECT COUNT(*) FROM batches 
      WHERE workspace_id = v_workspace_id 
      AND status = 'conditioning'
      AND condition_end_date <= CURRENT_DATE + INTERVAL '7 days'
    ),
    'low_stock_items', (
      SELECT COUNT(*) FROM items i
      WHERE i.workspace_id = v_workspace_id
      AND i.reorder_level IS NOT NULL
      AND (
        SELECT COALESCE(SUM(il.qty), 0) 
        FROM item_lots il 
        WHERE il.item_id = i.id
      ) <= i.reorder_level
    ),
    'batches_this_week', (
      SELECT COUNT(*) FROM batches 
      WHERE workspace_id = v_workspace_id 
      AND brew_date >= date_trunc('week', CURRENT_DATE)
      AND brew_date <= date_trunc('week', CURRENT_DATE) + INTERVAL '6 days'
    ),
    'volume_this_week', (
      SELECT COALESCE(SUM(target_volume), 0) FROM batches 
      WHERE workspace_id = v_workspace_id 
      AND brew_date >= date_trunc('week', CURRENT_DATE)
      AND brew_date <= date_trunc('week', CURRENT_DATE) + INTERVAL '6 days'
    )
  ) INTO v_stats;
  
  RETURN v_stats;
END;
$$;

-- Function to get upcoming production tasks
CREATE OR REPLACE FUNCTION get_upcoming_production_tasks(p_days_ahead INTEGER DEFAULT 7)
RETURNS TABLE (
  id UUID,
  type TEXT,
  title TEXT,
  description TEXT,
  due_date DATE,
  priority TEXT,
  entity_id UUID,
  entity_type TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_workspace_id UUID;
BEGIN
  v_workspace_id := get_jwt_workspace_id();
  
  RETURN QUERY
  -- Scheduled brew days
  SELECT 
    b.id,
    'brew'::TEXT,
    'Brew ' || b.batch_number::TEXT,
    COALESCE(r.name || ' - ' || b.target_volume::TEXT || 'L', 'Scheduled brew'),
    b.brew_date,
    CASE 
      WHEN b.brew_date = CURRENT_DATE THEN 'high'
      WHEN b.brew_date <= CURRENT_DATE + INTERVAL '2 days' THEN 'medium'
      ELSE 'low'
    END::TEXT,
    b.id,
    'batch'::TEXT
  FROM batches b
  LEFT JOIN recipe_versions rv ON rv.id = b.recipe_version_id
  LEFT JOIN recipes r ON r.id = rv.recipe_id
  WHERE b.workspace_id = v_workspace_id
  AND b.status = 'planned'
  AND b.brew_date <= CURRENT_DATE + make_interval(days => p_days_ahead)
  
  UNION ALL
  
  -- Batches ready to package
  SELECT 
    b.id,
    'package'::TEXT,
    'Package ' || b.batch_number::TEXT,
    'Ready for packaging after ' || 
    COALESCE(
      date_trunc('day', age(CURRENT_TIMESTAMP, b.ferment_start_date))::TEXT,
      'conditioning'
    ),
    COALESCE(b.condition_end_date, b.ferment_end_date, CURRENT_DATE),
    CASE 
      WHEN b.condition_end_date <= CURRENT_DATE THEN 'high'
      WHEN b.condition_end_date <= CURRENT_DATE + INTERVAL '2 days' THEN 'medium'
      ELSE 'low'
    END::TEXT,
    b.id,
    'batch'::TEXT
  FROM batches b
  WHERE b.workspace_id = v_workspace_id
  AND b.status = 'conditioning'
  AND COALESCE(b.condition_end_date, b.ferment_end_date, CURRENT_DATE) <= CURRENT_DATE + make_interval(days => p_days_ahead)
  
  UNION ALL
  
  -- Yeast ready to harvest
  SELECT 
    yb.id,
    'harvest'::TEXT,
    'Harvest ' || ys.name::TEXT,
    'Generation ' || yb.generation::TEXT || ' ready to harvest',
    CURRENT_DATE,
    'medium'::TEXT,
    yb.id,
    'yeast'::TEXT
  FROM yeast_batches yb
  JOIN yeast_strains ys ON ys.id = yb.strain_id
  WHERE yb.workspace_id = v_workspace_id
  AND yb.harvest_at IS NULL
  AND yb.pitch_at <= CURRENT_TIMESTAMP - INTERVAL '7 days'
  
  UNION ALL
  
  -- Tanks needing CIP
  SELECT 
    t.id,
    'cip'::TEXT,
    'CIP ' || t.name::TEXT,
    'Tank requires cleaning',
    CURRENT_DATE,
    'high'::TEXT,
    t.id,
    'tank'::TEXT
  FROM tanks t
  WHERE t.workspace_id = v_workspace_id
  AND t.cip_status = 'required'
  
  ORDER BY due_date, priority DESC;
END;
$$;

-- View for production activity feed
CREATE OR REPLACE VIEW v_production_activity AS
SELECT 
  al.id,
  al.action as type,
  CASE 
    WHEN al.entity_table = 'batches' AND al.action = 'insert' THEN 'New batch created'
    WHEN al.entity_table = 'batches' AND al.action = 'update' THEN 'Batch updated'
    WHEN al.entity_table = 'ferm_readings' THEN 'Fermentation reading logged'
    WHEN al.entity_table = 'packaging_runs' THEN 'Packaging run completed'
    WHEN al.entity_table = 'yeast_batches' AND al.action = 'insert' THEN 'Yeast batch created'
    WHEN al.entity_table = 'yeast_batches' AND al.action = 'update' THEN 'Yeast batch updated'
    WHEN al.entity_table = 'tanks' AND al.action = 'update' THEN 'Tank status updated'
    ELSE al.entity_table || ' ' || al.action
  END as description,
  al.created_at as timestamp,
  COALESCE(u.full_name, u.email, 'System') as user_name,
  al.entity_id,
  al.entity_table as entity_type,
  al.workspace_id
FROM audit_logs al
LEFT JOIN users u ON u.id = al.created_by
WHERE al.entity_table IN ('batches', 'ferm_readings', 'packaging_runs', 'yeast_batches', 'tanks')
AND al.created_at >= CURRENT_TIMESTAMP - INTERVAL '7 days';

-- Grant permissions
GRANT SELECT ON v_production_activity TO authenticated;
GRANT EXECUTE ON FUNCTION get_production_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION get_upcoming_production_tasks(INTEGER) TO authenticated;

-- Add RLS to the view
ALTER VIEW v_production_activity OWNER TO authenticated;

-- Add helpful indexes
CREATE INDEX IF NOT EXISTS idx_batches_status_brew_date 
ON batches(workspace_id, status, brew_date);

CREATE INDEX IF NOT EXISTS idx_tanks_cip_status 
ON tanks(workspace_id, cip_status) 
WHERE cip_status = 'required';

CREATE INDEX IF NOT EXISTS idx_yeast_batches_harvest 
ON yeast_batches(workspace_id, harvest_at) 
WHERE harvest_at IS NULL;
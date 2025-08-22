-- Week 2: QA Specifications and Fermentation Improvements
-- This migration adds QA specs to recipes and enhances fermentation tracking

-- Add QA specification ranges to recipe versions
ALTER TABLE recipe_versions
ADD COLUMN IF NOT EXISTS qa_specs JSONB DEFAULT '{}'::jsonb;

-- QA specs structure:
-- {
--   "temp_min": 18,
--   "temp_max": 22,
--   "ph_min": 4.2,
--   "ph_max": 4.6,
--   "fermentation_days_min": 10,
--   "fermentation_days_max": 14,
--   "conditioning_days_min": 7,
--   "conditioning_days_max": 21,
--   "attenuation_min": 75,
--   "attenuation_max": 85
-- }

-- Add planned dates to batches for better scheduling
ALTER TABLE batches
ADD COLUMN IF NOT EXISTS planned_start_date DATE,
ADD COLUMN IF NOT EXISTS planned_end_date DATE;

-- Create an index for scheduling queries
CREATE INDEX IF NOT EXISTS idx_batches_planned_dates 
ON batches(planned_start_date, planned_end_date) 
WHERE planned_start_date IS NOT NULL;

-- Function to detect fermentation anomalies
CREATE OR REPLACE FUNCTION detect_fermentation_anomalies(
  p_batch_id UUID,
  p_include_warnings BOOLEAN DEFAULT TRUE
)
RETURNS TABLE (
  anomaly_type TEXT,
  severity TEXT,
  detected_at TIMESTAMPTZ,
  value DECIMAL,
  expected_min DECIMAL,
  expected_max DECIMAL,
  message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_qa_specs JSONB;
  v_batch_status TEXT;
  v_target_fg DECIMAL;
BEGIN
  -- Get batch details and QA specs
  SELECT 
    b.status,
    b.target_fg,
    rv.qa_specs
  INTO v_batch_status, v_target_fg, v_qa_specs
  FROM batches b
  LEFT JOIN recipe_versions rv ON rv.id = b.recipe_version_id
  WHERE b.id = p_batch_id
  AND b.workspace_id = get_jwt_workspace_id();

  IF v_qa_specs IS NULL OR v_qa_specs = '{}'::jsonb THEN
    RETURN; -- No QA specs defined
  END IF;

  -- Check temperature anomalies
  IF v_qa_specs->>'temp_min' IS NOT NULL AND v_qa_specs->>'temp_max' IS NOT NULL THEN
    RETURN QUERY
    SELECT 
      'temperature'::TEXT as anomaly_type,
      CASE 
        WHEN fr.temp < (v_qa_specs->>'temp_min')::DECIMAL - 2 OR 
             fr.temp > (v_qa_specs->>'temp_max')::DECIMAL + 2
        THEN 'critical'::TEXT
        ELSE 'warning'::TEXT
      END as severity,
      fr.reading_at as detected_at,
      fr.temp as value,
      (v_qa_specs->>'temp_min')::DECIMAL as expected_min,
      (v_qa_specs->>'temp_max')::DECIMAL as expected_max,
      CASE 
        WHEN fr.temp < (v_qa_specs->>'temp_min')::DECIMAL
        THEN format('Temperature %s°C is below minimum %s°C', fr.temp, v_qa_specs->>'temp_min')
        ELSE format('Temperature %s°C exceeds maximum %s°C', fr.temp, v_qa_specs->>'temp_max')
      END as message
    FROM ferm_readings fr
    WHERE fr.batch_id = p_batch_id
    AND fr.temp IS NOT NULL
    AND (
      fr.temp < (v_qa_specs->>'temp_min')::DECIMAL OR
      fr.temp > (v_qa_specs->>'temp_max')::DECIMAL
    )
    AND (p_include_warnings OR (
      fr.temp < (v_qa_specs->>'temp_min')::DECIMAL - 2 OR 
      fr.temp > (v_qa_specs->>'temp_max')::DECIMAL + 2
    ));
  END IF;

  -- Check pH anomalies
  IF v_qa_specs->>'ph_min' IS NOT NULL AND v_qa_specs->>'ph_max' IS NOT NULL THEN
    RETURN QUERY
    SELECT 
      'ph'::TEXT as anomaly_type,
      CASE 
        WHEN fr.ph < (v_qa_specs->>'ph_min')::DECIMAL - 0.3 OR 
             fr.ph > (v_qa_specs->>'ph_max')::DECIMAL + 0.3
        THEN 'critical'::TEXT
        ELSE 'warning'::TEXT
      END as severity,
      fr.reading_at as detected_at,
      fr.ph as value,
      (v_qa_specs->>'ph_min')::DECIMAL as expected_min,
      (v_qa_specs->>'ph_max')::DECIMAL as expected_max,
      CASE 
        WHEN fr.ph < (v_qa_specs->>'ph_min')::DECIMAL
        THEN format('pH %s is below minimum %s', fr.ph, v_qa_specs->>'ph_min')
        ELSE format('pH %s exceeds maximum %s', fr.ph, v_qa_specs->>'ph_max')
      END as message
    FROM ferm_readings fr
    WHERE fr.batch_id = p_batch_id
    AND fr.ph IS NOT NULL
    AND (
      fr.ph < (v_qa_specs->>'ph_min')::DECIMAL OR
      fr.ph > (v_qa_specs->>'ph_max')::DECIMAL
    )
    AND (p_include_warnings OR (
      fr.ph < (v_qa_specs->>'ph_min')::DECIMAL - 0.3 OR 
      fr.ph > (v_qa_specs->>'ph_max')::DECIMAL + 0.3
    ));
  END IF;

  -- Check for stalled fermentation (no gravity change in 3 days)
  IF v_batch_status = 'fermenting' AND v_target_fg IS NOT NULL THEN
    RETURN QUERY
    WITH gravity_changes AS (
      SELECT 
        fr.reading_at,
        fr.sg,
        LAG(fr.sg, 3) OVER (ORDER BY fr.reading_at) as sg_3_days_ago
      FROM ferm_readings fr
      WHERE fr.batch_id = p_batch_id
      AND fr.sg IS NOT NULL
      ORDER BY fr.reading_at DESC
    )
    SELECT 
      'stalled_fermentation'::TEXT as anomaly_type,
      'warning'::TEXT as severity,
      gc.reading_at as detected_at,
      gc.sg as value,
      v_target_fg - 0.005 as expected_min,
      v_target_fg + 0.005 as expected_max,
      format('Possible stalled fermentation - gravity unchanged at %s', gc.sg) as message
    FROM gravity_changes gc
    WHERE gc.sg_3_days_ago IS NOT NULL
    AND ABS(gc.sg - gc.sg_3_days_ago) < 0.002
    AND gc.sg > v_target_fg + 0.005
    LIMIT 1;
  END IF;

  RETURN;
END;
$$;

-- Function to get fermentation statistics
CREATE OR REPLACE FUNCTION get_fermentation_stats(p_batch_id UUID)
RETURNS TABLE (
  current_sg DECIMAL,
  current_temp DECIMAL,
  current_ph DECIMAL,
  days_fermenting INTEGER,
  attenuation_pct DECIMAL,
  readings_count INTEGER,
  last_reading_at TIMESTAMPTZ,
  anomaly_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH latest_reading AS (
    SELECT 
      sg,
      temp,
      ph,
      reading_at
    FROM ferm_readings
    WHERE batch_id = p_batch_id
    ORDER BY reading_at DESC
    LIMIT 1
  ),
  batch_info AS (
    SELECT 
      target_og,
      ferment_start_date
    FROM batches
    WHERE id = p_batch_id
  ),
  anomalies AS (
    SELECT COUNT(*) as cnt
    FROM detect_fermentation_anomalies(p_batch_id, false)
  )
  SELECT 
    lr.sg as current_sg,
    lr.temp as current_temp,
    lr.ph as current_ph,
    CASE 
      WHEN bi.ferment_start_date IS NOT NULL
      THEN EXTRACT(DAY FROM NOW() - bi.ferment_start_date)::INTEGER
      ELSE NULL
    END as days_fermenting,
    CASE 
      WHEN bi.target_og IS NOT NULL AND lr.sg IS NOT NULL
      THEN ROUND(((bi.target_og - lr.sg) / (bi.target_og - 1.000)) * 100, 1)
      ELSE NULL
    END as attenuation_pct,
    (SELECT COUNT(*) FROM ferm_readings WHERE batch_id = p_batch_id)::INTEGER as readings_count,
    lr.reading_at as last_reading_at,
    a.cnt::INTEGER as anomaly_count
  FROM latest_reading lr
  CROSS JOIN batch_info bi
  CROSS JOIN anomalies a;
END;
$$;

-- View for batch scheduling conflicts
CREATE OR REPLACE VIEW v_tank_schedule AS
SELECT 
  t.id as tank_id,
  t.name as tank_name,
  t.capacity,
  t.cip_status,
  b.id as batch_id,
  b.batch_number,
  b.status as batch_status,
  COALESCE(b.planned_start_date, b.brew_date, b.ferment_start_date) as start_date,
  COALESCE(
    b.planned_end_date, 
    b.package_date,
    b.ferment_end_date,
    CASE 
      WHEN b.ferment_start_date IS NOT NULL 
      THEN b.ferment_start_date + INTERVAL '14 days'
      ELSE NULL
    END
  ) as end_date,
  b.target_volume,
  b.actual_volume
FROM tanks t
LEFT JOIN batches b ON b.tank_id = t.id
WHERE t.is_active = true
AND b.status NOT IN ('completed', 'cancelled')
ORDER BY t.name, start_date;

-- Function to check tank availability
CREATE OR REPLACE FUNCTION check_tank_availability(
  p_tank_id UUID,
  p_start_date DATE,
  p_end_date DATE,
  p_exclude_batch_id UUID DEFAULT NULL
)
RETURNS TABLE (
  is_available BOOLEAN,
  conflict_batch_id UUID,
  conflict_batch_number TEXT,
  conflict_start DATE,
  conflict_end DATE,
  message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH conflicts AS (
    SELECT 
      b.id,
      b.batch_number,
      COALESCE(b.planned_start_date, b.brew_date, b.ferment_start_date) as start_date,
      COALESCE(
        b.planned_end_date, 
        b.package_date,
        b.ferment_end_date,
        b.ferment_start_date + INTERVAL '14 days'
      )::DATE as end_date
    FROM batches b
    WHERE b.tank_id = p_tank_id
    AND b.status NOT IN ('completed', 'cancelled')
    AND (p_exclude_batch_id IS NULL OR b.id != p_exclude_batch_id)
    AND b.workspace_id = get_jwt_workspace_id()
  )
  SELECT 
    CASE WHEN COUNT(*) = 0 THEN TRUE ELSE FALSE END as is_available,
    c.id as conflict_batch_id,
    c.batch_number as conflict_batch_number,
    c.start_date as conflict_start,
    c.end_date as conflict_end,
    CASE 
      WHEN COUNT(*) > 0 
      THEN format('Tank occupied by batch %s from %s to %s', 
                  c.batch_number, 
                  c.start_date, 
                  c.end_date)
      ELSE 'Tank is available'
    END as message
  FROM conflicts c
  WHERE (
    (p_start_date <= c.end_date AND p_end_date >= c.start_date) OR
    (c.start_date <= p_end_date AND c.end_date >= p_start_date)
  )
  GROUP BY c.id, c.batch_number, c.start_date, c.end_date
  LIMIT 1;

  -- If no conflicts found, return available status
  IF NOT FOUND THEN
    RETURN QUERY 
    SELECT 
      TRUE as is_available,
      NULL::UUID as conflict_batch_id,
      NULL::TEXT as conflict_batch_number,
      NULL::DATE as conflict_start,
      NULL::DATE as conflict_end,
      'Tank is available'::TEXT as message;
  END IF;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION detect_fermentation_anomalies(UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION get_fermentation_stats(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION check_tank_availability(UUID, DATE, DATE, UUID) TO authenticated;
GRANT SELECT ON v_tank_schedule TO authenticated;
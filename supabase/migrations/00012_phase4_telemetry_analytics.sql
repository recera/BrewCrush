-- Phase 4.12: Telemetry & Analytics for Production Module
-- ============================================================================
-- Adds telemetry events and analytics functions for production tracking

-- Add telemetry event types for production
CREATE TYPE telemetry_event_type AS ENUM (
  -- Recipe events
  'recipe_created',
  'recipe_version_created',
  'recipe_version_locked',
  'recipe_used_for_batch',
  
  -- Batch events
  'batch_created',
  'batch_status_changed',
  'brew_day_started',
  'brew_day_completed',
  'batch_measurements_recorded',
  
  -- Tank events
  'tank_assigned',
  'tank_cip_updated',
  
  -- Fermentation events
  'ferm_reading_logged',
  'fermentation_started',
  'fermentation_completed',
  
  -- Yeast events
  'yeast_strain_created',
  'yeast_batch_created',
  'yeast_pitched',
  'yeast_harvested',
  'yeast_generation_warning',
  
  -- Offline events
  'offline_action_queued',
  'offline_sync_completed',
  'offline_sync_failed'
);

-- Create telemetry events table if not exists
CREATE TABLE IF NOT EXISTS telemetry_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  event_type telemetry_event_type NOT NULL,
  event_name TEXT NOT NULL,
  entity_type TEXT,
  entity_id UUID,
  properties JSONB DEFAULT '{}',
  metadata JSONB DEFAULT '{}',
  session_id TEXT,
  device_info JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Indexes for efficient querying
  INDEX idx_telemetry_workspace_event (workspace_id, event_type, created_at DESC),
  INDEX idx_telemetry_entity (entity_type, entity_id),
  INDEX idx_telemetry_user (user_id, created_at DESC),
  INDEX idx_telemetry_session (session_id)
);

-- Enable RLS
ALTER TABLE telemetry_events ENABLE ROW LEVEL SECURITY;

-- RLS policies for telemetry
CREATE POLICY "Users can insert telemetry for their workspace"
  ON telemetry_events
  FOR INSERT
  WITH CHECK (workspace_id = get_current_workspace_id());

CREATE POLICY "Users can view telemetry for their workspace"
  ON telemetry_events
  FOR SELECT
  USING (workspace_id = get_current_workspace_id());

-- Function to log telemetry events
CREATE OR REPLACE FUNCTION log_telemetry_event(
  p_event_type telemetry_event_type,
  p_event_name TEXT,
  p_entity_type TEXT DEFAULT NULL,
  p_entity_id UUID DEFAULT NULL,
  p_properties JSONB DEFAULT '{}',
  p_metadata JSONB DEFAULT '{}'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_event_id UUID;
BEGIN
  INSERT INTO telemetry_events (
    workspace_id,
    user_id,
    event_type,
    event_name,
    entity_type,
    entity_id,
    properties,
    metadata
  ) VALUES (
    get_current_workspace_id(),
    auth.uid(),
    p_event_type,
    p_event_name,
    p_entity_type,
    p_entity_id,
    p_properties,
    p_metadata
  )
  RETURNING id INTO v_event_id;
  
  RETURN v_event_id;
END;
$$;

-- Trigger to log recipe events
CREATE OR REPLACE FUNCTION log_recipe_events()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF TG_TABLE_NAME = 'recipes' THEN
      PERFORM log_telemetry_event(
        'recipe_created'::telemetry_event_type,
        'Recipe created',
        'recipe',
        NEW.id,
        jsonb_build_object(
          'recipe_name', NEW.name,
          'style', NEW.style,
          'target_volume', NEW.target_volume
        )
      );
    ELSIF TG_TABLE_NAME = 'recipe_versions' THEN
      PERFORM log_telemetry_event(
        'recipe_version_created'::telemetry_event_type,
        'Recipe version created',
        'recipe_version',
        NEW.id,
        jsonb_build_object(
          'recipe_id', NEW.recipe_id,
          'version_number', NEW.version_number,
          'is_locked', NEW.is_locked
        )
      );
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF TG_TABLE_NAME = 'recipe_versions' AND NEW.is_locked = true AND OLD.is_locked = false THEN
      PERFORM log_telemetry_event(
        'recipe_version_locked'::telemetry_event_type,
        'Recipe version locked',
        'recipe_version',
        NEW.id,
        jsonb_build_object(
          'recipe_id', NEW.recipe_id,
          'version_number', NEW.version_number
        )
      );
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Create triggers for recipe events
CREATE TRIGGER tr_log_recipe_events
  AFTER INSERT ON recipes
  FOR EACH ROW
  EXECUTE FUNCTION log_recipe_events();

CREATE TRIGGER tr_log_recipe_version_events
  AFTER INSERT OR UPDATE ON recipe_versions
  FOR EACH ROW
  EXECUTE FUNCTION log_recipe_events();

-- Trigger to log batch events
CREATE OR REPLACE FUNCTION log_batch_events()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM log_telemetry_event(
      'batch_created'::telemetry_event_type,
      'Batch created',
      'batch',
      NEW.id,
      jsonb_build_object(
        'batch_number', NEW.batch_number,
        'recipe_version_id', NEW.recipe_version_id,
        'status', NEW.status,
        'target_volume', NEW.target_volume
      )
    );
  ELSIF TG_OP = 'UPDATE' THEN
    -- Log status changes
    IF NEW.status != OLD.status THEN
      PERFORM log_telemetry_event(
        'batch_status_changed'::telemetry_event_type,
        'Batch status changed',
        'batch',
        NEW.id,
        jsonb_build_object(
          'batch_number', NEW.batch_number,
          'old_status', OLD.status,
          'new_status', NEW.status
        )
      );
      
      -- Log specific milestone events
      IF NEW.status = 'brewing' THEN
        PERFORM log_telemetry_event(
          'brew_day_started'::telemetry_event_type,
          'Brew day started',
          'batch',
          NEW.id,
          jsonb_build_object(
            'batch_number', NEW.batch_number,
            'tank_id', NEW.tank_id
          )
        );
      ELSIF NEW.status = 'fermenting' THEN
        PERFORM log_telemetry_event(
          'fermentation_started'::telemetry_event_type,
          'Fermentation started',
          'batch',
          NEW.id,
          jsonb_build_object(
            'batch_number', NEW.batch_number,
            'actual_og', NEW.actual_og,
            'actual_volume', NEW.actual_volume
          )
        );
      ELSIF NEW.status = 'completed' THEN
        PERFORM log_telemetry_event(
          'fermentation_completed'::telemetry_event_type,
          'Fermentation completed',
          'batch',
          NEW.id,
          jsonb_build_object(
            'batch_number', NEW.batch_number,
            'duration_days', 
            CASE 
              WHEN NEW.ferment_start_date IS NOT NULL AND NEW.ferment_end_date IS NOT NULL
              THEN EXTRACT(DAY FROM NEW.ferment_end_date - NEW.ferment_start_date)
              ELSE NULL
            END
          )
        );
      END IF;
    END IF;
    
    -- Log measurements recorded
    IF (OLD.actual_og IS NULL AND NEW.actual_og IS NOT NULL) OR
       (OLD.actual_volume IS NULL AND NEW.actual_volume IS NOT NULL) THEN
      PERFORM log_telemetry_event(
        'batch_measurements_recorded'::telemetry_event_type,
        'Batch measurements recorded',
        'batch',
        NEW.id,
        jsonb_build_object(
          'batch_number', NEW.batch_number,
          'actual_og', NEW.actual_og,
          'actual_volume', NEW.actual_volume
        )
      );
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Create trigger for batch events
CREATE TRIGGER tr_log_batch_events
  AFTER INSERT OR UPDATE ON batches
  FOR EACH ROW
  EXECUTE FUNCTION log_batch_events();

-- Trigger to log fermentation reading events
CREATE OR REPLACE FUNCTION log_ferm_reading_events()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM log_telemetry_event(
    'ferm_reading_logged'::telemetry_event_type,
    'Fermentation reading logged',
    'ferm_reading',
    NEW.id,
    jsonb_build_object(
      'batch_id', NEW.batch_id,
      'sg', NEW.sg,
      'temp', NEW.temp,
      'ph', NEW.ph,
      'offline_synced', COALESCE(NEW.idempotency_key IS NOT NULL, false)
    )
  );
  
  RETURN NEW;
END;
$$;

-- Create trigger for fermentation readings
CREATE TRIGGER tr_log_ferm_reading_events
  AFTER INSERT ON ferm_readings
  FOR EACH ROW
  EXECUTE FUNCTION log_ferm_reading_events();

-- Trigger to log yeast events
CREATE OR REPLACE FUNCTION log_yeast_events()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_max_generation INTEGER;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF TG_TABLE_NAME = 'yeast_strains' THEN
      PERFORM log_telemetry_event(
        'yeast_strain_created'::telemetry_event_type,
        'Yeast strain created',
        'yeast_strain',
        NEW.id,
        jsonb_build_object(
          'name', NEW.name,
          'lab_source', NEW.lab_source,
          'type', NEW.type
        )
      );
    ELSIF TG_TABLE_NAME = 'yeast_batches' THEN
      -- Get max generation for warning
      SELECT recommended_max_generation 
      INTO v_max_generation
      FROM yeast_strains 
      WHERE id = NEW.strain_id;
      
      PERFORM log_telemetry_event(
        'yeast_batch_created'::telemetry_event_type,
        'Yeast batch created',
        'yeast_batch',
        NEW.id,
        jsonb_build_object(
          'strain_id', NEW.strain_id,
          'generation', NEW.generation,
          'source', NEW.source
        )
      );
      
      -- Log warning if exceeding max generation
      IF v_max_generation IS NOT NULL AND NEW.generation > v_max_generation THEN
        PERFORM log_telemetry_event(
          'yeast_generation_warning'::telemetry_event_type,
          'Yeast generation exceeds recommended maximum',
          'yeast_batch',
          NEW.id,
          jsonb_build_object(
            'generation', NEW.generation,
            'max_generation', v_max_generation
          )
        );
      END IF;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF TG_TABLE_NAME = 'yeast_batches' THEN
      -- Log pitch event
      IF OLD.pitch_at IS NULL AND NEW.pitch_at IS NOT NULL THEN
        PERFORM log_telemetry_event(
          'yeast_pitched'::telemetry_event_type,
          'Yeast pitched',
          'yeast_batch',
          NEW.id,
          jsonb_build_object(
            'strain_id', NEW.strain_id,
            'generation', NEW.generation
          )
        );
      END IF;
      
      -- Log harvest event
      IF OLD.harvest_at IS NULL AND NEW.harvest_at IS NOT NULL THEN
        PERFORM log_telemetry_event(
          'yeast_harvested'::telemetry_event_type,
          'Yeast harvested',
          'yeast_batch',
          NEW.id,
          jsonb_build_object(
            'strain_id', NEW.strain_id,
            'old_generation', OLD.generation,
            'new_generation', NEW.generation,
            'days_since_pitch', 
            CASE 
              WHEN NEW.pitch_at IS NOT NULL 
              THEN EXTRACT(DAY FROM NEW.harvest_at - NEW.pitch_at)
              ELSE NULL
            END
          )
        );
      END IF;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Create triggers for yeast events
CREATE TRIGGER tr_log_yeast_strain_events
  AFTER INSERT ON yeast_strains
  FOR EACH ROW
  EXECUTE FUNCTION log_yeast_events();

CREATE TRIGGER tr_log_yeast_batch_events
  AFTER INSERT OR UPDATE ON yeast_batches
  FOR EACH ROW
  EXECUTE FUNCTION log_yeast_events();

-- Analytics Views
-- ============================================================================

-- Production metrics view
CREATE OR REPLACE VIEW v_production_metrics AS
WITH batch_stats AS (
  SELECT 
    workspace_id,
    COUNT(*) AS total_batches,
    COUNT(*) FILTER (WHERE status = 'completed') AS completed_batches,
    COUNT(*) FILTER (WHERE status IN ('brewing', 'fermenting', 'conditioning', 'packaging')) AS active_batches,
    AVG(actual_volume) AS avg_batch_volume,
    AVG(EXTRACT(DAY FROM ferment_end_date - ferment_start_date)) AS avg_fermentation_days
  FROM batches
  WHERE created_at >= NOW() - INTERVAL '30 days'
  GROUP BY workspace_id
),
recipe_stats AS (
  SELECT 
    workspace_id,
    COUNT(DISTINCT recipe_id) AS active_recipes,
    COUNT(DISTINCT recipe_version_id) AS recipe_versions_used
  FROM batches
  WHERE created_at >= NOW() - INTERVAL '30 days'
  GROUP BY workspace_id
),
yeast_stats AS (
  SELECT 
    workspace_id,
    AVG(generation) AS avg_yeast_generation,
    COUNT(*) FILTER (WHERE harvest_at IS NOT NULL) AS yeast_harvests
  FROM yeast_batches
  WHERE created_at >= NOW() - INTERVAL '30 days'
  GROUP BY workspace_id
),
ferm_stats AS (
  SELECT 
    b.workspace_id,
    COUNT(fr.*) AS total_readings,
    AVG(fr.sg) AS avg_final_sg
  FROM ferm_readings fr
  JOIN batches b ON b.id = fr.batch_id
  WHERE fr.reading_at >= NOW() - INTERVAL '30 days'
  GROUP BY b.workspace_id
)
SELECT 
  w.id AS workspace_id,
  w.name AS workspace_name,
  COALESCE(bs.total_batches, 0) AS total_batches_30d,
  COALESCE(bs.completed_batches, 0) AS completed_batches_30d,
  COALESCE(bs.active_batches, 0) AS active_batches,
  COALESCE(bs.avg_batch_volume, 0) AS avg_batch_volume,
  COALESCE(bs.avg_fermentation_days, 0) AS avg_fermentation_days,
  COALESCE(rs.active_recipes, 0) AS active_recipes,
  COALESCE(rs.recipe_versions_used, 0) AS recipe_versions_used,
  COALESCE(ys.avg_yeast_generation, 0) AS avg_yeast_generation,
  COALESCE(ys.yeast_harvests, 0) AS yeast_harvests_30d,
  COALESCE(fs.total_readings, 0) AS total_readings_30d,
  COALESCE(fs.avg_final_sg, 0) AS avg_final_sg
FROM workspaces w
LEFT JOIN batch_stats bs ON bs.workspace_id = w.id
LEFT JOIN recipe_stats rs ON rs.workspace_id = w.id
LEFT JOIN yeast_stats ys ON ys.workspace_id = w.id
LEFT JOIN ferm_stats fs ON fs.workspace_id = w.id;

-- Grant access to the metrics view
GRANT SELECT ON v_production_metrics TO authenticated;

-- Function to get production analytics
CREATE OR REPLACE FUNCTION get_production_analytics(
  p_start_date DATE DEFAULT NOW() - INTERVAL '30 days',
  p_end_date DATE DEFAULT NOW()
)
RETURNS TABLE (
  metric_name TEXT,
  metric_value NUMERIC,
  metric_unit TEXT,
  trend_direction TEXT,
  trend_percentage NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_workspace_id UUID;
BEGIN
  v_workspace_id := get_current_workspace_id();
  
  RETURN QUERY
  WITH current_period AS (
    SELECT 
      COUNT(*) AS batches_created,
      COUNT(*) FILTER (WHERE status = 'completed') AS batches_completed,
      AVG(actual_volume) AS avg_volume,
      AVG(EXTRACT(DAY FROM ferment_end_date - ferment_start_date)) AS avg_ferment_days,
      COUNT(DISTINCT tank_id) AS tanks_used
    FROM batches
    WHERE workspace_id = v_workspace_id
      AND created_at BETWEEN p_start_date AND p_end_date
  ),
  previous_period AS (
    SELECT 
      COUNT(*) AS batches_created,
      COUNT(*) FILTER (WHERE status = 'completed') AS batches_completed,
      AVG(actual_volume) AS avg_volume,
      AVG(EXTRACT(DAY FROM ferment_end_date - ferment_start_date)) AS avg_ferment_days,
      COUNT(DISTINCT tank_id) AS tanks_used
    FROM batches
    WHERE workspace_id = v_workspace_id
      AND created_at BETWEEN 
        p_start_date - (p_end_date - p_start_date)::INTERVAL 
        AND p_start_date
  ),
  yeast_metrics AS (
    SELECT 
      AVG(generation) AS avg_generation,
      COUNT(*) FILTER (WHERE harvest_at IS NOT NULL) AS harvests
    FROM yeast_batches
    WHERE workspace_id = v_workspace_id
      AND created_at BETWEEN p_start_date AND p_end_date
  )
  SELECT 
    'Batches Created' AS metric_name,
    cp.batches_created AS metric_value,
    'batches' AS metric_unit,
    CASE 
      WHEN cp.batches_created > pp.batches_created THEN 'up'
      WHEN cp.batches_created < pp.batches_created THEN 'down'
      ELSE 'stable'
    END AS trend_direction,
    CASE 
      WHEN pp.batches_created > 0 
      THEN ((cp.batches_created - pp.batches_created)::NUMERIC / pp.batches_created) * 100
      ELSE 0
    END AS trend_percentage
  FROM current_period cp, previous_period pp
  
  UNION ALL
  
  SELECT 
    'Completion Rate',
    CASE 
      WHEN cp.batches_created > 0 
      THEN (cp.batches_completed::NUMERIC / cp.batches_created) * 100
      ELSE 0
    END,
    '%',
    CASE 
      WHEN cp.batches_created > 0 AND pp.batches_created > 0 THEN
        CASE 
          WHEN (cp.batches_completed::NUMERIC / cp.batches_created) > 
               (pp.batches_completed::NUMERIC / pp.batches_created) THEN 'up'
          WHEN (cp.batches_completed::NUMERIC / cp.batches_created) < 
               (pp.batches_completed::NUMERIC / pp.batches_created) THEN 'down'
          ELSE 'stable'
        END
      ELSE 'stable'
    END,
    0
  FROM current_period cp, previous_period pp
  
  UNION ALL
  
  SELECT 
    'Avg Batch Volume',
    COALESCE(cp.avg_volume, 0),
    'L',
    CASE 
      WHEN cp.avg_volume > pp.avg_volume THEN 'up'
      WHEN cp.avg_volume < pp.avg_volume THEN 'down'
      ELSE 'stable'
    END,
    CASE 
      WHEN pp.avg_volume > 0 
      THEN ((cp.avg_volume - pp.avg_volume) / pp.avg_volume) * 100
      ELSE 0
    END
  FROM current_period cp, previous_period pp
  
  UNION ALL
  
  SELECT 
    'Avg Fermentation Days',
    COALESCE(cp.avg_ferment_days, 0),
    'days',
    CASE 
      WHEN cp.avg_ferment_days < pp.avg_ferment_days THEN 'up' -- Lower is better
      WHEN cp.avg_ferment_days > pp.avg_ferment_days THEN 'down'
      ELSE 'stable'
    END,
    CASE 
      WHEN pp.avg_ferment_days > 0 
      THEN ((pp.avg_ferment_days - cp.avg_ferment_days) / pp.avg_ferment_days) * 100
      ELSE 0
    END
  FROM current_period cp, previous_period pp
  
  UNION ALL
  
  SELECT 
    'Tank Utilization',
    cp.tanks_used,
    'tanks',
    CASE 
      WHEN cp.tanks_used > pp.tanks_used THEN 'up'
      WHEN cp.tanks_used < pp.tanks_used THEN 'down'
      ELSE 'stable'
    END,
    CASE 
      WHEN pp.tanks_used > 0 
      THEN ((cp.tanks_used - pp.tanks_used)::NUMERIC / pp.tanks_used) * 100
      ELSE 0
    END
  FROM current_period cp, previous_period pp
  
  UNION ALL
  
  SELECT 
    'Avg Yeast Generation',
    COALESCE(ym.avg_generation, 0),
    'generation',
    'stable',
    0
  FROM yeast_metrics ym;
END;
$$;

-- Function to get offline sync metrics
CREATE OR REPLACE FUNCTION get_offline_sync_metrics(
  p_days INTEGER DEFAULT 7
)
RETURNS TABLE (
  total_queued BIGINT,
  successful_syncs BIGINT,
  failed_syncs BIGINT,
  avg_sync_time_seconds NUMERIC,
  success_rate NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COUNT(*) FILTER (WHERE event_type = 'offline_action_queued') AS total_queued,
    COUNT(*) FILTER (WHERE event_type = 'offline_sync_completed') AS successful_syncs,
    COUNT(*) FILTER (WHERE event_type = 'offline_sync_failed') AS failed_syncs,
    AVG((properties->>'sync_duration_ms')::NUMERIC / 1000) FILTER (
      WHERE event_type = 'offline_sync_completed'
    ) AS avg_sync_time_seconds,
    CASE 
      WHEN COUNT(*) FILTER (WHERE event_type IN ('offline_sync_completed', 'offline_sync_failed')) > 0
      THEN (COUNT(*) FILTER (WHERE event_type = 'offline_sync_completed')::NUMERIC / 
            COUNT(*) FILTER (WHERE event_type IN ('offline_sync_completed', 'offline_sync_failed'))) * 100
      ELSE 100
    END AS success_rate
  FROM telemetry_events
  WHERE workspace_id = get_current_workspace_id()
    AND created_at >= NOW() - (p_days || ' days')::INTERVAL
    AND event_type IN ('offline_action_queued', 'offline_sync_completed', 'offline_sync_failed');
END;
$$;

-- Add comment
COMMENT ON FUNCTION get_production_analytics IS 'Returns key production metrics with trend analysis for the specified date range';
COMMENT ON FUNCTION get_offline_sync_metrics IS 'Returns offline sync performance metrics for the specified number of days';
COMMENT ON VIEW v_production_metrics IS 'Aggregated production metrics by workspace for the last 30 days';
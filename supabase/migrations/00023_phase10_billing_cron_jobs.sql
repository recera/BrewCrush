-- Phase 10: Billing System Cron Jobs
-- =====================================================
-- Sets up scheduled jobs for:
-- - Weekly Observed Production calculation  
-- - Daily check for plan downgrades
-- - Monthly invoice reminders

-- Enable pg_cron if not already enabled
-- Note: This requires superuser privileges and is typically enabled via Supabase dashboard
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    CREATE EXTENSION pg_cron;
  END IF;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'pg_cron extension requires superuser privileges. Please enable it via Supabase dashboard.';
END $$;

-- Create a function to calculate observed production
-- This can be called by cron or Edge Functions
CREATE OR REPLACE FUNCTION calculate_observed_production_for_all()
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_workspace RECORD;
BEGIN
  -- Calculate OP for each workspace
  FOR v_workspace IN 
    SELECT DISTINCT workspace_id 
    FROM workspaces 
    WHERE deleted_at IS NULL
  LOOP
    -- Calculate packaged BBL for last 90 days
    INSERT INTO observed_production_snapshots (
      workspace_id,
      date,
      packaged_bbl_90d,
      op_annualized_bbl,
      packaging_runs_count
    )
    SELECT 
      v_workspace.workspace_id,
      CURRENT_DATE,
      COALESCE(SUM(volume_bbl), 0),
      COALESCE(SUM(volume_bbl) / 90 * 365, 0),
      COUNT(*)
    FROM (
      SELECT 
        pr.id,
        -- Convert finished goods to BBL (1 BBL = 31 gallons = 117.35 liters)
        SUM(fl.produced_qty * fs.size_ml / 1000 / 117.35) as volume_bbl
      FROM packaging_runs pr
      JOIN finished_lots fl ON fl.packaging_run_id = pr.id
      JOIN finished_skus fs ON fs.id = fl.sku_id
      WHERE pr.workspace_id = v_workspace.workspace_id
        AND pr.created_at >= CURRENT_DATE - INTERVAL '90 days'
      GROUP BY pr.id
    ) recent_runs
    ON CONFLICT (workspace_id, date) 
    DO UPDATE SET
      packaged_bbl_90d = EXCLUDED.packaged_bbl_90d,
      op_annualized_bbl = EXCLUDED.op_annualized_bbl,
      packaging_runs_count = EXCLUDED.packaging_runs_count,
      created_at = NOW();
  END LOOP;
END;
$$;

-- Create a function to check for plan suggestions
CREATE OR REPLACE FUNCTION check_plan_suggestions()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  -- Check for upgrades (OP exceeds current plan)
  WITH upgrade_candidates AS (
    SELECT 
      ab.workspace_id,
      ab.plan_id as current_plan_id,
      bp.name as current_plan,
      bp.bbl_max as current_max,
      ops.op_annualized_bbl as current_op
    FROM account_billing ab
    JOIN billing_plans bp ON bp.id = ab.plan_id
    JOIN observed_production_snapshots ops ON ops.workspace_id = ab.workspace_id
    WHERE ops.date = CURRENT_DATE
      AND bp.bbl_max IS NOT NULL
      AND ops.op_annualized_bbl > bp.bbl_max * 1.1 -- 10% above maximum
      AND ab.override_tier IS NULL -- Not manually overridden
  )
  INSERT INTO plan_change_suggestions (
    workspace_id,
    current_plan_id,
    suggested_plan_id,
    reason,
    op_annualized_bbl,
    effective_at_default
  )
  SELECT 
    uc.workspace_id,
    uc.current_plan_id,
    bp.id,
    'op_exceeds',
    uc.current_op,
    ab.renewal_at
  FROM upgrade_candidates uc
  JOIN billing_plans bp ON bp.bbl_min <= uc.current_op 
    AND (bp.bbl_max IS NULL OR bp.bbl_max >= uc.current_op)
    AND bp.is_active = true
    AND bp.name != 'trial'
  JOIN account_billing ab ON ab.workspace_id = uc.workspace_id
  WHERE NOT EXISTS (
    -- Don't create duplicate suggestions
    SELECT 1 FROM plan_change_suggestions
    WHERE workspace_id = uc.workspace_id
      AND status = 'suggested'
      AND reason = 'op_exceeds'
  );

  -- Check for downgrades (OP below current plan for 90 days)
  WITH downgrade_candidates AS (
    SELECT 
      ab.workspace_id,
      ab.plan_id as current_plan_id,
      bp.name as current_plan,
      bp.bbl_min as current_min,
      AVG(ops.op_annualized_bbl) as avg_op_90d
    FROM account_billing ab
    JOIN billing_plans bp ON bp.id = ab.plan_id
    JOIN observed_production_snapshots ops ON ops.workspace_id = ab.workspace_id
    WHERE ops.date >= CURRENT_DATE - INTERVAL '90 days'
      AND bp.name NOT IN ('trial', 'starter') -- Can't downgrade from starter
      AND ab.override_tier IS NULL
    GROUP BY ab.workspace_id, ab.plan_id, bp.name, bp.bbl_min
    HAVING AVG(ops.op_annualized_bbl) < bp.bbl_min * 0.9 -- 10% below minimum
  )
  INSERT INTO plan_change_suggestions (
    workspace_id,
    current_plan_id,
    suggested_plan_id,
    reason,
    op_annualized_bbl,
    effective_at_default
  )
  SELECT 
    dc.workspace_id,
    dc.current_plan_id,
    bp.id,
    'op_below',
    dc.avg_op_90d,
    ab.renewal_at
  FROM downgrade_candidates dc
  JOIN billing_plans bp ON bp.bbl_min <= dc.avg_op_90d 
    AND (bp.bbl_max IS NULL OR bp.bbl_max >= dc.avg_op_90d)
    AND bp.is_active = true
    AND bp.name != 'trial'
  JOIN account_billing ab ON ab.workspace_id = dc.workspace_id
  WHERE NOT EXISTS (
    SELECT 1 FROM plan_change_suggestions
    WHERE workspace_id = dc.workspace_id
      AND status = 'suggested'
      AND reason = 'op_below'
  );
END;
$$;

-- Create function to check payment failures
CREATE OR REPLACE FUNCTION check_payment_failures()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  -- Enable read-only mode for workspaces with 3+ failed payments in last 14 days
  UPDATE account_billing ab
  SET 
    read_only_mode = true,
    read_only_reason = 'payment_failed',
    updated_at = NOW()
  FROM (
    SELECT workspace_id
    FROM invoices
    WHERE status = 'failed'
      AND created_at >= NOW() - INTERVAL '14 days'
    GROUP BY workspace_id
    HAVING COUNT(*) >= 3
  ) failed
  WHERE ab.workspace_id = failed.workspace_id
    AND ab.read_only_mode = false;
END;
$$;

-- Create function for trial ending reminders
CREATE OR REPLACE FUNCTION send_trial_reminders()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO notification_queue (workspace_id, type, priority, payload)
  SELECT 
    workspace_id,
    'trial_ending',
    'medium',
    jsonb_build_object(
      'days_remaining', EXTRACT(DAY FROM trial_ends_at - NOW()),
      'trial_ends_at', trial_ends_at
    )
  FROM account_billing
  WHERE trial_ends_at IS NOT NULL
    AND trial_ends_at > NOW()
    AND trial_ends_at <= NOW() + INTERVAL '3 days'
    AND NOT EXISTS (
      -- Don't send duplicate notifications
      SELECT 1 FROM notification_queue
      WHERE workspace_id = account_billing.workspace_id
        AND type = 'trial_ending'
        AND created_at >= NOW() - INTERVAL '24 hours'
    );
END;
$$;

-- Clean up old OP snapshots function
CREATE OR REPLACE FUNCTION cleanup_old_snapshots()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM observed_production_snapshots
  WHERE date < CURRENT_DATE - INTERVAL '365 days';
END;
$$;

-- Try to schedule cron jobs if pg_cron is available
-- These will fail gracefully if pg_cron is not enabled
DO $$
BEGIN
  -- Check if pg_cron is installed
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Weekly OP calculation (Sundays at 2 AM)
    PERFORM cron.schedule(
      'calculate-observed-production',
      '0 2 * * 0',
      'SELECT calculate_observed_production_for_all();'
    );
    
    -- Daily plan suggestions check (3 AM)
    PERFORM cron.schedule(
      'check-plan-suggestions',
      '0 3 * * *',
      'SELECT check_plan_suggestions();'
    );
    
    -- Daily payment failure check (4 AM)
    PERFORM cron.schedule(
      'check-payment-failures',
      '0 4 * * *',
      'SELECT check_payment_failures();'
    );
    
    -- Daily trial reminders (9 AM)
    PERFORM cron.schedule(
      'trial-ending-reminders',
      '0 9 * * *',
      'SELECT send_trial_reminders();'
    );
    
    -- Weekly cleanup (Sundays at 1 AM)
    PERFORM cron.schedule(
      'cleanup-op-snapshots',
      '0 1 * * 0',
      'SELECT cleanup_old_snapshots();'
    );
    
    RAISE NOTICE 'Cron jobs scheduled successfully';
  ELSE
    RAISE NOTICE 'pg_cron not available. Jobs can be run manually or via Edge Functions.';
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Could not schedule cron jobs: %. Jobs can be run manually or via Edge Functions.', SQLERRM;
END $$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION calculate_observed_production_for_all() TO service_role;
GRANT EXECUTE ON FUNCTION check_plan_suggestions() TO service_role;
GRANT EXECUTE ON FUNCTION check_payment_failures() TO service_role;
GRANT EXECUTE ON FUNCTION send_trial_reminders() TO service_role;
GRANT EXECUTE ON FUNCTION cleanup_old_snapshots() TO service_role;
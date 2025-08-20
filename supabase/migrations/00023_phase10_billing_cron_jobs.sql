-- Phase 10: Billing System Cron Jobs
-- =====================================================
-- Sets up scheduled jobs for:
-- - Weekly Observed Production calculation
-- - Daily check for plan downgrades
-- - Monthly invoice reminders

-- Enable pg_cron if not already enabled
create extension if not exists pg_cron;

-- Weekly OP calculation (Sundays at 2 AM)
select cron.schedule(
  'calculate-observed-production',
  '0 2 * * 0', -- Sundays at 2 AM
  $$
  select net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/calculate-observed-production',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.supabase_service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Daily check for plan downgrades (check if OP has been low for 3 months)
select cron.schedule(
  'check-plan-downgrades',
  '0 3 * * *', -- Daily at 3 AM
  $$
  with downgrade_candidates as (
    select 
      ab.workspace_id,
      ab.plan_id as current_plan_id,
      bp.name as current_plan,
      bp.bbl_min as current_min,
      bp.bbl_max as current_max,
      avg(ops.op_annualized_bbl) as avg_op_90d
    from account_billing ab
    join billing_plans bp on bp.id = ab.plan_id
    join lateral (
      select op_annualized_bbl
      from observed_production_snapshots
      where workspace_id = ab.workspace_id
        and date >= current_date - interval '90 days'
    ) ops on true
    where bp.name not in ('trial', 'starter') -- Can't downgrade from starter
      and ab.override_tier is null -- Not manually overridden
    group by ab.workspace_id, ab.plan_id, bp.name, bp.bbl_min, bp.bbl_max
    having avg(ops.op_annualized_bbl) < bp.bbl_min * 0.9 -- 10% below minimum
  ),
  suggested_downgrades as (
    select 
      dc.workspace_id,
      dc.current_plan_id,
      bp.id as suggested_plan_id,
      dc.avg_op_90d
    from downgrade_candidates dc
    cross join billing_plans bp
    where bp.is_active
      and bp.name != 'trial'
      and bp.bbl_min <= dc.avg_op_90d
      and (bp.bbl_max is null or bp.bbl_max >= dc.avg_op_90d)
      and bp.id != dc.current_plan_id
  )
  insert into plan_change_suggestions (
    workspace_id,
    current_plan_id,
    suggested_plan_id,
    reason,
    op_annualized_bbl,
    effective_at_default
  )
  select 
    workspace_id,
    current_plan_id,
    suggested_plan_id,
    'op_below',
    avg_op_90d,
    (select renewal_at from account_billing where workspace_id = sd.workspace_id)
  from suggested_downgrades sd
  where not exists (
    -- Don't create duplicate suggestions
    select 1 from plan_change_suggestions
    where workspace_id = sd.workspace_id
      and status = 'suggested'
      and reason = 'op_below'
  );
  $$
);

-- Check for failed payments and dunning (daily at 4 AM)
select cron.schedule(
  'check-payment-failures',
  '0 4 * * *', -- Daily at 4 AM
  $$
  -- Enable read-only mode for workspaces with 3+ failed payments in last 14 days
  update account_billing ab
  set 
    read_only_mode = true,
    read_only_reason = 'payment_failed',
    updated_at = now()
  from (
    select workspace_id
    from invoices
    where status = 'failed'
      and created_at >= now() - interval '14 days'
    group by workspace_id
    having count(*) >= 3
  ) failed
  where ab.workspace_id = failed.workspace_id
    and ab.read_only_mode = false;

  -- Send dunning notifications
  insert into notification_queue (workspace_id, type, priority, payload)
  select 
    ab.workspace_id,
    'payment_failure',
    'high',
    jsonb_build_object(
      'failed_count', count(i.id),
      'total_due', sum(i.amount_due),
      'will_enter_readonly', count(i.id) >= 2
    )
  from account_billing ab
  join invoices i on i.workspace_id = ab.workspace_id
  where i.status = 'failed'
    and i.created_at >= now() - interval '14 days'
    and ab.read_only_mode = false
  group by ab.workspace_id
  having count(i.id) >= 1;
  $$
);

-- Trial ending reminders (daily at 9 AM)
select cron.schedule(
  'trial-ending-reminders',
  '0 9 * * *', -- Daily at 9 AM
  $$
  insert into notification_queue (workspace_id, type, priority, payload)
  select 
    workspace_id,
    'trial_ending',
    'medium',
    jsonb_build_object(
      'days_remaining', extract(day from trial_ends_at - now()),
      'trial_ends_at', trial_ends_at
    )
  from account_billing
  where trial_ends_at is not null
    and trial_ends_at > now()
    and trial_ends_at <= now() + interval '3 days'
    and not exists (
      -- Don't send duplicate notifications
      select 1 from notification_queue
      where workspace_id = account_billing.workspace_id
        and type = 'trial_ending'
        and created_at >= now() - interval '24 hours'
    );
  $$
);

-- Clean up old OP snapshots (keep last 365 days)
select cron.schedule(
  'cleanup-op-snapshots',
  '0 1 * * 0', -- Sundays at 1 AM
  $$
  delete from observed_production_snapshots
  where date < current_date - interval '365 days';
  $$
);

-- Comment on jobs for documentation
comment on schema cron is 'Scheduled jobs for billing and production tracking';
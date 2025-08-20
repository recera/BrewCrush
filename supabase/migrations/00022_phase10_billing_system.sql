-- Phase 10: Billing & Pricing System
-- =====================================================
-- Implements:
-- - Billing plans (Starter/Growth/Pro)
-- - Account billing management
-- - Observed Production (OP) tracking
-- - Plan change suggestions
-- - Stripe integration support
-- - Setup packages
-- - Invoicing

-- Create enum types for billing
create type billing_period as enum ('monthly', 'annual');
create type plan_tier as enum ('trial', 'starter', 'growth', 'pro');
create type plan_change_reason as enum ('op_exceeds', 'op_below', 'manual', 'support_override');
create type suggestion_status as enum ('suggested', 'accepted', 'dismissed', 'overridden');
create type payment_status as enum ('pending', 'processing', 'succeeded', 'failed');

-- Billing plans configuration
create table billing_plans (
  id uuid primary key default gen_random_uuid(),
  name plan_tier not null unique,
  display_name text not null,
  bbl_min integer not null,
  bbl_max integer,
  price_monthly integer not null, -- in cents
  price_annual_monthly integer not null, -- monthly price when paid annually, in cents
  features jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Insert default plans
insert into billing_plans (name, display_name, bbl_min, bbl_max, price_monthly, price_annual_monthly, features) values
  ('trial', 'Trial', 0, null, 0, 0, '{"duration_days": 14, "features": ["all_mvp"]}'::jsonb),
  ('starter', 'Starter', 0, 1000, 4000, 3400, '{"features": ["all_mvp"]}'::jsonb),
  ('growth', 'Growth', 1001, 3500, 8500, 7200, '{"features": ["all_mvp"]}'::jsonb),
  ('pro', 'Pro', 3501, 10000, 20000, 17000, '{"features": ["all_mvp"]}'::jsonb);

-- Account billing information
create table account_billing (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  plan_id uuid not null references billing_plans(id),
  billing_period billing_period not null default 'monthly',
  stripe_customer_id text,
  stripe_subscription_id text,
  payment_method_id text,
  trial_ends_at timestamptz,
  renewal_at timestamptz,
  canceled_at timestamptz,
  override_tier plan_tier, -- Support can pin a tier
  override_reason text,
  read_only_mode boolean not null default false,
  read_only_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id)
);

-- Observed Production snapshots
create table observed_production_snapshots (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  date date not null,
  packaged_bbl_90d numeric(12,2) not null default 0,
  op_annualized_bbl numeric(12,2) not null default 0,
  packaging_runs_count integer not null default 0,
  created_at timestamptz not null default now(),
  unique(workspace_id, date)
);

-- Plan change suggestions
create table plan_change_suggestions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  suggested_plan_id uuid not null references billing_plans(id),
  current_plan_id uuid not null references billing_plans(id),
  reason plan_change_reason not null,
  op_annualized_bbl numeric(12,2),
  first_detected_at timestamptz not null default now(),
  effective_at_default timestamptz not null,
  status suggestion_status not null default 'suggested',
  acted_by uuid references auth.users(id),
  acted_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Invoices (Stripe mirror)
create table invoices (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  stripe_invoice_id text unique,
  invoice_number text,
  amount_due integer not null, -- in cents
  amount_paid integer not null default 0,
  currency text not null default 'usd',
  status payment_status not null default 'pending',
  period_start timestamptz not null,
  period_end timestamptz not null,
  due_date timestamptz,
  paid_at timestamptz,
  pdf_url text,
  hosted_invoice_url text,
  metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Setup packages
create table setup_packages (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  display_name text not null,
  price integer not null, -- in cents
  description text not null,
  features jsonb not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Insert setup packages
insert into setup_packages (name, display_name, price, description, features) values
  ('basic', 'Basic Setup', 29900, 'CSV mapping session, 60-min screen-share, import validation', 
   '{"included": ["csv_mapping", "screen_share_60", "import_validation"]}'::jsonb),
  ('white_glove', 'White-glove Setup', 89900, 'We convert legacy sheets, recreate 3 recipes, 1 brew dry-run, POS ingest dry-run',
   '{"included": ["legacy_conversion", "recipe_recreation_3", "brew_dry_run", "pos_ingest_dry_run"]}'::jsonb),
  ('legacy_switch', 'Legacy Switch', 149900, 'Everything in White-glove + BROP/Excise rehearsal and go-live support on filing week',
   '{"included": ["white_glove_all", "brop_excise_rehearsal", "filing_week_support"]}'::jsonb);

-- Setup package purchases
create table setup_package_purchases (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  package_id uuid not null references setup_packages(id),
  stripe_payment_intent_id text,
  amount_paid integer not null,
  status payment_status not null default 'pending',
  purchased_at timestamptz not null default now(),
  completed_at timestamptz,
  notes text
);

-- Stripe webhook events (for idempotency)
create table stripe_webhook_events (
  id uuid primary key default gen_random_uuid(),
  stripe_event_id text not null unique,
  event_type text not null,
  processed boolean not null default false,
  payload jsonb not null,
  error text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

-- RLS Policies
alter table billing_plans enable row level security;
alter table account_billing enable row level security;
alter table observed_production_snapshots enable row level security;
alter table plan_change_suggestions enable row level security;
alter table invoices enable row level security;
alter table setup_packages enable row level security;
alter table setup_package_purchases enable row level security;
alter table stripe_webhook_events enable row level security;

-- Billing plans are public read
create policy "Billing plans are publicly readable"
  on billing_plans for select
  using (true);

-- Account billing - workspace members can view
create policy "Workspace members can view billing"
  on account_billing for select
  using (workspace_id in (
    select workspace_id from user_workspace_roles 
    where user_id = auth.uid()
  ));

-- Only admins can update billing
create policy "Only admins can update billing"
  on account_billing for update
  using (workspace_id in (
    select workspace_id from user_workspace_roles 
    where user_id = auth.uid() and role = 'admin'
  ));

-- OP snapshots - workspace members can view
create policy "Workspace members can view OP snapshots"
  on observed_production_snapshots for select
  using (workspace_id in (
    select workspace_id from user_workspace_roles 
    where user_id = auth.uid()
  ));

-- Plan suggestions - admins only
create policy "Only admins can view plan suggestions"
  on plan_change_suggestions for select
  using (workspace_id in (
    select workspace_id from user_workspace_roles 
    where user_id = auth.uid() and role = 'admin'
  ));

create policy "Only admins can act on plan suggestions"
  on plan_change_suggestions for update
  using (workspace_id in (
    select workspace_id from user_workspace_roles 
    where user_id = auth.uid() and role = 'admin'
  ));

-- Invoices - workspace members can view
create policy "Workspace members can view invoices"
  on invoices for select
  using (workspace_id in (
    select workspace_id from user_workspace_roles 
    where user_id = auth.uid()
  ));

-- Setup packages are public read
create policy "Setup packages are publicly readable"
  on setup_packages for select
  using (true);

-- Setup package purchases - workspace members can view
create policy "Workspace members can view setup purchases"
  on setup_package_purchases for select
  using (workspace_id in (
    select workspace_id from user_workspace_roles 
    where user_id = auth.uid()
  ));

-- Functions

-- Calculate Observed Production (OP)
create or replace function calculate_observed_production(p_workspace_id uuid)
returns numeric
language plpgsql
security definer
as $$
declare
  v_packaged_bbl_90d numeric;
  v_op_annualized numeric;
begin
  -- Calculate total BBL packaged in last 90 days
  select coalesce(sum(
    case 
      when fs.pack_config->>'container' = 'keg' then 
        (fl.produced_qty * (fs.size_ml::numeric / 1000) / 117.348) -- Convert liters to BBL
      when fs.pack_config->>'container' = 'case' then
        (fl.produced_qty * (fs.pack_config->>'units_per_case')::numeric * (fs.size_ml::numeric / 1000) / 117.348)
      else
        (fl.produced_qty * (fs.size_ml::numeric / 1000) / 117.348)
    end
  ), 0)
  into v_packaged_bbl_90d
  from finished_lots fl
  join finished_skus fs on fs.id = fl.sku_id
  join packaging_runs pr on pr.id = fl.packaging_run_id
  where fl.workspace_id = p_workspace_id
    and pr.created_at >= now() - interval '90 days';

  -- Annualize the 90-day production
  v_op_annualized := (v_packaged_bbl_90d / 90.0) * 365.0;

  return round(v_op_annualized, 2);
end;
$$;

-- Check and suggest plan changes
create or replace function check_plan_suggestions(p_workspace_id uuid)
returns void
language plpgsql
security definer
as $$
declare
  v_current_plan plan_tier;
  v_current_plan_id uuid;
  v_op_annualized numeric;
  v_suggested_plan_id uuid;
  v_grace_factor numeric := 1.1; -- 10% grace band
  v_current_max integer;
  v_renewal_at timestamptz;
begin
  -- Get current plan and OP
  select bp.name, bp.id, bp.bbl_max, ab.renewal_at
  into v_current_plan, v_current_plan_id, v_current_max, v_renewal_at
  from account_billing ab
  join billing_plans bp on bp.id = ab.plan_id
  where ab.workspace_id = p_workspace_id;

  if v_current_plan = 'trial' then
    return; -- Don't suggest during trial
  end if;

  v_op_annualized := calculate_observed_production(p_workspace_id);

  -- Store snapshot
  insert into observed_production_snapshots (workspace_id, date, op_annualized_bbl)
  values (p_workspace_id, current_date, v_op_annualized)
  on conflict (workspace_id, date) 
  do update set op_annualized_bbl = v_op_annualized;

  -- Check if OP exceeds current tier (with grace band)
  if v_current_max is not null and v_op_annualized > (v_current_max * v_grace_factor) then
    -- Find appropriate tier
    select id into v_suggested_plan_id
    from billing_plans
    where is_active 
      and bbl_min <= v_op_annualized 
      and (bbl_max is null or bbl_max >= v_op_annualized)
      and name != 'trial'
    order by bbl_min desc
    limit 1;

    -- Create suggestion if not already exists
    if v_suggested_plan_id is not null and v_suggested_plan_id != v_current_plan_id then
      insert into plan_change_suggestions (
        workspace_id, 
        suggested_plan_id, 
        current_plan_id,
        reason, 
        op_annualized_bbl,
        effective_at_default
      )
      values (
        p_workspace_id,
        v_suggested_plan_id,
        v_current_plan_id,
        'op_exceeds',
        v_op_annualized,
        coalesce(v_renewal_at, now() + interval '14 days')
      )
      on conflict do nothing;
    end if;
  end if;

  -- Check for downgrades (3 months of lower production)
  -- This would be called by a scheduled job checking historical data
end;
$$;

-- Accept plan change suggestion
create or replace function accept_plan_suggestion(
  p_suggestion_id uuid,
  p_when text default 'renewal' -- 'now' or 'renewal'
)
returns void
language plpgsql
security definer
as $$
declare
  v_workspace_id uuid;
  v_suggested_plan_id uuid;
  v_effective_at timestamptz;
begin
  -- Get suggestion details
  select workspace_id, suggested_plan_id, effective_at_default
  into v_workspace_id, v_suggested_plan_id, v_effective_at
  from plan_change_suggestions
  where id = p_suggestion_id and status = 'suggested';

  if not found then
    raise exception 'Suggestion not found or already acted upon';
  end if;

  -- Verify user has permission
  if not exists (
    select 1 from user_workspace_roles
    where workspace_id = v_workspace_id 
      and user_id = auth.uid() 
      and role = 'admin'
  ) then
    raise exception 'Insufficient permissions';
  end if;

  if p_when = 'now' then
    -- Update billing immediately
    update account_billing
    set plan_id = v_suggested_plan_id,
        updated_at = now()
    where workspace_id = v_workspace_id;
  else
    -- Schedule for renewal (handled by webhook/cron)
    -- For now, just mark the suggestion
  end if;

  -- Update suggestion status
  update plan_change_suggestions
  set status = 'accepted',
      acted_by = auth.uid(),
      acted_at = now(),
      updated_at = now()
  where id = p_suggestion_id;

  -- Log to audit
  insert into audit_logs (
    workspace_id,
    user_id,
    entity_table,
    entity_id,
    action,
    after
  ) values (
    v_workspace_id,
    auth.uid(),
    'plan_change_suggestions',
    p_suggestion_id,
    'command',
    jsonb_build_object(
      'action', 'accept_plan_suggestion',
      'when', p_when,
      'suggested_plan_id', v_suggested_plan_id
    )
  );
end;
$$;

-- Dismiss plan suggestion
create or replace function dismiss_plan_suggestion(p_suggestion_id uuid)
returns void
language plpgsql
security definer
as $$
begin
  update plan_change_suggestions
  set status = 'dismissed',
      acted_by = auth.uid(),
      acted_at = now(),
      updated_at = now()
  where id = p_suggestion_id
    and workspace_id in (
      select workspace_id from user_workspace_roles
      where user_id = auth.uid() and role = 'admin'
    );
end;
$$;

-- Get billing status for workspace
create or replace function get_billing_status(p_workspace_id uuid)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_result jsonb;
begin
  select jsonb_build_object(
    'plan', bp.name,
    'display_name', bp.display_name,
    'billing_period', ab.billing_period,
    'renewal_at', ab.renewal_at,
    'trial_ends_at', ab.trial_ends_at,
    'read_only_mode', ab.read_only_mode,
    'stripe_customer_id', ab.stripe_customer_id,
    'current_op', ops.op_annualized_bbl,
    'plan_min_bbl', bp.bbl_min,
    'plan_max_bbl', bp.bbl_max,
    'has_suggestion', exists(
      select 1 from plan_change_suggestions
      where workspace_id = p_workspace_id
        and status = 'suggested'
    )
  )
  into v_result
  from account_billing ab
  join billing_plans bp on bp.id = ab.plan_id
  left join lateral (
    select op_annualized_bbl
    from observed_production_snapshots
    where workspace_id = p_workspace_id
    order by date desc
    limit 1
  ) ops on true
  where ab.workspace_id = p_workspace_id;

  return v_result;
end;
$$;

-- Create indexes
create index idx_account_billing_workspace on account_billing(workspace_id);
create index idx_account_billing_stripe_customer on account_billing(stripe_customer_id) where stripe_customer_id is not null;
create index idx_op_snapshots_workspace_date on observed_production_snapshots(workspace_id, date desc);
create index idx_suggestions_workspace_status on plan_change_suggestions(workspace_id, status) where status = 'suggested';
create index idx_invoices_workspace on invoices(workspace_id);
create index idx_invoices_stripe on invoices(stripe_invoice_id) where stripe_invoice_id is not null;
create index idx_stripe_events on stripe_webhook_events(stripe_event_id);
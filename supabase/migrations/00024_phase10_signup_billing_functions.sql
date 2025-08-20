-- Phase 10: Signup and Billing Functions
-- =====================================================
-- Functions to handle workspace creation with billing setup

-- Function to create workspace with billing setup
create or replace function create_workspace_with_billing(
  workspace_name text,
  plan_tier text default 'starter',
  billing_period text default 'monthly'
) returns json
language plpgsql
security definer
as $$
declare
  v_user_id uuid;
  v_workspace_id uuid;
  v_plan_id uuid;
  v_trial_ends_at timestamptz;
begin
  -- Get the current user ID
  v_user_id := auth.uid();
  
  if v_user_id is null then
    raise exception 'User not authenticated';
  end if;
  
  -- Check if user already has a workspace
  if exists (
    select 1 from user_workspace_roles 
    where user_id = v_user_id
  ) then
    raise exception 'User already belongs to a workspace';
  end if;
  
  -- Get the plan ID
  select id into v_plan_id
  from billing_plans
  where name = plan_tier
    and is_active = true;
    
  if v_plan_id is null then
    -- Default to starter if plan not found
    select id into v_plan_id
    from billing_plans
    where name = 'starter'
      and is_active = true;
  end if;
  
  -- Calculate trial end date (14 days from now)
  v_trial_ends_at := now() + interval '14 days';
  
  -- Create the workspace
  insert into workspaces (name, plan)
  values (workspace_name, plan_tier)
  returning id into v_workspace_id;
  
  -- Assign admin role to the creator
  insert into user_workspace_roles (user_id, workspace_id, role)
  values (v_user_id, v_workspace_id, 'admin');
  
  -- Create billing record
  insert into account_billing (
    workspace_id,
    plan_id,
    billing_period,
    trial_ends_at,
    renewal_at,
    is_active,
    created_at,
    updated_at
  ) values (
    v_workspace_id,
    v_plan_id,
    billing_period::billing_period,
    v_trial_ends_at,
    v_trial_ends_at, -- Renewal starts after trial
    true,
    now(),
    now()
  );
  
  -- Create initial OP snapshot with 0 production
  insert into observed_production_snapshots (
    workspace_id,
    date,
    packaged_bbl_90d,
    op_annualized_bbl,
    created_at
  ) values (
    v_workspace_id,
    current_date,
    0,
    0,
    now()
  );
  
  -- Log the event
  insert into ui_events (
    event_name,
    workspace_id,
    user_id,
    metadata
  ) values (
    'workspace_created_with_billing',
    v_workspace_id,
    v_user_id,
    jsonb_build_object(
      'plan_tier', plan_tier,
      'billing_period', billing_period,
      'trial_ends_at', v_trial_ends_at
    )
  );
  
  return json_build_object(
    'workspace_id', v_workspace_id,
    'workspace_name', workspace_name,
    'plan_tier', plan_tier,
    'billing_period', billing_period,
    'trial_ends_at', v_trial_ends_at,
    'success', true
  );
  
exception
  when others then
    -- Log the error
    insert into error_logs (
      error_message,
      error_detail,
      user_id,
      created_at
    ) values (
      SQLERRM,
      SQLSTATE,
      v_user_id,
      now()
    );
    
    raise;
end;
$$;

-- Function to upgrade workspace after trial (called from Stripe webhook)
create or replace function activate_workspace_billing(
  p_workspace_id uuid,
  p_stripe_customer_id text,
  p_stripe_subscription_id text,
  p_stripe_price_id text
) returns void
language plpgsql
security definer
as $$
declare
  v_plan_id uuid;
begin
  -- Get plan ID from Stripe price ID
  select bp.id into v_plan_id
  from billing_plans bp
  where bp.stripe_price_id_monthly = p_stripe_price_id
     or bp.stripe_price_id_annual = p_stripe_price_id;
     
  if v_plan_id is null then
    raise exception 'Invalid Stripe price ID';
  end if;
  
  -- Update workspace with Stripe customer ID
  update workspaces
  set stripe_customer_id = p_stripe_customer_id,
      updated_at = now()
  where id = p_workspace_id;
  
  -- Update billing record
  update account_billing
  set stripe_subscription_id = p_stripe_subscription_id,
      plan_id = v_plan_id,
      trial_ends_at = null, -- Clear trial
      updated_at = now()
  where workspace_id = p_workspace_id;
  
  -- Log the activation
  insert into ui_events (
    event_name,
    workspace_id,
    metadata
  ) values (
    'billing_activated',
    p_workspace_id,
    jsonb_build_object(
      'stripe_customer_id', p_stripe_customer_id,
      'stripe_subscription_id', p_stripe_subscription_id,
      'plan_id', v_plan_id
    )
  );
end;
$$;

-- Function to check if workspace is in trial
create or replace function is_workspace_in_trial(p_workspace_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from account_billing
    where workspace_id = p_workspace_id
      and trial_ends_at is not null
      and trial_ends_at > now()
      and stripe_subscription_id is null
  );
$$;

-- Function to get workspace billing status
create or replace function get_workspace_billing_status(p_workspace_id uuid)
returns json
language plpgsql
stable
as $$
declare
  v_result json;
begin
  select json_build_object(
    'workspace_id', ab.workspace_id,
    'plan_name', bp.name,
    'billing_period', ab.billing_period,
    'is_trial', ab.trial_ends_at is not null and ab.trial_ends_at > now(),
    'trial_ends_at', ab.trial_ends_at,
    'renewal_at', ab.renewal_at,
    'is_active', ab.is_active,
    'read_only_mode', ab.read_only_mode,
    'read_only_reason', ab.read_only_reason,
    'stripe_subscription_id', ab.stripe_subscription_id
  ) into v_result
  from account_billing ab
  join billing_plans bp on bp.id = ab.plan_id
  where ab.workspace_id = p_workspace_id;
  
  return v_result;
end;
$$;

-- Add error_logs table if it doesn't exist
create table if not exists error_logs (
  id uuid primary key default gen_random_uuid(),
  error_message text,
  error_detail text,
  user_id uuid references auth.users(id),
  workspace_id uuid references workspaces(id),
  created_at timestamptz default now()
);

-- Grant permissions
grant execute on function create_workspace_with_billing to authenticated;
grant execute on function is_workspace_in_trial to authenticated;
grant execute on function get_workspace_billing_status to authenticated;
grant execute on function activate_workspace_billing to service_role;

-- Create index for error logs
create index if not exists idx_error_logs_user_id on error_logs(user_id);
create index if not exists idx_error_logs_workspace_id on error_logs(workspace_id);
create index if not exists idx_error_logs_created_at on error_logs(created_at desc);

-- Comment on functions
comment on function create_workspace_with_billing is 'Creates a new workspace with billing setup during signup';
comment on function activate_workspace_billing is 'Activates billing after successful Stripe checkout';
comment on function is_workspace_in_trial is 'Checks if workspace is still in trial period';
comment on function get_workspace_billing_status is 'Gets current billing status for a workspace';
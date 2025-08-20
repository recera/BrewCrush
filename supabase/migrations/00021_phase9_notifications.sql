-- Phase 9: Notification System for Daily Digests and Due-Date Reminders

-- Notification preferences table
create table if not exists notification_preferences (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  
  -- Notification channels
  email_enabled boolean not null default true,
  push_enabled boolean not null default false,
  in_app_enabled boolean not null default true,
  
  -- Notification types
  daily_digest boolean not null default true,
  low_stock_alerts boolean not null default true,
  po_due_reminders boolean not null default true,
  tank_milestones boolean not null default true,
  brop_due_reminders boolean not null default true,
  excise_due_reminders boolean not null default true,
  transfer_pending_alerts boolean not null default true,
  
  -- Timing preferences
  digest_time time not null default '08:00:00',
  timezone text not null default 'America/New_York',
  reminder_days_before integer not null default 3, -- Days before due date to send reminder
  
  -- Metadata
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  
  unique(workspace_id, user_id)
);

-- Notification log for tracking sent notifications
create table if not exists notification_log (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  
  type text not null check (type in (
    'daily_digest', 
    'low_stock', 
    'po_due', 
    'tank_milestone', 
    'brop_due', 
    'excise_due', 
    'transfer_pending',
    'sync_error',
    'system'
  )),
  
  channel text not null check (channel in ('email', 'push', 'in_app')),
  status text not null check (status in ('pending', 'sent', 'failed', 'cancelled')),
  
  subject text,
  content jsonb not null,
  metadata jsonb,
  
  scheduled_at timestamptz,
  sent_at timestamptz,
  failed_at timestamptz,
  error_message text,
  
  created_at timestamptz not null default now()
);

-- Notification queue for pending notifications
create table if not exists notification_queue (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  
  type text not null,
  recipients jsonb not null, -- Array of user IDs
  data jsonb not null,
  
  priority integer not null default 5 check (priority between 1 and 10),
  scheduled_for timestamptz not null default now(),
  expires_at timestamptz,
  
  status text not null default 'pending' check (status in ('pending', 'processing', 'completed', 'failed')),
  attempts integer not null default 0,
  last_attempt_at timestamptz,
  
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

-- Push notification subscriptions
create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  
  endpoint text not null,
  keys jsonb not null, -- p256dh and auth keys for web push
  
  device_info jsonb, -- User agent, device type, etc.
  is_active boolean not null default true,
  
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  
  unique(user_id, endpoint)
);

-- Create indexes
create index idx_notification_preferences_workspace on notification_preferences(workspace_id);
create index idx_notification_preferences_user on notification_preferences(user_id);
create index idx_notification_log_workspace_created on notification_log(workspace_id, created_at desc);
create index idx_notification_log_user_type on notification_log(user_id, type);
create index idx_notification_queue_status_scheduled on notification_queue(status, scheduled_for) where status = 'pending';
create index idx_push_subscriptions_user on push_subscriptions(user_id) where is_active = true;

-- RLS Policies
alter table notification_preferences enable row level security;
alter table notification_log enable row level security;
alter table notification_queue enable row level security;
alter table push_subscriptions enable row level security;

-- Notification preferences policies
create policy "Users can view their own notification preferences"
  on notification_preferences for select
  using (auth.uid() = user_id);

create policy "Users can update their own notification preferences"
  on notification_preferences for update
  using (auth.uid() = user_id);

create policy "Users can insert their own notification preferences"
  on notification_preferences for insert
  with check (auth.uid() = user_id);

-- Notification log policies
create policy "Users can view their own notifications"
  on notification_log for select
  using (auth.uid() = user_id or workspace_id in (
    select workspace_id from user_workspace_roles where user_id = auth.uid()
  ));

-- Push subscription policies
create policy "Users can manage their own push subscriptions"
  on push_subscriptions for all
  using (auth.uid() = user_id);

-- Function to get daily digest data
create or replace function get_daily_digest_data(p_workspace_id uuid)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_digest jsonb;
  v_low_stock_count integer;
  v_open_pos jsonb;
  v_tank_milestones jsonb;
  v_due_dates jsonb;
begin
  -- Get low stock items
  select count(*)
  into v_low_stock_count
  from items i
  where i.workspace_id = p_workspace_id
    and i.reorder_level is not null
    and exists (
      select 1 from mv_inventory_on_hand mio
      where mio.item_id = i.id
        and mio.total_on_hand < i.reorder_level
    );
  
  -- Get open POs due soon
  select jsonb_agg(jsonb_build_object(
    'po_number', po_number,
    'vendor_name', v.name,
    'due_date', due_date,
    'total_items', (select count(*) from po_lines where po_id = po.id)
  ))
  into v_open_pos
  from purchase_orders po
  join vendors v on v.id = po.vendor_id
  where po.workspace_id = p_workspace_id
    and po.status in ('draft', 'approved', 'partial')
    and po.due_date between current_date and current_date + interval '7 days';
  
  -- Get tank milestones (ready to transfer, harvest yeast, etc.)
  select jsonb_agg(jsonb_build_object(
    'tank_name', t.name,
    'batch_name', b.name,
    'days_in_tank', extract(day from now() - b.brew_date),
    'status', b.status,
    'milestone', case
      when b.status = 'fermenting' and extract(day from now() - b.brew_date) >= 5 then 'Ready for yeast harvest'
      when b.status = 'fermenting' and extract(day from now() - b.brew_date) >= 14 then 'Ready to transfer'
      when b.status = 'conditioning' and extract(day from now() - b.brew_date) >= 21 then 'Ready to package'
      else null
    end
  ))
  into v_tank_milestones
  from tanks t
  join batches b on b.current_tank_id = t.id
  where t.workspace_id = p_workspace_id
    and b.status in ('fermenting', 'conditioning')
    and (
      (b.status = 'fermenting' and extract(day from now() - b.brew_date) >= 5) or
      (b.status = 'conditioning' and extract(day from now() - b.brew_date) >= 21)
    );
  
  -- Get upcoming due dates (BROP, Excise, etc.)
  select jsonb_build_object(
    'brop_due', (
      select jsonb_build_object(
        'period_type', type,
        'period_end', period_end,
        'due_date', due_date
      )
      from ttb_periods
      where workspace_id = p_workspace_id
        and status in ('open', 'draft')
        and due_date between current_date and current_date + interval '7 days'
      order by due_date
      limit 1
    ),
    'excise_due', (
      select jsonb_build_object(
        'period_end', period_end,
        'due_date', due_date
      )
      from ttb_periods
      where workspace_id = p_workspace_id
        and filing_frequency_excise is not null
        and status in ('open', 'draft')
        and due_date between current_date and current_date + interval '7 days'
      order by due_date
      limit 1
    )
  )
  into v_due_dates;
  
  -- Build digest
  v_digest := jsonb_build_object(
    'workspace_id', p_workspace_id,
    'date', current_date,
    'low_stock_count', v_low_stock_count,
    'open_pos', coalesce(v_open_pos, '[]'::jsonb),
    'tank_milestones', coalesce(v_tank_milestones, '[]'::jsonb),
    'due_dates', v_due_dates,
    'summary', jsonb_build_object(
      'total_active_batches', (
        select count(*) from batches 
        where workspace_id = p_workspace_id 
          and status in ('fermenting', 'conditioning')
      ),
      'total_open_pos', (
        select count(*) from purchase_orders 
        where workspace_id = p_workspace_id 
          and status in ('draft', 'approved', 'partial')
      )
    )
  );
  
  return v_digest;
end;
$$;

-- Function to queue daily digests
create or replace function queue_daily_digests()
returns void
language plpgsql
security definer
as $$
declare
  v_workspace record;
  v_digest_data jsonb;
  v_recipients jsonb;
begin
  -- For each workspace with active users who want daily digests
  for v_workspace in
    select distinct w.id as workspace_id
    from workspaces w
    join notification_preferences np on np.workspace_id = w.id
    where np.daily_digest = true
      and np.email_enabled = true
  loop
    -- Get digest data
    v_digest_data := get_daily_digest_data(v_workspace.workspace_id);
    
    -- Get recipients for this workspace
    select jsonb_agg(np.user_id)
    into v_recipients
    from notification_preferences np
    where np.workspace_id = v_workspace.workspace_id
      and np.daily_digest = true
      and np.email_enabled = true;
    
    -- Queue the digest
    if v_recipients is not null and jsonb_array_length(v_recipients) > 0 then
      insert into notification_queue (
        workspace_id,
        type,
        recipients,
        data,
        priority,
        scheduled_for
      ) values (
        v_workspace.workspace_id,
        'daily_digest',
        v_recipients,
        v_digest_data,
        5,
        now()
      );
    end if;
  end loop;
end;
$$;

-- Function to check and queue due date reminders
create or replace function queue_due_date_reminders()
returns void
language plpgsql
security definer
as $$
declare
  v_reminder record;
begin
  -- BROP due reminders
  for v_reminder in
    select 
      tp.workspace_id,
      tp.id as period_id,
      tp.type as period_type,
      tp.due_date,
      jsonb_agg(distinct np.user_id) as recipients
    from ttb_periods tp
    join notification_preferences np on np.workspace_id = tp.workspace_id
    where tp.status in ('open', 'draft')
      and tp.due_date between current_date and current_date + interval '7 days'
      and np.brop_due_reminders = true
      and not exists (
        select 1 from notification_log nl
        where nl.workspace_id = tp.workspace_id
          and nl.type = 'brop_due'
          and nl.metadata->>'period_id' = tp.id::text
          and nl.created_at > current_date
      )
    group by tp.workspace_id, tp.id, tp.type, tp.due_date
  loop
    insert into notification_queue (
      workspace_id,
      type,
      recipients,
      data,
      priority,
      scheduled_for
    ) values (
      v_reminder.workspace_id,
      'brop_due',
      v_reminder.recipients,
      jsonb_build_object(
        'period_id', v_reminder.period_id,
        'period_type', v_reminder.period_type,
        'due_date', v_reminder.due_date,
        'days_until_due', extract(day from v_reminder.due_date - current_date)
      ),
      8, -- Higher priority for compliance
      now()
    );
  end loop;
  
  -- Similar for excise, PO due dates, etc.
  -- (Implementation follows same pattern)
end;
$$;

-- Schedule cron jobs (using pg_cron)
-- These would be set up in the Supabase dashboard or via SQL:
-- select cron.schedule('daily-digest', '0 8 * * *', 'select queue_daily_digests();');
-- select cron.schedule('due-reminders', '0 9 * * *', 'select queue_due_date_reminders();');
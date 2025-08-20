-- Phase 10: Notification Queue System
-- =====================================================
-- Table for queuing notifications to be sent

-- Notification types
create type notification_type as enum (
  'trial_ending',
  'trial_expired',
  'plan_suggestion',
  'plan_changed',
  'payment_failure',
  'payment_success',
  'low_stock',
  'ttb_due',
  'excise_due',
  'tank_milestone'
);

-- Notification priority
create type notification_priority as enum (
  'low',
  'medium',
  'high',
  'critical'
);

-- Notification status
create type notification_status as enum (
  'pending',
  'processing',
  'sent',
  'failed',
  'cancelled'
);

-- Create notification queue table
create table notification_queue (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid references auth.users(id),
  type notification_type not null,
  priority notification_priority not null default 'medium',
  status notification_status not null default 'pending',
  payload jsonb not null default '{}'::jsonb,
  send_at timestamptz default now(),
  sent_at timestamptz,
  failed_at timestamptz,
  error_message text,
  retry_count integer default 0,
  max_retries integer default 3,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Create indexes
create index idx_notification_queue_workspace on notification_queue(workspace_id);
create index idx_notification_queue_status on notification_queue(status) where status in ('pending', 'processing');
create index idx_notification_queue_send_at on notification_queue(send_at) where status = 'pending';
create index idx_notification_queue_type on notification_queue(type);
create index idx_notification_queue_priority on notification_queue(priority, send_at) where status = 'pending';

-- Enable RLS
alter table notification_queue enable row level security;

-- RLS policies
create policy "Workspace members can view their notifications"
  on notification_queue for select
  using (
    workspace_id in (
      select workspace_id 
      from user_workspace_roles 
      where user_id = auth.uid()
    )
  );

create policy "System can insert notifications"
  on notification_queue for insert
  with check (true);

create policy "System can update notifications"
  on notification_queue for update
  using (true);

-- Function to process notification queue
create or replace function process_notification_queue()
returns void
language plpgsql
security definer
as $$
declare
  v_notification record;
begin
  -- Get next pending notification
  for v_notification in
    select *
    from notification_queue
    where status = 'pending'
      and send_at <= now()
      and retry_count < max_retries
    order by priority desc, send_at asc
    limit 10
    for update skip locked
  loop
    -- Mark as processing
    update notification_queue
    set status = 'processing',
        updated_at = now()
    where id = v_notification.id;
    
    -- Here you would call the actual notification service
    -- For now, we'll just mark as sent
    -- In production, this would integrate with email/push services
    
    update notification_queue
    set status = 'sent',
        sent_at = now(),
        updated_at = now()
    where id = v_notification.id;
    
  end loop;
end;
$$;

-- Function to retry failed notifications
create or replace function retry_failed_notifications()
returns void
language plpgsql
security definer
as $$
begin
  update notification_queue
  set status = 'pending',
      retry_count = retry_count + 1,
      send_at = now() + (interval '1 minute' * power(2, retry_count)), -- Exponential backoff
      updated_at = now()
  where status = 'failed'
    and retry_count < max_retries
    and failed_at > now() - interval '24 hours';
end;
$$;

-- Function to queue a notification
create or replace function queue_notification(
  p_workspace_id uuid,
  p_type text,
  p_payload jsonb,
  p_priority text default 'medium',
  p_user_id uuid default null,
  p_send_at timestamptz default now()
) returns uuid
language plpgsql
security definer
as $$
declare
  v_notification_id uuid;
begin
  insert into notification_queue (
    workspace_id,
    user_id,
    type,
    priority,
    payload,
    send_at
  ) values (
    p_workspace_id,
    p_user_id,
    p_type::notification_type,
    p_priority::notification_priority,
    p_payload,
    p_send_at
  ) returning id into v_notification_id;
  
  return v_notification_id;
end;
$$;

-- Cron job to process notifications (every minute)
select cron.schedule(
  'process-notifications',
  '* * * * *', -- Every minute
  $$select process_notification_queue();$$
);

-- Cron job to retry failed notifications (every 15 minutes)
select cron.schedule(
  'retry-notifications',
  '*/15 * * * *', -- Every 15 minutes
  $$select retry_failed_notifications();$$
);

-- Grant permissions
grant execute on function queue_notification to authenticated;
grant execute on function process_notification_queue to service_role;
grant execute on function retry_failed_notifications to service_role;

-- Comment on table and functions
comment on table notification_queue is 'Queue for all system notifications';
comment on function queue_notification is 'Queues a notification for sending';
comment on function process_notification_queue is 'Processes pending notifications';
comment on function retry_failed_notifications is 'Retries failed notifications with exponential backoff';
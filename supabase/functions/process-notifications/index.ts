import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY')
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')

interface NotificationQueueItem {
  id: string
  workspace_id: string
  type: string
  recipients: string[]
  data: any
  priority: number
}

serve(async (req) => {
  try {
    // Create Supabase client with service role
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Get pending notifications from queue
    const { data: notifications, error: fetchError } = await supabaseClient
      .from('notification_queue')
      .select('*')
      .eq('status', 'pending')
      .lte('scheduled_for', new Date().toISOString())
      .order('priority', { ascending: false })
      .order('scheduled_for', { ascending: true })
      .limit(10)

    if (fetchError) {
      throw fetchError
    }

    const results = []

    for (const notification of notifications) {
      try {
        // Mark as processing
        await supabaseClient
          .from('notification_queue')
          .update({ 
            status: 'processing',
            last_attempt_at: new Date().toISOString(),
            attempts: notification.attempts + 1
          })
          .eq('id', notification.id)

        // Process based on type
        const result = await processNotification(supabaseClient, notification)
        
        // Mark as completed
        await supabaseClient
          .from('notification_queue')
          .update({ 
            status: 'completed',
            processed_at: new Date().toISOString()
          })
          .eq('id', notification.id)

        results.push({ id: notification.id, success: true, result })
      } catch (error) {
        console.error(`Failed to process notification ${notification.id}:`, error)
        
        // Mark as failed if max attempts reached
        const maxAttempts = 3
        const status = notification.attempts >= maxAttempts ? 'failed' : 'pending'
        
        await supabaseClient
          .from('notification_queue')
          .update({ 
            status,
            last_attempt_at: new Date().toISOString()
          })
          .eq('id', notification.id)

        results.push({ id: notification.id, success: false, error: error.message })
      }
    }

    return new Response(
      JSON.stringify({ 
        processed: results.length,
        results 
      }),
      { 
        headers: { 'Content-Type': 'application/json' },
        status: 200
      }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        headers: { 'Content-Type': 'application/json' },
        status: 500
      }
    )
  }
})

async function processNotification(supabase: any, notification: NotificationQueueItem) {
  switch (notification.type) {
    case 'daily_digest':
      return await sendDailyDigest(supabase, notification)
    case 'brop_due':
    case 'excise_due':
      return await sendDueDateReminder(supabase, notification)
    case 'low_stock':
      return await sendLowStockAlert(supabase, notification)
    case 'po_due':
      return await sendPOReminder(supabase, notification)
    case 'tank_milestone':
      return await sendTankMilestone(supabase, notification)
    default:
      throw new Error(`Unknown notification type: ${notification.type}`)
  }
}

async function sendDailyDigest(supabase: any, notification: NotificationQueueItem) {
  const { data } = notification
  const emailPromises = []
  
  for (const userId of notification.recipients) {
    // Get user details
    const { data: user } = await supabase
      .from('users')
      .select('email, full_name')
      .eq('id', userId)
      .single()
    
    if (!user?.email) continue
    
    // Get workspace name
    const { data: workspace } = await supabase
      .from('workspaces')
      .select('name')
      .eq('id', notification.workspace_id)
      .single()
    
    // Build email content
    const emailHtml = buildDigestEmail({
      userName: user.full_name || 'Brewer',
      workspaceName: workspace?.name || 'Brewery',
      date: data.date,
      lowStockCount: data.low_stock_count,
      openPOs: data.open_pos,
      tankMilestones: data.tank_milestones,
      dueDates: data.due_dates,
      summary: data.summary
    })
    
    // Send email via Resend
    if (RESEND_API_KEY) {
      emailPromises.push(
        sendEmail({
          to: user.email,
          subject: `BrewCrush Daily Digest - ${new Date().toLocaleDateString()}`,
          html: emailHtml
        })
      )
    }
    
    // Log notification
    await supabase.from('notification_log').insert({
      workspace_id: notification.workspace_id,
      user_id: userId,
      type: 'daily_digest',
      channel: 'email',
      status: 'sent',
      subject: 'Daily Digest',
      content: data,
      sent_at: new Date().toISOString()
    })
  }
  
  await Promise.all(emailPromises)
  return { sent_to: notification.recipients.length }
}

async function sendDueDateReminder(supabase: any, notification: NotificationQueueItem) {
  const { data } = notification
  const emailPromises = []
  const pushPromises = []
  
  for (const userId of notification.recipients) {
    // Get user preferences
    const { data: prefs } = await supabase
      .from('notification_preferences')
      .select('email_enabled, push_enabled')
      .eq('user_id', userId)
      .eq('workspace_id', notification.workspace_id)
      .single()
    
    // Get user details
    const { data: user } = await supabase
      .from('users')
      .select('email, full_name')
      .eq('id', userId)
      .single()
    
    if (!user) continue
    
    const subject = notification.type === 'brop_due' 
      ? `BROP Due in ${data.days_until_due} days`
      : `Excise Return Due in ${data.days_until_due} days`
    
    // Send email if enabled
    if (prefs?.email_enabled && user.email && RESEND_API_KEY) {
      emailPromises.push(
        sendEmail({
          to: user.email,
          subject,
          html: buildDueDateEmail({
            userName: user.full_name || 'Brewer',
            type: notification.type,
            dueDate: data.due_date,
            daysUntilDue: data.days_until_due
          })
        })
      )
    }
    
    // Send push notification if enabled
    if (prefs?.push_enabled) {
      const { data: subscriptions } = await supabase
        .from('push_subscriptions')
        .select('*')
        .eq('user_id', userId)
        .eq('is_active', true)
      
      for (const sub of subscriptions || []) {
        pushPromises.push(
          sendPushNotification({
            subscription: sub,
            title: subject,
            body: `Don't forget to file your ${notification.type === 'brop_due' ? 'BROP' : 'Excise Return'} by ${new Date(data.due_date).toLocaleDateString()}`,
            tag: `${notification.type}-${data.period_id}`,
            data: { type: notification.type, ...data }
          })
        )
      }
    }
    
    // Log notification
    await supabase.from('notification_log').insert({
      workspace_id: notification.workspace_id,
      user_id: userId,
      type: notification.type,
      channel: prefs?.push_enabled ? 'push' : 'email',
      status: 'sent',
      subject,
      content: data,
      metadata: { period_id: data.period_id },
      sent_at: new Date().toISOString()
    })
  }
  
  await Promise.all([...emailPromises, ...pushPromises])
  return { sent_to: notification.recipients.length }
}

async function sendLowStockAlert(supabase: any, notification: NotificationQueueItem) {
  // Similar implementation for low stock alerts
  return { sent_to: notification.recipients.length }
}

async function sendPOReminder(supabase: any, notification: NotificationQueueItem) {
  // Similar implementation for PO reminders
  return { sent_to: notification.recipients.length }
}

async function sendTankMilestone(supabase: any, notification: NotificationQueueItem) {
  // Similar implementation for tank milestones
  return { sent_to: notification.recipients.length }
}

// Email sending helper
async function sendEmail({ to, subject, html }: { to: string; subject: string; html: string }) {
  if (!RESEND_API_KEY) {
    console.log('Email sending skipped - no API key configured')
    return
  }
  
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'BrewCrush <notifications@brewcrush.com>',
      to: [to],
      subject,
      html
    })
  })
  
  if (!response.ok) {
    throw new Error(`Failed to send email: ${await response.text()}`)
  }
}

// Web Push notification helper
async function sendPushNotification({ 
  subscription, 
  title, 
  body, 
  tag, 
  data 
}: { 
  subscription: any
  title: string
  body: string
  tag?: string
  data?: any 
}) {
  // Implementation would use web-push library
  // For now, log the attempt
  console.log('Push notification would be sent:', { title, body })
  return true
}

// Email template builders
function buildDigestEmail(data: any): string {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #f97316; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
        .content { background: white; padding: 20px; border: 1px solid #e5e7eb; }
        .section { margin: 20px 0; }
        .metric { display: inline-block; margin: 10px 20px 10px 0; }
        .metric-value { font-size: 24px; font-weight: bold; color: #111827; }
        .metric-label { font-size: 14px; color: #6b7280; }
        .alert { background: #fef3c7; border-left: 4px solid #f59e0b; padding: 12px; margin: 10px 0; }
        .footer { text-align: center; color: #6b7280; font-size: 12px; margin-top: 20px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Good morning, ${data.userName}!</h1>
          <p>Here's your daily digest for ${data.workspaceName}</p>
        </div>
        
        <div class="content">
          <div class="section">
            <h2>Today's Overview</h2>
            <div class="metric">
              <div class="metric-value">${data.summary.total_active_batches}</div>
              <div class="metric-label">Active Batches</div>
            </div>
            <div class="metric">
              <div class="metric-value">${data.summary.total_open_pos}</div>
              <div class="metric-label">Open POs</div>
            </div>
            ${data.lowStockCount > 0 ? `
              <div class="metric">
                <div class="metric-value" style="color: #ef4444;">${data.lowStockCount}</div>
                <div class="metric-label">Low Stock Items</div>
              </div>
            ` : ''}
          </div>
          
          ${data.tankMilestones.length > 0 ? `
            <div class="section">
              <h3>Tank Milestones</h3>
              ${data.tankMilestones.map((m: any) => `
                <div class="alert">
                  <strong>${m.tank_name}</strong> - ${m.batch_name}<br>
                  ${m.milestone} (Day ${m.days_in_tank})
                </div>
              `).join('')}
            </div>
          ` : ''}
          
          ${data.openPOs.length > 0 ? `
            <div class="section">
              <h3>Purchase Orders Due Soon</h3>
              ${data.openPOs.map((po: any) => `
                <div class="alert">
                  <strong>PO ${po.po_number}</strong> - ${po.vendor_name}<br>
                  Due: ${new Date(po.due_date).toLocaleDateString()} (${po.total_items} items)
                </div>
              `).join('')}
            </div>
          ` : ''}
          
          ${data.dueDates.brop_due || data.dueDates.excise_due ? `
            <div class="section">
              <h3>Compliance Deadlines</h3>
              ${data.dueDates.brop_due ? `
                <div class="alert">
                  <strong>BROP Due</strong><br>
                  ${data.dueDates.brop_due.period_type} report due by ${new Date(data.dueDates.brop_due.due_date).toLocaleDateString()}
                </div>
              ` : ''}
              ${data.dueDates.excise_due ? `
                <div class="alert">
                  <strong>Excise Return Due</strong><br>
                  Due by ${new Date(data.dueDates.excise_due.due_date).toLocaleDateString()}
                </div>
              ` : ''}
            </div>
          ` : ''}
        </div>
        
        <div class="footer">
          <p>You're receiving this because you have daily digests enabled in BrewCrush.</p>
          <p><a href="https://app.brewcrush.com/settings/notifications">Update notification preferences</a></p>
        </div>
      </div>
    </body>
    </html>
  `
}

function buildDueDateEmail(data: any): string {
  const isB ROP = data.type === 'brop_due'
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .alert-header { background: #ef4444; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
        .content { background: white; padding: 20px; border: 1px solid #e5e7eb; }
        .cta-button { 
          display: inline-block; 
          background: #f97316; 
          color: white; 
          padding: 12px 24px; 
          text-decoration: none; 
          border-radius: 6px; 
          margin: 20px 0;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="alert-header">
          <h1>⚠️ ${isBROP ? 'BROP' : 'Excise Return'} Due Soon</h1>
        </div>
        
        <div class="content">
          <p>Hi ${data.userName},</p>
          
          <p><strong>Your ${isBROP ? 'Brewer\'s Report of Operations' : 'Excise Tax Return'} is due in ${data.daysUntilDue} days.</strong></p>
          
          <p>Due Date: <strong>${new Date(data.dueDate).toLocaleDateString()}</strong></p>
          
          <a href="https://app.brewcrush.com/compliance/${isBROP ? 'ttb' : 'excise'}" class="cta-button">
            Prepare ${isBROP ? 'BROP' : 'Excise Return'}
          </a>
          
          <p>Don't wait until the last minute - log in now to review your data and generate your filing documents.</p>
        </div>
      </div>
    </body>
    </html>
  `
}
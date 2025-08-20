import { createClient } from '@/lib/supabase/client'

export type TelemetryEvent = 
  | 'po_created'
  | 'po_received'
  | 'po_approved'
  | 'po_cancelled'
  | 'po_edited'
  | 'po_duplicated'
  | 'po_exported'
  | 'po_imported'
  | 'low_stock_alert_viewed'
  | 'reorder_po_created'
  | 'variance_detected'
  | 'inventory_adjusted'
  | 'inventory_transferred'
  | 'cycle_count_completed'

interface EventProperties {
  // Common properties
  workspace_id?: string
  entity_id?: string
  entity_type?: string
  
  // PO specific
  po_id?: string
  vendor_id?: string
  total_amount?: number
  line_count?: number
  status?: string
  
  // Receipt specific
  receipt_id?: string
  variance_detected?: boolean
  variance_amount?: number
  partial?: boolean
  
  // Import/Export specific
  record_count?: number
  format?: string
  
  // Performance
  duration_ms?: number
  
  // Context
  source?: 'web' | 'mobile' | 'api'
  offline_queued?: boolean
  
  // Any additional properties
  [key: string]: any
}

class TelemetryService {
  private queue: Array<{
    event: TelemetryEvent
    properties: EventProperties
    timestamp: string
  }> = []
  
  private flushInterval: NodeJS.Timeout | null = null
  private isOnline: boolean = true
  
  constructor() {
    // Listen for online/offline events
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        this.isOnline = true
        this.flush()
      })
      
      window.addEventListener('offline', () => {
        this.isOnline = false
      })
      
      // Flush queue every 30 seconds
      this.flushInterval = setInterval(() => {
        this.flush()
      }, 30000)
    }
  }
  
  async track(event: TelemetryEvent, properties: EventProperties = {}) {
    try {
      const supabase = createClient()
      
      // Get current user and workspace
      const { data: { user } } = await supabase.auth.getUser()
      
      // Get workspace from localStorage or user's default
      let workspaceId = properties.workspace_id
      if (!workspaceId && typeof localStorage !== 'undefined') {
        workspaceId = localStorage.getItem('workspace_id') || undefined
      }
      
      // Detect device type
      const device = this.getDeviceType()
      
      // Build event payload
      const eventData = {
        event_name: event,
        workspace_id: workspaceId,
        user_id: user?.id,
        properties: {
          ...properties,
          device,
          source: properties.source || 'web',
          timestamp: new Date().toISOString(),
        },
        created_at: new Date().toISOString(),
      }
      
      // If offline, queue the event
      if (!this.isOnline) {
        this.queue.push({
          event,
          properties: eventData.properties,
          timestamp: eventData.created_at,
        })
        return
      }
      
      // Try to send immediately
      await this.sendEvent(eventData)
      
    } catch (error) {
      console.error('Failed to track event:', error)
      
      // Queue for retry
      this.queue.push({
        event,
        properties,
        timestamp: new Date().toISOString(),
      })
    }
  }
  
  private async sendEvent(eventData: any) {
    const supabase = createClient()
    
    // Insert into ui_events table
    const { error } = await supabase
      .from('ui_events')
      .insert({
        event_name: eventData.event_name,
        workspace_id: eventData.workspace_id,
        entity_type: eventData.properties.entity_type,
        entity_id: eventData.properties.entity_id,
        duration_ms: eventData.properties.duration_ms,
        offline_queued: eventData.properties.offline_queued || false,
        device: eventData.properties.device,
        role: await this.getUserRole(),
        cost_method: eventData.properties.cost_method,
        form_type: eventData.properties.form_type,
      })
    
    if (error) {
      throw error
    }
  }
  
  private async getUserRole(): Promise<string | null> {
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      
      if (!user) return null
      
      const { data } = await supabase
        .from('user_workspace_roles')
        .select('role')
        .eq('user_id', user.id)
        .single()
      
      return data?.role || null
    } catch {
      return null
    }
  }
  
  private getDeviceType(): string {
    if (typeof window === 'undefined') return 'server'
    
    const width = window.innerWidth
    if (width < 640) return 'mobile'
    if (width < 1024) return 'tablet'
    return 'desktop'
  }
  
  async flush() {
    if (this.queue.length === 0 || !this.isOnline) return
    
    const events = [...this.queue]
    this.queue = []
    
    for (const event of events) {
      try {
        await this.sendEvent({
          event_name: event.event,
          properties: {
            ...event.properties,
            offline_queued: true,
          },
          created_at: event.timestamp,
        })
      } catch (error) {
        // Re-queue failed events
        this.queue.push(event)
      }
    }
  }
  
  destroy() {
    if (this.flushInterval) {
      clearInterval(this.flushInterval)
    }
    this.flush()
  }
}

// Singleton instance
let telemetryInstance: TelemetryService | null = null

export function getTelemetry(): TelemetryService {
  if (!telemetryInstance) {
    telemetryInstance = new TelemetryService()
  }
  return telemetryInstance
}

// Convenience function for tracking
export async function trackEvent(
  event: TelemetryEvent,
  properties?: EventProperties
) {
  const telemetry = getTelemetry()
  await telemetry.track(event, properties)
}

// Track page views
export function trackPageView(path: string, properties?: EventProperties) {
  // This could be expanded to track page views as well
  console.log('Page view:', path, properties)
}

// Performance tracking helper
export function trackPerformance(
  event: TelemetryEvent,
  startTime: number,
  properties?: EventProperties
) {
  const duration = Date.now() - startTime
  trackEvent(event, {
    ...properties,
    duration_ms: duration,
  })
}
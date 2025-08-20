'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js'

interface UseInventorySubscriptionOptions {
  workspaceId?: string
  itemId?: string
  locationId?: string
  onInsert?: (payload: any) => void
  onUpdate?: (payload: any) => void
  onDelete?: (payload: any) => void
}

export function useInventorySubscription({
  workspaceId,
  itemId,
  locationId,
  onInsert,
  onUpdate,
  onDelete,
}: UseInventorySubscriptionOptions = {}) {
  const [isSubscribed, setIsSubscribed] = useState(false)
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)
  const supabase = createClient()

  useEffect(() => {
    let channel: RealtimeChannel | null = null

    async function setupSubscription() {
      // Subscribe to inventory_transactions changes
      channel = supabase
        .channel('inventory-changes')
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'inventory_transactions',
            filter: workspaceId ? `workspace_id=eq.${workspaceId}` : undefined,
          },
          (payload: RealtimePostgresChangesPayload<any>) => {
            // Filter by itemId or locationId if provided
            if (itemId && payload.new?.item_id !== itemId) return
            if (locationId && 
                payload.new?.from_location_id !== locationId && 
                payload.new?.to_location_id !== locationId) return

            setLastUpdate(new Date())

            switch (payload.eventType) {
              case 'INSERT':
                onInsert?.(payload.new)
                break
              case 'UPDATE':
                onUpdate?.(payload.new)
                break
              case 'DELETE':
                onDelete?.(payload.old)
                break
            }
          }
        )

      // Subscribe to item_lots changes
      channel.on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'item_lots',
          filter: workspaceId ? `workspace_id=eq.${workspaceId}` : undefined,
        },
        (payload: RealtimePostgresChangesPayload<any>) => {
          // Filter by itemId or locationId if provided
          if (itemId && payload.new?.item_id !== itemId) return
          if (locationId && payload.new?.location_id !== locationId) return

          setLastUpdate(new Date())

          switch (payload.eventType) {
            case 'INSERT':
              onInsert?.(payload.new)
              break
            case 'UPDATE':
              onUpdate?.(payload.new)
              break
            case 'DELETE':
              onDelete?.(payload.old)
              break
          }
        }
      )

      // Subscribe to the channel
      const { error } = await channel.subscribe()
      
      if (!error) {
        setIsSubscribed(true)
      } else {
        console.error('Error subscribing to inventory changes:', error)
      }
    }

    setupSubscription()

    // Cleanup subscription on unmount
    return () => {
      if (channel) {
        supabase.removeChannel(channel)
        setIsSubscribed(false)
      }
    }
  }, [workspaceId, itemId, locationId, onInsert, onUpdate, onDelete, supabase])

  return {
    isSubscribed,
    lastUpdate,
  }
}

// Hook for subscribing to low stock alerts
export function useLowStockAlerts(workspaceId: string) {
  const [lowStockItems, setLowStockItems] = useState<any[]>([])
  const supabase = createClient()

  useEffect(() => {
    let channel: RealtimeChannel | null = null

    async function checkLowStock() {
      // Query items that are below reorder level
      const { data, error } = await supabase
        .from('inventory_on_hand_by_item_location')
        .select(`
          *,
          items!inner(
            reorder_level
          )
        `)
        .not('items.reorder_level', 'is', null)
        .lt('qty_on_hand', 'items.reorder_level')

      if (!error && data) {
        setLowStockItems(data)
      }
    }

    // Initial check
    checkLowStock()

    // Subscribe to changes that might affect stock levels
    channel = supabase
      .channel('low-stock-alerts')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'inventory_transactions',
          filter: `workspace_id=eq.${workspaceId}`,
        },
        () => {
          // Re-check low stock on any inventory transaction
          checkLowStock()
        }
      )
      .subscribe()

    return () => {
      if (channel) {
        supabase.removeChannel(channel)
      }
    }
  }, [workspaceId, supabase])

  return lowStockItems
}

// Hook for tracking inventory value changes
export function useInventoryValue(workspaceId: string) {
  const [inventoryValue, setInventoryValue] = useState<number>(0)
  const [isLoading, setIsLoading] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    let channel: RealtimeChannel | null = null

    async function fetchInventoryValue() {
      setIsLoading(true)
      const { data, error } = await supabase
        .from('inventory_value')
        .select('total_value')
        .eq('workspace_id', workspaceId)

      if (!error && data) {
        const totalValue = data.reduce((sum, item) => sum + (item.total_value || 0), 0)
        setInventoryValue(totalValue)
      }
      setIsLoading(false)
    }

    // Initial fetch
    fetchInventoryValue()

    // Subscribe to inventory changes
    channel = supabase
      .channel('inventory-value')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'inventory_transactions',
          filter: `workspace_id=eq.${workspaceId}`,
        },
        () => {
          // Refresh inventory value on any transaction
          fetchInventoryValue()
        }
      )
      .subscribe()

    return () => {
      if (channel) {
        supabase.removeChannel(channel)
      }
    }
  }, [workspaceId, supabase])

  return { inventoryValue, isLoading }
}

// Hook for listening to PO receipt events
export function usePOReceiptSubscription(
  workspaceId: string,
  onReceipt?: (receipt: any) => void
) {
  const supabase = createClient()

  useEffect(() => {
    const channel = supabase
      .channel('po-receipts')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'po_receipt_lines',
          filter: `workspace_id=eq.${workspaceId}`,
        },
        (payload) => {
          onReceipt?.(payload.new)
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [workspaceId, onReceipt, supabase])
}
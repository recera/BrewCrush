import { createClient } from '@/lib/supabase/client';
import {
  getOutboxItems,
  updateOutboxItem,
  removeFromOutbox,
  getOutboxCount,
  cleanupOldData,
} from './db';

// Exponential backoff configuration
const MAX_RETRY_COUNT = 5;
const BASE_RETRY_DELAY = 1000; // 1 second
const MAX_RETRY_DELAY = 60000; // 1 minute

export class OfflineSyncManager {
  private static instance: OfflineSyncManager | null = null;
  private isSyncing = false;
  private syncInterval: NodeJS.Timeout | null = null;
  private listeners: Set<(count: number) => void> = new Set();
  private onlineListener: (() => void) | null = null;
  private offlineListener: (() => void) | null = null;

  private constructor() {
    // Initialize network status listeners
    this.setupNetworkListeners();
    
    // Start periodic sync
    this.startPeriodicSync();
    
    // Clean up old data periodically
    this.startCleanup();
  }

  static getInstance(): OfflineSyncManager {
    if (!OfflineSyncManager.instance) {
      OfflineSyncManager.instance = new OfflineSyncManager();
    }
    return OfflineSyncManager.instance;
  }

  private setupNetworkListeners() {
    // Listen for online event
    this.onlineListener = () => {
      console.log('Network online - starting sync');
      this.sync();
    };
    
    // Listen for offline event
    this.offlineListener = () => {
      console.log('Network offline');
      this.notifyListeners();
    };
    
    window.addEventListener('online', this.onlineListener);
    window.addEventListener('offline', this.offlineListener);
  }

  private startPeriodicSync() {
    // Sync every 30 seconds if online
    this.syncInterval = setInterval(() => {
      if (navigator.onLine) {
        this.sync();
      }
    }, 30000);
  }

  private startCleanup() {
    // Clean up old data once a day
    setInterval(() => {
      cleanupOldData(7);
    }, 24 * 60 * 60 * 1000);
    
    // Also clean on startup
    cleanupOldData(7);
  }

  async sync(): Promise<void> {
    if (this.isSyncing || !navigator.onLine) {
      return;
    }

    this.isSyncing = true;

    try {
      const supabase = createClient();
      const items = await getOutboxItems(10);

      for (const item of items) {
        try {
          // Calculate retry delay with exponential backoff
          if (item.retryCount >= MAX_RETRY_COUNT) {
            // Mark as failed and skip
            await updateOutboxItem(item.id, {
              error: 'Max retries exceeded',
            });
            continue;
          }

          // Check if we should wait before retrying
          if (item.lastAttempt) {
            const retryDelay = Math.min(
              BASE_RETRY_DELAY * Math.pow(2, item.retryCount),
              MAX_RETRY_DELAY
            );
            const timeSinceLastAttempt = Date.now() - item.lastAttempt;
            
            if (timeSinceLastAttempt < retryDelay) {
              continue; // Skip this item for now
            }
          }

          // Process the operation
          const result = await this.processOperation(supabase, item);

          if (result.success) {
            // Remove from outbox on success
            await removeFromOutbox(item.id);
          } else {
            // Update retry count and error
            await updateOutboxItem(item.id, {
              retryCount: item.retryCount + 1,
              error: result.error,
            });
          }
        } catch (error) {
          console.error('Error processing outbox item:', error);
          
          await updateOutboxItem(item.id, {
            retryCount: item.retryCount + 1,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }
    } finally {
      this.isSyncing = false;
      this.notifyListeners();
    }
  }

  private async processOperation(
    supabase: any,
    item: any
  ): Promise<{ success: boolean; error?: string }> {
    try {
      switch (item.operation) {
        case 'ferm_reading.create': {
          const { error: fermError } = await supabase.rpc('log_ferm_reading', {
            ...item.payload,
            p_idempotency_key: item.idempotencyKey,
          });
          
          if (fermError) {
            // Check if it's a duplicate (already processed)
            if (fermError.message?.includes('duplicate key') || 
                fermError.message?.includes('already exists')) {
              return { success: true }; // Already processed, consider it success
            }
            return { success: false, error: fermError.message };
          }
          return { success: true };
        }

        case 'batch.update_status': {
          const { error: statusError } = await supabase.rpc('update_batch_status', {
            ...item.payload,
            p_idempotency_key: item.idempotencyKey,
          });
          
          if (statusError) {
            if (statusError.message?.includes('duplicate key')) {
              return { success: true };
            }
            return { success: false, error: statusError.message };
          }
          return { success: true };
        }

        case 'batch.consume_inventory': {
          const { error: consumeError } = await supabase.rpc('consume_batch_inventory', {
            ...item.payload,
            p_idempotency_key: item.idempotencyKey,
          });
          
          if (consumeError) {
            if (consumeError.message?.includes('duplicate key')) {
              return { success: true };
            }
            return { success: false, error: consumeError.message };
          }
          return { success: true };
        }

        case 'batch.update_measurements': {
          const { error: measureError } = await supabase
            .from('batches')
            .update({
              actual_og: item.payload.actual_og,
              actual_volume: item.payload.actual_volume,
              updated_at: new Date().toISOString(),
            })
            .eq('id', item.payload.batch_id)
            .eq('workspace_id', item.workspaceId);
          
          if (measureError) {
            return { success: false, error: measureError.message };
          }
          return { success: true };
        }

        case 'timer.complete': {
          // Timer completions are just for tracking, no server sync needed
          return { success: true };
        }

        case 'yeast.pitch': {
          const { error: pitchError } = await supabase.rpc('pitch_yeast', {
            ...item.payload,
            p_idempotency_key: item.idempotencyKey,
          });
          
          if (pitchError) {
            if (pitchError.message?.includes('duplicate key')) {
              return { success: true };
            }
            return { success: false, error: pitchError.message };
          }
          return { success: true };
        }

        case 'yeast.harvest': {
          const { error: harvestError } = await supabase.rpc('harvest_yeast', {
            ...item.payload,
            p_idempotency_key: item.idempotencyKey,
          });
          
          if (harvestError) {
            if (harvestError.message?.includes('duplicate key')) {
              return { success: true };
            }
            return { success: false, error: harvestError.message };
          }
          return { success: true };
        }

        default:
          return { success: false, error: `Unknown operation: ${item.operation}` };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  // Subscribe to outbox count changes
  subscribe(listener: (count: number) => void) {
    this.listeners.add(listener);
    // Immediately notify with current count
    this.notifyListener(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private async notifyListeners() {
    const count = await getOutboxCount();
    this.listeners.forEach(listener => listener(count));
  }

  private async notifyListener(listener: (count: number) => void) {
    const count = await getOutboxCount();
    listener(count);
  }

  // Manual sync trigger
  async forceSyncNow(): Promise<void> {
    await this.sync();
  }

  // Check if online
  isOnline(): boolean {
    return navigator.onLine;
  }

  // Cleanup
  destroy() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
    }
    
    if (this.onlineListener) {
      window.removeEventListener('online', this.onlineListener);
    }
    
    if (this.offlineListener) {
      window.removeEventListener('offline', this.offlineListener);
    }
    
    this.listeners.clear();
    OfflineSyncManager.instance = null;
  }
}

// Helper hook for React components
import { useEffect, useState } from 'react';

export function useOfflineQueue() {
  const [queueCount, setQueueCount] = useState(0);
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    const syncManager = OfflineSyncManager.getInstance();
    
    // Subscribe to queue count changes
    const unsubscribe = syncManager.subscribe(setQueueCount);
    
    // Set initial online status
    setIsOnline(syncManager.isOnline());
    
    // Listen for online/offline events
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    return () => {
      unsubscribe();
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return {
    queueCount,
    isOnline,
    forceSync: () => OfflineSyncManager.getInstance().forceSyncNow(),
  };
}
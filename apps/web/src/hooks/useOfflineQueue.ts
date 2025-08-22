import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';

interface QueueItem {
  id: string;
  type: string;
  data: any;
  timestamp: string;
  retries: number;
  lastError?: string;
}

const QUEUE_KEY = 'brewcrush_offline_queue';
const MAX_RETRIES = 3;
const RETRY_DELAY = 5000; // 5 seconds

export function useOfflineQueue() {
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [queueSize, setQueueSize] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const supabase = createClient();

  // Load queue from localStorage
  const loadQueue = useCallback((): QueueItem[] => {
    try {
      const stored = localStorage.getItem(QUEUE_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch (error) {
      console.error('Failed to load offline queue:', error);
      return [];
    }
  }, []);

  // Save queue to localStorage
  const saveQueue = useCallback((queue: QueueItem[]) => {
    try {
      localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
      setQueueSize(queue.length);
    } catch (error) {
      console.error('Failed to save offline queue:', error);
    }
  }, []);

  // Add item to queue
  const addToQueue = useCallback((item: Omit<QueueItem, 'id' | 'retries'>) => {
    const queue = loadQueue();
    const newItem: QueueItem = {
      ...item,
      id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      retries: 0,
    };
    queue.push(newItem);
    saveQueue(queue);
    toast.info(`Saved offline (${queue.length} items queued)`);
  }, [loadQueue, saveQueue]);

  // Process a single queue item
  const processQueueItem = async (item: QueueItem): Promise<boolean> => {
    try {
      switch (item.type) {
        case 'ferm_reading':
          const { error } = await supabase
            .from('ferm_readings')
            .insert(item.data);
          if (error) throw error;
          break;
          
        case 'batch_update':
          const { error: updateError } = await supabase
            .from('batches')
            .update(item.data.updates)
            .eq('id', item.data.batch_id);
          if (updateError) throw updateError;
          break;
          
        case 'inventory_transaction':
          const { error: txError } = await supabase
            .from('inventory_transactions')
            .insert(item.data);
          if (txError) throw txError;
          break;
          
        default:
          console.warn(`Unknown queue item type: ${item.type}`);
          return false;
      }
      
      return true;
    } catch (error: any) {
      console.error(`Failed to process queue item ${item.id}:`, error);
      item.lastError = error.message;
      item.retries++;
      
      if (item.retries >= MAX_RETRIES) {
        toast.error(`Failed to sync ${item.type} after ${MAX_RETRIES} attempts`);
        return false;
      }
      
      // Will retry later
      return false;
    }
  };

  // Sync queue with server
  const syncQueue = useCallback(async () => {
    if (isOffline || isSyncing) return;
    
    const queue = loadQueue();
    if (queue.length === 0) return;
    
    setIsSyncing(true);
    console.log(`Starting sync of ${queue.length} queued items`);
    
    const remaining: QueueItem[] = [];
    let successCount = 0;
    let failCount = 0;
    
    for (const item of queue) {
      const success = await processQueueItem(item);
      if (success) {
        successCount++;
      } else if (item.retries < MAX_RETRIES) {
        remaining.push(item);
        failCount++;
      } else {
        // Item has exceeded max retries, discard it
        failCount++;
      }
    }
    
    saveQueue(remaining);
    setIsSyncing(false);
    
    if (successCount > 0) {
      toast.success(`Synced ${successCount} offline items`);
    }
    
    if (failCount > 0 && remaining.length > 0) {
      // Schedule retry for failed items
      setTimeout(() => syncQueue(), RETRY_DELAY);
    }
  }, [isOffline, isSyncing, loadQueue, saveQueue]);

  // Clear the queue
  const clearQueue = useCallback(() => {
    saveQueue([]);
    toast.info('Offline queue cleared');
  }, [saveQueue]);

  // Get queue items
  const getQueueItems = useCallback((): QueueItem[] => {
    return loadQueue();
  }, [loadQueue]);

  // Monitor online/offline status
  useEffect(() => {
    const handleOnline = () => {
      setIsOffline(false);
      toast.success('Back online');
      // Sync queue when coming back online
      setTimeout(() => syncQueue(), 1000);
    };

    const handleOffline = () => {
      setIsOffline(true);
      toast.warning('You are offline. Changes will be saved locally.');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Check initial state
    setIsOffline(!navigator.onLine);
    
    // Load initial queue size
    setQueueSize(loadQueue().length);

    // Attempt initial sync if online
    if (navigator.onLine) {
      syncQueue();
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [syncQueue, loadQueue]);

  // Periodic sync attempt
  useEffect(() => {
    if (isOffline || queueSize === 0) return;
    
    const interval = setInterval(() => {
      syncQueue();
    }, 30000); // Try every 30 seconds
    
    return () => clearInterval(interval);
  }, [isOffline, queueSize, syncQueue]);

  return {
    isOffline,
    queueSize,
    isSyncing,
    addToQueue,
    syncQueue,
    clearQueue,
    getQueueItems,
  };
}
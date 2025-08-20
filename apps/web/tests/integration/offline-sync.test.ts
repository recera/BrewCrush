import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { openDB, deleteDB, IDBPDatabase } from 'idb';
import { OfflineSyncManager } from '@/lib/offline/sync';
import { BrewCrushDB } from '@/lib/offline/db';
import { createClient } from '@supabase/supabase-js';

// Mock Supabase client
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: vi.fn(),
    rpc: vi.fn(),
  })),
}));

describe('Offline Sync Integration', () => {
  let db: IDBPDatabase<BrewCrushDB>;
  let syncManager: OfflineSyncManager;
  let mockSupabase: any;

  beforeEach(async () => {
    // Clean up any existing database
    await deleteDB('brewcrush-offline');

    // Open test database
    db = await openDB<BrewCrushDB>('brewcrush-offline', 1, {
      upgrade(db) {
        // Create outbox store
        if (!db.objectStoreNames.contains('outbox')) {
          const outbox = db.createObjectStore('outbox', { keyPath: 'id' });
          outbox.createIndex('timestamp', 'timestamp');
        }

        // Create timers store
        if (!db.objectStoreNames.contains('timers')) {
          const timers = db.createObjectStore('timers', { keyPath: 'id' });
          timers.createIndex('batchId', 'batchId');
        }

        // Create brewDayState store
        if (!db.objectStoreNames.contains('brewDayState')) {
          db.createObjectStore('brewDayState', { keyPath: 'batchId' });
        }
      },
    });

    // Setup mock Supabase
    mockSupabase = {
      from: vi.fn().mockReturnThis(),
      insert: vi.fn().mockResolvedValue({ data: {}, error: null }),
      update: vi.fn().mockResolvedValue({ data: {}, error: null }),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: {}, error: null }),
      rpc: vi.fn().mockResolvedValue({ data: {}, error: null }),
    };

    // Initialize sync manager
    syncManager = OfflineSyncManager.getInstance();
  });

  afterEach(async () => {
    // Clean up
    await db.close();
    await deleteDB('brewcrush-offline');
    vi.clearAllMocks();
  });

  describe('Outbox Operations', () => {
    it('should queue operations when offline', async () => {
      // Add operation to outbox
      const operation = {
        id: 'op-1',
        operation: 'ferm_reading.create',
        payload: {
          batch_id: 'batch-1',
          sg: 1.045,
          temp: 18.5,
          ph: 5.2,
        },
        timestamp: Date.now(),
        retryCount: 0,
        idempotencyKey: 'idem-1',
      };

      await db.put('outbox', operation);

      // Verify operation is queued
      const queued = await db.get('outbox', 'op-1');
      expect(queued).toEqual(operation);

      // Check outbox count
      const count = await db.count('outbox');
      expect(count).toBe(1);
    });

    it('should process queued operations when online', async () => {
      // Queue multiple operations
      const operations = [
        {
          id: 'op-1',
          operation: 'ferm_reading.create',
          payload: { batch_id: 'batch-1', sg: 1.045 },
          timestamp: Date.now() - 2000,
          retryCount: 0,
          idempotencyKey: 'idem-1',
        },
        {
          id: 'op-2',
          operation: 'batch.update',
          payload: { id: 'batch-1', status: 'fermenting' },
          timestamp: Date.now() - 1000,
          retryCount: 0,
          idempotencyKey: 'idem-2',
        },
      ];

      for (const op of operations) {
        await db.put('outbox', op);
      }

      // Mock successful sync
      mockSupabase.from.mockImplementation((table: string) => ({
        insert: vi.fn().mockResolvedValue({ data: {}, error: null }),
        update: vi.fn().mockResolvedValue({ data: {}, error: null }),
      }));

      // Process sync
      await syncManager.sync(mockSupabase);

      // Verify outbox is cleared
      const remaining = await db.count('outbox');
      expect(remaining).toBe(0);
    });

    it('should handle idempotency correctly', async () => {
      const idempotencyKey = 'unique-key-123';
      
      // First operation
      const op1 = {
        id: 'op-1',
        operation: 'ferm_reading.create',
        payload: { batch_id: 'batch-1', sg: 1.045 },
        timestamp: Date.now(),
        retryCount: 0,
        idempotencyKey,
      };

      await db.put('outbox', op1);

      // Mock server already has this operation
      mockSupabase.from.mockImplementation(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({
          data: [{ idempotency_key: idempotencyKey }],
          error: null,
        }),
      }));

      // Sync should skip duplicate
      await syncManager.sync(mockSupabase);

      // Operation should be removed from outbox (already on server)
      const remaining = await db.get('outbox', 'op-1');
      expect(remaining).toBeUndefined();
    });

    it('should implement exponential backoff on failures', async () => {
      const operation = {
        id: 'op-1',
        operation: 'ferm_reading.create',
        payload: { batch_id: 'batch-1', sg: 1.045 },
        timestamp: Date.now(),
        retryCount: 0,
        idempotencyKey: 'idem-1',
      };

      await db.put('outbox', operation);

      // Mock failure
      mockSupabase.from.mockImplementation(() => ({
        insert: vi.fn().mockRejectedValue(new Error('Network error')),
      }));

      // First retry
      await syncManager.sync(mockSupabase);
      let updated = await db.get('outbox', 'op-1');
      expect(updated?.retryCount).toBe(1);
      expect(updated?.lastAttempt).toBeDefined();

      // Calculate expected backoff
      const backoffMs = Math.min(1000 * Math.pow(2, 1), 60000);
      const nextRetryTime = updated!.lastAttempt! + backoffMs;

      // Attempt sync before backoff period - should skip
      await syncManager.sync(mockSupabase);
      updated = await db.get('outbox', 'op-1');
      expect(updated?.retryCount).toBe(1); // Still 1, not retried yet

      // Wait for backoff period and retry
      vi.setSystemTime(nextRetryTime + 100);
      await syncManager.sync(mockSupabase);
      updated = await db.get('outbox', 'op-1');
      expect(updated?.retryCount).toBe(2);

      vi.useRealTimers();
    });

    it('should stop retrying after max attempts', async () => {
      const operation = {
        id: 'op-1',
        operation: 'ferm_reading.create',
        payload: { batch_id: 'batch-1', sg: 1.045 },
        timestamp: Date.now(),
        retryCount: 5, // Already at max
        lastAttempt: Date.now() - 120000,
        idempotencyKey: 'idem-1',
        error: 'Previous error',
      };

      await db.put('outbox', operation);

      // Mock continued failure
      mockSupabase.from.mockImplementation(() => ({
        insert: vi.fn().mockRejectedValue(new Error('Still failing')),
      }));

      await syncManager.sync(mockSupabase);

      // Should mark as permanently failed
      const updated = await db.get('outbox', 'op-1');
      expect(updated?.error).toContain('Max retries exceeded');
      expect(updated?.retryCount).toBe(5);
    });
  });

  describe('Timer Persistence', () => {
    it('should persist brew day timers', async () => {
      const timer = {
        id: 'timer-1',
        batchId: 'batch-1',
        name: 'Mash Timer',
        duration: 3600000, // 60 minutes
        startTime: Date.now(),
        isPaused: false,
        pausedTime: 0,
        completed: false,
      };

      await db.put('timers', timer);

      // Retrieve timer
      const saved = await db.get('timers', 'timer-1');
      expect(saved).toEqual(timer);

      // Get all timers for batch
      const tx = db.transaction('timers', 'readonly');
      const index = tx.objectStore('timers').index('batchId');
      const batchTimers = await index.getAll('batch-1');
      expect(batchTimers).toHaveLength(1);
    });

    it('should update timer state correctly', async () => {
      const timer = {
        id: 'timer-1',
        batchId: 'batch-1',
        name: 'Boil Timer',
        duration: 5400000, // 90 minutes
        startTime: Date.now(),
        isPaused: false,
        pausedTime: 0,
        completed: false,
      };

      await db.put('timers', timer);

      // Pause timer
      const pauseTime = Date.now() + 1000000; // 16.67 minutes later
      timer.isPaused = true;
      timer.pausedTime = pauseTime - timer.startTime;
      await db.put('timers', timer);

      const paused = await db.get('timers', 'timer-1');
      expect(paused?.isPaused).toBe(true);
      expect(paused?.pausedTime).toBeGreaterThan(0);

      // Complete timer
      timer.completed = true;
      await db.put('timers', timer);

      const completed = await db.get('timers', 'timer-1');
      expect(completed?.completed).toBe(true);
    });

    it('should clean up old completed timers', async () => {
      // Add multiple timers
      const timers = [
        {
          id: 'timer-1',
          batchId: 'batch-1',
          name: 'Timer 1',
          duration: 1000,
          startTime: Date.now() - 86400000, // 1 day ago
          completed: true,
          isPaused: false,
          pausedTime: 0,
        },
        {
          id: 'timer-2',
          batchId: 'batch-1',
          name: 'Timer 2',
          duration: 1000,
          startTime: Date.now(),
          completed: false,
          isPaused: false,
          pausedTime: 0,
        },
      ];

      for (const timer of timers) {
        await db.put('timers', timer);
      }

      // Clean up old completed timers
      const tx = db.transaction('timers', 'readwrite');
      const store = tx.objectStore('timers');
      const allTimers = await store.getAll();
      
      for (const timer of allTimers) {
        if (timer.completed && Date.now() - timer.startTime > 86400000) {
          await store.delete(timer.id);
        }
      }

      await tx.done;

      // Verify cleanup
      const remaining = await db.getAll('timers');
      expect(remaining).toHaveLength(1);
      expect(remaining[0].id).toBe('timer-2');
    });
  });

  describe('Brew Day State', () => {
    it('should persist brew day checklist state', async () => {
      const state = {
        batchId: 'batch-1',
        checklist: {
          'sanitize-equipment': true,
          'heat-water': true,
          'add-grains': false,
          'mash-in': false,
        },
        measurements: {
          actual_og: 1.055,
          actual_volume: 98,
        },
        notes: 'Mash temperature stable at 65°C',
        lastUpdated: Date.now(),
      };

      await db.put('brewDayState', state);

      const saved = await db.get('brewDayState', 'batch-1');
      expect(saved).toEqual(state);
    });

    it('should merge state updates correctly', async () => {
      // Initial state
      const initialState = {
        batchId: 'batch-1',
        checklist: {
          'sanitize-equipment': true,
        },
        measurements: {},
        lastUpdated: Date.now(),
      };

      await db.put('brewDayState', initialState);

      // Update checklist
      const current = await db.get('brewDayState', 'batch-1');
      if (current) {
        current.checklist['heat-water'] = true;
        current.lastUpdated = Date.now();
        await db.put('brewDayState', current);
      }

      // Update measurements
      const updated = await db.get('brewDayState', 'batch-1');
      if (updated) {
        updated.measurements = { actual_og: 1.053 };
        updated.lastUpdated = Date.now();
        await db.put('brewDayState', updated);
      }

      // Verify merged state
      const final = await db.get('brewDayState', 'batch-1');
      expect(final?.checklist).toEqual({
        'sanitize-equipment': true,
        'heat-water': true,
      });
      expect(final?.measurements).toEqual({
        actual_og: 1.053,
      });
    });
  });

  describe('Conflict Resolution', () => {
    it('should handle version conflicts', async () => {
      // Local change
      const localOp = {
        id: 'op-1',
        operation: 'batch.update',
        payload: {
          id: 'batch-1',
          status: 'fermenting',
          version: 1,
        },
        timestamp: Date.now(),
        retryCount: 0,
        idempotencyKey: 'idem-1',
      };

      await db.put('outbox', localOp);

      // Mock server has newer version
      mockSupabase.from.mockImplementation(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({
          data: { id: 'batch-1', status: 'conditioning', version: 2 },
          error: null,
        }),
      }));

      // Sync should detect conflict
      await syncManager.sync(mockSupabase);

      // Check for conflict marker
      const updated = await db.get('outbox', 'op-1');
      expect(updated?.error).toContain('version conflict');
    });

    it('should use last-write-wins for simple fields', async () => {
      const operations = [
        {
          id: 'op-1',
          operation: 'ferm_reading.create',
          payload: {
            batch_id: 'batch-1',
            sg: 1.045,
            temp: 18.5,
            timestamp: Date.now() - 1000,
          },
          timestamp: Date.now() - 1000,
          retryCount: 0,
          idempotencyKey: 'idem-1',
        },
        {
          id: 'op-2',
          operation: 'ferm_reading.create',
          payload: {
            batch_id: 'batch-1',
            sg: 1.044,
            temp: 18.8,
            timestamp: Date.now(),
          },
          timestamp: Date.now(),
          retryCount: 0,
          idempotencyKey: 'idem-2',
        },
      ];

      for (const op of operations) {
        await db.put('outbox', op);
      }

      // Both should sync successfully (different idempotency keys)
      mockSupabase.from.mockImplementation(() => ({
        insert: vi.fn().mockResolvedValue({ data: {}, error: null }),
      }));

      await syncManager.sync(mockSupabase);

      // Both operations should be processed
      const count = await db.count('outbox');
      expect(count).toBe(0);
    });
  });

  describe('Batch Sync', () => {
    it('should batch multiple operations efficiently', async () => {
      // Queue many operations
      const operations = [];
      for (let i = 0; i < 20; i++) {
        operations.push({
          id: `op-${i}`,
          operation: 'ferm_reading.create',
          payload: {
            batch_id: 'batch-1',
            sg: 1.045 - (i * 0.001),
            temp: 18.5,
          },
          timestamp: Date.now() - (20 - i) * 1000,
          retryCount: 0,
          idempotencyKey: `idem-${i}`,
        });
      }

      for (const op of operations) {
        await db.put('outbox', op);
      }

      // Mock batch insert
      let insertCalls = 0;
      mockSupabase.from.mockImplementation(() => ({
        insert: vi.fn((data) => {
          insertCalls++;
          // Should batch operations
          expect(Array.isArray(data)).toBe(true);
          expect(data.length).toBeGreaterThan(1);
          return Promise.resolve({ data: {}, error: null });
        }),
      }));

      await syncManager.sync(mockSupabase);

      // Should batch operations (fewer calls than operations)
      expect(insertCalls).toBeLessThan(operations.length);
    });

    it('should respect operation order within batches', async () => {
      const operations = [
        {
          id: 'op-1',
          operation: 'batch.create',
          payload: { id: 'batch-1' },
          timestamp: Date.now() - 3000,
          retryCount: 0,
          idempotencyKey: 'idem-1',
        },
        {
          id: 'op-2',
          operation: 'batch.update',
          payload: { id: 'batch-1', status: 'brewing' },
          timestamp: Date.now() - 2000,
          retryCount: 0,
          idempotencyKey: 'idem-2',
        },
        {
          id: 'op-3',
          operation: 'batch.update',
          payload: { id: 'batch-1', status: 'fermenting' },
          timestamp: Date.now() - 1000,
          retryCount: 0,
          idempotencyKey: 'idem-3',
        },
      ];

      for (const op of operations) {
        await db.put('outbox', op);
      }

      const processedOps: any[] = [];
      mockSupabase.from.mockImplementation(() => ({
        insert: vi.fn((data) => {
          processedOps.push(data);
          return Promise.resolve({ data: {}, error: null });
        }),
        update: vi.fn((data) => {
          processedOps.push(data);
          return Promise.resolve({ data: {}, error: null });
        }),
      }));

      await syncManager.sync(mockSupabase);

      // Verify operations were processed in timestamp order
      expect(processedOps.length).toBe(3);
      // Create should be first
      expect(processedOps[0].id).toBe('batch-1');
    });
  });

  describe('Network Detection', () => {
    it('should detect online/offline status', async () => {
      // Mock navigator.onLine
      Object.defineProperty(navigator, 'onLine', {
        writable: true,
        value: false,
      });

      expect(syncManager.isOnline()).toBe(false);

      // Go online
      Object.defineProperty(navigator, 'onLine', {
        value: true,
      });

      expect(syncManager.isOnline()).toBe(true);
    });

    it('should auto-sync when coming online', async () => {
      // Queue operation while offline
      const operation = {
        id: 'op-1',
        operation: 'ferm_reading.create',
        payload: { batch_id: 'batch-1', sg: 1.045 },
        timestamp: Date.now(),
        retryCount: 0,
        idempotencyKey: 'idem-1',
      };

      await db.put('outbox', operation);

      // Mock successful sync
      mockSupabase.from.mockImplementation(() => ({
        insert: vi.fn().mockResolvedValue({ data: {}, error: null }),
      }));

      // Simulate online event
      const onlineEvent = new Event('online');
      window.dispatchEvent(onlineEvent);

      // Wait for auto-sync
      await new Promise(resolve => setTimeout(resolve, 100));

      // Operation should be synced
      const remaining = await db.count('outbox');
      expect(remaining).toBe(0);
    });
  });
});
import { openDB, DBSchema, IDBPDatabase } from 'idb';

// Define the schema for our IndexedDB
export interface BrewCrushDB extends DBSchema {
  outbox: {
    key: string;
    value: {
      id: string;
      operation: string;
      payload: any;
      timestamp: number;
      retryCount: number;
      lastAttempt?: number;
      error?: string;
      idempotencyKey: string;
      workspaceId: string;
      userId: string;
    };
    indexes: {
      'by-timestamp': number;
      'by-workspace': string;
      'by-operation': string;
    };
  };
  timers: {
    key: string;
    value: {
      id: string;
      batchId: string;
      name: string;
      startTime: number;
      duration: number; // in seconds
      isPaused: boolean;
      pausedAt?: number;
      remainingTime?: number;
      completed: boolean;
    };
    indexes: {
      'by-batch': string;
    };
  };
  cache: {
    key: string;
    value: {
      key: string;
      data: any;
      timestamp: number;
      expiresAt?: number;
    };
    indexes: {
      'by-expiry': number;
    };
  };
  brewDayState: {
    key: string;
    value: {
      batchId: string;
      currentStep: number;
      completedSteps: string[];
      measurements: Record<string, any>;
      notes: string[];
      startedAt: number;
      lastUpdated: number;
    };
  };
}

const DB_NAME = 'brewcrush-offline';
const DB_VERSION = 1;

let dbInstance: IDBPDatabase<BrewCrushDB> | null = null;

export async function getDB(): Promise<IDBPDatabase<BrewCrushDB>> {
  if (dbInstance) return dbInstance;

  dbInstance = await openDB<BrewCrushDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      // Create outbox store for offline operations
      if (!db.objectStoreNames.contains('outbox')) {
        const outboxStore = db.createObjectStore('outbox', {
          keyPath: 'id',
        });
        outboxStore.createIndex('by-timestamp', 'timestamp');
        outboxStore.createIndex('by-workspace', 'workspaceId');
        outboxStore.createIndex('by-operation', 'operation');
      }

      // Create timers store for brew day timers
      if (!db.objectStoreNames.contains('timers')) {
        const timerStore = db.createObjectStore('timers', {
          keyPath: 'id',
        });
        timerStore.createIndex('by-batch', 'batchId');
      }

      // Create cache store for temporary data
      if (!db.objectStoreNames.contains('cache')) {
        const cacheStore = db.createObjectStore('cache', {
          keyPath: 'key',
        });
        cacheStore.createIndex('by-expiry', 'expiresAt');
      }

      // Create brew day state store
      if (!db.objectStoreNames.contains('brewDayState')) {
        db.createObjectStore('brewDayState', {
          keyPath: 'batchId',
        });
      }
    },
  });

  return dbInstance;
}

// Outbox operations
export async function addToOutbox(operation: {
  operation: string;
  payload: any;
  workspaceId: string;
  userId: string;
}) {
  const db = await getDB();
  const id = crypto.randomUUID();
  const idempotencyKey = `${operation.operation}-${Date.now()}-${id}`;
  
  await db.add('outbox', {
    id,
    ...operation,
    timestamp: Date.now(),
    retryCount: 0,
    idempotencyKey,
  });
  
  return id;
}

export async function getOutboxItems(limit = 10) {
  const db = await getDB();
  const tx = db.transaction('outbox', 'readonly');
  const index = tx.store.index('by-timestamp');
  
  return await index.getAll(undefined, limit);
}

export async function updateOutboxItem(id: string, updates: Partial<BrewCrushDB['outbox']['value']>) {
  const db = await getDB();
  const item = await db.get('outbox', id);
  
  if (item) {
    await db.put('outbox', {
      ...item,
      ...updates,
      lastAttempt: Date.now(),
    });
  }
}

export async function removeFromOutbox(id: string) {
  const db = await getDB();
  await db.delete('outbox', id);
}

export async function getOutboxCount() {
  const db = await getDB();
  return await db.count('outbox');
}

// Timer operations
export async function saveTimer(timer: BrewCrushDB['timers']['value']) {
  const db = await getDB();
  await db.put('timers', timer);
}

export async function getTimersByBatch(batchId: string) {
  const db = await getDB();
  const index = db.transaction('timers').store.index('by-batch');
  return await index.getAll(batchId);
}

export async function updateTimer(id: string, updates: Partial<BrewCrushDB['timers']['value']>) {
  const db = await getDB();
  const timer = await db.get('timers', id);
  
  if (timer) {
    await db.put('timers', {
      ...timer,
      ...updates,
    });
  }
}

export async function deleteTimer(id: string) {
  const db = await getDB();
  await db.delete('timers', id);
}

// Brew day state operations
export async function saveBrewDayState(state: BrewCrushDB['brewDayState']['value']) {
  const db = await getDB();
  await db.put('brewDayState', {
    ...state,
    lastUpdated: Date.now(),
  });
}

export async function getBrewDayState(batchId: string) {
  const db = await getDB();
  return await db.get('brewDayState', batchId);
}

export async function clearBrewDayState(batchId: string) {
  const db = await getDB();
  await db.delete('brewDayState', batchId);
}

// Cache operations
export async function cacheData(key: string, data: any, ttlSeconds?: number) {
  const db = await getDB();
  const timestamp = Date.now();
  const expiresAt = ttlSeconds ? timestamp + (ttlSeconds * 1000) : undefined;
  
  await db.put('cache', {
    key,
    data,
    timestamp,
    expiresAt,
  });
}

export async function getCachedData(key: string) {
  const db = await getDB();
  const cached = await db.get('cache', key);
  
  if (!cached) return null;
  
  // Check if expired
  if (cached.expiresAt && cached.expiresAt < Date.now()) {
    await db.delete('cache', key);
    return null;
  }
  
  return cached.data;
}

export async function clearExpiredCache() {
  const db = await getDB();
  const tx = db.transaction('cache', 'readwrite');
  const index = tx.store.index('by-expiry');
  const now = Date.now();
  
  const expired = await index.getAllKeys(IDBKeyRange.upperBound(now));
  for (const key of expired) {
    await tx.store.delete(key);
  }
}

// Cleanup function
export async function cleanupOldData(daysToKeep = 7) {
  const db = await getDB();
  const cutoff = Date.now() - (daysToKeep * 24 * 60 * 60 * 1000);
  
  // Clean old outbox items
  const outboxTx = db.transaction('outbox', 'readwrite');
  const outboxIndex = outboxTx.store.index('by-timestamp');
  const oldOutboxKeys = await outboxIndex.getAllKeys(IDBKeyRange.upperBound(cutoff));
  for (const key of oldOutboxKeys) {
    await outboxTx.store.delete(key);
  }
  
  // Clean expired cache
  await clearExpiredCache();
  
  // Clean old completed timers
  const timerTx = db.transaction('timers', 'readwrite');
  const allTimers = await timerTx.store.getAll();
  for (const timer of allTimers) {
    if (timer.completed && timer.startTime < cutoff) {
      await timerTx.store.delete(timer.id);
    }
  }
}
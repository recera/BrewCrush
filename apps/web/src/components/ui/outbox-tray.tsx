'use client';

import { useState, useEffect } from 'react';
import { useOfflineQueue } from '@/lib/offline/sync';
import { getOutboxItems, removeFromOutbox, updateOutboxItem } from '@/lib/offline/db';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  CloudOffIcon, 
  WifiOff, 
  RefreshCw, 
  AlertCircle, 
  CheckCircle2,
  Clock,
  X,
  ChevronDown,
  ChevronUp,
  Download
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface OutboxItem {
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
}

export function OutboxTray() {
  const { queueCount, isOnline, forceSync } = useOfflineQueue();
  const [isOpen, setIsOpen] = useState(false);
  const [items, setItems] = useState<OutboxItem[]>([]);
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [isSyncing, setIsSyncing] = useState(false);

  // Load outbox items when tray opens
  useEffect(() => {
    if (isOpen) {
      loadItems();
      const interval = setInterval(loadItems, 2000);
      return () => clearInterval(interval);
    }
  }, [isOpen]);

  const loadItems = async () => {
    try {
      const outboxItems = await getOutboxItems(100);
      setItems(outboxItems);
    } catch (error) {
      console.error('Failed to load outbox items:', error);
    }
  };

  const handleSync = async () => {
    setIsSyncing(true);
    try {
      await forceSync();
      toast.success('Sync completed');
      await loadItems();
    } catch (error) {
      toast.error('Sync failed');
    } finally {
      setIsSyncing(false);
    }
  };

  const handleRetry = async (item: OutboxItem) => {
    await updateOutboxItem(item.id, { retryCount: 0, error: undefined });
    await handleSync();
  };

  const handleRemove = async (item: OutboxItem) => {
    if (confirm('Remove this item from the queue? This action cannot be undone.')) {
      await removeFromOutbox(item.id);
      await loadItems();
      toast.info('Item removed from queue');
    }
  };

  const toggleExpanded = (id: string) => {
    const newExpanded = new Set(expandedItems);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedItems(newExpanded);
  };

  const exportErrors = () => {
    const errorItems = items.filter(item => item.error);
    const csv = [
      'Timestamp,Operation,Error,Retry Count,Payload',
      ...errorItems.map(item => 
        `"${new Date(item.timestamp).toISOString()}","${item.operation}","${item.error || ''}","${item.retryCount}","${JSON.stringify(item.payload).replace(/"/g, '""')}"`
      )
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `brewcrush-sync-errors-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const getOperationLabel = (operation: string) => {
    const labels: Record<string, string> = {
      'ferm_reading.create': 'Fermentation Reading',
      'batch.update_status': 'Update Batch Status',
      'batch.consume_inventory': 'Consume Inventory',
      'batch.update_measurements': 'Update Measurements',
      'yeast.pitch': 'Pitch Yeast',
      'yeast.harvest': 'Harvest Yeast',
      'packaging.create_run': 'Create Packaging Run',
      'inventory.adjust': 'Adjust Inventory',
      'timer.complete': 'Timer Completed',
    };
    return labels[operation] || operation;
  };

  const getRetryTime = (item: OutboxItem) => {
    if (!item.lastAttempt) return 'Not attempted';
    const baseDelay = 1000;
    const maxDelay = 60000;
    const retryDelay = Math.min(baseDelay * Math.pow(2, item.retryCount), maxDelay);
    const nextRetry = item.lastAttempt + retryDelay;
    const remaining = Math.max(0, nextRetry - Date.now());
    
    if (remaining === 0) return 'Ready to retry';
    if (remaining < 60000) return `Retry in ${Math.round(remaining / 1000)}s`;
    return `Retry in ${Math.round(remaining / 60000)}m`;
  };

  if (queueCount === 0 && isOnline) {
    return null;
  }

  return (
    <>
      {/* Offline Banner */}
      {!isOnline && (
        <div 
          className="fixed top-0 left-0 right-0 z-50 bg-orange-500 text-white px-4 py-2 text-center"
          role="alert"
          aria-live="polite"
        >
          <div className="flex items-center justify-center gap-2">
            <WifiOff className="h-4 w-4" aria-hidden="true" />
            <span>You're offline. Changes will sync when connection is restored.</span>
          </div>
        </div>
      )}

      {/* Outbox Tray Trigger */}
      <Sheet open={isOpen} onOpenChange={setIsOpen}>
        <SheetTrigger asChild>
          <Button
            variant={queueCount > 0 ? "default" : "outline"}
            size="sm"
            className={cn(
              "fixed bottom-4 right-4 z-40",
              queueCount > 0 && "animate-pulse"
            )}
            aria-label={`Offline queue: ${queueCount} items`}
          >
            <CloudOffIcon className="h-4 w-4 mr-2" aria-hidden="true" />
            {queueCount > 0 ? (
              <span>
                {queueCount} queued
              </span>
            ) : (
              <span>Offline mode</span>
            )}
          </Button>
        </SheetTrigger>

        <SheetContent className="w-[400px] sm:w-[540px]">
          <SheetHeader>
            <SheetTitle className="flex items-center justify-between">
              <span>Offline Queue</span>
              <div className="flex items-center gap-2">
                {items.some(item => item.error) && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={exportErrors}
                    aria-label="Export errors as CSV"
                  >
                    <Download className="h-4 w-4 mr-1" />
                    Export Errors
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSync}
                  disabled={!isOnline || isSyncing}
                  aria-label="Force sync now"
                >
                  <RefreshCw className={cn("h-4 w-4 mr-1", isSyncing && "animate-spin")} />
                  Sync Now
                </Button>
              </div>
            </SheetTitle>
          </SheetHeader>

          <div className="mt-4 space-y-4">
            {/* Connection Status */}
            <Alert className={isOnline ? "border-green-500" : "border-orange-500"}>
              <AlertDescription className="flex items-center gap-2">
                {isOnline ? (
                  <>
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                    Connected - Actions will sync automatically
                  </>
                ) : (
                  <>
                    <WifiOff className="h-4 w-4 text-orange-500" />
                    Offline - Actions queued for later
                  </>
                )}
              </AlertDescription>
            </Alert>

            {/* Queue Items */}
            <ScrollArea className="h-[calc(100vh-200px)]">
              {items.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <CloudOffIcon className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p>No items in queue</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {items.map((item) => (
                    <div
                      key={item.id}
                      className={cn(
                        "border rounded-lg p-3",
                        item.error && "border-red-500 bg-red-50"
                      )}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm">
                              {getOperationLabel(item.operation)}
                            </span>
                            {item.retryCount > 0 && (
                              <Badge variant="secondary" className="text-xs">
                                Retry {item.retryCount}
                              </Badge>
                            )}
                            {item.error && (
                              <Badge variant="destructive" className="text-xs">
                                Failed
                              </Badge>
                            )}
                          </div>
                          
                          <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                            <Clock className="h-3 w-3" />
                            {new Date(item.timestamp).toLocaleString()}
                            {item.lastAttempt && (
                              <span className="ml-2">• {getRetryTime(item)}</span>
                            )}
                          </div>

                          {item.error && (
                            <Alert className="mt-2 p-2" variant="destructive">
                              <AlertCircle className="h-3 w-3" />
                              <AlertDescription className="text-xs ml-1">
                                {item.error}
                              </AlertDescription>
                            </Alert>
                          )}
                        </div>

                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => toggleExpanded(item.id)}
                            aria-label={expandedItems.has(item.id) ? "Collapse details" : "Expand details"}
                          >
                            {expandedItems.has(item.id) ? (
                              <ChevronUp className="h-4 w-4" />
                            ) : (
                              <ChevronDown className="h-4 w-4" />
                            )}
                          </Button>
                          
                          {item.error && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleRetry(item)}
                              aria-label="Retry this action"
                            >
                              <RefreshCw className="h-4 w-4" />
                            </Button>
                          )}
                          
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleRemove(item)}
                            aria-label="Remove from queue"
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>

                      {/* Expanded Details */}
                      {expandedItems.has(item.id) && (
                        <div className="mt-3 pt-3 border-t">
                          <pre className="text-xs bg-muted p-2 rounded overflow-x-auto">
                            {JSON.stringify(item.payload, null, 2)}
                          </pre>
                          <div className="mt-2 text-xs text-muted-foreground">
                            <div>ID: {item.id}</div>
                            <div>Idempotency Key: {item.idempotencyKey}</div>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
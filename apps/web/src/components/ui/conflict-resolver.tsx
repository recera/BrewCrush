'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  AlertTriangle, 
  RefreshCw, 
  CheckCircle, 
  XCircle,
  GitBranch,
  Database,
  Package
} from 'lucide-react';
import { toast } from 'sonner';
import { removeFromOutbox, updateOutboxItem } from '@/lib/offline/db';

export interface ConflictData {
  id: string;
  type: 'data_conflict' | 'resource_constraint' | 'version_mismatch';
  operation: string;
  localData: any;
  serverData?: any;
  constraintDetails?: string;
  suggestions?: string[];
  timestamp: number;
}

interface ConflictResolverProps {
  conflict: ConflictData | null;
  onResolve: (resolution: 'local' | 'server' | 'merge' | 'retry' | 'discard') => Promise<void>;
  onDismiss: () => void;
}

export function ConflictResolver({ conflict, onResolve, onDismiss }: ConflictResolverProps) {
  const [selectedResolution, setSelectedResolution] = useState<string>('');
  const [isResolving, setIsResolving] = useState(false);
  const [mergedData, setMergedData] = useState<any>(null);

  useEffect(() => {
    if (conflict?.type === 'data_conflict' && conflict.localData && conflict.serverData) {
      // Auto-generate a merge suggestion
      const merged = generateMergeSuggestion(conflict.localData, conflict.serverData);
      setMergedData(merged);
    }
  }, [conflict]);

  const generateMergeSuggestion = (local: any, server: any) => {
    // Simple merge strategy: prefer newer timestamps, combine arrays
    const merged = { ...server };
    
    Object.keys(local).forEach(key => {
      if (key === 'updated_at' || key === 'timestamp') {
        // Use the newer timestamp
        merged[key] = new Date(local[key]) > new Date(server[key]) ? local[key] : server[key];
      } else if (Array.isArray(local[key]) && Array.isArray(server[key])) {
        // Combine arrays and deduplicate
        merged[key] = [...new Set([...server[key], ...local[key]])];
      } else if (local[key] !== server[key]) {
        // For other conflicts, prefer local changes (user's intent)
        merged[key] = local[key];
      }
    });
    
    return merged;
  };

  const handleResolve = async () => {
    if (!selectedResolution) {
      toast.error('Please select a resolution strategy');
      return;
    }

    setIsResolving(true);
    try {
      await onResolve(selectedResolution as any);
      toast.success('Conflict resolved successfully');
    } catch (error) {
      toast.error('Failed to resolve conflict');
      console.error('Conflict resolution error:', error);
    } finally {
      setIsResolving(false);
    }
  };

  const getConflictIcon = () => {
    switch (conflict?.type) {
      case 'data_conflict':
        return <GitBranch className="h-5 w-5" />;
      case 'resource_constraint':
        return <Package className="h-5 w-5" />;
      case 'version_mismatch':
        return <Database className="h-5 w-5" />;
      default:
        return <AlertTriangle className="h-5 w-5" />;
    }
  };

  const getConflictTitle = () => {
    switch (conflict?.type) {
      case 'data_conflict':
        return 'Data Conflict Detected';
      case 'resource_constraint':
        return 'Resource Constraint';
      case 'version_mismatch':
        return 'Version Mismatch';
      default:
        return 'Sync Conflict';
    }
  };

  const getConflictDescription = () => {
    switch (conflict?.type) {
      case 'data_conflict':
        return 'The data you tried to sync has been modified by another user or device. Choose how to resolve this conflict.';
      case 'resource_constraint':
        return conflict?.constraintDetails || 'The operation cannot be completed due to insufficient resources.';
      case 'version_mismatch':
        return 'The local version is out of sync with the server. Please review and choose how to proceed.';
      default:
        return 'A conflict was detected while syncing your changes.';
    }
  };

  if (!conflict) return null;

  return (
    <Dialog open={!!conflict} onOpenChange={() => !isResolving && onDismiss()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {getConflictIcon()}
            {getConflictTitle()}
          </DialogTitle>
          <DialogDescription>
            {getConflictDescription()}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Conflict Details */}
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              <div className="space-y-1">
                <div className="font-medium">Operation: {conflict.operation}</div>
                <div className="text-sm text-muted-foreground">
                  Occurred at: {new Date(conflict.timestamp).toLocaleString()}
                </div>
              </div>
            </AlertDescription>
          </Alert>

          {/* Suggestions */}
          {conflict.suggestions && conflict.suggestions.length > 0 && (
            <Alert className="border-blue-500 bg-blue-50">
              <AlertDescription>
                <div className="font-medium mb-1">Suggestions:</div>
                <ul className="list-disc list-inside text-sm space-y-1">
                  {conflict.suggestions.map((suggestion, index) => (
                    <li key={index}>{suggestion}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {/* Resolution Options */}
          {conflict.type === 'data_conflict' ? (
            <Tabs defaultValue="options" className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="options">Resolution Options</TabsTrigger>
                <TabsTrigger value="compare">Compare Data</TabsTrigger>
              </TabsList>
              
              <TabsContent value="options" className="space-y-4">
                <RadioGroup value={selectedResolution} onValueChange={setSelectedResolution}>
                  <div className="space-y-3">
                    <div className="flex items-start space-x-3">
                      <RadioGroupItem value="local" id="local" />
                      <div className="space-y-1">
                        <Label htmlFor="local" className="font-medium">
                          Keep My Changes
                        </Label>
                        <p className="text-sm text-muted-foreground">
                          Override the server data with your local changes
                        </p>
                      </div>
                    </div>
                    
                    <div className="flex items-start space-x-3">
                      <RadioGroupItem value="server" id="server" />
                      <div className="space-y-1">
                        <Label htmlFor="server" className="font-medium">
                          Keep Server Changes
                        </Label>
                        <p className="text-sm text-muted-foreground">
                          Discard your local changes and use the server version
                        </p>
                      </div>
                    </div>
                    
                    {mergedData && (
                      <div className="flex items-start space-x-3">
                        <RadioGroupItem value="merge" id="merge" />
                        <div className="space-y-1">
                          <Label htmlFor="merge" className="font-medium">
                            Merge Changes
                            <Badge variant="secondary" className="ml-2">Recommended</Badge>
                          </Label>
                          <p className="text-sm text-muted-foreground">
                            Combine both versions intelligently
                          </p>
                        </div>
                      </div>
                    )}
                    
                    <div className="flex items-start space-x-3">
                      <RadioGroupItem value="retry" id="retry" />
                      <div className="space-y-1">
                        <Label htmlFor="retry" className="font-medium">
                          Retry Later
                        </Label>
                        <p className="text-sm text-muted-foreground">
                          Keep in queue and retry when conditions might be better
                        </p>
                      </div>
                    </div>
                    
                    <div className="flex items-start space-x-3">
                      <RadioGroupItem value="discard" id="discard" />
                      <div className="space-y-1">
                        <Label htmlFor="discard" className="font-medium">
                          Discard Operation
                        </Label>
                        <p className="text-sm text-muted-foreground text-red-600">
                          Remove from queue permanently (cannot be undone)
                        </p>
                      </div>
                    </div>
                  </div>
                </RadioGroup>
              </TabsContent>
              
              <TabsContent value="compare" className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <h4 className="font-medium mb-2">Your Local Changes</h4>
                    <ScrollArea className="h-48 border rounded p-2">
                      <pre className="text-xs">
                        {JSON.stringify(conflict.localData, null, 2)}
                      </pre>
                    </ScrollArea>
                  </div>
                  
                  <div>
                    <h4 className="font-medium mb-2">Server Version</h4>
                    <ScrollArea className="h-48 border rounded p-2">
                      <pre className="text-xs">
                        {JSON.stringify(conflict.serverData || {}, null, 2)}
                      </pre>
                    </ScrollArea>
                  </div>
                </div>
                
                {mergedData && (
                  <div>
                    <h4 className="font-medium mb-2">
                      Proposed Merge
                      <Badge variant="secondary" className="ml-2">Auto-generated</Badge>
                    </h4>
                    <ScrollArea className="h-48 border rounded p-2">
                      <pre className="text-xs">
                        {JSON.stringify(mergedData, null, 2)}
                      </pre>
                    </ScrollArea>
                  </div>
                )}
              </TabsContent>
            </Tabs>
          ) : (
            <RadioGroup value={selectedResolution} onValueChange={setSelectedResolution}>
              <div className="space-y-3">
                <div className="flex items-start space-x-3">
                  <RadioGroupItem value="retry" id="retry" />
                  <div className="space-y-1">
                    <Label htmlFor="retry" className="font-medium">
                      Retry Operation
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      Try again with current conditions
                    </p>
                  </div>
                </div>
                
                <div className="flex items-start space-x-3">
                  <RadioGroupItem value="discard" id="discard" />
                  <div className="space-y-1">
                    <Label htmlFor="discard" className="font-medium">
                      Discard Operation
                    </Label>
                    <p className="text-sm text-muted-foreground text-red-600">
                      Remove from queue permanently
                    </p>
                  </div>
                </div>
              </div>
            </RadioGroup>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={onDismiss}
            disabled={isResolving}
          >
            Cancel
          </Button>
          <Button
            onClick={handleResolve}
            disabled={!selectedResolution || isResolving}
          >
            {isResolving && <RefreshCw className="mr-2 h-4 w-4 animate-spin" />}
            {selectedResolution === 'discard' ? 'Discard' : 'Apply Resolution'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
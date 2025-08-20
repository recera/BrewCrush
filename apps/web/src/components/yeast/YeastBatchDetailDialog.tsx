'use client';

import { useQuery } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@brewcrush/ui';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@brewcrush/ui';
import { Badge } from '@brewcrush/ui';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@brewcrush/ui';
import { ScrollArea } from '@brewcrush/ui';
import { 
  Microscope,
  Calendar,
  Activity,
  Package,
  AlertCircle,
  CheckCircle,
  Clock,
  FlaskConical,
  TrendingUp,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { formatDate, formatDateTime, getDaysBetween } from '@/lib/utils';

interface YeastBatchWithDetails {
  id: string;
  strain_id: string;
  source: 'lab' | 'harvest' | 'bank';
  generation: number;
  pitch_at?: string;
  harvest_at?: string;
  viability_notes?: string;
  notes?: string;
  created_at: string;
  strain?: {
    id: string;
    name: string;
    lab_source?: string;
    type: string;
    attenuation_min?: number;
    attenuation_max?: number;
    temperature_min?: number;
    temperature_max?: number;
    flocculation?: string;
    recommended_max_generation?: number;
  };
  batches?: Array<{
    id: string;
    batch_number: string;
    status: string;
    recipe_name?: string;
    tank?: {
      name: string;
    };
  }>;
}

interface YeastBatchDetailDialogProps {
  yeastBatch: YeastBatchWithDetails;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRefresh?: () => void;
}

export function YeastBatchDetailDialog({
  yeastBatch,
  open,
  onOpenChange,
  onRefresh,
}: YeastBatchDetailDialogProps) {
  const supabase = createClient();

  // Fetch yeast batch history
  const { data: history } = useQuery({
    queryKey: ['yeast-batch-history', yeastBatch.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('audit_logs')
        .select('*')
        .eq('entity_table', 'yeast_batches')
        .eq('entity_id', yeastBatch.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data;
    },
    enabled: open,
  });

  const getGenerationStatus = () => {
    const maxGen = yeastBatch.strain?.recommended_max_generation || 10;
    const percentage = (yeastBatch.generation / maxGen) * 100;
    
    if (percentage >= 90) {
      return { color: 'text-red-600', icon: <AlertCircle className="h-4 w-4" />, label: 'Near Max' };
    } else if (percentage >= 70) {
      return { color: 'text-yellow-600', icon: <AlertCircle className="h-4 w-4" />, label: 'Caution' };
    }
    return { color: 'text-green-600', icon: <CheckCircle className="h-4 w-4" />, label: 'Good' };
  };

  const getViabilityBadge = () => {
    if (!yeastBatch.viability_notes) return null;
    
    const viabilityLower = yeastBatch.viability_notes.toLowerCase();
    if (viabilityLower.includes('high') || viabilityLower.includes('excellent')) {
      return <Badge className="bg-green-500">High Viability</Badge>;
    } else if (viabilityLower.includes('medium') || viabilityLower.includes('moderate')) {
      return <Badge className="bg-yellow-500">Medium Viability</Badge>;
    } else if (viabilityLower.includes('low') || viabilityLower.includes('poor')) {
      return <Badge className="bg-red-500">Low Viability</Badge>;
    }
    return <Badge variant="outline">{yeastBatch.viability_notes}</Badge>;
  };

  const generationStatus = getGenerationStatus();
  const daysSincePitch = yeastBatch.pitch_at ? getDaysBetween(yeastBatch.pitch_at) : null;
  const daysSinceHarvest = yeastBatch.harvest_at ? getDaysBetween(yeastBatch.harvest_at) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh]">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="text-2xl">{yeastBatch.strain?.name}</DialogTitle>
              <DialogDescription className="flex items-center gap-4 mt-2">
                <span>Generation {yeastBatch.generation}</span>
                {yeastBatch.strain?.lab_source && (
                  <span>{yeastBatch.strain.lab_source}</span>
                )}
                {getViabilityBadge()}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <Tabs defaultValue="overview" className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="lifecycle">Lifecycle</TabsTrigger>
            <TabsTrigger value="strain">Strain Info</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>

          <ScrollArea className="h-[450px] mt-4">
            <TabsContent value="overview" className="space-y-4">
              {/* Status Card */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Current Status</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm text-muted-foreground">Status</p>
                      <p className="font-medium">
                        {yeastBatch.harvest_at ? 'Harvested' : 
                         yeastBatch.pitch_at ? 'Active' : 'Ready'}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Source</p>
                      <p className="font-medium capitalize">{yeastBatch.source}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Generation</p>
                      <div className={`font-medium flex items-center gap-1 ${generationStatus.color}`}>
                        {generationStatus.icon}
                        <span>
                          {yeastBatch.generation} / {yeastBatch.strain?.recommended_max_generation || 10}
                        </span>
                        <Badge variant="outline" className="ml-2 text-xs">
                          {generationStatus.label}
                        </Badge>
                      </div>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Created</p>
                      <p className="font-medium">{formatDate(yeastBatch.created_at)}</p>
                    </div>
                  </div>

                  {yeastBatch.viability_notes && (
                    <div className="mt-4 pt-4 border-t">
                      <p className="text-sm text-muted-foreground mb-1">Viability Notes</p>
                      <p className="text-sm">{yeastBatch.viability_notes}</p>
                    </div>
                  )}

                  {yeastBatch.notes && (
                    <div className="mt-4 pt-4 border-t">
                      <p className="text-sm text-muted-foreground mb-1">Notes</p>
                      <p className="text-sm">{yeastBatch.notes}</p>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Age Warnings */}
              {daysSinceHarvest && daysSinceHarvest > 14 && (
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    This yeast was harvested {daysSinceHarvest} days ago. 
                    Consider performing a viability test before use.
                  </AlertDescription>
                </Alert>
              )}

              {/* Associated Batches */}
              {yeastBatch.batches && yeastBatch.batches.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Associated Batches</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {yeastBatch.batches.map((batch) => (
                        <div
                          key={batch.id}
                          className="flex items-center justify-between py-2 border-b last:border-0"
                        >
                          <div>
                            <p className="font-medium">{batch.batch_number}</p>
                            <p className="text-sm text-muted-foreground">
                              {batch.recipe_name} • {batch.tank?.name}
                            </p>
                          </div>
                          <Badge variant="outline">{batch.status}</Badge>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="lifecycle" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Yeast Lifecycle</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {/* Created */}
                    <div className="flex items-start gap-3">
                      <div className="mt-1">
                        <Microscope className="h-4 w-4 text-blue-500" />
                      </div>
                      <div className="flex-1">
                        <p className="font-medium">Created</p>
                        <p className="text-sm text-muted-foreground">
                          {formatDateTime(yeastBatch.created_at)}
                        </p>
                        <p className="text-sm">
                          Source: {yeastBatch.source}, Generation {yeastBatch.generation}
                        </p>
                      </div>
                    </div>

                    {/* Pitched */}
                    {yeastBatch.pitch_at ? (
                      <div className="flex items-start gap-3">
                        <div className="mt-1">
                          <FlaskConical className="h-4 w-4 text-amber-500" />
                        </div>
                        <div className="flex-1">
                          <p className="font-medium">Pitched</p>
                          <p className="text-sm text-muted-foreground">
                            {formatDateTime(yeastBatch.pitch_at)}
                            {daysSincePitch && (
                              <span className="ml-2">({daysSincePitch} days ago)</span>
                            )}
                          </p>
                          {yeastBatch.batches?.[0] && (
                            <p className="text-sm">
                              Into batch: {yeastBatch.batches[0].batch_number}
                            </p>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start gap-3 opacity-50">
                        <div className="mt-1">
                          <FlaskConical className="h-4 w-4 text-gray-400" />
                        </div>
                        <div className="flex-1">
                          <p className="font-medium">Not Yet Pitched</p>
                          <p className="text-sm text-muted-foreground">
                            Awaiting use
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Harvested */}
                    {yeastBatch.harvest_at ? (
                      <div className="flex items-start gap-3">
                        <div className="mt-1">
                          <Package className="h-4 w-4 text-green-500" />
                        </div>
                        <div className="flex-1">
                          <p className="font-medium">Harvested</p>
                          <p className="text-sm text-muted-foreground">
                            {formatDateTime(yeastBatch.harvest_at)}
                            {daysSinceHarvest && (
                              <span className="ml-2">({daysSinceHarvest} days ago)</span>
                            )}
                          </p>
                          <p className="text-sm">
                            Generation incremented to {yeastBatch.generation}
                          </p>
                        </div>
                      </div>
                    ) : yeastBatch.pitch_at && daysSincePitch && daysSincePitch >= 5 ? (
                      <div className="flex items-start gap-3">
                        <div className="mt-1">
                          <Package className="h-4 w-4 text-yellow-500" />
                        </div>
                        <div className="flex-1">
                          <p className="font-medium text-yellow-600">Ready for Harvest</p>
                          <p className="text-sm text-muted-foreground">
                            {daysSincePitch} days since pitch
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start gap-3 opacity-50">
                        <div className="mt-1">
                          <Package className="h-4 w-4 text-gray-400" />
                        </div>
                        <div className="flex-1">
                          <p className="font-medium">Not Yet Harvested</p>
                          {daysSincePitch && daysSincePitch < 5 && (
                            <p className="text-sm text-muted-foreground">
                              Wait {5 - daysSincePitch} more days
                            </p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="strain" className="space-y-4">
              {yeastBatch.strain && (
                <>
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Strain Characteristics</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <p className="text-sm text-muted-foreground">Type</p>
                          <p className="font-medium capitalize">{yeastBatch.strain.type}</p>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">Flocculation</p>
                          <p className="font-medium capitalize">
                            {yeastBatch.strain.flocculation || '-'}
                          </p>
                        </div>
                        {yeastBatch.strain.attenuation_min && yeastBatch.strain.attenuation_max && (
                          <div>
                            <p className="text-sm text-muted-foreground">Attenuation</p>
                            <p className="font-medium">
                              {yeastBatch.strain.attenuation_min}-{yeastBatch.strain.attenuation_max}%
                            </p>
                          </div>
                        )}
                        {yeastBatch.strain.temperature_min && yeastBatch.strain.temperature_max && (
                          <div>
                            <p className="text-sm text-muted-foreground">Temperature Range</p>
                            <p className="font-medium">
                              {yeastBatch.strain.temperature_min}-{yeastBatch.strain.temperature_max}°C
                            </p>
                          </div>
                        )}
                        <div>
                          <p className="text-sm text-muted-foreground">Max Generation</p>
                          <p className="font-medium">
                            {yeastBatch.strain.recommended_max_generation || 10}
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </>
              )}
            </TabsContent>

            <TabsContent value="history" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">History</CardTitle>
                  <CardDescription>
                    All events for this yeast batch
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {history && history.length > 0 ? (
                    <div className="space-y-3">
                      {history.map((event) => (
                        <div
                          key={event.id}
                          className="flex items-start gap-3 py-2 border-b last:border-0"
                        >
                          <div className="mt-1">
                            <Activity className="h-4 w-4 text-muted-foreground" />
                          </div>
                          <div className="flex-1">
                            <p className="text-sm font-medium capitalize">
                              {event.action.replace('_', ' ')}
                            </p>
                            <p className="text-sm text-muted-foreground">
                              {formatDateTime(event.created_at)}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      No history available
                    </p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </ScrollArea>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
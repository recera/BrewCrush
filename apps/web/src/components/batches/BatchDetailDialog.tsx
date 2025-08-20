'use client';

import { useState } from 'react';
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
import { Button } from '@brewcrush/ui';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@brewcrush/ui';
import { ScrollArea } from '@brewcrush/ui';
import { Progress } from '@brewcrush/ui';
import { Alert, AlertDescription } from '@brewcrush/ui';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@brewcrush/ui';
import { 
  Calendar,
  Clock,
  FlaskConical,
  Package,
  CheckCircle,
  AlertCircle,
  MoreVertical,
  Thermometer,
  Activity,
  Droplets,
  Beaker,
  Archive,
  XCircle,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useUserRole } from '@/hooks/useUserRole';
import { BatchTimeline, FermReading } from '@/types/production';
import { 
  formatDate, 
  formatDateTime, 
  getDaysBetween, 
  getBatchStatusColor,
  formatNumber,
  calculateABV 
} from '@/lib/utils';
import { useRouter } from 'next/navigation';

interface BatchDetailDialogProps {
  batch: BatchTimeline;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRefresh?: () => void;
}

export function BatchDetailDialog({
  batch,
  open,
  onOpenChange,
  onRefresh,
}: BatchDetailDialogProps) {
  const supabase = createClient();
  const router = useRouter();
  const { role } = useUserRole();
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  
  const canManageBatch = role === 'admin' || role === 'brewer';

  // Fetch fermentation readings
  const { data: fermReadings } = useQuery({
    queryKey: ['ferm-readings', batch.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ferm_readings')
        .select('*')
        .eq('batch_id', batch.id)
        .order('reading_at', { ascending: false })
        .limit(20);

      if (error) throw error;
      return data as FermReading[];
    },
    enabled: open && ['fermenting', 'conditioning'].includes(batch.status),
  });

  // Fetch batch events/history
  const { data: batchEvents } = useQuery({
    queryKey: ['batch-events', batch.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('audit_logs')
        .select('*')
        .eq('entity_table', 'batches')
        .eq('entity_id', batch.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data;
    },
    enabled: open,
  });

  const getStatusIcon = (status: string) => {
    const icons: Record<string, JSX.Element> = {
      planned: <Calendar className="h-4 w-4" />,
      brewing: <FlaskConical className="h-4 w-4" />,
      fermenting: <Activity className="h-4 w-4" />,
      conditioning: <Clock className="h-4 w-4" />,
      packaging: <Package className="h-4 w-4" />,
      completed: <CheckCircle className="h-4 w-4" />,
      archived: <Archive className="h-4 w-4" />,
      cancelled: <XCircle className="h-4 w-4" />,
    };
    return icons[status] || <AlertCircle className="h-4 w-4" />;
  };

  const getProgressPercentage = (): number => {
    const statusProgress: Record<string, number> = {
      planned: 0,
      brewing: 20,
      fermenting: 40,
      conditioning: 60,
      packaging: 80,
      completed: 100,
      archived: 100,
      cancelled: 0,
    };
    return statusProgress[batch.status] || 0;
  };

  const handleStatusUpdate = async (newStatus: string) => {
    if (!canManageBatch) return;
    
    setIsUpdatingStatus(true);
    try {
      const { error } = await supabase.rpc('update_batch_status', {
        p_batch_id: batch.id,
        p_new_status: newStatus,
      });

      if (error) throw error;
      onRefresh?.();
    } catch (error) {
      console.error('Error updating batch status:', error);
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  const getNextStatuses = (): string[] => {
    const transitions: Record<string, string[]> = {
      planned: ['brewing', 'cancelled'],
      brewing: ['fermenting', 'cancelled'],
      fermenting: ['conditioning', 'packaging', 'cancelled'],
      conditioning: ['packaging', 'cancelled'],
      packaging: ['completed', 'cancelled'],
      completed: ['archived'],
      archived: [],
      cancelled: [],
    };
    return transitions[batch.status] || [];
  };

  const latestReading = fermReadings?.[0];
  const abv = latestReading?.sg && batch.target_fg 
    ? calculateABV(batch.target_og || 1.050, latestReading.sg)
    : batch.target_abv;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh]">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="text-2xl">{batch.batch_number}</DialogTitle>
              <DialogDescription className="flex items-center gap-4 mt-2">
                <span>{batch.recipe_name}</span>
                {batch.target_volume && (
                  <span>{batch.target_volume}L</span>
                )}
              </DialogDescription>
            </div>
            {canManageBatch && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon">
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>Actions</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {batch.status === 'brewing' && (
                    <DropdownMenuItem
                      onClick={() => router.push(`/batches/${batch.id}/brew-day`)}
                    >
                      <FlaskConical className="mr-2 h-4 w-4" />
                      Continue Brew Day
                    </DropdownMenuItem>
                  )}
                  {['fermenting', 'conditioning'].includes(batch.status) && (
                    <DropdownMenuItem
                      onClick={() => router.push(`/batches/${batch.id}/fermentation`)}
                    >
                      <Activity className="mr-2 h-4 w-4" />
                      Log Reading
                    </DropdownMenuItem>
                  )}
                  {getNextStatuses().map((status) => (
                    <DropdownMenuItem
                      key={status}
                      onClick={() => handleStatusUpdate(status)}
                      disabled={isUpdatingStatus}
                    >
                      {getStatusIcon(status)}
                      <span className="ml-2">Move to {status}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </DialogHeader>

        {/* Status and Progress */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <Badge 
              className={`${getBatchStatusColor(batch.status)} text-white px-3 py-1`}
            >
              {getStatusIcon(batch.status)}
              <span className="ml-2">{batch.status}</span>
            </Badge>
            <span className="text-sm text-muted-foreground">
              Started {formatDate(batch.brew_date || batch.created_at)}
            </span>
          </div>
          <Progress value={getProgressPercentage()} className="h-2" />
        </div>

        <Tabs defaultValue="overview" className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="timeline">Timeline</TabsTrigger>
            <TabsTrigger value="fermentation" disabled={!['fermenting', 'conditioning'].includes(batch.status)}>
              Fermentation
            </TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>

          <ScrollArea className="h-[450px] mt-4">
            <TabsContent value="overview" className="space-y-4">
              {/* Batch Details */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Batch Information</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm text-muted-foreground">Recipe</p>
                      <p className="font-medium">{batch.recipe_name}</p>
                    </div>
                    {batch.tank_name && (
                      <div>
                        <p className="text-sm text-muted-foreground">Tank</p>
                        <p className="font-medium">{batch.tank_name}</p>
                      </div>
                    )}
                    {batch.yeast_strain && (
                      <div>
                        <p className="text-sm text-muted-foreground">Yeast</p>
                        <p className="font-medium">
                          {batch.yeast_strain} (Gen {batch.yeast_generation})
                        </p>
                      </div>
                    )}
                    {batch.target_volume && (
                      <div>
                        <p className="text-sm text-muted-foreground">Target Volume</p>
                        <p className="font-medium">{batch.target_volume}L</p>
                      </div>
                    )}
                    {batch.actual_volume && (
                      <div>
                        <p className="text-sm text-muted-foreground">Actual Volume</p>
                        <p className="font-medium">{batch.actual_volume}L</p>
                      </div>
                    )}
                    {batch.efficiency_pct && (
                      <div>
                        <p className="text-sm text-muted-foreground">Efficiency</p>
                        <p className="font-medium">{batch.efficiency_pct}%</p>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Target vs Actual */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Targets vs Actuals</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {batch.target_og && (
                      <div className="flex justify-between items-center">
                        <span className="text-sm">Original Gravity</span>
                        <div className="flex gap-4">
                          <span className="text-sm text-muted-foreground">
                            Target: {batch.target_og.toFixed(3)}
                          </span>
                          {batch.actual_og && (
                            <span className="text-sm font-medium">
                              Actual: {batch.actual_og.toFixed(3)}
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                    {batch.target_fg && (
                      <div className="flex justify-between items-center">
                        <span className="text-sm">Final Gravity</span>
                        <div className="flex gap-4">
                          <span className="text-sm text-muted-foreground">
                            Target: {batch.target_fg.toFixed(3)}
                          </span>
                          {latestReading?.sg && (
                            <span className="text-sm font-medium">
                              Current: {latestReading.sg.toFixed(3)}
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                    {abv && (
                      <div className="flex justify-between items-center">
                        <span className="text-sm">ABV</span>
                        <span className="text-sm font-medium">{abv.toFixed(1)}%</span>
                      </div>
                    )}
                    {batch.target_ibu && (
                      <div className="flex justify-between items-center">
                        <span className="text-sm">IBU</span>
                        <span className="text-sm font-medium">{batch.target_ibu}</span>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Current Status Info */}
              {batch.status === 'fermenting' && batch.days_in_fermentation && (
                <Alert>
                  <Activity className="h-4 w-4" />
                  <AlertDescription>
                    Day {batch.days_in_fermentation} of fermentation
                    {latestReading && (
                      <span className="block mt-1">
                        Latest reading: SG {latestReading.sg?.toFixed(3)} at {latestReading.temp}°C
                      </span>
                    )}
                  </AlertDescription>
                </Alert>
              )}
              {batch.status === 'conditioning' && batch.days_in_conditioning && (
                <Alert>
                  <Clock className="h-4 w-4" />
                  <AlertDescription>
                    Day {batch.days_in_conditioning} of conditioning
                  </AlertDescription>
                </Alert>
              )}
            </TabsContent>

            <TabsContent value="timeline" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Production Timeline</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {batch.brew_date && (
                      <div className="flex items-start gap-3">
                        <div className="mt-1">
                          <FlaskConical className="h-4 w-4 text-blue-500" />
                        </div>
                        <div className="flex-1">
                          <p className="font-medium">Brew Day</p>
                          <p className="text-sm text-muted-foreground">
                            {formatDateTime(batch.brew_date)}
                          </p>
                        </div>
                      </div>
                    )}
                    {batch.ferment_start_date && (
                      <div className="flex items-start gap-3">
                        <div className="mt-1">
                          <Activity className="h-4 w-4 text-amber-500" />
                        </div>
                        <div className="flex-1">
                          <p className="font-medium">Fermentation Started</p>
                          <p className="text-sm text-muted-foreground">
                            {formatDateTime(batch.ferment_start_date)}
                          </p>
                        </div>
                      </div>
                    )}
                    {batch.ferment_end_date && (
                      <div className="flex items-start gap-3">
                        <div className="mt-1">
                          <CheckCircle className="h-4 w-4 text-green-500" />
                        </div>
                        <div className="flex-1">
                          <p className="font-medium">Fermentation Ended</p>
                          <p className="text-sm text-muted-foreground">
                            {formatDateTime(batch.ferment_end_date)}
                            {batch.ferment_start_date && (
                              <span className="ml-2">
                                ({getDaysBetween(batch.ferment_start_date, batch.ferment_end_date)} days)
                              </span>
                            )}
                          </p>
                        </div>
                      </div>
                    )}
                    {batch.condition_start_date && (
                      <div className="flex items-start gap-3">
                        <div className="mt-1">
                          <Clock className="h-4 w-4 text-yellow-500" />
                        </div>
                        <div className="flex-1">
                          <p className="font-medium">Conditioning Started</p>
                          <p className="text-sm text-muted-foreground">
                            {formatDateTime(batch.condition_start_date)}
                          </p>
                        </div>
                      </div>
                    )}
                    {batch.package_date && (
                      <div className="flex items-start gap-3">
                        <div className="mt-1">
                          <Package className="h-4 w-4 text-purple-500" />
                        </div>
                        <div className="flex-1">
                          <p className="font-medium">Packaged</p>
                          <p className="text-sm text-muted-foreground">
                            {formatDateTime(batch.package_date)}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="fermentation" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Fermentation Readings</CardTitle>
                  <CardDescription>
                    {fermReadings?.length || 0} readings logged
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {fermReadings && fermReadings.length > 0 ? (
                    <div className="space-y-3">
                      {fermReadings.map((reading) => (
                        <div
                          key={reading.id}
                          className="flex items-center justify-between py-2 border-b last:border-0"
                        >
                          <div className="flex-1">
                            <p className="text-sm font-medium">
                              {formatDateTime(reading.reading_at)}
                            </p>
                            <div className="flex gap-4 mt-1">
                              {reading.sg && (
                                <span className="text-sm text-muted-foreground flex items-center gap-1">
                                  <Droplets className="h-3 w-3" />
                                  SG: {reading.sg.toFixed(3)}
                                </span>
                              )}
                              {reading.temp && (
                                <span className="text-sm text-muted-foreground flex items-center gap-1">
                                  <Thermometer className="h-3 w-3" />
                                  {reading.temp}°C
                                </span>
                              )}
                              {reading.ph && (
                                <span className="text-sm text-muted-foreground flex items-center gap-1">
                                  <Beaker className="h-3 w-3" />
                                  pH: {reading.ph.toFixed(1)}
                                </span>
                              )}
                            </div>
                          </div>
                          {reading.notes && (
                            <p className="text-sm text-muted-foreground max-w-xs">
                              {reading.notes}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      No fermentation readings logged yet
                    </p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="history" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Batch History</CardTitle>
                  <CardDescription>
                    All events and changes for this batch
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {batchEvents && batchEvents.length > 0 ? (
                    <div className="space-y-3">
                      {batchEvents.map((event) => (
                        <div
                          key={event.id}
                          className="flex items-start gap-3 py-2 border-b last:border-0"
                        >
                          <div className="mt-1">
                            <AlertCircle className="h-4 w-4 text-muted-foreground" />
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
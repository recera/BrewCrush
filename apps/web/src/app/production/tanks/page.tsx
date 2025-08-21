'use client';

import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { 
  Plus, 
  Droplets, 
  Thermometer, 
  Clock, 
  AlertCircle,
  CheckCircle,
  Activity,
  Beaker,
  Settings,
  TrendingUp,
  TrendingDown,
  Minus
} from 'lucide-react';
import { Button } from '@brewcrush/ui';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@brewcrush/ui';
import { Badge } from '@brewcrush/ui';
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
import { createClient } from '@/lib/supabase/client';
import { useUserRole } from '@/hooks/useUserRole';
import { Tank, BatchTimeline, FermReading } from '@/types/production';
import { formatDate, getDaysBetween, getTankStatusColor, formatNumber } from '@/lib/utils';
import { LogFermReadingDialog } from '@/components/tanks/LogFermReadingDialog';
import { TankDetailDialog } from '@/components/tanks/TankDetailDialog';
import { UpdateCIPDialog } from '@/components/tanks/UpdateCIPDialog';

interface TankWithBatch extends Tank {
  current_batch?: BatchTimeline;
  latest_reading?: FermReading;
  yeast_harvest_ready?: boolean;
}

export default function TanksPage() {
  const supabase = createClient();
  const { role } = useUserRole();
  const [selectedTank, setSelectedTank] = useState<TankWithBatch | null>(null);
  const [logReadingTank, setLogReadingTank] = useState<TankWithBatch | null>(null);
  const [updateCIPTank, setUpdateCIPTank] = useState<Tank | null>(null);

  const canManageTanks = role === 'admin' || role === 'brewer';

  // Fetch tanks with current batches and latest readings
  const { data: tanks, isLoading, refetch } = useQuery({
    queryKey: ['tanks-board'],
    queryFn: async () => {
      // Get tanks
      const { data: tanksData, error: tanksError } = await supabase
        .from('tanks')
        .select('*')
        .eq('is_active', true)
        .order('name');

      if (tanksError) throw tanksError;

      // Get active batches
      const { data: batchesData, error: batchesError } = await supabase
        .from('v_batch_timeline')
        .select('*')
        .in('status', ['fermenting', 'conditioning'])
        .not('tank_id', 'is', null);

      if (batchesError) throw batchesError;

      // Get latest readings for active batches
      const batchIds = batchesData?.map(b => b.id) || [];
      let latestReadings: any[] = [];

      if (batchIds.length > 0) {
        const { data: readingsData, error: readingsError } = await supabase
          .from('ferm_readings')
          .select('*')
          .in('batch_id', batchIds)
          .order('reading_at', { ascending: false });

        if (readingsError) throw readingsError;

        // Get only the latest reading per batch
        const readingsByBatch: Record<string, FermReading> = {};
        readingsData?.forEach(reading => {
          if (!readingsByBatch[reading.batch_id]) {
            readingsByBatch[reading.batch_id] = reading;
          }
        });
        latestReadings = Object.values(readingsByBatch);
      }

      // Combine data
      const tanksWithBatches: TankWithBatch[] = tanksData.map(tank => {
        const batch = batchesData?.find(b => b.tank_id === tank.id);
        const reading = batch ? latestReadings.find(r => r.batch_id === batch.id) : undefined;
        
        // Check if yeast harvest is recommended
        const yeastHarvestReady = batch && 
          batch.status === 'fermenting' && 
          batch.days_in_fermentation && 
          batch.days_in_fermentation >= 5 &&
          !batch.yeast_harvested;

        return {
          ...tank,
          current_batch: batch,
          latest_reading: reading,
          yeast_harvest_ready: yeastHarvestReady,
        };
      });

      return tanksWithBatches;
    },
  });

  // Set up real-time subscription
  useEffect(() => {
    const channel = supabase
      .channel('tank-updates')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'ferm_readings',
        },
        () => {
          refetch();
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'batches',
        },
        () => {
          refetch();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, refetch]);

  const getGravityTrend = (current?: number, previous?: number) => {
    if (!current || !previous) return null;
    if (current < previous) return 'down';
    if (current > previous) return 'up';
    return 'stable';
  };

  const getCIPStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      clean: 'bg-green-500',
      dirty: 'bg-yellow-500',
      in_progress: 'bg-blue-500',
      required: 'bg-red-500',
    };

    const icons: Record<string, JSX.Element> = {
      clean: <CheckCircle className="h-3 w-3" />,
      dirty: <AlertCircle className="h-3 w-3" />,
      in_progress: <Settings className="h-3 w-3 animate-spin" />,
      required: <AlertCircle className="h-3 w-3" />,
    };

    return (
      <Badge className={`${colors[status] || 'bg-gray-500'} text-white`}>
        {icons[status]}
        <span className="ml-1 capitalize">{status.replace('_', ' ')}</span>
      </Badge>
    );
  };

  const activeTanks = tanks?.filter(t => t.current_batch) || [];
  const emptyTanks = tanks?.filter(t => !t.current_batch) || [];

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
        <div>
          <h1 className="text-3xl font-bold">Tank Board</h1>
          <p className="text-muted-foreground">
            Monitor fermentation and tank status in real-time
          </p>
        </div>
        {canManageTanks && (
          <Button onClick={() => window.location.href = '/settings/tanks'}>
            <Plus className="mr-2 h-4 w-4" />
            Manage Tanks
          </Button>
        )}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Active Fermentations</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{activeTanks.length}</div>
            <p className="text-xs text-muted-foreground">
              {tanks?.length || 0} total tanks
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Available Tanks</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{emptyTanks.length}</div>
            <p className="text-xs text-muted-foreground">
              Ready for new batches
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">CIP Required</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {tanks?.filter(t => t.cip_status === 'required').length || 0}
            </div>
            <p className="text-xs text-muted-foreground">
              Need cleaning
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Harvest Ready</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {tanks?.filter(t => t.yeast_harvest_ready).length || 0}
            </div>
            <p className="text-xs text-muted-foreground">
              Yeast ready to harvest
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Active Tanks */}
      {activeTanks.length > 0 && (
        <div className="mb-8">
          <h2 className="text-xl font-semibold mb-4">Active Fermentations</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {activeTanks.map((tank) => (
              <Card
                key={tank.id}
                className="cursor-pointer hover:shadow-lg transition-shadow"
                onClick={() => setSelectedTank(tank)}
              >
                <CardHeader>
                  <div className="flex justify-between items-start">
                    <div>
                      <CardTitle>{tank.name}</CardTitle>
                      <CardDescription>
                        {tank.current_batch?.batch_number}
                      </CardDescription>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        onClick={(e) => e.stopPropagation()}
                        asChild
                      >
                        <Button variant="ghost" size="icon">
                          <Settings className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuLabel>Actions</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        {canManageTanks && (
                          <>
                            <DropdownMenuItem
                              onClick={(e) => {
                                e.stopPropagation();
                                setLogReadingTank(tank);
                              }}
                            >
                              <Activity className="mr-2 h-4 w-4" />
                              Log Reading
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={(e) => {
                                e.stopPropagation();
                                setUpdateCIPTank(tank);
                              }}
                            >
                              <Droplets className="mr-2 h-4 w-4" />
                              Update CIP Status
                            </DropdownMenuItem>
                          </>
                        )}
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedTank(tank);
                          }}
                        >
                          View Details
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Batch Info */}
                  {tank.current_batch && (
                    <>
                      <div className="flex justify-between items-center">
                        <Badge className={`${getBatchStatusColor(tank.current_batch.status)} text-white`}>
                          {tank.current_batch.status}
                        </Badge>
                        <span className="text-sm text-muted-foreground">
                          Day {tank.current_batch.days_in_fermentation || tank.current_batch.days_in_conditioning || 0}
                        </span>
                      </div>

                      {/* Latest Reading */}
                      {tank.latest_reading && (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Droplets className="h-4 w-4 text-blue-500" />
                              <span className="text-sm font-medium">
                                SG: {tank.latest_reading.sg?.toFixed(3)}
                              </span>
                            </div>
                            {getGravityTrend(tank.latest_reading.sg, tank.current_batch.target_fg) === 'down' && (
                              <TrendingDown className="h-4 w-4 text-green-500" />
                            )}
                            {getGravityTrend(tank.latest_reading.sg, tank.current_batch.target_fg) === 'up' && (
                              <TrendingUp className="h-4 w-4 text-amber-500" />
                            )}
                            {getGravityTrend(tank.latest_reading.sg, tank.current_batch.target_fg) === 'stable' && (
                              <Minus className="h-4 w-4 text-gray-500" />
                            )}
                          </div>

                          <div className="flex items-center gap-4 text-sm">
                            {tank.latest_reading.temp && (
                              <div className="flex items-center gap-1">
                                <Thermometer className="h-3 w-3 text-orange-500" />
                                {tank.latest_reading.temp}°C
                              </div>
                            )}
                            {tank.latest_reading.ph && (
                              <div className="flex items-center gap-1">
                                <Beaker className="h-3 w-3 text-purple-500" />
                                pH {tank.latest_reading.ph.toFixed(1)}
                              </div>
                            )}
                          </div>

                          <p className="text-xs text-muted-foreground">
                            Last reading: {formatDate(tank.latest_reading.reading_at)}
                          </p>
                        </div>
                      )}

                      {/* Fermentation Progress */}
                      {tank.current_batch.target_fg && tank.latest_reading?.sg && (
                        <div className="space-y-1">
                          <div className="flex justify-between text-xs">
                            <span>Fermentation Progress</span>
                            <span>
                              {Math.round(
                                ((tank.current_batch.target_og! - tank.latest_reading.sg) /
                                  (tank.current_batch.target_og! - tank.current_batch.target_fg)) *
                                  100
                              )}%
                            </span>
                          </div>
                          <Progress
                            value={
                              ((tank.current_batch.target_og! - tank.latest_reading.sg) /
                                (tank.current_batch.target_og! - tank.current_batch.target_fg)) *
                              100
                            }
                            className="h-2"
                          />
                        </div>
                      )}

                      {/* Prompts */}
                      {tank.yeast_harvest_ready && (
                        <Alert className="py-2">
                          <AlertCircle className="h-3 w-3" />
                          <AlertDescription className="text-xs">
                            Yeast ready to harvest
                          </AlertDescription>
                        </Alert>
                      )}
                    </>
                  )}

                  {/* CIP Status */}
                  <div className="pt-2 border-t">
                    {getCIPStatusBadge(tank.cip_status)}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Empty Tanks */}
      {emptyTanks.length > 0 && (
        <div>
          <h2 className="text-xl font-semibold mb-4">Available Tanks</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {emptyTanks.map((tank) => (
              <Card
                key={tank.id}
                className="cursor-pointer hover:shadow-lg transition-shadow"
                onClick={() => setSelectedTank(tank)}
              >
                <CardHeader>
                  <CardTitle className="text-base">{tank.name}</CardTitle>
                  <CardDescription>{tank.capacity}L capacity</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex justify-between items-center">
                    {getCIPStatusBadge(tank.cip_status)}
                    {canManageTanks && tank.cip_status !== 'clean' && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={(e) => {
                          e.stopPropagation();
                          setUpdateCIPTank(tank);
                        }}
                      >
                        Update
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Dialogs */}
      {selectedTank && (
        <TankDetailDialog
          tank={selectedTank}
          open={!!selectedTank}
          onOpenChange={(open) => !open && setSelectedTank(null)}
          onRefresh={refetch}
        />
      )}

      {logReadingTank && (
        <LogFermReadingDialog
          tank={logReadingTank}
          batch={logReadingTank.current_batch!}
          open={!!logReadingTank}
          onOpenChange={(open) => !open && setLogReadingTank(null)}
          onSuccess={refetch}
        />
      )}

      {updateCIPTank && (
        <UpdateCIPDialog
          tank={updateCIPTank}
          open={!!updateCIPTank}
          onOpenChange={(open) => !open && setUpdateCIPTank(null)}
          onSuccess={refetch}
        />
      )}
    </div>
  );
}
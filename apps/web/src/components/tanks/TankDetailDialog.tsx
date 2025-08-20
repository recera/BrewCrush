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
import { Button } from '@brewcrush/ui';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@brewcrush/ui';
import { ScrollArea } from '@brewcrush/ui';
import { 
  Droplets,
  Thermometer,
  Activity,
  Clock,
  AlertCircle,
  CheckCircle,
  Package,
  Beaker,
  TrendingUp,
  TrendingDown,
  Minus,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useUserRole } from '@/hooks/useUserRole';
import { Tank, BatchTimeline, FermReading } from '@/types/production';
import { formatDate, formatDateTime, getTankStatusColor } from '@/lib/utils';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface TankWithBatch extends Tank {
  current_batch?: BatchTimeline;
  latest_reading?: FermReading;
}

interface TankDetailDialogProps {
  tank: TankWithBatch;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRefresh?: () => void;
}

export function TankDetailDialog({
  tank,
  open,
  onOpenChange,
  onRefresh,
}: TankDetailDialogProps) {
  const supabase = createClient();
  const { role } = useUserRole();
  
  const canManageTank = role === 'admin' || role === 'brewer';

  // Fetch fermentation history for current batch
  const { data: fermHistory } = useQuery({
    queryKey: ['tank-ferm-history', tank.current_batch?.id],
    queryFn: async () => {
      if (!tank.current_batch?.id) return [];
      
      const { data, error } = await supabase
        .from('ferm_readings')
        .select('*')
        .eq('batch_id', tank.current_batch.id)
        .order('reading_at', { ascending: true });

      if (error) throw error;
      return data as FermReading[];
    },
    enabled: open && !!tank.current_batch?.id,
  });

  // Fetch batch history for this tank
  const { data: batchHistory } = useQuery({
    queryKey: ['tank-batch-history', tank.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('batches')
        .select(`
          id,
          batch_number,
          status,
          brew_date,
          ferment_start_date,
          ferment_end_date,
          package_date,
          recipe:recipes(name)
        `)
        .eq('tank_id', tank.id)
        .order('brew_date', { ascending: false })
        .limit(10);

      if (error) throw error;
      return data;
    },
    enabled: open,
  });

  // Fetch CIP history
  const { data: cipHistory } = useQuery({
    queryKey: ['tank-cip-history', tank.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('audit_logs')
        .select('*')
        .eq('entity_table', 'tanks')
        .eq('entity_id', tank.id)
        .like('after', '%cip_status%')
        .order('created_at', { ascending: false })
        .limit(10);

      if (error) throw error;
      return data;
    },
    enabled: open,
  });

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
      in_progress: <Clock className="h-3 w-3 animate-spin" />,
      required: <AlertCircle className="h-3 w-3" />,
    };

    return (
      <Badge className={`${colors[status] || 'bg-gray-500'} text-white`}>
        {icons[status]}
        <span className="ml-1 capitalize">{status.replace('_', ' ')}</span>
      </Badge>
    );
  };

  // Prepare chart data
  const chartData = fermHistory?.map((reading) => ({
    date: format(new Date(reading.reading_at), 'MM/dd'),
    sg: reading.sg,
    temp: reading.temp,
    ph: reading.ph,
  })) || [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh]">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="text-2xl">{tank.name}</DialogTitle>
              <DialogDescription className="flex items-center gap-4 mt-2">
                <span>{tank.type} - {tank.capacity}L</span>
                {getCIPStatusBadge(tank.cip_status)}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <Tabs defaultValue="overview" className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="fermentation" disabled={!tank.current_batch}>
              Fermentation
            </TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
            <TabsTrigger value="maintenance">Maintenance</TabsTrigger>
          </TabsList>

          <ScrollArea className="h-[450px] mt-4">
            <TabsContent value="overview" className="space-y-4">
              {/* Tank Info */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Tank Information</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm text-muted-foreground">Type</p>
                      <p className="font-medium capitalize">{tank.type}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Capacity</p>
                      <p className="font-medium">{tank.capacity} Liters</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Status</p>
                      <p className="font-medium">
                        {tank.current_batch ? 'Occupied' : 'Available'}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">CIP Status</p>
                      {getCIPStatusBadge(tank.cip_status)}
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Current Batch */}
              {tank.current_batch ? (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Current Batch</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      <div className="flex justify-between items-center">
                        <span className="font-medium">{tank.current_batch.batch_number}</span>
                        <Badge className={`${getBatchStatusColor(tank.current_batch.status)} text-white`}>
                          {tank.current_batch.status}
                        </Badge>
                      </div>
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <p className="text-muted-foreground">Recipe</p>
                          <p>{tank.current_batch.recipe_name}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Volume</p>
                          <p>{tank.current_batch.target_volume}L</p>
                        </div>
                        {tank.current_batch.yeast_strain && (
                          <div>
                            <p className="text-muted-foreground">Yeast</p>
                            <p>{tank.current_batch.yeast_strain} (G{tank.current_batch.yeast_generation})</p>
                          </div>
                        )}
                        <div>
                          <p className="text-muted-foreground">Day</p>
                          <p>{tank.current_batch.days_in_fermentation || tank.current_batch.days_in_conditioning || 0}</p>
                        </div>
                      </div>

                      {/* Latest Reading */}
                      {tank.latest_reading && (
                        <div className="pt-3 border-t">
                          <p className="text-sm font-medium mb-2">Latest Reading</p>
                          <div className="grid grid-cols-3 gap-4">
                            {tank.latest_reading.sg && (
                              <div className="flex items-center gap-2">
                                <Droplets className="h-4 w-4 text-blue-500" />
                                <span className="text-sm">SG: {tank.latest_reading.sg.toFixed(3)}</span>
                              </div>
                            )}
                            {tank.latest_reading.temp && (
                              <div className="flex items-center gap-2">
                                <Thermometer className="h-4 w-4 text-orange-500" />
                                <span className="text-sm">{tank.latest_reading.temp}°C</span>
                              </div>
                            )}
                            {tank.latest_reading.ph && (
                              <div className="flex items-center gap-2">
                                <Beaker className="h-4 w-4 text-purple-500" />
                                <span className="text-sm">pH {tank.latest_reading.ph.toFixed(1)}</span>
                              </div>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground mt-2">
                            {formatDateTime(tank.latest_reading.reading_at)}
                          </p>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <Card>
                  <CardContent className="py-8 text-center text-muted-foreground">
                    No batch currently in this tank
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="fermentation" className="space-y-4">
              {fermHistory && fermHistory.length > 0 ? (
                <>
                  {/* Fermentation Chart */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Gravity Trend</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ResponsiveContainer width="100%" height={200}>
                        <LineChart data={chartData}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="date" />
                          <YAxis domain={['dataMin - 0.01', 'dataMax + 0.01']} />
                          <Tooltip />
                          <Line 
                            type="monotone" 
                            dataKey="sg" 
                            stroke="#3b82f6" 
                            strokeWidth={2}
                            dot={{ fill: '#3b82f6' }}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>

                  {/* Temperature Chart */}
                  {chartData.some(d => d.temp) && (
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base">Temperature Trend</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <ResponsiveContainer width="100%" height={200}>
                          <LineChart data={chartData}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="date" />
                            <YAxis />
                            <Tooltip />
                            <Line 
                              type="monotone" 
                              dataKey="temp" 
                              stroke="#f97316" 
                              strokeWidth={2}
                              dot={{ fill: '#f97316' }}
                            />
                          </LineChart>
                        </ResponsiveContainer>
                      </CardContent>
                    </Card>
                  )}

                  {/* Reading History */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">All Readings</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {fermHistory.map((reading) => (
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
                                  <span className="text-sm text-muted-foreground">
                                    SG: {reading.sg.toFixed(3)}
                                  </span>
                                )}
                                {reading.temp && (
                                  <span className="text-sm text-muted-foreground">
                                    {reading.temp}°C
                                  </span>
                                )}
                                {reading.ph && (
                                  <span className="text-sm text-muted-foreground">
                                    pH {reading.ph.toFixed(1)}
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
                    </CardContent>
                  </Card>
                </>
              ) : (
                <Card>
                  <CardContent className="py-8 text-center text-muted-foreground">
                    No fermentation readings available
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="history" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Batch History</CardTitle>
                  <CardDescription>
                    Previous batches in this tank
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {batchHistory && batchHistory.length > 0 ? (
                    <div className="space-y-3">
                      {batchHistory.map((batch) => (
                        <div
                          key={batch.id}
                          className="flex items-center justify-between py-2 border-b last:border-0"
                        >
                          <div>
                            <p className="font-medium">{batch.batch_number}</p>
                            <p className="text-sm text-muted-foreground">
                              {batch.recipe?.name}
                            </p>
                          </div>
                          <div className="text-right">
                            <Badge variant="outline">{batch.status}</Badge>
                            <p className="text-sm text-muted-foreground mt-1">
                              {batch.brew_date && formatDate(batch.brew_date)}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      No batch history available
                    </p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="maintenance" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">CIP History</CardTitle>
                  <CardDescription>
                    Cleaning and maintenance log
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {cipHistory && cipHistory.length > 0 ? (
                    <div className="space-y-3">
                      {cipHistory.map((event) => {
                        const afterData = JSON.parse(event.after || '{}');
                        const beforeData = JSON.parse(event.before || '{}');
                        return (
                          <div
                            key={event.id}
                            className="flex items-center justify-between py-2 border-b last:border-0"
                          >
                            <div>
                              <p className="text-sm">
                                Status changed from{' '}
                                <Badge variant="outline" className="mx-1">
                                  {beforeData.cip_status || 'unknown'}
                                </Badge>
                                to
                                <Badge variant="outline" className="ml-1">
                                  {afterData.cip_status || 'unknown'}
                                </Badge>
                              </p>
                            </div>
                            <p className="text-sm text-muted-foreground">
                              {formatDateTime(event.created_at)}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      No CIP history available
                    </p>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Tank Details</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Created</span>
                      <span>{formatDate(tank.created_at)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Last Updated</span>
                      <span>{formatDate(tank.updated_at)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Active</span>
                      <span>{tank.is_active ? 'Yes' : 'No'}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </ScrollArea>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

// Add format import
import { format } from 'date-fns';
'use client';

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format, startOfWeek, endOfWeek, eachDayOfInterval, addDays, isSameDay, isWithinInterval } from 'date-fns';
import { ChevronLeft, ChevronRight, Calendar, Plus, Filter, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { createClient } from '@/lib/supabase/client';
import { useUserRole } from '@/hooks/useUserRole';
import { BatchTimeline, Tank } from '@/types/production';
import { getBatchStatusColor, formatDate } from '@/lib/utils';
import { BatchDetailDialog } from '@/components/batches/BatchDetailDialog';
import { useRouter } from 'next/navigation';

type ViewMode = 'week' | '2weeks' | 'month';

export default function ProductionCalendarPage() {
  const supabase = createClient();
  const router = useRouter();
  const { role } = useUserRole();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<ViewMode>('2weeks');
  const [selectedBatch, setSelectedBatch] = useState<BatchTimeline | null>(null);
  const [showEmptyTanks, setShowEmptyTanks] = useState(true);

  const canManageProduction = role === 'admin' || role === 'brewer';

  // Calculate date range based on view mode
  const dateRange = useMemo(() => {
    const start = startOfWeek(currentDate, { weekStartsOn: 1 });
    let end: Date;
    
    switch (viewMode) {
      case 'week':
        end = endOfWeek(currentDate, { weekStartsOn: 1 });
        break;
      case '2weeks':
        end = addDays(endOfWeek(currentDate, { weekStartsOn: 1 }), 7);
        break;
      case 'month':
        end = addDays(start, 27);
        break;
      default:
        end = endOfWeek(currentDate, { weekStartsOn: 1 });
    }
    
    return { start, end };
  }, [currentDate, viewMode]);

  const daysInRange = eachDayOfInterval(dateRange);

  // Fetch tanks
  const { data: tanks, isLoading: tanksLoading } = useQuery({
    queryKey: ['tanks'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tanks')
        .select('*')
        .eq('is_active', true)
        .order('name');

      if (error) throw error;
      return data as Tank[];
    },
  });

  // Fetch batches in date range
  const { data: batches, isLoading: batchesLoading, refetch } = useQuery({
    queryKey: ['calendar-batches', dateRange.start, dateRange.end],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_batch_timeline')
        .select('*')
        .gte('brew_date', format(dateRange.start, 'yyyy-MM-dd'))
        .lte('brew_date', format(dateRange.end, 'yyyy-MM-dd'))
        .order('brew_date');

      if (error) throw error;
      return data as BatchTimeline[];
    },
  });

  // Group batches by tank
  const batchesByTank = useMemo(() => {
    const grouped: Record<string, BatchTimeline[]> = {};
    
    tanks?.forEach(tank => {
      grouped[tank.id] = [];
    });
    
    batches?.forEach(batch => {
      if (batch.tank_id && grouped[batch.tank_id]) {
        grouped[batch.tank_id].push(batch);
      }
    });
    
    return grouped;
  }, [tanks, batches]);

  const handlePreviousPeriod = () => {
    const days = viewMode === 'week' ? 7 : viewMode === '2weeks' ? 14 : 28;
    setCurrentDate(prev => addDays(prev, -days));
  };

  const handleNextPeriod = () => {
    const days = viewMode === 'week' ? 7 : viewMode === '2weeks' ? 14 : 28;
    setCurrentDate(prev => addDays(prev, days));
  };

  const handleToday = () => {
    setCurrentDate(new Date());
  };

  const getBatchDuration = (batch: BatchTimeline): number => {
    if (!batch.brew_date) return 1;
    
    let endDate = batch.package_date || batch.condition_end_date || batch.ferment_end_date;
    if (!endDate) {
      // Estimate based on status
      const daysMap: Record<string, number> = {
        planned: 1,
        brewing: 1,
        fermenting: 14,
        conditioning: 21,
        packaging: 1,
        completed: 1,
      };
      return daysMap[batch.status] || 1;
    }
    
    const start = new Date(batch.brew_date);
    const end = new Date(endDate);
    return Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  };

  const getBatchPosition = (batch: BatchTimeline, tankBatches: BatchTimeline[]): number => {
    // Find overlapping batches and stack them
    let position = 0;
    const batchStart = new Date(batch.brew_date!);
    const batchEnd = addDays(batchStart, getBatchDuration(batch) - 1);
    
    for (const otherBatch of tankBatches) {
      if (otherBatch.id === batch.id) continue;
      
      const otherStart = new Date(otherBatch.brew_date!);
      const otherEnd = addDays(otherStart, getBatchDuration(otherBatch) - 1);
      
      // Check for overlap
      if (
        (batchStart >= otherStart && batchStart <= otherEnd) ||
        (batchEnd >= otherStart && batchEnd <= otherEnd) ||
        (batchStart <= otherStart && batchEnd >= otherEnd)
      ) {
        position++;
      }
    }
    
    return position;
  };

  const renderBatchBar = (batch: BatchTimeline, tankBatches: BatchTimeline[]) => {
    if (!batch.brew_date) return null;
    
    const batchStart = new Date(batch.brew_date);
    const duration = getBatchDuration(batch);
    const batchEnd = addDays(batchStart, duration - 1);
    
    // Check if batch is visible in current range
    if (batchEnd < dateRange.start || batchStart > dateRange.end) {
      return null;
    }
    
    // Calculate position and width
    const firstVisibleDay = batchStart < dateRange.start ? dateRange.start : batchStart;
    const lastVisibleDay = batchEnd > dateRange.end ? dateRange.end : batchEnd;
    
    const startIndex = daysInRange.findIndex(day => isSameDay(day, firstVisibleDay));
    const endIndex = daysInRange.findIndex(day => isSameDay(day, lastVisibleDay));
    
    if (startIndex === -1 || endIndex === -1) return null;
    
    const position = getBatchPosition(batch, tankBatches);
    const leftPercent = (startIndex / daysInRange.length) * 100;
    const widthPercent = ((endIndex - startIndex + 1) / daysInRange.length) * 100;
    
    return (
      <div
        key={batch.id}
        className={`absolute h-8 rounded cursor-pointer hover:shadow-lg transition-shadow ${getBatchStatusColor(batch.status)}`}
        style={{
          left: `${leftPercent}%`,
          width: `${widthPercent}%`,
          top: `${position * 36}px`,
        }}
        onClick={() => setSelectedBatch(batch)}
      >
        <div className="px-2 py-1 text-white text-xs font-medium truncate">
          {batch.batch_number}
        </div>
      </div>
    );
  };

  const isLoading = tanksLoading || batchesLoading;

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
        <div>
          <h1 className="text-3xl font-bold">Production Calendar</h1>
          <p className="text-muted-foreground">Schedule and track batches across tanks</p>
        </div>
        <div className="flex gap-2">
          {canManageProduction && (
            <Button onClick={() => router.push('/recipes')}>
              <Plus className="mr-2 h-4 w-4" />
              New Batch
            </Button>
          )}
        </div>
      </div>

      {/* Calendar Controls */}
      <Card className="mb-6">
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                onClick={handlePreviousPeriod}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                onClick={handleToday}
              >
                Today
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={handleNextPeriod}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
              <span className="ml-4 font-medium">
                {format(dateRange.start, 'MMM d')} - {format(dateRange.end, 'MMM d, yyyy')}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Select value={viewMode} onValueChange={(v) => setViewMode(v as ViewMode)}>
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="week">Week</SelectItem>
                  <SelectItem value="2weeks">2 Weeks</SelectItem>
                  <SelectItem value="month">Month</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setShowEmptyTanks(!showEmptyTanks)}
              >
                <Filter className={`h-4 w-4 ${!showEmptyTanks ? 'text-primary' : ''}`} />
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Calendar Grid */}
      <Card>
        <ScrollArea className="w-full">
          <div className="min-w-[800px]">
            {/* Date Headers */}
            <div className="flex border-b bg-muted/50">
              <div className="w-32 shrink-0 p-3 font-medium">Tank</div>
              <div className="flex-1 flex">
                {daysInRange.map((day) => (
                  <div
                    key={day.toISOString()}
                    className={`flex-1 p-3 text-center text-sm border-l ${
                      isSameDay(day, new Date()) ? 'bg-primary/10 font-bold' : ''
                    }`}
                  >
                    <div className="font-medium">{format(day, 'EEE')}</div>
                    <div className="text-muted-foreground">{format(day, 'd')}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Tank Lanes */}
            {isLoading ? (
              <div className="p-8 text-center text-muted-foreground">
                Loading calendar...
              </div>
            ) : (
              <div>
                {tanks?.map((tank) => {
                  const tankBatches = batchesByTank[tank.id] || [];
                  const hasActiveBatches = tankBatches.length > 0;
                  
                  if (!showEmptyTanks && !hasActiveBatches) {
                    return null;
                  }
                  
                  const maxPosition = Math.max(
                    0,
                    ...tankBatches.map(b => getBatchPosition(b, tankBatches))
                  );
                  const laneHeight = Math.max(60, (maxPosition + 1) * 36 + 12);
                  
                  return (
                    <div key={tank.id} className="flex border-b hover:bg-muted/30">
                      <div className="w-32 shrink-0 p-3">
                        <div className="font-medium">{tank.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {tank.capacity}L
                        </div>
                        {tank.cip_status === 'required' && (
                          <Badge variant="destructive" className="text-xs mt-1">
                            CIP
                          </Badge>
                        )}
                      </div>
                      <div className="flex-1 relative" style={{ height: `${laneHeight}px` }}>
                        {/* Day grid lines */}
                        {daysInRange.map((day, index) => (
                          <div
                            key={day.toISOString()}
                            className={`absolute top-0 bottom-0 border-l ${
                              isSameDay(day, new Date()) ? 'bg-primary/5' : ''
                            }`}
                            style={{
                              left: `${(index / daysInRange.length) * 100}%`,
                              width: `${100 / daysInRange.length}%`,
                            }}
                          />
                        ))}
                        
                        {/* Batch bars */}
                        {tankBatches.map((batch) => renderBatchBar(batch, tankBatches))}
                      </div>
                    </div>
                  );
                })}
                
                {/* Unassigned batches */}
                {batches?.filter(b => !b.tank_id).length > 0 && (
                  <div className="flex border-b bg-yellow-50">
                    <div className="w-32 shrink-0 p-3">
                      <div className="font-medium text-amber-700">Unassigned</div>
                    </div>
                    <div className="flex-1 p-3">
                      <div className="flex flex-wrap gap-2">
                        {batches
                          ?.filter(b => !b.tank_id)
                          .map((batch) => (
                            <Badge
                              key={batch.id}
                              variant="outline"
                              className="cursor-pointer"
                              onClick={() => setSelectedBatch(batch)}
                            >
                              {batch.batch_number}
                            </Badge>
                          ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
      </Card>

      {/* Legend */}
      <Card className="mt-4">
        <CardContent className="pt-6">
          <div className="flex flex-wrap gap-4">
            <span className="text-sm font-medium">Status:</span>
            {['planned', 'brewing', 'fermenting', 'conditioning', 'packaging', 'completed'].map((status) => (
              <div key={status} className="flex items-center gap-2">
                <div className={`w-4 h-4 rounded ${getBatchStatusColor(status)}`} />
                <span className="text-sm capitalize">{status}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Batch Detail Dialog */}
      {selectedBatch && (
        <BatchDetailDialog
          batch={selectedBatch}
          open={!!selectedBatch}
          onOpenChange={(open) => !open && setSelectedBatch(null)}
          onRefresh={refetch}
        />
      )}
    </div>
  );
}
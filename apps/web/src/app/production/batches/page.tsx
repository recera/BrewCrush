'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, Search, Filter, ChevronDown, Calendar, FlaskConical, Clock } from 'lucide-react';
import { Button } from '@brewcrush/ui';
import { Input } from '@brewcrush/ui';
import { Badge } from '@brewcrush/ui';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@brewcrush/ui';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuCheckboxItem,
} from '@brewcrush/ui';
import { Progress } from '@brewcrush/ui';
import { createClient } from '@/lib/supabase/client';
import { useUserRole } from '@/hooks/useUserRole';
import { BatchTimeline, BatchStatus } from '@/types/production';
import { formatDate, getDaysBetween, getBatchStatusColor } from '@/lib/utils';
import { BatchDetailDialog } from '@/components/batches/BatchDetailDialog';
import { StartBrewDayDialog } from '@/components/batches/StartBrewDayDialog';
import { useRouter } from 'next/navigation';

const statusOptions: BatchStatus[] = [
  'planned',
  'brewing',
  'fermenting',
  'conditioning',
  'packaging',
  'completed',
  'archived',
  'cancelled',
];

export default function BatchesPage() {
  const supabase = createClient();
  const router = useRouter();
  const { role } = useUserRole();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedStatuses, setSelectedStatuses] = useState<BatchStatus[]>([
    'planned',
    'brewing',
    'fermenting',
    'conditioning',
    'packaging',
  ]);
  const [selectedBatch, setSelectedBatch] = useState<BatchTimeline | null>(null);
  const [brewDayBatch, setBrewDayBatch] = useState<BatchTimeline | null>(null);

  const canManageBatches = role === 'admin' || role === 'brewer';

  // Fetch batches with timeline info
  const { data: batches, isLoading, refetch } = useQuery({
    queryKey: ['batches', searchTerm, selectedStatuses],
    queryFn: async () => {
      let query = supabase
        .from('v_batch_timeline')
        .select('*')
        .order('brew_date', { ascending: false });

      if (searchTerm) {
        query = query.or(
          `batch_number.ilike.%${searchTerm}%,recipe_name.ilike.%${searchTerm}%`
        );
      }

      if (selectedStatuses.length > 0) {
        query = query.in('status', selectedStatuses);
      }

      const { data, error } = await query;

      if (error) throw error;
      return data as BatchTimeline[];
    },
  });

  const handleStatusToggle = (status: BatchStatus) => {
    setSelectedStatuses((prev) =>
      prev.includes(status)
        ? prev.filter((s) => s !== status)
        : [...prev, status]
    );
  };

  const getStatusBadge = (status: BatchStatus) => {
    const colors: Record<BatchStatus, string> = {
      planned: 'secondary',
      brewing: 'default',
      fermenting: 'default',
      conditioning: 'default',
      packaging: 'default',
      completed: 'default',
      archived: 'secondary',
      cancelled: 'destructive',
    };

    return (
      <Badge 
        variant={colors[status] as any}
        className={`${getBatchStatusColor(status)} text-white`}
      >
        {status}
      </Badge>
    );
  };

  const getProgressPercentage = (batch: BatchTimeline): number => {
    const statusProgress: Record<BatchStatus, number> = {
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

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
        <div>
          <h1 className="text-3xl font-bold">Batches</h1>
          <p className="text-muted-foreground">Manage your production batches</p>
        </div>
        <div className="flex gap-2">
          <Button 
            variant="outline"
            onClick={() => router.push('/production/calendar')}
          >
            <Calendar className="mr-2 h-4 w-4" />
            Calendar View
          </Button>
          {canManageBatches && (
            <Button onClick={() => router.push('/recipes')}>
              <Plus className="mr-2 h-4 w-4" />
              New Batch
            </Button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
          <Input
            placeholder="Search batches..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline">
              <Filter className="mr-2 h-4 w-4" />
              Status ({selectedStatuses.length})
              <ChevronDown className="ml-2 h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLabel>Filter by Status</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {statusOptions.map((status) => (
              <DropdownMenuCheckboxItem
                key={status}
                checked={selectedStatuses.includes(status)}
                onCheckedChange={() => handleStatusToggle(status)}
              >
                {status}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Batch Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <Card key={i} className="animate-pulse">
              <CardHeader>
                <div className="h-6 bg-muted rounded w-3/4 mb-2" />
                <div className="h-4 bg-muted rounded w-1/2" />
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="h-4 bg-muted rounded" />
                  <div className="h-4 bg-muted rounded w-5/6" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : batches?.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="text-muted-foreground mb-4">No batches found</p>
          {canManageBatches && (
            <Button onClick={() => router.push('/recipes')}>
              <Plus className="mr-2 h-4 w-4" />
              Create Your First Batch
            </Button>
          )}
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {batches?.map((batch) => (
            <Card
              key={batch.id}
              className="cursor-pointer hover:shadow-lg transition-shadow"
              onClick={() => setSelectedBatch(batch)}
            >
              <CardHeader>
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <CardTitle className="text-lg">{batch.batch_number}</CardTitle>
                    <CardDescription>{batch.recipe_name}</CardDescription>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      onClick={(e) => e.stopPropagation()}
                      asChild
                    >
                      <Button variant="ghost" size="icon">
                        <ChevronDown className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedBatch(batch);
                        }}
                      >
                        View Details
                      </DropdownMenuItem>
                      {canManageBatches && batch.status === 'planned' && (
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            setBrewDayBatch(batch);
                          }}
                        >
                          <FlaskConical className="mr-2 h-4 w-4" />
                          Start Brew Day
                        </DropdownMenuItem>
                      )}
                      {canManageBatches && batch.status === 'brewing' && (
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            router.push(`/production/batches/${batch.id}/brew-day`);
                          }}
                        >
                          <FlaskConical className="mr-2 h-4 w-4" />
                          Continue Brew Day
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {/* Status Badge */}
                  <div className="flex items-center justify-between">
                    {getStatusBadge(batch.status)}
                    {batch.brew_date && (
                      <span className="text-sm text-muted-foreground">
                        {formatDate(batch.brew_date)}
                      </span>
                    )}
                  </div>

                  {/* Progress Bar */}
                  <Progress value={getProgressPercentage(batch)} className="h-2" />

                  {/* Batch Info */}
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    {batch.tank_name && (
                      <div>
                        <span className="text-muted-foreground">Tank:</span>{' '}
                        {batch.tank_name}
                      </div>
                    )}
                    {batch.target_volume && (
                      <div>
                        <span className="text-muted-foreground">Volume:</span>{' '}
                        {batch.target_volume}L
                      </div>
                    )}
                    {batch.yeast_strain && (
                      <div>
                        <span className="text-muted-foreground">Yeast:</span>{' '}
                        {batch.yeast_strain} (G{batch.yeast_generation})
                      </div>
                    )}
                    {batch.reading_count !== undefined && (
                      <div>
                        <span className="text-muted-foreground">Readings:</span>{' '}
                        {batch.reading_count}
                      </div>
                    )}
                  </div>

                  {/* Status-specific info */}
                  {batch.status === 'fermenting' && batch.days_in_fermentation && (
                    <div className="flex items-center gap-1 text-sm text-amber-600">
                      <Clock className="h-3 w-3" />
                      Day {batch.days_in_fermentation} of fermentation
                    </div>
                  )}
                  {batch.status === 'conditioning' && batch.days_in_conditioning && (
                    <div className="flex items-center gap-1 text-sm text-yellow-600">
                      <Clock className="h-3 w-3" />
                      Day {batch.days_in_conditioning} of conditioning
                    </div>
                  )}
                  {batch.status === 'completed' && batch.package_date && (
                    <div className="text-sm text-green-600">
                      Packaged {formatDate(batch.package_date)}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Dialogs */}
      {selectedBatch && (
        <BatchDetailDialog
          batch={selectedBatch}
          open={!!selectedBatch}
          onOpenChange={(open) => !open && setSelectedBatch(null)}
          onRefresh={refetch}
        />
      )}

      {brewDayBatch && (
        <StartBrewDayDialog
          batch={brewDayBatch}
          open={!!brewDayBatch}
          onOpenChange={(open) => !open && setBrewDayBatch(null)}
          onSuccess={() => {
            refetch();
            router.push(`/production/batches/${brewDayBatch.id}/brew-day`);
          }}
        />
      )}
    </div>
  );
}
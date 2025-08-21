'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { 
  Plus, 
  FlaskConical, 
  Activity, 
  AlertCircle,
  CheckCircle,
  Clock,
  TrendingUp,
  Package,
  Calendar,
  ChevronRight,
  Microscope,
} from 'lucide-react';
import { Button } from '@brewcrush/ui';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@brewcrush/ui';
import { Badge } from '@brewcrush/ui';
import { Progress } from '@brewcrush/ui';
import { Alert, AlertDescription } from '@brewcrush/ui';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@brewcrush/ui';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@brewcrush/ui';
import { createClient } from '@/lib/supabase/client';
import { useUserRole } from '@/hooks/useUserRole';
import { YeastStrain, YeastBatch } from '@/types/production';
import { formatDate, getDaysBetween } from '@/lib/utils';
import { CreateYeastStrainDialog } from '@/components/yeast/CreateYeastStrainDialog';
import { CreateYeastBatchDialog } from '@/components/yeast/CreateYeastBatchDialog';
import { YeastBatchDetailDialog } from '@/components/yeast/YeastBatchDetailDialog';
import { HarvestYeastDialog } from '@/components/yeast/HarvestYeastDialog';

interface YeastStrain {
  id: string;
  workspace_id: string;
  name: string;
  lab_source?: string;
  strain_code?: string;
  type: 'ale' | 'lager' | 'wild' | 'other';
  attenuation_min?: number;
  attenuation_max?: number;
  temperature_min?: number;
  temperature_max?: number;
  flocculation?: 'low' | 'medium' | 'high' | 'very_high';
  alcohol_tolerance?: number;
  recommended_max_generation?: number;
  notes?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface YeastBatchWithDetails extends YeastBatch {
  strain?: YeastStrain;
  batches?: Array<{
    id: string;
    batch_number: string;
    status: string;
    tank?: {
      name: string;
    };
  }>;
}

export default function YeastPage() {
  const supabase = createClient();
  const { role } = useUserRole();
  const [showCreateStrain, setShowCreateStrain] = useState(false);
  const [showCreateBatch, setShowCreateBatch] = useState(false);
  const [selectedYeastBatch, setSelectedYeastBatch] = useState<YeastBatchWithDetails | null>(null);
  const [harvestYeastBatch, setHarvestYeastBatch] = useState<YeastBatchWithDetails | null>(null);

  const canManageYeast = role === 'admin' || role === 'brewer';

  // Fetch yeast strains
  const { data: strains, isLoading: strainsLoading, refetch: refetchStrains } = useQuery({
    queryKey: ['yeast-strains'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('yeast_strains')
        .select('*')
        .eq('is_active', true)
        .order('name');

      if (error) throw error;
      return data as YeastStrain[];
    },
  });

  // Fetch yeast batches with details
  const { data: yeastBatches, isLoading: batchesLoading, refetch: refetchBatches } = useQuery({
    queryKey: ['yeast-batches'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('yeast_batches')
        .select(`
          *,
          strain:yeast_strains(*),
          batch_yeast_links(
            batch:batches(
              id,
              batch_number,
              status,
              tank:tanks(name)
            )
          )
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Transform the data to include batches array
      return (data as any[]).map(yb => ({
        ...yb,
        batches: yb.batch_yeast_links?.map((link: any) => link.batch) || [],
      })) as YeastBatchWithDetails[];
    },
  });

  // Calculate statistics
  const activeYeastBatches = yeastBatches?.filter(yb => !yb.harvest_at) || [];
  const harvestedYeastBatches = yeastBatches?.filter(yb => yb.harvest_at) || [];
  const harvestReadyBatches = activeYeastBatches.filter(yb => {
    if (!yb.pitch_at) return false;
    const daysSincePitch = getDaysBetween(yb.pitch_at);
    return daysSincePitch >= 5 && daysSincePitch <= 10;
  });

  const averageGeneration = yeastBatches?.length > 0
    ? yeastBatches.reduce((sum, yb) => sum + yb.generation, 0) / yeastBatches.length
    : 0;

  const getGenerationBadge = (generation: number, maxGen?: number) => {
    const max = maxGen || 10;
    const percentage = (generation / max) * 100;
    
    if (percentage >= 90) {
      return <Badge variant="destructive">Gen {generation}</Badge>;
    } else if (percentage >= 70) {
      return <Badge variant="secondary" className="bg-yellow-100 text-yellow-800">Gen {generation}</Badge>;
    }
    return <Badge variant="secondary">Gen {generation}</Badge>;
  };

  const getViabilityBadge = (viability?: string) => {
    if (!viability) return null;
    
    const viabilityLower = viability.toLowerCase();
    if (viabilityLower.includes('high') || viabilityLower.includes('excellent')) {
      return <Badge variant="default" className="bg-green-500">High Viability</Badge>;
    } else if (viabilityLower.includes('medium') || viabilityLower.includes('moderate')) {
      return <Badge variant="secondary">Medium Viability</Badge>;
    } else if (viabilityLower.includes('low') || viabilityLower.includes('poor')) {
      return <Badge variant="destructive">Low Viability</Badge>;
    }
    return <Badge variant="outline">{viability}</Badge>;
  };

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
        <div>
          <h1 className="text-3xl font-bold">Yeast Management</h1>
          <p className="text-muted-foreground">
            Track yeast strains, generations, and viability
          </p>
        </div>
        {canManageYeast && (
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => setShowCreateStrain(true)}
            >
              <Plus className="mr-2 h-4 w-4" />
              New Strain
            </Button>
            <Button onClick={() => setShowCreateBatch(true)}>
              <Plus className="mr-2 h-4 w-4" />
              New Yeast Batch
            </Button>
          </div>
        )}
      </div>

      {/* Statistics Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Active Pitches</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{activeYeastBatches.length}</div>
            <p className="text-xs text-muted-foreground">
              Currently fermenting
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Harvest Ready</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{harvestReadyBatches.length}</div>
            <p className="text-xs text-muted-foreground">
              5-10 days since pitch
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Available Strains</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{strains?.length || 0}</div>
            <p className="text-xs text-muted-foreground">
              Active strains
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Avg Generation</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{averageGeneration.toFixed(1)}</div>
            <p className="text-xs text-muted-foreground">
              Across all batches
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Harvest Ready Alert */}
      {harvestReadyBatches.length > 0 && (
        <Alert className="mb-6">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="flex items-center justify-between">
            <span>
              {harvestReadyBatches.length} yeast {harvestReadyBatches.length === 1 ? 'batch is' : 'batches are'} ready for harvest
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setHarvestYeastBatch(harvestReadyBatches[0])}
            >
              Harvest First
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Main Content Tabs */}
      <Tabs defaultValue="batches" className="space-y-4">
        <TabsList>
          <TabsTrigger value="batches">Yeast Batches</TabsTrigger>
          <TabsTrigger value="strains">Strains</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        <TabsContent value="batches" className="space-y-4">
          {/* Active Yeast Batches */}
          <Card>
            <CardHeader>
              <CardTitle>Active Yeast Batches</CardTitle>
              <CardDescription>
                Currently pitched yeast that can be harvested
              </CardDescription>
            </CardHeader>
            <CardContent>
              {activeYeastBatches.length === 0 ? (
                <p className="text-muted-foreground text-center py-4">
                  No active yeast batches
                </p>
              ) : (
                <div className="space-y-3">
                  {activeYeastBatches.map((yeastBatch) => {
                    const daysSincePitch = yeastBatch.pitch_at 
                      ? getDaysBetween(yeastBatch.pitch_at)
                      : 0;
                    const isHarvestReady = daysSincePitch >= 5 && daysSincePitch <= 10;
                    
                    return (
                      <div
                        key={yeastBatch.id}
                        className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 cursor-pointer"
                        onClick={() => setSelectedYeastBatch(yeastBatch)}
                      >
                        <div className="flex items-center gap-4">
                          <Microscope className="h-8 w-8 text-muted-foreground" />
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="font-medium">{yeastBatch.strain?.name}</p>
                              {getGenerationBadge(
                                yeastBatch.generation,
                                yeastBatch.strain?.recommended_max_generation
                              )}
                              {getViabilityBadge(yeastBatch.viability_notes)}
                            </div>
                            <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
                              {yeastBatch.strain?.lab_source && (
                                <span>Source: {yeastBatch.strain.lab_source}</span>
                              )}
                              {yeastBatch.pitch_at && (
                                <span>Pitched {daysSincePitch} days ago</span>
                              )}
                              {yeastBatch.batches?.[0] && (
                                <span>In {yeastBatch.batches[0].batch_number}</span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {isHarvestReady && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={(e) => {
                                e.stopPropagation();
                                setHarvestYeastBatch(yeastBatch);
                              }}
                            >
                              <Package className="mr-2 h-3 w-3" />
                              Harvest
                            </Button>
                          )}
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Harvested Yeast */}
          <Card>
            <CardHeader>
              <CardTitle>Harvested Yeast</CardTitle>
              <CardDescription>
                Available yeast for pitching
              </CardDescription>
            </CardHeader>
            <CardContent>
              {harvestedYeastBatches.length === 0 ? (
                <p className="text-muted-foreground text-center py-4">
                  No harvested yeast available
                </p>
              ) : (
                <div className="space-y-3">
                  {harvestedYeastBatches.map((yeastBatch) => {
                    const daysSinceHarvest = yeastBatch.harvest_at 
                      ? getDaysBetween(yeastBatch.harvest_at)
                      : 0;
                    
                    return (
                      <div
                        key={yeastBatch.id}
                        className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 cursor-pointer"
                        onClick={() => setSelectedYeastBatch(yeastBatch)}
                      >
                        <div className="flex items-center gap-4">
                          <FlaskConical className="h-8 w-8 text-muted-foreground" />
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="font-medium">{yeastBatch.strain?.name}</p>
                              {getGenerationBadge(
                                yeastBatch.generation,
                                yeastBatch.strain?.recommended_max_generation
                              )}
                              {getViabilityBadge(yeastBatch.viability_notes)}
                            </div>
                            <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
                              <span>Harvested {daysSinceHarvest} days ago</span>
                              {daysSinceHarvest > 14 && (
                                <Badge variant="destructive" className="text-xs">
                                  Consider viability test
                                </Badge>
                              )}
                            </div>
                          </div>
                        </div>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="strains" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Yeast Strains</CardTitle>
              <CardDescription>
                All available yeast strains in your brewery
              </CardDescription>
            </CardHeader>
            <CardContent>
              {strains?.length === 0 ? (
                <p className="text-muted-foreground text-center py-4">
                  No yeast strains configured
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Strain</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Attenuation</TableHead>
                      <TableHead>Temp Range</TableHead>
                      <TableHead>Max Gen</TableHead>
                      <TableHead>Flocculation</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {strains?.map((strain) => (
                      <TableRow key={strain.id}>
                        <TableCell>
                          <div>
                            <p className="font-medium">{strain.name}</p>
                            {strain.lab_source && (
                              <p className="text-sm text-muted-foreground">
                                {strain.lab_source} {strain.strain_code && `(${strain.strain_code})`}
                              </p>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="capitalize">{strain.type}</TableCell>
                        <TableCell>
                          {strain.attenuation_min && strain.attenuation_max
                            ? `${strain.attenuation_min}-${strain.attenuation_max}%`
                            : '-'}
                        </TableCell>
                        <TableCell>
                          {strain.temperature_min && strain.temperature_max
                            ? `${strain.temperature_min}-${strain.temperature_max}°C`
                            : '-'}
                        </TableCell>
                        <TableCell>
                          {strain.recommended_max_generation || '-'}
                        </TableCell>
                        <TableCell className="capitalize">
                          {strain.flocculation || '-'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Yeast History</CardTitle>
              <CardDescription>
                All yeast pitches and harvests
              </CardDescription>
            </CardHeader>
            <CardContent>
              {yeastBatches?.length === 0 ? (
                <p className="text-muted-foreground text-center py-4">
                  No yeast history available
                </p>
              ) : (
                <div className="space-y-2">
                  {yeastBatches?.map((yeastBatch) => (
                    <div
                      key={yeastBatch.id}
                      className="flex items-center justify-between py-2 border-b last:border-0"
                    >
                      <div>
                        <p className="font-medium">
                          {yeastBatch.strain?.name} - Generation {yeastBatch.generation}
                        </p>
                        <div className="flex items-center gap-4 text-sm text-muted-foreground">
                          {yeastBatch.pitch_at && (
                            <span>Pitched: {formatDate(yeastBatch.pitch_at)}</span>
                          )}
                          {yeastBatch.harvest_at && (
                            <span>Harvested: {formatDate(yeastBatch.harvest_at)}</span>
                          )}
                          {yeastBatch.batches?.[0] && (
                            <span>Batch: {yeastBatch.batches[0].batch_number}</span>
                          )}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setSelectedYeastBatch(yeastBatch)}
                      >
                        View
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Dialogs */}
      {showCreateStrain && (
        <CreateYeastStrainDialog
          open={showCreateStrain}
          onOpenChange={setShowCreateStrain}
          onSuccess={refetchStrains}
        />
      )}

      {showCreateBatch && strains && (
        <CreateYeastBatchDialog
          strains={strains}
          open={showCreateBatch}
          onOpenChange={setShowCreateBatch}
          onSuccess={refetchBatches}
        />
      )}

      {selectedYeastBatch && (
        <YeastBatchDetailDialog
          yeastBatch={selectedYeastBatch}
          open={!!selectedYeastBatch}
          onOpenChange={(open) => !open && setSelectedYeastBatch(null)}
          onRefresh={refetchBatches}
        />
      )}

      {harvestYeastBatch && (
        <HarvestYeastDialog
          yeastBatch={harvestYeastBatch}
          open={!!harvestYeastBatch}
          onOpenChange={(open) => !open && setHarvestYeastBatch(null)}
          onSuccess={refetchBatches}
        />
      )}
    </div>
  );
}
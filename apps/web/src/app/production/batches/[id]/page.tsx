'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { 
  FlaskConical, 
  Calendar, 
  Package, 
  CheckCircle, 
  AlertCircle, 
  Clock,
  TrendingUp,
  TrendingDown,
  Activity,
  Droplets,
  Beaker,
  Archive,
  XCircle,
  MoreVertical,
  ChevronLeft,
  Microscope,
  DollarSign,
  FileText,
  Thermometer,
  Timer,
  Target,
  ArrowRight,
  Edit,
  Play,
  Pause,
  Check,
  X,
  AlertTriangle,
  Info,
  BarChart3
} from 'lucide-react';
import { Button } from '@brewcrush/ui';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@brewcrush/ui';
import { Badge } from '@brewcrush/ui';
import { Progress } from '@brewcrush/ui';
import { Alert, AlertDescription, AlertTitle } from '@brewcrush/ui';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@brewcrush/ui';
import { Separator } from '@brewcrush/ui';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@brewcrush/ui';
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
import { formatDate, formatDateTime, getDaysBetween, formatNumber, calculateABV } from '@/lib/utils';
import { useToast } from '@brewcrush/ui';
import { FermentationChart } from '@/components/production/FermentationChart';
import { QuickLogButton } from '@/components/production/QuickLogButton';
import { BatchExport } from '@/components/production/BatchExport';

interface BatchDetail {
  id: string;
  workspace_id: string;
  batch_number: string;
  recipe_version_id: string;
  recipe_name?: string;
  recipe_style?: string;
  status: 'planned' | 'brewing' | 'fermenting' | 'conditioning' | 'packaging' | 'completed' | 'cancelled';
  brew_date?: string;
  target_volume?: number;
  actual_volume?: number;
  target_og?: number;
  actual_og?: number;
  target_fg?: number;
  actual_fg?: number;
  target_abv?: number;
  actual_abv?: number;
  target_ibu?: number;
  target_srm?: number;
  target_ph?: number;
  tank_id?: string;
  tank_name?: string;
  ferment_start_date?: string;
  ferment_end_date?: string;
  condition_start_date?: string;
  condition_end_date?: string;
  package_date?: string;
  total_cost?: number;
  cost_per_liter?: number;
  notes?: string;
  created_at: string;
  updated_at: string;
  created_by?: string;
  yeast_batch?: {
    id: string;
    strain_name: string;
    generation: number;
    pitch_at: string;
    harvest_at?: string;
  };
  owner_entity?: {
    id: string;
    name: string;
    permit_number?: string;
  };
}

interface FermReading {
  id: string;
  batch_id: string;
  reading_at: string;
  sg?: number;
  temp?: number;
  ph?: number;
  notes?: string;
  created_by?: string;
}

interface PackagingRun {
  id: string;
  batch_id: string;
  run_at: string;
  sku_name: string;
  units_produced: number;
  loss_percentage?: number;
  lot_code?: string;
  total_cost?: number;
  cost_per_unit?: number;
}

interface InventoryConsumption {
  id: string;
  item_name: string;
  item_type: string;
  qty_consumed: number;
  uom: string;
  unit_cost?: number;
  total_cost?: number;
  lot_code?: string;
}

interface BatchEvent {
  id: string;
  event_type: string;
  event_description: string;
  event_at: string;
  user_name?: string;
  metadata?: any;
}

interface QATest {
  id: string;
  test_type: string;
  test_date: string;
  result: string;
  passed: boolean;
  notes?: string;
  performed_by?: string;
}

export default function BatchDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { role } = useUserRole();
  const { toast } = useToast();
  const [selectedTab, setSelectedTab] = useState('overview');

  const canManageBatch = role === 'admin' || role === 'brewer';
  const canViewCosts = role === 'admin' || role === 'accounting' || role === 'inventory';

  // Fetch batch details
  const { data: batch, isLoading: batchLoading, refetch: refetchBatch } = useQuery({
    queryKey: ['batch-detail', params.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_batch_details')
        .select('*')
        .eq('id', params.id)
        .single();

      if (error) throw error;
      return data as BatchDetail;
    },
  });

  // Fetch fermentation readings
  const { data: fermReadings, refetch: refetchFermReadings } = useQuery({
    queryKey: ['ferm-readings', params.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ferm_readings')
        .select('*')
        .eq('batch_id', params.id)
        .order('reading_at', { ascending: true });

      if (error) throw error;
      return data as FermReading[];
    },
    enabled: !!batch && ['fermenting', 'conditioning', 'packaging', 'completed'].includes(batch.status),
  });

  // Fetch packaging runs
  const { data: packagingRuns } = useQuery({
    queryKey: ['packaging-runs', params.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_packaging_runs')
        .select('*')
        .eq('batch_id', params.id)
        .order('run_at', { ascending: false });

      if (error) throw error;
      return data as PackagingRun[];
    },
    enabled: !!batch && ['packaging', 'completed'].includes(batch.status),
  });

  // Fetch inventory consumption
  const { data: consumption } = useQuery({
    queryKey: ['batch-consumption', params.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_batch_consumption')
        .select('*')
        .eq('batch_id', params.id)
        .order('item_type', { ascending: true });

      if (error) throw error;
      return data as InventoryConsumption[];
    },
    enabled: !!batch && canViewCosts,
  });

  // Fetch batch events/timeline
  const { data: events } = useQuery({
    queryKey: ['batch-events', params.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_batch_events')
        .select('*')
        .eq('batch_id', params.id)
        .order('event_at', { ascending: false });

      if (error) throw error;
      return data as BatchEvent[];
    },
  });

  // Fetch QA tests
  const { data: qaTests } = useQuery({
    queryKey: ['batch-qa', params.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('qa_tests')
        .select('*')
        .eq('batch_id', params.id)
        .order('test_date', { ascending: false });

      if (error) throw error;
      return data as QATest[];
    },
  });

  // Update batch status mutation
  const updateStatusMutation = useMutation({
    mutationFn: async (newStatus: string) => {
      const { data, error } = await supabase
        .rpc('update_batch_status', {
          p_batch_id: params.id,
          p_new_status: newStatus,
        });

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['batch-detail', params.id] });
      toast({
        title: 'Status Updated',
        description: 'Batch status has been updated successfully.',
      });
    },
    onError: (error: any) => {
      toast({
        title: 'Error',
        description: error.message || 'Failed to update batch status',
        variant: 'destructive',
      });
    },
  });

  if (batchLoading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="text-center">Loading batch details...</div>
      </div>
    );
  }

  if (!batch) {
    return (
      <div className="container mx-auto px-4 py-8">
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Batch Not Found</AlertTitle>
          <AlertDescription>
            The requested batch could not be found.
          </AlertDescription>
        </Alert>
        <Button 
          className="mt-4"
          onClick={() => router.push('/production/batches')}
        >
          Back to Batches
        </Button>
      </div>
    );
  }

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      planned: 'bg-gray-100 text-gray-800',
      brewing: 'bg-blue-100 text-blue-800',
      fermenting: 'bg-amber-100 text-amber-800',
      conditioning: 'bg-purple-100 text-purple-800',
      packaging: 'bg-green-100 text-green-800',
      completed: 'bg-emerald-100 text-emerald-800',
      cancelled: 'bg-red-100 text-red-800',
    };
    return colors[status] || 'bg-gray-100 text-gray-800';
  };

  const getNextStatus = (currentStatus: string): string | null => {
    const statusFlow: Record<string, string> = {
      planned: 'brewing',
      brewing: 'fermenting',
      fermenting: 'conditioning',
      conditioning: 'packaging',
      packaging: 'completed',
    };
    return statusFlow[currentStatus] || null;
  };

  const calculateProgress = () => {
    const statusValues: Record<string, number> = {
      planned: 0,
      brewing: 20,
      fermenting: 40,
      conditioning: 60,
      packaging: 80,
      completed: 100,
      cancelled: 0,
    };
    return statusValues[batch.status] || 0;
  };

  const calculateDaysInStatus = () => {
    if (!batch) return 0;
    
    let startDate: string | undefined;
    switch (batch.status) {
      case 'fermenting':
        startDate = batch.ferment_start_date;
        break;
      case 'conditioning':
        startDate = batch.condition_start_date;
        break;
      case 'packaging':
        startDate = batch.package_date;
        break;
      default:
        startDate = batch.brew_date;
    }
    
    if (!startDate) return 0;
    return getDaysBetween(new Date(startDate), new Date());
  };

  const formatChartData = () => {
    if (!fermReadings || fermReadings.length === 0) return [];
    
    return fermReadings.map(reading => ({
      date: formatDate(reading.reading_at),
      sg: reading.sg,
      temp: reading.temp,
      ph: reading.ph,
    }));
  };

  const calculateCOGS = () => {
    if (!consumption || !canViewCosts) return null;
    
    const breakdown = {
      ingredients: 0,
      packaging: 0,
      other: 0,
      total: 0,
    };
    
    consumption.forEach(item => {
      const cost = item.total_cost || 0;
      breakdown.total += cost;
      
      if (item.item_type === 'raw') {
        breakdown.ingredients += cost;
      } else if (item.item_type === 'packaging') {
        breakdown.packaging += cost;
      } else {
        breakdown.other += cost;
      }
    });
    
    return breakdown;
  };

  const cogsBreakdown = calculateCOGS();

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => router.push('/production/batches')}
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold">{batch.batch_number}</h1>
              <Badge className={getStatusColor(batch.status)}>
                {batch.status}
              </Badge>
            </div>
            <div className="flex items-center gap-4 mt-1 text-muted-foreground">
              <span>{batch.recipe_name}</span>
              {batch.recipe_style && (
                <>
                  <span>•</span>
                  <span>{batch.recipe_style}</span>
                </>
              )}
              {batch.target_volume && (
                <>
                  <span>•</span>
                  <span>{batch.target_volume}L</span>
                </>
              )}
            </div>
          </div>
        </div>
        
        <div className="flex gap-2">
          <BatchExport 
            batch={batch}
            fermReadings={fermReadings}
          />
          {canManageBatch && batch.status === 'brewing' && (
            <Button
              onClick={() => router.push(`/production/batches/${params.id}/brew-day`)}
            >
              <Play className="mr-2 h-4 w-4" />
              Continue Brew Day
            </Button>
          )}
          {canManageBatch && batch.status === 'conditioning' && (
            <Button
              variant="outline"
              onClick={() => router.push('/packaging')}
            >
              <Package className="mr-2 h-4 w-4" />
              Start Packaging
            </Button>
          )}
          {canManageBatch && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuLabel>Actions</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {getNextStatus(batch.status) && (
                  <DropdownMenuItem
                    onClick={() => updateStatusMutation.mutate(getNextStatus(batch.status)!)}
                  >
                    <ArrowRight className="mr-2 h-4 w-4" />
                    Move to {getNextStatus(batch.status)}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem>
                  <Edit className="mr-2 h-4 w-4" />
                  Edit Batch
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <FileText className="mr-2 h-4 w-4" />
                  Generate Report
                </DropdownMenuItem>
                {batch.status === 'planned' && (
                  <DropdownMenuItem className="text-destructive">
                    <XCircle className="mr-2 h-4 w-4" />
                    Cancel Batch
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {/* Progress Bar */}
      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>Production Progress</span>
              <span>{calculateProgress()}%</span>
            </div>
            <Progress value={calculateProgress()} className="h-2" />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Planned</span>
              <span>Brewing</span>
              <span>Fermenting</span>
              <span>Conditioning</span>
              <span>Packaging</span>
              <span>Complete</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Brew Date</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {batch.brew_date ? formatDate(batch.brew_date) : 'Not scheduled'}
            </div>
            {batch.status !== 'planned' && batch.brew_date && (
              <p className="text-xs text-muted-foreground mt-1">
                {getDaysBetween(new Date(batch.brew_date), new Date())} days ago
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Volume</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {batch.actual_volume || batch.target_volume || 0}L
            </div>
            {batch.actual_volume && batch.target_volume && (
              <p className="text-xs text-muted-foreground mt-1">
                {((batch.actual_volume / batch.target_volume) * 100).toFixed(1)}% of target
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">ABV</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {batch.actual_abv 
                ? `${batch.actual_abv.toFixed(1)}%`
                : batch.actual_og && batch.actual_fg
                ? `${calculateABV(batch.actual_og, batch.actual_fg).toFixed(1)}%`
                : batch.target_abv
                ? `${batch.target_abv.toFixed(1)}%*`
                : 'TBD'}
            </div>
            {batch.target_abv && !batch.actual_abv && (
              <p className="text-xs text-muted-foreground mt-1">
                *Target
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Status Duration</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {calculateDaysInStatus()} days
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              In {batch.status} status
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Main Content Tabs */}
      <Tabs value={selectedTab} onValueChange={setSelectedTab} className="space-y-4">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="fermentation">
            Fermentation
            {fermReadings && fermReadings.length > 0 && (
              <Badge variant="secondary" className="ml-2">
                {fermReadings.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="qa">QA & Testing</TabsTrigger>
          <TabsTrigger value="costs">
            Costs
            {!canViewCosts && <X className="ml-1 h-3 w-3" />}
          </TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Batch Information */}
            <Card>
              <CardHeader>
                <CardTitle>Batch Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Recipe</p>
                    <p className="font-medium">{batch.recipe_name || 'N/A'}</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Style</p>
                    <p className="font-medium">{batch.recipe_style || 'N/A'}</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Tank</p>
                    <p className="font-medium">{batch.tank_name || 'Not assigned'}</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Yeast</p>
                    {batch.yeast_batch ? (
                      <p className="font-medium">
                        {batch.yeast_batch.strain_name} (Gen {batch.yeast_batch.generation})
                      </p>
                    ) : (
                      <p className="font-medium">Not pitched</p>
                    )}
                  </div>
                </div>
                
                {batch.owner_entity && (
                  <div className="pt-3 border-t">
                    <p className="text-sm font-medium text-muted-foreground mb-1">Owner/Contract</p>
                    <p className="font-medium">{batch.owner_entity.name}</p>
                    {batch.owner_entity.permit_number && (
                      <p className="text-sm text-muted-foreground">
                        Permit: {batch.owner_entity.permit_number}
                      </p>
                    )}
                  </div>
                )}
                
                {batch.notes && (
                  <div className="pt-3 border-t">
                    <p className="text-sm font-medium text-muted-foreground mb-1">Notes</p>
                    <p className="text-sm">{batch.notes}</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Gravity & Specifications */}
            <Card>
              <CardHeader>
                <CardTitle>Specifications</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium">Original Gravity</span>
                      <div className="flex items-center gap-2">
                        {batch.actual_og && (
                          <span className="font-bold">{batch.actual_og.toFixed(3)}</span>
                        )}
                        {batch.target_og && (
                          <span className="text-sm text-muted-foreground">
                            (Target: {batch.target_og.toFixed(3)})
                          </span>
                        )}
                      </div>
                    </div>
                    {batch.target_og && batch.actual_og && (
                      <Progress 
                        value={(batch.actual_og / batch.target_og) * 100} 
                        className="h-2"
                      />
                    )}
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium">Final Gravity</span>
                      <div className="flex items-center gap-2">
                        {batch.actual_fg && (
                          <span className="font-bold">{batch.actual_fg.toFixed(3)}</span>
                        )}
                        {batch.target_fg && (
                          <span className="text-sm text-muted-foreground">
                            (Target: {batch.target_fg.toFixed(3)})
                          </span>
                        )}
                      </div>
                    </div>
                    {batch.target_fg && batch.actual_fg && (
                      <Progress 
                        value={(batch.actual_fg / batch.target_fg) * 100} 
                        className="h-2"
                      />
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-4 pt-3 border-t">
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">IBU</p>
                      <p className="font-medium">{batch.target_ibu || 'N/A'}</p>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">SRM</p>
                      <p className="font-medium">{batch.target_srm || 'N/A'}</p>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">pH</p>
                      <p className="font-medium">{batch.target_ph || 'N/A'}</p>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Attenuation</p>
                      <p className="font-medium">
                        {batch.actual_og && batch.actual_fg
                          ? `${(((batch.actual_og - batch.actual_fg) / (batch.actual_og - 1)) * 100).toFixed(1)}%`
                          : 'N/A'}
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Packaging Runs */}
          {packagingRuns && packagingRuns.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Packaging Runs</CardTitle>
                <CardDescription>
                  Completed packaging operations for this batch
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>SKU</TableHead>
                      <TableHead>Units</TableHead>
                      <TableHead>Loss %</TableHead>
                      <TableHead>Lot Code</TableHead>
                      {canViewCosts && <TableHead>Cost/Unit</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {packagingRuns.map((run) => (
                      <TableRow key={run.id}>
                        <TableCell>{formatDate(run.run_at)}</TableCell>
                        <TableCell>{run.sku_name}</TableCell>
                        <TableCell>{run.units_produced}</TableCell>
                        <TableCell>
                          {run.loss_percentage ? `${run.loss_percentage.toFixed(1)}%` : 'N/A'}
                        </TableCell>
                        <TableCell>
                          <code className="text-xs">{run.lot_code}</code>
                        </TableCell>
                        {canViewCosts && (
                          <TableCell>
                            {run.cost_per_unit ? `$${run.cost_per_unit.toFixed(2)}` : 'N/A'}
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Fermentation Tab */}
        <TabsContent value="fermentation" className="space-y-4">
          {/* QuickLog FAB for mobile */}
          {canManageBatch && batch.status === 'fermenting' && (
            <QuickLogButton
              batchId={batch.id}
              batchNumber={batch.batch_number}
              tankName={batch.tank_name}
              currentSG={fermReadings?.[0]?.sg}
              currentTemp={fermReadings?.[0]?.temp}
              currentPH={fermReadings?.[0]?.ph}
              lastReading={fermReadings?.[0] ? {
                sg: fermReadings[0].sg,
                temp: fermReadings[0].temp,
                ph: fermReadings[0].ph,
                reading_at: fermReadings[0].reading_at
              } : undefined}
              variant="fab"
              onSave={() => refetchFermReadings()}
            />
          )}

          {fermReadings && fermReadings.length > 0 ? (
            <>
              {/* Enhanced Fermentation Chart with QA Specs */}
              <FermentationChart
                readings={fermReadings}
                qaSpecs={{
                  target_og: batch.target_og,
                  target_fg: batch.target_fg,
                  target_abv: batch.target_abv,
                  target_ibu: batch.target_ibu,
                  temp_min: 18, // These would come from recipe in production
                  temp_max: 22,
                  ph_min: 4.2,
                  ph_max: 4.6,
                }}
                batchStatus={batch.status}
                showAnomalies={true}
              />

              {/* Readings Table */}
              <Card>
                <CardHeader>
                  <CardTitle>Fermentation Readings</CardTitle>
                  <CardDescription>
                    All recorded measurements for this batch
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date/Time</TableHead>
                        <TableHead>SG</TableHead>
                        <TableHead>Temp (°C)</TableHead>
                        <TableHead>pH</TableHead>
                        <TableHead>Notes</TableHead>
                        <TableHead>Logged By</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {fermReadings.map((reading) => (
                        <TableRow key={reading.id}>
                          <TableCell>{formatDateTime(reading.reading_at)}</TableCell>
                          <TableCell>{reading.sg?.toFixed(3) || 'N/A'}</TableCell>
                          <TableCell>{reading.temp?.toFixed(1) || 'N/A'}</TableCell>
                          <TableCell>{reading.ph?.toFixed(2) || 'N/A'}</TableCell>
                          <TableCell className="max-w-xs truncate">
                            {reading.notes || '-'}
                          </TableCell>
                          <TableCell>{reading.created_by || 'System'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </>
          ) : (
            <Card>
              <CardContent className="text-center py-8">
                <Thermometer className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
                <p className="text-muted-foreground">No fermentation readings recorded yet</p>
                {canManageBatch && batch.status === 'fermenting' && (
                  <QuickLogButton
                    batchId={batch.id}
                    batchNumber={batch.batch_number}
                    tankName={batch.tank_name}
                    variant="button"
                    className="mt-4"
                    onSave={() => refetchFermReadings()}
                  />
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* QA & Testing Tab */}
        <TabsContent value="qa" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Quality Assurance</CardTitle>
              <CardDescription>
                Test results and quality control data
              </CardDescription>
            </CardHeader>
            <CardContent>
              {qaTests && qaTests.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Test Date</TableHead>
                      <TableHead>Test Type</TableHead>
                      <TableHead>Result</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Notes</TableHead>
                      <TableHead>Performed By</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {qaTests.map((test) => (
                      <TableRow key={test.id}>
                        <TableCell>{formatDate(test.test_date)}</TableCell>
                        <TableCell>{test.test_type}</TableCell>
                        <TableCell>{test.result}</TableCell>
                        <TableCell>
                          <Badge variant={test.passed ? 'default' : 'destructive'}>
                            {test.passed ? 'Passed' : 'Failed'}
                          </Badge>
                        </TableCell>
                        <TableCell className="max-w-xs truncate">
                          {test.notes || '-'}
                        </TableCell>
                        <TableCell>{test.performed_by || 'N/A'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="text-center py-8">
                  <Beaker className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
                  <p className="text-muted-foreground">No QA tests recorded</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* QA Specifications Comparison */}
          <Card>
            <CardHeader>
              <CardTitle>Specification Compliance</CardTitle>
              <CardDescription>
                Actual values vs. target specifications
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {batch.target_og && (
                  <div className="flex items-center justify-between p-3 rounded-lg border">
                    <div className="flex items-center gap-3">
                      <Target className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium">Original Gravity</span>
                    </div>
                    <div className="flex items-center gap-4">
                      <span>Target: {batch.target_og.toFixed(3)}</span>
                      <span>Actual: {batch.actual_og?.toFixed(3) || 'N/A'}</span>
                      {batch.actual_og && (
                        <Badge variant={
                          Math.abs(batch.actual_og - batch.target_og) <= 0.005 ? 'default' : 'warning'
                        }>
                          {Math.abs(batch.actual_og - batch.target_og) <= 0.005 ? 'In Spec' : 'Out of Spec'}
                        </Badge>
                      )}
                    </div>
                  </div>
                )}
                
                {batch.target_fg && (
                  <div className="flex items-center justify-between p-3 rounded-lg border">
                    <div className="flex items-center gap-3">
                      <Target className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium">Final Gravity</span>
                    </div>
                    <div className="flex items-center gap-4">
                      <span>Target: {batch.target_fg.toFixed(3)}</span>
                      <span>Actual: {batch.actual_fg?.toFixed(3) || 'N/A'}</span>
                      {batch.actual_fg && (
                        <Badge variant={
                          Math.abs(batch.actual_fg - batch.target_fg) <= 0.003 ? 'default' : 'warning'
                        }>
                          {Math.abs(batch.actual_fg - batch.target_fg) <= 0.003 ? 'In Spec' : 'Out of Spec'}
                        </Badge>
                      )}
                    </div>
                  </div>
                )}
                
                {batch.target_abv && (
                  <div className="flex items-center justify-between p-3 rounded-lg border">
                    <div className="flex items-center gap-3">
                      <Target className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium">ABV</span>
                    </div>
                    <div className="flex items-center gap-4">
                      <span>Target: {batch.target_abv.toFixed(1)}%</span>
                      <span>
                        Actual: {
                          batch.actual_abv?.toFixed(1) || 
                          (batch.actual_og && batch.actual_fg 
                            ? calculateABV(batch.actual_og, batch.actual_fg).toFixed(1)
                            : 'N/A')
                        }%
                      </span>
                      {(batch.actual_abv || (batch.actual_og && batch.actual_fg)) && (
                        <Badge variant={
                          Math.abs((batch.actual_abv || calculateABV(batch.actual_og!, batch.actual_fg!)) - batch.target_abv) <= 0.5 
                            ? 'default' 
                            : 'warning'
                        }>
                          {Math.abs((batch.actual_abv || calculateABV(batch.actual_og!, batch.actual_fg!)) - batch.target_abv) <= 0.5 
                            ? 'In Spec' 
                            : 'Out of Spec'}
                        </Badge>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Costs Tab */}
        <TabsContent value="costs" className="space-y-4">
          {canViewCosts ? (
            <>
              {/* COGS Summary */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-medium">Total Cost</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">
                      ${cogsBreakdown?.total.toFixed(2) || '0.00'}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      All materials and overhead
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-medium">Cost per Liter</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">
                      ${batch.cost_per_liter?.toFixed(2) || 
                        (cogsBreakdown && batch.actual_volume 
                          ? (cogsBreakdown.total / batch.actual_volume).toFixed(2)
                          : '0.00')}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Based on actual volume
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-medium">Yield Efficiency</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">
                      {batch.actual_volume && batch.target_volume
                        ? `${((batch.actual_volume / batch.target_volume) * 100).toFixed(1)}%`
                        : 'N/A'}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Actual vs. target volume
                    </p>
                  </CardContent>
                </Card>
              </div>

              {/* Cost Breakdown */}
              <Card>
                <CardHeader>
                  <CardTitle>Cost Breakdown</CardTitle>
                  <CardDescription>
                    Materials consumed and their costs
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {consumption && consumption.length > 0 ? (
                    <>
                      <div className="grid grid-cols-3 gap-4 mb-4">
                        <div className="text-center p-4 rounded-lg bg-muted">
                          <p className="text-sm font-medium text-muted-foreground">Ingredients</p>
                          <p className="text-2xl font-bold mt-1">
                            ${cogsBreakdown?.ingredients.toFixed(2) || '0.00'}
                          </p>
                        </div>
                        <div className="text-center p-4 rounded-lg bg-muted">
                          <p className="text-sm font-medium text-muted-foreground">Packaging</p>
                          <p className="text-2xl font-bold mt-1">
                            ${cogsBreakdown?.packaging.toFixed(2) || '0.00'}
                          </p>
                        </div>
                        <div className="text-center p-4 rounded-lg bg-muted">
                          <p className="text-sm font-medium text-muted-foreground">Other</p>
                          <p className="text-2xl font-bold mt-1">
                            ${cogsBreakdown?.other.toFixed(2) || '0.00'}
                          </p>
                        </div>
                      </div>
                      
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Item</TableHead>
                            <TableHead>Type</TableHead>
                            <TableHead>Quantity</TableHead>
                            <TableHead>Unit Cost</TableHead>
                            <TableHead>Total Cost</TableHead>
                            <TableHead>Lot</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {consumption.map((item) => (
                            <TableRow key={item.id}>
                              <TableCell>{item.item_name}</TableCell>
                              <TableCell>
                                <Badge variant="outline">{item.item_type}</Badge>
                              </TableCell>
                              <TableCell>
                                {formatNumber(item.qty_consumed)} {item.uom}
                              </TableCell>
                              <TableCell>
                                ${item.unit_cost?.toFixed(3) || '0.000'}
                              </TableCell>
                              <TableCell className="font-medium">
                                ${item.total_cost?.toFixed(2) || '0.00'}
                              </TableCell>
                              <TableCell>
                                <code className="text-xs">{item.lot_code || 'N/A'}</code>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </>
                  ) : (
                    <div className="text-center py-8">
                      <DollarSign className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
                      <p className="text-muted-foreground">No consumption data available</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </>
          ) : (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Access Restricted</AlertTitle>
              <AlertDescription>
                You don't have permission to view cost information.
              </AlertDescription>
            </Alert>
          )}
        </TabsContent>

        {/* Timeline Tab */}
        <TabsContent value="timeline">
          <Card>
            <CardHeader>
              <CardTitle>Batch Timeline</CardTitle>
              <CardDescription>
                Complete history of events for this batch
              </CardDescription>
            </CardHeader>
            <CardContent>
              {events && events.length > 0 ? (
                <div className="space-y-4">
                  {events.map((event, index) => (
                    <div key={event.id} className="flex gap-4">
                      <div className="flex flex-col items-center">
                        <div className="rounded-full bg-primary p-2">
                          <Activity className="h-3 w-3 text-primary-foreground" />
                        </div>
                        {index < events.length - 1 && (
                          <div className="w-0.5 flex-1 bg-border mt-2" />
                        )}
                      </div>
                      <div className="flex-1 pb-8">
                        <div className="flex items-start justify-between">
                          <div>
                            <p className="font-medium">{event.event_description}</p>
                            <p className="text-sm text-muted-foreground mt-1">
                              {event.user_name || 'System'} • {formatDateTime(event.event_at)}
                            </p>
                          </div>
                          <Badge variant="outline">{event.event_type}</Badge>
                        </div>
                        {event.metadata && (
                          <div className="mt-2 p-2 rounded bg-muted text-sm">
                            <code>{JSON.stringify(event.metadata, null, 2)}</code>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  <Clock className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
                  <p className="text-muted-foreground">No events recorded</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
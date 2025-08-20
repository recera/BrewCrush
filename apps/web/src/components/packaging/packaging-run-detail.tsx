'use client';

import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { 
  Package, 
  Calendar,
  MapPin,
  FileText,
  Printer,
  Download,
  DollarSign,
  Beaker,
  Info
} from 'lucide-react';
import { Button } from '@brewcrush/ui/components/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@brewcrush/ui/components/card';
import { Badge } from '@brewcrush/ui/components/badge';
import { Progress } from '@brewcrush/ui/components/progress';
import { Separator } from '@brewcrush/ui/components/separator';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@brewcrush/ui/components/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@brewcrush/ui/components/table';
import { Skeleton } from '@brewcrush/ui/components/skeleton';
import { toast } from '@/hooks/use-toast';
import { useSupabase } from '@/hooks/use-supabase';
import { formatCurrency } from '@/lib/utils';

interface PackagingRunDetailProps {
  runId: string;
  open: boolean;
  onClose: () => void;
}

interface PackagingRunData {
  id: string;
  run_number: number;
  packaged_at: string;
  target_quantity: number;
  actual_quantity: number;
  loss_percentage: number;
  total_cogs_cents: number;
  unit_cogs_cents: number;
  cost_method_used: string;
  lot_code_pattern: string;
  notes: string;
  created_at: string;
  metadata: any;
  finished_skus: {
    code: string;
    name: string;
    container_type: string;
    container_size_ml: number;
    pack_size: number;
    barrels_per_unit: number;
  };
  finished_lots: {
    id: string;
    lot_code: string;
    quantity: number;
    quantity_remaining: number;
    unit_cogs_cents: number;
    expiry_date: string | null;
  }[];
  packaging_run_sources: {
    batch_id: string;
    volume_liters: number;
    percentage_of_blend: number;
    allocated_cogs_cents: number;
    batches: {
      batch_number: string;
      brew_date: string;
      actual_volume_liters: number;
      total_cogs_cents: number;
      recipe_versions: {
        recipes: {
          name: string;
          style: string;
        };
      };
      tanks: {
        name: string;
      };
    };
  }[];
  inventory_locations: {
    name: string;
    location_type: string;
  };
  users: {
    full_name: string;
    email: string;
  };
}

export function PackagingRunDetail({ runId, open, onClose }: PackagingRunDetailProps) {
  const { supabase } = useSupabase();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<PackagingRunData | null>(null);

  useEffect(() => {
    if (open && runId) {
      loadPackagingRunDetails();
    }
  }, [open, runId]);

  const loadPackagingRunDetails = async () => {
    try {
      setLoading(true);

      const { data: runData, error } = await supabase
        .from('packaging_runs')
        .select(`
          *,
          finished_skus!inner (
            code,
            name,
            container_type,
            container_size_ml,
            pack_size,
            barrels_per_unit
          ),
          finished_lots (
            id,
            lot_code,
            quantity,
            quantity_remaining,
            unit_cogs_cents,
            expiry_date
          ),
          packaging_run_sources (
            batch_id,
            volume_liters,
            percentage_of_blend,
            allocated_cogs_cents,
            batches!inner (
              batch_number,
              brew_date,
              actual_volume_liters,
              total_cogs_cents,
              recipe_versions!inner (
                recipes!inner (
                  name,
                  style
                )
              ),
              tanks (
                name
              )
            )
          ),
          inventory_locations (
            name,
            location_type
          ),
          users!created_by (
            full_name,
            email
          )
        `)
        .eq('id', runId)
        .single();

      if (error) throw error;

      setData(runData);
    } catch (error) {
      console.error('Error loading packaging run details:', error);
      toast({
        title: 'Error',
        description: 'Failed to load packaging run details',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const handleExportLabels = async () => {
    try {
      // TODO: Call Edge Function to generate PDF labels
      toast({
        title: 'Generating labels...',
        description: 'Your labels will download shortly'
      });
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to generate labels',
        variant: 'destructive'
      });
    }
  };

  const handlePrintManifest = async () => {
    try {
      // TODO: Call Edge Function to generate manifest PDF
      toast({
        title: 'Generating manifest...',
        description: 'Your manifest will open for printing'
      });
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to generate manifest',
        variant: 'destructive'
      });
    }
  };

  const getContainerIcon = (type: string) => {
    const icons = {
      keg: '🛢️',
      can: '🥫',
      bottle: '🍾',
      growler: '🍺',
      other: '📦'
    };
    return icons[type] || '📦';
  };

  const getCostMethodLabel = (method: string) => {
    const labels = {
      actual_lots: 'Actual Lots',
      moving_avg: 'Moving Average',
      latest_cost: 'Latest Cost'
    };
    return labels[method] || method;
  };

  if (loading) {
    return (
      <Dialog open={open} onOpenChange={onClose}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-4 w-48 mt-2" />
          </DialogHeader>
          <div className="space-y-4">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-48 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  if (!data) {
    return null;
  }

  const yieldPercentage = (data.actual_quantity / data.target_quantity) * 100;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-6 w-6" />
            Packaging Run #{data.run_number.toString().padStart(4, '0')}
          </DialogTitle>
          <DialogDescription>
            {format(new Date(data.packaged_at), 'MMMM d, yyyy \'at\' h:mm a')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Action Buttons */}
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleExportLabels}>
              <FileText className="h-4 w-4 mr-2" />
              Export Labels
            </Button>
            <Button variant="outline" size="sm" onClick={handlePrintManifest}>
              <Printer className="h-4 w-4 mr-2" />
              Print Manifest
            </Button>
          </div>

          {/* SKU Information */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Product Details</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-gray-600">SKU</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xl">{getContainerIcon(data.finished_skus.container_type)}</span>
                    <div>
                      <p className="font-medium">{data.finished_skus.name}</p>
                      <p className="text-sm text-gray-500">
                        {data.finished_skus.code} • {data.finished_skus.container_size_ml}ml × {data.finished_skus.pack_size}
                      </p>
                    </div>
                  </div>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Barrels per Unit</p>
                  <p className="text-lg font-medium mt-1">
                    {data.finished_skus.barrels_per_unit.toFixed(4)} BBL
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Production Summary */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Production Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <p className="text-sm text-gray-600">Target Quantity</p>
                    <p className="text-xl font-bold">{data.target_quantity}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Actual Quantity</p>
                    <p className="text-xl font-bold">{data.actual_quantity}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Loss</p>
                    <p className="text-xl font-bold">{data.loss_percentage.toFixed(1)}%</p>
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-sm mb-2">
                    <span>Yield</span>
                    <span className="font-medium">{yieldPercentage.toFixed(1)}%</span>
                  </div>
                  <Progress value={yieldPercentage} className="h-2" />
                </div>

                {data.finished_lots.map((lot) => (
                  <div key={lot.id} className="border rounded-lg p-3">
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="text-sm text-gray-600">Lot Code</p>
                        <code className="text-lg font-mono bg-gray-100 px-2 py-1 rounded">
                          {lot.lot_code}
                        </code>
                      </div>
                      <div className="text-right">
                        <p className="text-sm text-gray-600">Remaining</p>
                        <p className="font-medium">
                          {lot.quantity_remaining} / {lot.quantity}
                        </p>
                      </div>
                    </div>
                    {lot.expiry_date && (
                      <div className="mt-2">
                        <p className="text-sm text-gray-600">Expires</p>
                        <p className="text-sm">{format(new Date(lot.expiry_date), 'MMM d, yyyy')}</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Source Batches */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Source Batches</CardTitle>
              {data.packaging_run_sources.length > 1 && (
                <CardDescription>Blend of {data.packaging_run_sources.length} batches</CardDescription>
              )}
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Batch</TableHead>
                    <TableHead>Recipe</TableHead>
                    <TableHead className="text-right">Volume Used</TableHead>
                    <TableHead className="text-right">Blend %</TableHead>
                    <TableHead className="text-right">COGS</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.packaging_run_sources.map((source) => (
                    <TableRow key={source.batch_id}>
                      <TableCell className="font-medium">
                        {source.batches.batch_number}
                      </TableCell>
                      <TableCell>
                        <div>
                          <p>{source.batches.recipe_versions.recipes.name}</p>
                          <p className="text-xs text-gray-500">
                            {source.batches.recipe_versions.recipes.style} • 
                            Brewed {format(new Date(source.batches.brew_date), 'MMM d')}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        {source.volume_liters.toFixed(1)}L
                      </TableCell>
                      <TableCell className="text-right">
                        {source.percentage_of_blend.toFixed(1)}%
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(source.allocated_cogs_cents / 100)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* COGS Analysis */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <DollarSign className="h-5 w-5" />
                Cost Analysis
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-gray-600">Total COGS</p>
                  <p className="text-2xl font-bold">
                    {formatCurrency(data.total_cogs_cents / 100)}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Unit COGS</p>
                  <p className="text-2xl font-bold">
                    {formatCurrency(data.unit_cogs_cents / 100)}
                  </p>
                </div>
              </div>
              <div className="mt-4">
                <Badge variant="outline">
                  {getCostMethodLabel(data.cost_method_used)}
                </Badge>
              </div>
            </CardContent>
          </Card>

          {/* Additional Information */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Additional Information</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {data.inventory_locations && (
                  <div className="flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-gray-400" />
                    <span className="text-sm text-gray-600">Location:</span>
                    <span className="text-sm font-medium">{data.inventory_locations.name}</span>
                  </div>
                )}
                
                {data.lot_code_pattern && (
                  <div className="flex items-center gap-2">
                    <Info className="h-4 w-4 text-gray-400" />
                    <span className="text-sm text-gray-600">Lot Code Pattern:</span>
                    <code className="text-sm bg-gray-100 px-2 py-1 rounded">
                      {data.lot_code_pattern}
                    </code>
                  </div>
                )}

                {data.users && (
                  <div className="flex items-center gap-2">
                    <Info className="h-4 w-4 text-gray-400" />
                    <span className="text-sm text-gray-600">Created by:</span>
                    <span className="text-sm font-medium">{data.users.full_name}</span>
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-gray-400" />
                  <span className="text-sm text-gray-600">Created:</span>
                  <span className="text-sm font-medium">
                    {format(new Date(data.created_at), 'MMM d, yyyy \'at\' h:mm a')}
                  </span>
                </div>

                {data.notes && (
                  <div className="pt-2 border-t">
                    <p className="text-sm text-gray-600 mb-1">Notes</p>
                    <p className="text-sm">{data.notes}</p>
                  </div>
                )}

                {data.metadata && Object.keys(data.metadata).length > 0 && (
                  <div className="pt-2 border-t">
                    <p className="text-sm text-gray-600 mb-1">Metadata</p>
                    <pre className="text-xs bg-gray-50 p-2 rounded overflow-x-auto">
                      {JSON.stringify(data.metadata, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </DialogContent>
    </Dialog>
  );
}
'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';
import { 
  Package, 
  Plus, 
  Eye, 
  Download, 
  Search,
  Filter,
  ChevronDown,
  MoreVertical,
  FileText,
  Printer
} from 'lucide-react';
import { Button } from '@brewcrush/ui/components/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@brewcrush/ui/components/card';
import { Input } from '@brewcrush/ui/components/input';
import { Badge } from '@brewcrush/ui/components/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@brewcrush/ui/components/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@brewcrush/ui/components/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@brewcrush/ui/components/select';
import { Skeleton } from '@brewcrush/ui/components/skeleton';
import { toast } from '@/hooks/use-toast';
import { useSupabase } from '@/hooks/use-supabase';
import { formatCurrency } from '@/lib/utils';
import { PackagingRunDetail } from './packaging-run-detail';

interface PackagingRun {
  id: string;
  run_number: number;
  packaged_at: string;
  target_quantity: number;
  actual_quantity: number;
  loss_percentage: number;
  total_cogs_cents: number;
  unit_cogs_cents: number;
  notes: string;
  created_at: string;
  finished_skus: {
    code: string;
    name: string;
    container_type: string;
    container_size_ml: number;
    pack_size: number;
  };
  finished_lots: {
    lot_code: string;
    quantity_remaining: number;
  }[];
  packaging_run_sources: {
    batch_id: string;
    volume_liters: number;
    percentage_of_blend: number;
    batches: {
      batch_number: string;
      recipe_version: {
        recipes: {
          name: string;
        };
      };
    };
  }[];
}

export function PackagingRunsList() {
  const router = useRouter();
  const { supabase } = useSupabase();
  const [loading, setLoading] = useState(true);
  const [runs, setRuns] = useState<PackagingRun[]>([]);
  const [filteredRuns, setFilteredRuns] = useState<PackagingRun[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedSku, setSelectedSku] = useState('all');
  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  const [skus, setSkus] = useState<{ id: string; name: string; code: string }[]>([]);

  useEffect(() => {
    loadPackagingRuns();
    loadSkus();
  }, []);

  useEffect(() => {
    filterRuns();
  }, [runs, searchTerm, selectedSku]);

  const loadPackagingRuns = async () => {
    try {
      setLoading(true);
      
      const { data, error } = await supabase
        .from('packaging_runs')
        .select(`
          *,
          finished_skus!inner (
            code,
            name,
            container_type,
            container_size_ml,
            pack_size
          ),
          finished_lots (
            lot_code,
            quantity_remaining
          ),
          packaging_run_sources (
            batch_id,
            volume_liters,
            percentage_of_blend,
            batches!inner (
              batch_number,
              recipe_versions!inner (
                recipes!inner (
                  name
                )
              )
            )
          )
        `)
        .order('packaged_at', { ascending: false });

      if (error) throw error;

      setRuns(data || []);
    } catch (error) {
      console.error('Error loading packaging runs:', error);
      toast({
        title: 'Error',
        description: 'Failed to load packaging runs',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const loadSkus = async () => {
    try {
      const { data, error } = await supabase
        .from('finished_skus')
        .select('id, name, code')
        .eq('is_active', true)
        .order('name');

      if (error) throw error;
      setSkus(data || []);
    } catch (error) {
      console.error('Error loading SKUs:', error);
    }
  };

  const filterRuns = () => {
    let filtered = [...runs];

    // Filter by search term
    if (searchTerm) {
      filtered = filtered.filter(run =>
        run.finished_lots[0]?.lot_code?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        run.finished_skus.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        run.finished_skus.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
        run.notes?.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    // Filter by SKU
    if (selectedSku !== 'all') {
      filtered = filtered.filter(run => run.finished_skus.code === selectedSku);
    }

    setFilteredRuns(filtered);
  };

  const handleExportLabels = async (runId: string) => {
    try {
      // This would call an Edge Function to generate PDF labels
      toast({
        title: 'Generating labels...',
        description: 'Your labels will download shortly'
      });
      
      // TODO: Implement actual PDF generation
      console.log('Generating labels for run:', runId);
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to generate labels',
        variant: 'destructive'
      });
    }
  };

  const handlePrintManifest = async (runId: string) => {
    try {
      // This would call an Edge Function to generate manifest PDF
      toast({
        title: 'Generating manifest...',
        description: 'Your manifest will open for printing'
      });
      
      // TODO: Implement actual manifest generation
      console.log('Generating manifest for run:', runId);
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to generate manifest',
        variant: 'destructive'
      });
    }
  };

  const calculateYield = (target: number, actual: number) => {
    return ((actual / target) * 100).toFixed(1);
  };

  const getContainerTypeIcon = (type: string) => {
    const icons = {
      keg: '🛢️',
      can: '🥫',
      bottle: '🍾',
      growler: '🍺',
      other: '📦'
    };
    return icons[type] || '📦';
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-2xl font-bold flex items-center gap-2">
              <Package className="h-6 w-6" />
              Packaging Runs
            </h2>
            <p className="text-gray-600">
              Convert batches to finished goods
            </p>
          </div>
          <Button onClick={() => router.push('/packaging/new')}>
            <Plus className="h-4 w-4 mr-2" />
            New Packaging Run
          </Button>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Total Runs</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{runs.length}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription>This Week</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {runs.filter(r => {
                  const packDate = new Date(r.packaged_at);
                  const weekAgo = new Date();
                  weekAgo.setDate(weekAgo.getDate() - 7);
                  return packDate >= weekAgo;
                }).length}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Avg Yield</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {runs.length > 0 
                  ? (runs.reduce((sum, r) => sum + (r.actual_quantity / r.target_quantity), 0) / runs.length * 100).toFixed(1)
                  : 0}%
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Avg Unit COGS</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {runs.length > 0
                  ? formatCurrency(runs.reduce((sum, r) => sum + r.unit_cogs_cents, 0) / runs.length / 100)
                  : '$0.00'}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <div className="flex gap-4 items-center">
          <div className="flex-1">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
              <Input
                placeholder="Search by lot code, SKU, or notes..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>
          
          <Select value={selectedSku} onValueChange={setSelectedSku}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Filter by SKU" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All SKUs</SelectItem>
              {skus.map((sku) => (
                <SelectItem key={sku.id} value={sku.code}>
                  {sku.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Runs Table */}
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Run #</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>Lot Code</TableHead>
                  <TableHead>Batches</TableHead>
                  <TableHead className="text-right">Quantity</TableHead>
                  <TableHead className="text-right">Yield</TableHead>
                  <TableHead className="text-right">Unit COGS</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRuns.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-8 text-gray-500">
                      No packaging runs found
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredRuns.map((run) => (
                    <TableRow 
                      key={run.id}
                      className="cursor-pointer hover:bg-gray-50"
                      onClick={() => setSelectedRun(run.id)}
                    >
                      <TableCell className="font-medium">
                        #{run.run_number.toString().padStart(4, '0')}
                      </TableCell>
                      <TableCell>
                        {format(new Date(run.packaged_at), 'MMM d, yyyy')}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span>{getContainerTypeIcon(run.finished_skus.container_type)}</span>
                          <div>
                            <div className="font-medium">{run.finished_skus.code}</div>
                            <div className="text-xs text-gray-500">
                              {run.finished_skus.container_size_ml}ml × {run.finished_skus.pack_size}
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <code className="text-sm bg-gray-100 px-2 py-1 rounded">
                          {run.finished_lots[0]?.lot_code || 'N/A'}
                        </code>
                      </TableCell>
                      <TableCell>
                        {run.packaging_run_sources.length === 1 ? (
                          <div className="text-sm">
                            {run.packaging_run_sources[0].batches.batch_number}
                          </div>
                        ) : (
                          <Badge variant="secondary">
                            {run.packaging_run_sources.length} batch blend
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div>
                          <div className="font-medium">{run.actual_quantity}</div>
                          <div className="text-xs text-gray-500">of {run.target_quantity}</div>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge 
                          variant={Number(calculateYield(run.target_quantity, run.actual_quantity)) >= 95 ? 'default' : 'secondary'}
                        >
                          {calculateYield(run.target_quantity, run.actual_quantity)}%
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatCurrency(run.unit_cogs_cents / 100)}
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                            <Button variant="ghost" size="sm">
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuLabel>Actions</DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => setSelectedRun(run.id)}>
                              <Eye className="h-4 w-4 mr-2" />
                              View Details
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleExportLabels(run.id)}>
                              <FileText className="h-4 w-4 mr-2" />
                              Export Labels
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handlePrintManifest(run.id)}>
                              <Printer className="h-4 w-4 mr-2" />
                              Print Manifest
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* Detail Dialog */}
      {selectedRun && (
        <PackagingRunDetail
          runId={selectedRun}
          open={!!selectedRun}
          onClose={() => setSelectedRun(null)}
        />
      )}
    </>
  );
}
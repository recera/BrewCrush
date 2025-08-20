'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import * as z from 'zod';
import { format } from 'date-fns';
import { Package, Plus, Trash2, AlertCircle, Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@brewcrush/ui/components/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@brewcrush/ui/components/card';
import { Input } from '@brewcrush/ui/components/input';
import { Label } from '@brewcrush/ui/components/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@brewcrush/ui/components/select';
import { Textarea } from '@brewcrush/ui/components/textarea';
import { Progress } from '@brewcrush/ui/components/progress';
import { Badge } from '@brewcrush/ui/components/badge';
import { Alert, AlertDescription } from '@brewcrush/ui/components/alert';
import { Slider } from '@brewcrush/ui/components/slider';
import { toast } from '@/hooks/use-toast';
import { useSupabase } from '@/hooks/use-supabase';
import { useOfflineSync } from '@/hooks/use-offline-sync';
import { formatCurrency } from '@/lib/utils';

// Validation schema for packaging form
const packagingSchema = z.object({
  sku_id: z.string().uuid('Please select a SKU'),
  sources: z.array(z.object({
    batch_id: z.string().uuid(),
    volume_liters: z.number().positive('Volume must be positive'),
    batch_name: z.string(),
    volume_available: z.number(),
    cogs_per_liter: z.number()
  })).min(1, 'At least one batch is required'),
  target_quantity: z.number().int().positive('Quantity must be positive'),
  actual_quantity: z.number().int().positive('Quantity must be positive'),
  loss_percentage: z.number().min(0).max(100),
  lot_code_template_id: z.string().uuid().optional(),
  location_id: z.string().uuid('Please select a location'),
  packaged_at: z.string(),
  notes: z.string().optional(),
  expiry_date: z.string().optional()
});

type PackagingFormData = z.infer<typeof packagingSchema>;

interface Batch {
  id: string;
  batch_number: string;
  recipe_name: string;
  volume_available_liters: number;
  brew_date: string;
  tank_name: string;
  total_cogs_cents: number;
}

interface SKU {
  id: string;
  code: string;
  name: string;
  container_type: string;
  container_size_ml: number;
  pack_size: number;
  barrels_per_unit: number;
}

interface LotCodeTemplate {
  id: string;
  name: string;
  pattern: string;
  is_default: boolean;
}

interface Location {
  id: string;
  name: string;
  location_type: string;
}

export function PackagingWizard() {
  const router = useRouter();
  const { supabase } = useSupabase();
  const { addToOutbox, isOnline } = useOfflineSync();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [skus, setSkus] = useState<SKU[]>([]);
  const [templates, setTemplates] = useState<LotCodeTemplate[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [previewData, setPreviewData] = useState<any>(null);
  const [lotCodePreview, setLotCodePreview] = useState('');

  const form = useForm<PackagingFormData>({
    resolver: zodResolver(packagingSchema),
    defaultValues: {
      sources: [],
      target_quantity: 1,
      actual_quantity: 1,
      loss_percentage: 0,
      packaged_at: format(new Date(), "yyyy-MM-dd'T'HH:mm"),
      notes: ''
    }
  });

  const sources = form.watch('sources');
  const selectedSku = form.watch('sku_id');
  const selectedTemplate = form.watch('lot_code_template_id');
  const targetQuantity = form.watch('target_quantity');
  const lossPercentage = form.watch('loss_percentage');

  // Load initial data
  useEffect(() => {
    loadData();
  }, []);

  // Calculate actual quantity based on loss
  useEffect(() => {
    const actualQty = Math.floor(targetQuantity * (1 - lossPercentage / 100));
    form.setValue('actual_quantity', actualQty);
  }, [targetQuantity, lossPercentage]);

  // Generate lot code preview
  useEffect(() => {
    if (selectedTemplate && selectedSku) {
      generateLotCodePreview();
    }
  }, [selectedTemplate, selectedSku, sources]);

  const loadData = async () => {
    try {
      setLoading(true);

      // Load available batches
      const { data: batchData, error: batchError } = await supabase
        .rpc('get_available_batches_for_packaging');
      
      if (batchError) throw batchError;
      setBatches(batchData || []);

      // Load SKUs
      const { data: skuData, error: skuError } = await supabase
        .from('finished_skus')
        .select('*')
        .eq('is_active', true)
        .order('name');
      
      if (skuError) throw skuError;
      setSkus(skuData || []);

      // Load lot code templates
      const { data: templateData, error: templateError } = await supabase
        .from('lot_code_templates')
        .select('*')
        .order('is_default', { ascending: false });
      
      if (templateError) throw templateError;
      setTemplates(templateData || []);

      // Set default template
      const defaultTemplate = templateData?.find(t => t.is_default);
      if (defaultTemplate) {
        form.setValue('lot_code_template_id', defaultTemplate.id);
      }

      // Load locations
      const { data: locationData, error: locationError } = await supabase
        .from('inventory_locations')
        .select('*')
        .in('location_type', ['warehouse', 'packaging'])
        .order('name');
      
      if (locationError) throw locationError;
      setLocations(locationData || []);

    } catch (error) {
      console.error('Error loading data:', error);
      toast({
        title: 'Error',
        description: 'Failed to load packaging data',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const generateLotCodePreview = async () => {
    const template = templates.find(t => t.id === selectedTemplate);
    const sku = skus.find(s => s.id === selectedSku);
    
    if (!template || !sku) return;

    let pattern = template.pattern;
    const now = new Date();
    
    // Replace date tokens
    pattern = pattern.replace('{YYYY}', now.getFullYear().toString());
    pattern = pattern.replace('{YY}', now.getFullYear().toString().slice(-2));
    pattern = pattern.replace('{MM}', String(now.getMonth() + 1).padStart(2, '0'));
    pattern = pattern.replace('{DD}', String(now.getDate()).padStart(2, '0'));
    pattern = pattern.replace('{JJJ}', String(Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 86400000)).padStart(3, '0'));
    
    // Replace batch token
    if (sources.length === 1) {
      pattern = pattern.replace('{BATCH}', sources[0].batch_id.slice(0, 8));
    } else if (sources.length > 1) {
      pattern = pattern.replace('{BATCH}', 'BLEND');
    }
    
    // Replace SKU token
    pattern = pattern.replace('{SKU}', sku.code);
    
    setLotCodePreview(pattern);
  };

  const addBatchSource = (batch: Batch) => {
    const currentSources = form.getValues('sources');
    
    // Check if batch already added
    if (currentSources.some(s => s.batch_id === batch.id)) {
      toast({
        title: 'Batch already added',
        description: 'This batch is already in the blend',
        variant: 'destructive'
      });
      return;
    }

    const newSource = {
      batch_id: batch.id,
      batch_name: `${batch.batch_number} - ${batch.recipe_name}`,
      volume_liters: batch.volume_available_liters,
      volume_available: batch.volume_available_liters,
      cogs_per_liter: batch.total_cogs_cents / batch.volume_available_liters / 100
    };

    form.setValue('sources', [...currentSources, newSource]);
  };

  const removeBatchSource = (index: number) => {
    const currentSources = form.getValues('sources');
    form.setValue('sources', currentSources.filter((_, i) => i !== index));
  };

  const updateSourceVolume = (index: number, volume: number) => {
    const currentSources = form.getValues('sources');
    currentSources[index].volume_liters = volume;
    form.setValue('sources', currentSources);
  };

  const calculateTotalVolume = () => {
    return sources.reduce((sum, source) => sum + source.volume_liters, 0);
  };

  const calculateTotalCOGS = () => {
    return sources.reduce((sum, source) => 
      sum + (source.volume_liters * source.cogs_per_liter), 0
    );
  };

  const calculateUnitCOGS = () => {
    const totalCogs = calculateTotalCOGS();
    const actualQty = form.getValues('actual_quantity');
    return actualQty > 0 ? totalCogs / actualQty : 0;
  };

  const handleDryRun = async () => {
    try {
      setLoading(true);
      const formData = form.getValues();

      const { data, error } = await supabase.rpc('create_packaging_run', {
        p_data: {
          ...formData,
          dry_run: true
        }
      });

      if (error) throw error;

      setPreviewData(data);
      toast({
        title: 'Preview Generated',
        description: 'Review the COGS and proceed if correct'
      });
    } catch (error) {
      console.error('Error generating preview:', error);
      toast({
        title: 'Error',
        description: 'Failed to generate preview',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const onSubmit = async (data: PackagingFormData) => {
    try {
      setLoading(true);

      if (!isOnline) {
        // Add to offline queue
        await addToOutbox({
          operation: 'create_packaging_run',
          data,
          entity_type: 'packaging_run',
          entity_id: crypto.randomUUID()
        });

        toast({
          title: 'Queued for sync',
          description: 'Packaging run will be created when online'
        });
        router.push('/packaging');
        return;
      }

      const { data: result, error } = await supabase.rpc('create_packaging_run', {
        p_data: data
      });

      if (error) throw error;

      toast({
        title: 'Success',
        description: 'Packaging run created successfully'
      });

      router.push('/packaging');
    } catch (error) {
      console.error('Error creating packaging run:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to create packaging run',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const renderStepContent = () => {
    switch (step) {
      case 1:
        return (
          <div className="space-y-6">
            <div className="space-y-4">
              <div>
                <Label htmlFor="sku">Finished SKU</Label>
                <Select
                  value={form.watch('sku_id')}
                  onValueChange={(value) => form.setValue('sku_id', value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select SKU to package" />
                  </SelectTrigger>
                  <SelectContent>
                    {skus.map((sku) => (
                      <SelectItem key={sku.id} value={sku.id}>
                        <div className="flex items-center justify-between w-full">
                          <span>{sku.name}</span>
                          <Badge variant="outline" className="ml-2">
                            {sku.container_type} - {sku.container_size_ml}ml x {sku.pack_size}
                          </Badge>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {form.formState.errors.sku_id && (
                  <p className="text-sm text-red-600 mt-1">
                    {form.formState.errors.sku_id.message}
                  </p>
                )}
              </div>

              <div>
                <Label htmlFor="location">Packaging Location</Label>
                <Select
                  value={form.watch('location_id')}
                  onValueChange={(value) => form.setValue('location_id', value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select location" />
                  </SelectTrigger>
                  <SelectContent>
                    {locations.map((location) => (
                      <SelectItem key={location.id} value={location.id}>
                        {location.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {form.formState.errors.location_id && (
                  <p className="text-sm text-red-600 mt-1">
                    {form.formState.errors.location_id.message}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="packaged_at">Packaging Date/Time</Label>
                  <Input
                    type="datetime-local"
                    {...form.register('packaged_at')}
                  />
                </div>

                <div>
                  <Label htmlFor="expiry_date">Expiry Date (Optional)</Label>
                  <Input
                    type="date"
                    {...form.register('expiry_date')}
                  />
                </div>
              </div>
            </div>
          </div>
        );

      case 2:
        return (
          <div className="space-y-6">
            <div>
              <div className="flex justify-between items-center mb-4">
                <Label>Select Batches for Packaging</Label>
                {sources.length > 0 && (
                  <Badge variant="secondary">
                    {sources.length} batch{sources.length !== 1 ? 'es' : ''} selected
                  </Badge>
                )}
              </div>

              {/* Available batches */}
              <div className="border rounded-lg max-h-64 overflow-y-auto">
                {batches.map((batch) => {
                  const isAdded = sources.some(s => s.batch_id === batch.id);
                  return (
                    <div
                      key={batch.id}
                      className={`p-3 border-b last:border-b-0 ${isAdded ? 'bg-gray-50' : 'hover:bg-gray-50'} cursor-pointer`}
                      onClick={() => !isAdded && addBatchSource(batch)}
                    >
                      <div className="flex justify-between items-center">
                        <div>
                          <div className="font-medium">{batch.batch_number} - {batch.recipe_name}</div>
                          <div className="text-sm text-gray-600">
                            {batch.volume_available_liters.toFixed(1)}L available • 
                            Tank: {batch.tank_name} • 
                            Brewed: {format(new Date(batch.brew_date), 'MMM d, yyyy')}
                          </div>
                        </div>
                        {isAdded ? (
                          <Badge variant="default">Added</Badge>
                        ) : (
                          <Button type="button" size="sm" variant="outline">
                            <Plus className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Selected batches with volume adjustment */}
            {sources.length > 0 && (
              <div className="space-y-4">
                <Label>Adjust Volumes for Blend</Label>
                {sources.map((source, index) => (
                  <Card key={source.batch_id}>
                    <CardContent className="pt-6">
                      <div className="flex justify-between items-start mb-4">
                        <div>
                          <div className="font-medium">{source.batch_name}</div>
                          <div className="text-sm text-gray-600">
                            Max available: {source.volume_available.toFixed(1)}L
                          </div>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => removeBatchSource(index)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                      
                      <div className="space-y-2">
                        <div className="flex justify-between text-sm">
                          <span>Volume to use</span>
                          <span>{source.volume_liters.toFixed(1)}L</span>
                        </div>
                        <Slider
                          value={[source.volume_liters]}
                          onValueChange={(value) => updateSourceVolume(index, value[0])}
                          min={0}
                          max={source.volume_available}
                          step={0.1}
                        />
                        <div className="flex justify-between text-xs text-gray-500">
                          <span>0L</span>
                          <span>{source.volume_available.toFixed(1)}L</span>
                        </div>
                      </div>

                      <div className="mt-4 text-sm text-gray-600">
                        <div className="flex justify-between">
                          <span>Blend percentage:</span>
                          <span className="font-medium">
                            {((source.volume_liters / calculateTotalVolume()) * 100).toFixed(1)}%
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span>COGS contribution:</span>
                          <span className="font-medium">
                            {formatCurrency(source.volume_liters * source.cogs_per_liter)}
                          </span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}

                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    <div className="space-y-1">
                      <div>Total volume: {calculateTotalVolume().toFixed(1)}L</div>
                      <div>Total COGS: {formatCurrency(calculateTotalCOGS())}</div>
                    </div>
                  </AlertDescription>
                </Alert>
              </div>
            )}

            {form.formState.errors.sources && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  {form.formState.errors.sources.message}
                </AlertDescription>
              </Alert>
            )}
          </div>
        );

      case 3:
        return (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="target_quantity">Target Quantity</Label>
                <Input
                  type="number"
                  {...form.register('target_quantity', { valueAsNumber: true })}
                />
                {form.formState.errors.target_quantity && (
                  <p className="text-sm text-red-600 mt-1">
                    {form.formState.errors.target_quantity.message}
                  </p>
                )}
              </div>

              <div>
                <Label htmlFor="loss_percentage">Loss %</Label>
                <Input
                  type="number"
                  step="0.1"
                  {...form.register('loss_percentage', { valueAsNumber: true })}
                />
              </div>
            </div>

            <div>
              <Label>Actual Quantity (after loss)</Label>
              <div className="text-2xl font-bold">
                {form.watch('actual_quantity')} units
              </div>
            </div>

            <div>
              <Label htmlFor="lot_code_template">Lot Code Template</Label>
              <Select
                value={form.watch('lot_code_template_id')}
                onValueChange={(value) => form.setValue('lot_code_template_id', value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select template" />
                </SelectTrigger>
                <SelectContent>
                  {templates.map((template) => (
                    <SelectItem key={template.id} value={template.id}>
                      <div>
                        <div>{template.name}</div>
                        <div className="text-xs text-gray-500">{template.pattern}</div>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {lotCodePreview && (
              <Alert>
                <AlertDescription>
                  <div className="space-y-1">
                    <div className="text-sm font-medium">Lot Code Preview:</div>
                    <div className="text-lg font-mono">{lotCodePreview}</div>
                  </div>
                </AlertDescription>
              </Alert>
            )}

            <div>
              <Label htmlFor="notes">Notes (Optional)</Label>
              <Textarea
                {...form.register('notes')}
                placeholder="Any special notes about this packaging run..."
                rows={3}
              />
            </div>

            {/* COGS Summary */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">COGS Summary</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span>Total Volume:</span>
                    <span className="font-medium">{calculateTotalVolume().toFixed(1)}L</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Total COGS:</span>
                    <span className="font-medium">{formatCurrency(calculateTotalCOGS())}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Units Produced:</span>
                    <span className="font-medium">{form.watch('actual_quantity')}</span>
                  </div>
                  <div className="border-t pt-2 flex justify-between text-lg font-bold">
                    <span>Unit COGS:</span>
                    <span>{formatCurrency(calculateUnitCOGS())}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="container max-w-4xl mx-auto py-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Package className="h-8 w-8" />
          Packaging Wizard
        </h1>
        <p className="text-gray-600 mt-2">
          Convert batches to finished goods with automated lot code generation
        </p>
      </div>

      {/* Progress indicator */}
      <div className="mb-8">
        <Progress value={(step / 3) * 100} className="h-2" />
        <div className="flex justify-between mt-2 text-sm text-gray-600">
          <span className={step === 1 ? 'font-bold text-primary' : ''}>SKU & Location</span>
          <span className={step === 2 ? 'font-bold text-primary' : ''}>Select Batches</span>
          <span className={step === 3 ? 'font-bold text-primary' : ''}>Quantity & Codes</span>
        </div>
      </div>

      <form onSubmit={form.handleSubmit(onSubmit)}>
        <Card>
          <CardContent className="pt-6">
            {renderStepContent()}
          </CardContent>
        </Card>

        <div className="flex justify-between mt-6">
          <Button
            type="button"
            variant="outline"
            onClick={() => setStep(Math.max(1, step - 1))}
            disabled={step === 1}
          >
            <ChevronLeft className="h-4 w-4 mr-2" />
            Previous
          </Button>

          <div className="flex gap-2">
            {step === 3 && (
              <Button
                type="button"
                variant="outline"
                onClick={handleDryRun}
                disabled={loading}
              >
                Preview COGS
              </Button>
            )}
            
            {step < 3 ? (
              <Button
                type="button"
                onClick={() => {
                  // Validate current step before proceeding
                  if (step === 1) {
                    if (!form.watch('sku_id') || !form.watch('location_id')) {
                      toast({
                        title: 'Missing information',
                        description: 'Please select SKU and location',
                        variant: 'destructive'
                      });
                      return;
                    }
                  } else if (step === 2) {
                    if (sources.length === 0) {
                      toast({
                        title: 'No batches selected',
                        description: 'Please select at least one batch',
                        variant: 'destructive'
                      });
                      return;
                    }
                  }
                  setStep(step + 1);
                }}
              >
                Next
                <ChevronRight className="h-4 w-4 ml-2" />
              </Button>
            ) : (
              <Button type="submit" disabled={loading}>
                {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Create Packaging Run
              </Button>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}
'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useQuery } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@brewcrush/ui';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@brewcrush/ui';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@brewcrush/ui';
import { Input } from '@brewcrush/ui';
import { Button } from '@brewcrush/ui';
import { Checkbox } from '@brewcrush/ui';
import { Alert, AlertDescription } from '@brewcrush/ui';
import { Badge } from '@brewcrush/ui';
import { Card, CardContent } from '@brewcrush/ui';
import { AlertCircle, FlaskConical, Package, Droplets, DollarSign } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { BatchTimeline, Tank, YeastBatch } from '@/types/production';
import { formatCurrency } from '@/lib/utils';

const brewDaySchema = z.object({
  actual_og: z.number().min(1).max(2).optional(),
  actual_volume: z.number().positive().optional(),
  tank_id: z.string().optional(),
  yeast_batch_id: z.string().optional(),
  consume_inventory: z.boolean().default(true),
  notes: z.string().optional(),
});

type BrewDayForm = z.infer<typeof brewDaySchema>;

interface StartBrewDayDialogProps {
  batch: BatchTimeline;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export function StartBrewDayDialog({
  batch,
  open,
  onOpenChange,
  onSuccess,
}: StartBrewDayDialogProps) {
  const supabase = createClient();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [inventoryCheck, setInventoryCheck] = useState<any>(null);

  // Fetch available tanks
  const { data: tanks } = useQuery({
    queryKey: ['available-tanks-brew'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_tank_status')
        .select('*')
        .eq('is_available', true)
        .eq('is_active', true)
        .order('name');

      if (error) throw error;
      return data as Tank[];
    },
    enabled: open,
  });

  // Fetch available yeast batches
  const { data: yeastBatches } = useQuery({
    queryKey: ['available-yeast'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('yeast_batches')
        .select(`
          *,
          strain:yeast_strains(*)
        `)
        .is('harvest_at', null)
        .order('generation');

      if (error) throw error;
      return data as YeastBatch[];
    },
    enabled: open,
  });

  // Check inventory availability
  const { data: inventoryStatus, isLoading: checkingInventory } = useQuery({
    queryKey: ['inventory-check', batch.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('check_batch_inventory', {
        p_batch_id: batch.id,
      });

      if (error) throw error;
      setInventoryCheck(data);
      return data;
    },
    enabled: open,
  });

  const form = useForm<BrewDayForm>({
    resolver: zodResolver(brewDaySchema),
    defaultValues: {
      actual_og: batch.target_og || undefined,
      actual_volume: batch.target_volume || undefined,
      tank_id: batch.tank_id || '',
      yeast_batch_id: '',
      consume_inventory: true,
      notes: '',
    },
  });

  const onSubmit = async (values: BrewDayForm) => {
    setIsSubmitting(true);
    try {
      // Start brew day
      const { data, error } = await supabase.rpc('start_brew_day', {
        p_batch_id: batch.id,
        p_actual_og: values.actual_og || null,
        p_actual_volume: values.actual_volume || null,
        p_consume_inventory: values.consume_inventory,
      });

      if (error) throw error;

      // Update tank assignment if changed
      if (values.tank_id && values.tank_id !== batch.tank_id) {
        const { error: tankError } = await supabase
          .from('batches')
          .update({ tank_id: values.tank_id })
          .eq('id', batch.id);

        if (tankError) throw tankError;
      }

      // Pitch yeast if selected
      if (values.yeast_batch_id) {
        const { error: yeastError } = await supabase.rpc('pitch_yeast', {
          p_batch_id: batch.id,
          p_yeast_batch_id: values.yeast_batch_id,
        });

        if (yeastError) throw yeastError;
      }

      // Add notes if provided
      if (values.notes) {
        const { error: notesError } = await supabase
          .from('batches')
          .update({ notes: values.notes })
          .eq('id', batch.id);

        if (notesError) throw notesError;
      }

      onSuccess?.();
      onOpenChange(false);
    } catch (error: any) {
      console.error('Error starting brew day:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const consumeInventory = form.watch('consume_inventory');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Start Brew Day</DialogTitle>
          <DialogDescription>
            Begin brewing <strong>{batch.batch_number}</strong> - {batch.recipe_name}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {/* Inventory Check */}
            {inventoryCheck && (
              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-start gap-3">
                    {inventoryCheck.has_all_inventory ? (
                      <>
                        <Package className="h-5 w-5 text-green-500 mt-0.5" />
                        <div className="flex-1">
                          <p className="font-medium text-green-700">Inventory Check Passed</p>
                          <p className="text-sm text-muted-foreground">
                            All required ingredients are available
                          </p>
                        </div>
                      </>
                    ) : (
                      <>
                        <AlertCircle className="h-5 w-5 text-amber-500 mt-0.5" />
                        <div className="flex-1">
                          <p className="font-medium text-amber-700">Inventory Warning</p>
                          <p className="text-sm text-muted-foreground mb-2">
                            Some ingredients may be insufficient:
                          </p>
                          {inventoryCheck.missing_items?.map((item: any) => (
                            <div key={item.item_id} className="text-sm">
                              • {item.item_name}: Need {item.required} {item.uom}, have {item.available}
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                  {inventoryCheck.estimated_cost && consumeInventory && (
                    <div className="mt-4 pt-4 border-t flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">Estimated ingredient cost:</span>
                      <span className="font-medium flex items-center gap-1">
                        <DollarSign className="h-4 w-4" />
                        {formatCurrency(inventoryCheck.estimated_cost)}
                      </span>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="actual_og"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Actual OG</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.001"
                        min="1.000"
                        max="2.000"
                        placeholder="1.050"
                        {...field}
                        onChange={(e) => field.onChange(parseFloat(e.target.value))}
                      />
                    </FormControl>
                    <FormDescription>
                      Measured original gravity
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="actual_volume"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Actual Volume (L)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.1"
                        placeholder={batch.target_volume?.toString()}
                        {...field}
                        onChange={(e) => field.onChange(parseFloat(e.target.value))}
                      />
                    </FormControl>
                    <FormDescription>
                      Volume into fermenter
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="tank_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Fermentation Tank</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select tank" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {batch.tank_id && (
                        <SelectItem value={batch.tank_id}>
                          {batch.tank_name} (Current)
                        </SelectItem>
                      )}
                      {tanks?.map((tank) => (
                        <SelectItem 
                          key={tank.id} 
                          value={tank.id}
                          disabled={tank.id === batch.tank_id}
                        >
                          {tank.name} ({tank.capacity}L)
                          {tank.cip_status === 'required' && (
                            <Badge variant="destructive" className="ml-2">
                              CIP Required
                            </Badge>
                          )}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    Assign to fermentation tank
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="yeast_batch_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Yeast Pitch</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select yeast (optional)" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="">No yeast selected</SelectItem>
                      {yeastBatches?.map((yeast) => (
                        <SelectItem key={yeast.id} value={yeast.id}>
                          {yeast.strain?.name} - Generation {yeast.generation}
                          {yeast.viability_notes && (
                            <span className="text-muted-foreground ml-2">
                              ({yeast.viability_notes})
                            </span>
                          )}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    Select yeast to pitch
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="consume_inventory"
              render={({ field }) => (
                <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                  <div className="space-y-1 leading-none">
                    <FormLabel>
                      Consume Inventory
                    </FormLabel>
                    <FormDescription>
                      Deduct ingredients from inventory using FIFO
                    </FormDescription>
                  </div>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes (Optional)</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Any notes about brew day..."
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {!inventoryCheck?.has_all_inventory && consumeInventory && (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  Some ingredients may be insufficient. The system will consume available inventory
                  and track shortages for reporting.
                </AlertDescription>
              </Alert>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button 
                type="submit" 
                disabled={isSubmitting || checkingInventory}
              >
                {isSubmitting ? (
                  <>
                    <FlaskConical className="mr-2 h-4 w-4 animate-spin" />
                    Starting Brew Day...
                  </>
                ) : (
                  <>
                    <FlaskConical className="mr-2 h-4 w-4" />
                    Start Brew Day
                  </>
                )}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
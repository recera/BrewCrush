'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
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
import { Input } from '@brewcrush/ui';
import { Textarea } from '@brewcrush/ui';
import { Button } from '@brewcrush/ui';
import { Checkbox } from '@brewcrush/ui';
import { Card, CardContent } from '@brewcrush/ui';
import { Badge } from '@brewcrush/ui';
import { Alert, AlertDescription } from '@brewcrush/ui';
import { 
  Package, 
  AlertCircle, 
  TrendingUp,
  Microscope,
  CheckCircle,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { formatDate, getDaysBetween } from '@/lib/utils';

interface YeastBatchWithDetails {
  id: string;
  strain_id: string;
  generation: number;
  pitch_at?: string;
  viability_notes?: string;
  strain?: {
    id: string;
    name: string;
    recommended_max_generation?: number;
  };
  batches?: Array<{
    id: string;
    batch_number: string;
  }>;
}

const harvestSchema = z.object({
  new_viability_notes: z.string().optional(),
  harvest_notes: z.string().optional(),
  create_inventory: z.boolean().default(false),
  inventory_qty: z.number().positive().optional(),
  inventory_unit: z.string().optional(),
});

type HarvestForm = z.infer<typeof harvestSchema>;

interface HarvestYeastDialogProps {
  yeastBatch: YeastBatchWithDetails;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export function HarvestYeastDialog({
  yeastBatch,
  open,
  onOpenChange,
  onSuccess,
}: HarvestYeastDialogProps) {
  const supabase = createClient();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<HarvestForm>({
    resolver: zodResolver(harvestSchema),
    defaultValues: {
      new_viability_notes: '',
      harvest_notes: '',
      create_inventory: false,
      inventory_qty: 500,
      inventory_unit: 'ml',
    },
  });

  const createInventory = form.watch('create_inventory');
  const daysSincePitch = yeastBatch.pitch_at 
    ? getDaysBetween(yeastBatch.pitch_at)
    : 0;

  const newGeneration = yeastBatch.generation + 1;
  const maxGen = yeastBatch.strain?.recommended_max_generation || 10;
  const isOverMaxGen = newGeneration > maxGen;

  const onSubmit = async (values: HarvestForm) => {
    setIsSubmitting(true);
    try {
      const { data, error } = await supabase.rpc('harvest_yeast', {
        p_yeast_batch_id: yeastBatch.id,
        p_viability_notes: values.new_viability_notes || null,
        p_notes: values.harvest_notes || null,
        p_create_inventory: values.create_inventory,
        p_inventory_qty: values.create_inventory ? values.inventory_qty : null,
        p_inventory_unit: values.create_inventory ? values.inventory_unit : null,
      });

      if (error) throw error;

      onSuccess?.();
      onOpenChange(false);
    } catch (error: any) {
      console.error('Error harvesting yeast:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Harvest Yeast</DialogTitle>
          <DialogDescription>
            Harvest yeast from {yeastBatch.batches?.[0]?.batch_number}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {/* Current Status */}
            <Card>
              <CardContent className="pt-4">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Strain</span>
                    <span className="font-medium">{yeastBatch.strain?.name}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Current Generation</span>
                    <Badge variant="secondary">Gen {yeastBatch.generation}</Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">New Generation</span>
                    <div className="flex items-center gap-2">
                      <TrendingUp className="h-4 w-4 text-blue-500" />
                      <Badge 
                        variant={isOverMaxGen ? "destructive" : "default"}
                        className={isOverMaxGen ? "" : "bg-green-500"}
                      >
                        Gen {newGeneration}
                      </Badge>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Days Since Pitch</span>
                    <span className="font-medium">{daysSincePitch} days</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Generation Warning */}
            {isOverMaxGen && (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  This harvest will exceed the recommended maximum generation ({maxGen}). 
                  Consider starting with fresh yeast for optimal performance.
                </AlertDescription>
              </Alert>
            )}

            {/* Harvest Timing */}
            {daysSincePitch < 5 && (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  Harvesting before day 5 may result in lower cell counts and viability.
                </AlertDescription>
              </Alert>
            )}
            {daysSincePitch > 10 && (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  Harvesting after day 10 may result in reduced viability. Consider a viability test.
                </AlertDescription>
              </Alert>
            )}
            {daysSincePitch >= 5 && daysSincePitch <= 10 && (
              <Alert>
                <CheckCircle className="h-4 w-4 text-green-500" />
                <AlertDescription className="text-green-600">
                  Optimal harvest timing (day {daysSincePitch})
                </AlertDescription>
              </Alert>
            )}

            <FormField
              control={form.control}
              name="new_viability_notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Viability Assessment</FormLabel>
                  <FormControl>
                    <Input 
                      placeholder="High, Medium, Low, or specific percentage"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    Visual assessment or test results
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="harvest_notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Harvest Notes</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Harvest conditions, observations..."
                      className="resize-none"
                      rows={3}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="create_inventory"
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
                      Create Inventory Item
                    </FormLabel>
                    <FormDescription>
                      Track this yeast as inventory for future use
                    </FormDescription>
                  </div>
                </FormItem>
              )}
            />

            {createInventory && (
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="inventory_qty"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Quantity</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.1"
                          min="0"
                          {...field}
                          onChange={(e) => field.onChange(parseFloat(e.target.value))}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="inventory_unit"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Unit</FormLabel>
                      <FormControl>
                        <Input placeholder="ml, L, slurry" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
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
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <Package className="mr-2 h-4 w-4 animate-spin" />
                    Harvesting...
                  </>
                ) : (
                  <>
                    <Package className="mr-2 h-4 w-4" />
                    Harvest Yeast
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
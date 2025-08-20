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
import { Card, CardContent } from '@brewcrush/ui';
import { Activity, Droplets, Thermometer, Beaker, TrendingDown } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Tank, BatchTimeline } from '@/types/production';
import { calculateABV } from '@/lib/utils';

const readingSchema = z.object({
  sg: z.number().min(0.990).max(1.200).optional(),
  temp: z.number().min(-10).max(50).optional(),
  ph: z.number().min(0).max(14).optional(),
  notes: z.string().optional(),
});

type FermReadingForm = z.infer<typeof readingSchema>;

interface LogFermReadingDialogProps {
  tank: Tank;
  batch: BatchTimeline;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export function LogFermReadingDialog({
  tank,
  batch,
  open,
  onOpenChange,
  onSuccess,
}: LogFermReadingDialogProps) {
  const supabase = createClient();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<FermReadingForm>({
    resolver: zodResolver(readingSchema),
    defaultValues: {
      sg: undefined,
      temp: undefined,
      ph: undefined,
      notes: '',
    },
  });

  const onSubmit = async (values: FermReadingForm) => {
    if (!values.sg && !values.temp && !values.ph) {
      form.setError('sg', { message: 'At least one measurement is required' });
      return;
    }

    setIsSubmitting(true);
    try {
      const { error } = await supabase.rpc('log_ferm_reading', {
        p_batch_id: batch.id,
        p_sg: values.sg || null,
        p_temp: values.temp || null,
        p_ph: values.ph || null,
        p_notes: values.notes || null,
      });

      if (error) throw error;

      onSuccess?.();
      onOpenChange(false);
      form.reset();
    } catch (error) {
      console.error('Error logging fermentation reading:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const sg = form.watch('sg');
  const estimatedAbv = sg && batch.target_og 
    ? calculateABV(batch.target_og, sg)
    : null;

  const attenuation = sg && batch.target_og
    ? ((batch.target_og - sg) / (batch.target_og - 1)) * 100
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Log Fermentation Reading</DialogTitle>
          <DialogDescription>
            Tank {tank.name} - {batch.batch_number}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {/* Target Info Card */}
            <Card>
              <CardContent className="pt-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  {batch.target_og && (
                    <div>
                      <p className="text-muted-foreground">Target OG</p>
                      <p className="font-medium">{batch.target_og.toFixed(3)}</p>
                    </div>
                  )}
                  {batch.target_fg && (
                    <div>
                      <p className="text-muted-foreground">Target FG</p>
                      <p className="font-medium">{batch.target_fg.toFixed(3)}</p>
                    </div>
                  )}
                  {batch.target_abv && (
                    <div>
                      <p className="text-muted-foreground">Target ABV</p>
                      <p className="font-medium">{batch.target_abv.toFixed(1)}%</p>
                    </div>
                  )}
                  {batch.days_in_fermentation && (
                    <div>
                      <p className="text-muted-foreground">Day</p>
                      <p className="font-medium">{batch.days_in_fermentation}</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Measurement Inputs */}
            <div className="space-y-4">
              <FormField
                control={form.control}
                name="sg"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center gap-2">
                      <Droplets className="h-4 w-4" />
                      Specific Gravity
                    </FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.001"
                        min="0.990"
                        max="1.200"
                        placeholder="1.010"
                        {...field}
                        onChange={(e) => field.onChange(e.target.value ? parseFloat(e.target.value) : undefined)}
                        className="text-lg font-mono"
                      />
                    </FormControl>
                    {sg && batch.target_fg && sg <= batch.target_fg && (
                      <FormDescription className="flex items-center gap-1 text-green-600">
                        <TrendingDown className="h-3 w-3" />
                        Target reached!
                      </FormDescription>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="temp"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-2">
                        <Thermometer className="h-4 w-4" />
                        Temperature (°C)
                      </FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.1"
                          min="-10"
                          max="50"
                          placeholder="18"
                          {...field}
                          onChange={(e) => field.onChange(e.target.value ? parseFloat(e.target.value) : undefined)}
                          className="text-lg font-mono"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="ph"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-2">
                        <Beaker className="h-4 w-4" />
                        pH
                      </FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.1"
                          min="0"
                          max="14"
                          placeholder="4.5"
                          {...field}
                          onChange={(e) => field.onChange(e.target.value ? parseFloat(e.target.value) : undefined)}
                          className="text-lg font-mono"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notes (Optional)</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Any observations..."
                        className="resize-none"
                        rows={3}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Calculated Values */}
            {(estimatedAbv !== null || attenuation !== null) && (
              <Card>
                <CardContent className="pt-4">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    {estimatedAbv !== null && (
                      <div>
                        <p className="text-muted-foreground">Estimated ABV</p>
                        <p className="font-medium">{estimatedAbv.toFixed(1)}%</p>
                      </div>
                    )}
                    {attenuation !== null && (
                      <div>
                        <p className="text-muted-foreground">Attenuation</p>
                        <p className="font-medium">{attenuation.toFixed(0)}%</p>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
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
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? (
                  <>
                    <Activity className="mr-2 h-4 w-4 animate-spin" />
                    Logging...
                  </>
                ) : (
                  <>
                    <Activity className="mr-2 h-4 w-4" />
                    Log Reading
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
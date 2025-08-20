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
import { Button } from '@brewcrush/ui';
import { Card, CardContent } from '@brewcrush/ui';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@brewcrush/ui';
import { 
  Droplets, 
  Thermometer, 
  Beaker, 
  FlaskConical,
  TrendingUp,
  TrendingDown,
  Check,
} from 'lucide-react';
import { BatchTimeline } from '@/types/production';
import { calculateABV, sgToPlato } from '@/lib/utils';

const measurementSchema = z.object({
  og: z.number().min(1.000).max(2.000).optional(),
  volume: z.number().positive().optional(),
  temp: z.number().min(-10).max(50).optional(),
  ph: z.number().min(0).max(14).optional(),
});

type MeasurementForm = z.infer<typeof measurementSchema>;

interface MeasurementDialogProps {
  batch: BatchTimeline;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (type: string, value: any) => void;
}

export function MeasurementDialog({
  batch,
  open,
  onOpenChange,
  onSave,
}: MeasurementDialogProps) {
  const [activeTab, setActiveTab] = useState('gravity');

  const form = useForm<MeasurementForm>({
    resolver: zodResolver(measurementSchema),
    defaultValues: {
      og: batch.actual_og || batch.target_og,
      volume: batch.actual_volume || batch.target_volume,
      temp: 20,
      ph: batch.target_ph || 5.4,
    },
  });

  const handleSave = (values: MeasurementForm) => {
    if (values.og) onSave('og', values.og);
    if (values.volume) onSave('volume', values.volume);
    if (values.temp) onSave('temp', values.temp);
    if (values.ph) onSave('ph', values.ph);
    onOpenChange(false);
  };

  const og = form.watch('og');
  const volume = form.watch('volume');

  // Calculate deviations
  const ogDeviation = og && batch.target_og 
    ? ((og - batch.target_og) / batch.target_og) * 100
    : null;
  
  const volumeDeviation = volume && batch.target_volume
    ? ((volume - batch.target_volume) / batch.target_volume) * 100
    : null;

  // Estimate final ABV based on OG
  const estimatedAbv = og && batch.target_fg
    ? calculateABV(og, batch.target_fg)
    : null;

  const plato = og ? sgToPlato(og) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Record Measurements</DialogTitle>
          <DialogDescription>
            Record actual measurements for {batch.batch_number}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSave)} className="space-y-4">
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="gravity">Gravity</TabsTrigger>
                <TabsTrigger value="volume">Volume</TabsTrigger>
                <TabsTrigger value="other">Other</TabsTrigger>
              </TabsList>

              <TabsContent value="gravity" className="space-y-4">
                <FormField
                  control={form.control}
                  name="og"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-base flex items-center gap-2">
                        <Droplets className="h-4 w-4" />
                        Original Gravity
                      </FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.001"
                          min="1.000"
                          max="2.000"
                          placeholder="1.050"
                          className="text-2xl h-16 font-mono text-center"
                          {...field}
                          onChange={(e) => field.onChange(e.target.value ? parseFloat(e.target.value) : undefined)}
                        />
                      </FormControl>
                      {batch.target_og && (
                        <FormDescription>
                          Target: {batch.target_og.toFixed(3)}
                        </FormDescription>
                      )}
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Gravity Analysis */}
                {og && (
                  <Card>
                    <CardContent className="pt-4">
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <p className="text-muted-foreground">Plato</p>
                          <p className="font-medium">{plato?.toFixed(1)}°P</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Est. ABV</p>
                          <p className="font-medium">{estimatedAbv?.toFixed(1)}%</p>
                        </div>
                        {ogDeviation !== null && (
                          <div className="col-span-2">
                            <p className="text-muted-foreground">Deviation</p>
                            <p className={`font-medium flex items-center gap-1 ${
                              Math.abs(ogDeviation) <= 2 ? 'text-green-600' :
                              Math.abs(ogDeviation) <= 5 ? 'text-yellow-600' : 'text-red-600'
                            }`}>
                              {ogDeviation > 0 && <TrendingUp className="h-3 w-3" />}
                              {ogDeviation < 0 && <TrendingDown className="h-3 w-3" />}
                              {ogDeviation > 0 ? '+' : ''}{ogDeviation.toFixed(1)}%
                              {Math.abs(ogDeviation) <= 2 && (
                                <Check className="h-3 w-3 ml-1" />
                              )}
                            </p>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                )}
              </TabsContent>

              <TabsContent value="volume" className="space-y-4">
                <FormField
                  control={form.control}
                  name="volume"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-base flex items-center gap-2">
                        <FlaskConical className="h-4 w-4" />
                        Volume (Liters)
                      </FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.1"
                          min="0"
                          placeholder="20"
                          className="text-2xl h-16 font-mono text-center"
                          {...field}
                          onChange={(e) => field.onChange(e.target.value ? parseFloat(e.target.value) : undefined)}
                        />
                      </FormControl>
                      {batch.target_volume && (
                        <FormDescription>
                          Target: {batch.target_volume}L
                        </FormDescription>
                      )}
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Volume Analysis */}
                {volume && volumeDeviation !== null && (
                  <Card>
                    <CardContent className="pt-4">
                      <div className="space-y-2">
                        <div>
                          <p className="text-sm text-muted-foreground">Deviation</p>
                          <p className={`font-medium flex items-center gap-1 ${
                            Math.abs(volumeDeviation) <= 5 ? 'text-green-600' :
                            Math.abs(volumeDeviation) <= 10 ? 'text-yellow-600' : 'text-red-600'
                          }`}>
                            {volumeDeviation > 0 && <TrendingUp className="h-3 w-3" />}
                            {volumeDeviation < 0 && <TrendingDown className="h-3 w-3" />}
                            {volumeDeviation > 0 ? '+' : ''}{volumeDeviation.toFixed(1)}%
                            {Math.abs(volumeDeviation) <= 5 && (
                              <Check className="h-3 w-3 ml-1" />
                            )}
                          </p>
                        </div>
                        {batch.efficiency_pct && og && batch.target_og && (
                          <div>
                            <p className="text-sm text-muted-foreground">Efficiency Adjustment</p>
                            <p className="font-medium">
                              {((og - 1) / (batch.target_og - 1) * batch.efficiency_pct).toFixed(1)}%
                            </p>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                )}
              </TabsContent>

              <TabsContent value="other" className="space-y-4">
                <FormField
                  control={form.control}
                  name="temp"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-base flex items-center gap-2">
                        <Thermometer className="h-4 w-4" />
                        Temperature (°C)
                      </FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.1"
                          min="-10"
                          max="50"
                          placeholder="20"
                          className="text-xl h-14 font-mono text-center"
                          {...field}
                          onChange={(e) => field.onChange(e.target.value ? parseFloat(e.target.value) : undefined)}
                        />
                      </FormControl>
                      <FormDescription>
                        Wort temperature at measurement
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="ph"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-base flex items-center gap-2">
                        <Beaker className="h-4 w-4" />
                        pH
                      </FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.1"
                          min="0"
                          max="14"
                          placeholder="5.4"
                          className="text-xl h-14 font-mono text-center"
                          {...field}
                          onChange={(e) => field.onChange(e.target.value ? parseFloat(e.target.value) : undefined)}
                        />
                      </FormControl>
                      {batch.target_ph && (
                        <FormDescription>
                          Target: {batch.target_ph.toFixed(1)}
                        </FormDescription>
                      )}
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </TabsContent>
            </Tabs>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit">
                Save Measurements
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
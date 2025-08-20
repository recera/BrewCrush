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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@brewcrush/ui';
import { Input } from '@brewcrush/ui';
import { Textarea } from '@brewcrush/ui';
import { Button } from '@brewcrush/ui';
import { createClient } from '@/lib/supabase/client';

const strainSchema = z.object({
  name: z.string().min(1, 'Strain name is required'),
  lab_source: z.string().optional(),
  strain_code: z.string().optional(),
  type: z.enum(['ale', 'lager', 'wild', 'other']),
  attenuation_min: z.number().min(0).max(100).optional(),
  attenuation_max: z.number().min(0).max(100).optional(),
  temperature_min: z.number().optional(),
  temperature_max: z.number().optional(),
  flocculation: z.enum(['low', 'medium', 'high', 'very_high']).optional(),
  alcohol_tolerance: z.number().min(0).max(30).optional(),
  recommended_max_generation: z.number().min(1).max(20).optional(),
  notes: z.string().optional(),
});

type StrainForm = z.infer<typeof strainSchema>;

interface CreateYeastStrainDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export function CreateYeastStrainDialog({
  open,
  onOpenChange,
  onSuccess,
}: CreateYeastStrainDialogProps) {
  const supabase = createClient();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<StrainForm>({
    resolver: zodResolver(strainSchema),
    defaultValues: {
      name: '',
      lab_source: '',
      strain_code: '',
      type: 'ale',
      attenuation_min: 70,
      attenuation_max: 80,
      temperature_min: 18,
      temperature_max: 22,
      flocculation: 'medium',
      alcohol_tolerance: 10,
      recommended_max_generation: 10,
      notes: '',
    },
  });

  const onSubmit = async (values: StrainForm) => {
    setIsSubmitting(true);
    try {
      const { error } = await supabase
        .from('yeast_strains')
        .insert({
          name: values.name,
          lab_source: values.lab_source || null,
          strain_code: values.strain_code || null,
          type: values.type,
          attenuation_min: values.attenuation_min || null,
          attenuation_max: values.attenuation_max || null,
          temperature_min: values.temperature_min || null,
          temperature_max: values.temperature_max || null,
          flocculation: values.flocculation || null,
          alcohol_tolerance: values.alcohol_tolerance || null,
          recommended_max_generation: values.recommended_max_generation || null,
          notes: values.notes || null,
          is_active: true,
        });

      if (error) throw error;

      onSuccess?.();
      onOpenChange(false);
      form.reset();
    } catch (error) {
      console.error('Error creating yeast strain:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Yeast Strain</DialogTitle>
          <DialogDescription>
            Add a new yeast strain to your brewery's collection
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Strain Name</FormLabel>
                    <FormControl>
                      <Input placeholder="US-05" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Type</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="ale">Ale</SelectItem>
                        <SelectItem value="lager">Lager</SelectItem>
                        <SelectItem value="wild">Wild/Brett</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="lab_source"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Lab/Source</FormLabel>
                    <FormControl>
                      <Input placeholder="Fermentis" {...field} />
                    </FormControl>
                    <FormDescription>Manufacturer or lab</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="strain_code"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Strain Code</FormLabel>
                    <FormControl>
                      <Input placeholder="SafAle US-05" {...field} />
                    </FormControl>
                    <FormDescription>Official strain code</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="attenuation_min"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Min Attenuation %</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min="0"
                        max="100"
                        {...field}
                        onChange={(e) => field.onChange(e.target.value ? parseFloat(e.target.value) : undefined)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="attenuation_max"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Max Attenuation %</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min="0"
                        max="100"
                        {...field}
                        onChange={(e) => field.onChange(e.target.value ? parseFloat(e.target.value) : undefined)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="temperature_min"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Min Temperature °C</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        {...field}
                        onChange={(e) => field.onChange(e.target.value ? parseFloat(e.target.value) : undefined)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="temperature_max"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Max Temperature °C</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        {...field}
                        onChange={(e) => field.onChange(e.target.value ? parseFloat(e.target.value) : undefined)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <FormField
                control={form.control}
                name="flocculation"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Flocculation</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="low">Low</SelectItem>
                        <SelectItem value="medium">Medium</SelectItem>
                        <SelectItem value="high">High</SelectItem>
                        <SelectItem value="very_high">Very High</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="alcohol_tolerance"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Alcohol Tolerance %</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min="0"
                        max="30"
                        {...field}
                        onChange={(e) => field.onChange(e.target.value ? parseFloat(e.target.value) : undefined)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="recommended_max_generation"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Max Generation</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min="1"
                        max="20"
                        {...field}
                        onChange={(e) => field.onChange(e.target.value ? parseFloat(e.target.value) : undefined)}
                      />
                    </FormControl>
                    <FormDescription>Recommended max</FormDescription>
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
                  <FormLabel>Notes</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Flavor profile, usage notes, etc..."
                      className="resize-none"
                      rows={3}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

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
                {isSubmitting ? 'Creating...' : 'Create Strain'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
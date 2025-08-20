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

interface YeastStrain {
  id: string;
  name: string;
  lab_source?: string;
  recommended_max_generation?: number;
}

const batchSchema = z.object({
  strain_id: z.string().min(1, 'Strain is required'),
  source: z.enum(['lab', 'harvest', 'bank']),
  generation: z.number().min(0).max(20),
  viability_notes: z.string().optional(),
  notes: z.string().optional(),
});

type YeastBatchForm = z.infer<typeof batchSchema>;

interface CreateYeastBatchDialogProps {
  strains: YeastStrain[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export function CreateYeastBatchDialog({
  strains,
  open,
  onOpenChange,
  onSuccess,
}: CreateYeastBatchDialogProps) {
  const supabase = createClient();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<YeastBatchForm>({
    resolver: zodResolver(batchSchema),
    defaultValues: {
      strain_id: '',
      source: 'lab',
      generation: 0,
      viability_notes: '',
      notes: '',
    },
  });

  const selectedStrain = strains.find(s => s.id === form.watch('strain_id'));
  const generation = form.watch('generation');
  const source = form.watch('source');

  // Auto-set generation based on source
  const handleSourceChange = (value: string) => {
    if (value === 'lab') {
      form.setValue('generation', 0);
    }
  };

  const onSubmit = async (values: YeastBatchForm) => {
    setIsSubmitting(true);
    try {
      const { error } = await supabase
        .from('yeast_batches')
        .insert({
          strain_id: values.strain_id,
          source: values.source,
          generation: values.generation,
          viability_notes: values.viability_notes || null,
          notes: values.notes || null,
        });

      if (error) throw error;

      onSuccess?.();
      onOpenChange(false);
      form.reset();
    } catch (error) {
      console.error('Error creating yeast batch:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Create Yeast Batch</DialogTitle>
          <DialogDescription>
            Start tracking a new yeast batch
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="strain_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Yeast Strain</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select strain" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {strains.map((strain) => (
                        <SelectItem key={strain.id} value={strain.id}>
                          <div className="flex flex-col">
                            <span>{strain.name}</span>
                            {strain.lab_source && (
                              <span className="text-xs text-muted-foreground">
                                {strain.lab_source}
                              </span>
                            )}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="source"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Source</FormLabel>
                  <Select 
                    onValueChange={(value) => {
                      field.onChange(value);
                      handleSourceChange(value);
                    }} 
                    value={field.value}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="lab">Fresh from Lab</SelectItem>
                      <SelectItem value="harvest">Harvested</SelectItem>
                      <SelectItem value="bank">Yeast Bank</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    Where this yeast batch originated
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="generation"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Generation</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min="0"
                      max="20"
                      {...field}
                      onChange={(e) => field.onChange(parseInt(e.target.value))}
                      disabled={source === 'lab'}
                    />
                  </FormControl>
                  <FormDescription>
                    Current generation number (0 for fresh lab yeast)
                  </FormDescription>
                  {selectedStrain?.recommended_max_generation && generation > selectedStrain.recommended_max_generation && (
                    <p className="text-sm text-amber-600">
                      Warning: Exceeds recommended max generation ({selectedStrain.recommended_max_generation})
                    </p>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="viability_notes"
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
                    Current viability status or test results
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Storage conditions, starter details, etc..."
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
                {isSubmitting ? 'Creating...' : 'Create Batch'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
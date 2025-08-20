'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
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
import { Calendar } from '@brewcrush/ui';
import { Popover, PopoverContent, PopoverTrigger } from '@brewcrush/ui';
import { Badge } from '@brewcrush/ui';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { CalendarIcon, AlertCircle } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Recipe, Tank, CreateBatchForm } from '@/types/production';

const batchSchema = z.object({
  batch_number: z.string().min(1, 'Batch number is required'),
  recipe_version_id: z.string().min(1, 'Recipe version is required'),
  brew_date: z.string().optional(),
  target_volume: z.number().positive('Volume must be positive').optional(),
  tank_id: z.string().optional(),
});

interface UseForBatchDialogProps {
  recipe: Recipe;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function UseForBatchDialog({
  recipe,
  open,
  onOpenChange,
}: UseForBatchDialogProps) {
  const supabase = createClient();
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Fetch available tanks
  const { data: tanks } = useQuery({
    queryKey: ['available-tanks'],
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

  // Fetch recipe versions
  const { data: versions } = useQuery({
    queryKey: ['recipe-versions', recipe.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('recipe_versions')
        .select('*')
        .eq('recipe_id', recipe.id)
        .eq('is_active', true)
        .order('version_number', { ascending: false });

      if (error) throw error;
      return data;
    },
    enabled: open,
  });

  // Generate batch number suggestion
  const { data: batchNumberSuggestion } = useQuery({
    queryKey: ['batch-number-suggestion'],
    queryFn: async () => {
      const today = new Date();
      const prefix = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}`;
      
      const { data, error } = await supabase
        .from('batches')
        .select('batch_number')
        .ilike('batch_number', `${prefix}%`)
        .order('batch_number', { ascending: false })
        .limit(1);

      if (error) throw error;

      if (data && data.length > 0) {
        const lastNumber = parseInt(data[0].batch_number.slice(-3)) || 0;
        return `${prefix}-${String(lastNumber + 1).padStart(3, '0')}`;
      }
      
      return `${prefix}-001`;
    },
    enabled: open,
  });

  const form = useForm<CreateBatchForm>({
    resolver: zodResolver(batchSchema),
    defaultValues: {
      batch_number: '',
      recipe_version_id: recipe.latest_version?.id || '',
      brew_date: format(new Date(), 'yyyy-MM-dd'),
      target_volume: recipe.latest_version?.target_volume || recipe.target_volume,
      tank_id: '',
    },
  });

  // Update batch number when suggestion loads
  if (batchNumberSuggestion && !form.getValues('batch_number')) {
    form.setValue('batch_number', batchNumberSuggestion);
  }

  const onSubmit = async (values: CreateBatchForm) => {
    setIsSubmitting(true);
    try {
      const { data, error } = await supabase.rpc('use_recipe_for_batch', {
        p_recipe_version_id: values.recipe_version_id,
        p_batch_number: values.batch_number,
        p_brew_date: values.brew_date || format(new Date(), 'yyyy-MM-dd'),
        p_tank_id: values.tank_id || null,
        p_target_volume: values.target_volume || null,
      });

      if (error) throw error;

      // Navigate to the new batch
      router.push(`/batches/${data}`);
      onOpenChange(false);
    } catch (error: any) {
      console.error('Error creating batch:', error);
      // Show error to user
      if (error.message?.includes('Batch number') && error.message?.includes('already exists')) {
        form.setError('batch_number', {
          type: 'manual',
          message: 'This batch number already exists',
        });
      } else if (error.message?.includes('Tank is currently occupied')) {
        form.setError('tank_id', {
          type: 'manual',
          message: 'This tank is currently occupied',
        });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const selectedVersion = versions?.find(v => v.id === form.watch('recipe_version_id'));
  const selectedVolume = form.watch('target_volume');
  const scalingFactor = selectedVersion?.target_volume && selectedVolume
    ? selectedVolume / selectedVersion.target_volume
    : 1;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Create Batch from Recipe</DialogTitle>
          <DialogDescription>
            Create a new production batch from <strong>{recipe.name}</strong>
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="batch_number"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Batch Number</FormLabel>
                  <FormControl>
                    <Input placeholder="YYYYMM-001" {...field} />
                  </FormControl>
                  <FormDescription>
                    Unique identifier for this batch
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="recipe_version_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Recipe Version</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select version" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {versions?.map((version) => (
                        <SelectItem key={version.id} value={version.id}>
                          Version {version.version_number}: {version.name}
                          {version.is_locked && (
                            <Badge variant="secondary" className="ml-2">
                              Locked
                            </Badge>
                          )}
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
              name="brew_date"
              render={({ field }) => (
                <FormItem className="flex flex-col">
                  <FormLabel>Brew Date</FormLabel>
                  <Popover>
                    <PopoverTrigger asChild>
                      <FormControl>
                        <Button
                          variant="outline"
                          className={cn(
                            'w-full pl-3 text-left font-normal',
                            !field.value && 'text-muted-foreground'
                          )}
                        >
                          {field.value ? (
                            format(new Date(field.value), 'PPP')
                          ) : (
                            <span>Pick a date</span>
                          )}
                          <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                        </Button>
                      </FormControl>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={field.value ? new Date(field.value) : undefined}
                        onSelect={(date) => 
                          field.onChange(date ? format(date, 'yyyy-MM-dd') : undefined)
                        }
                        disabled={(date) =>
                          date > new Date() || date < new Date('2020-01-01')
                        }
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="target_volume"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Target Volume (L)</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      step="0.1"
                      {...field}
                      onChange={(e) => field.onChange(parseFloat(e.target.value))}
                    />
                  </FormControl>
                  {scalingFactor !== 1 && (
                    <FormDescription className="flex items-center gap-1 text-amber-600">
                      <AlertCircle className="h-3 w-3" />
                      Recipe will be scaled by {(scalingFactor * 100).toFixed(0)}%
                    </FormDescription>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="tank_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tank (Optional)</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select tank" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="">No tank assigned</SelectItem>
                      {tanks?.map((tank) => (
                        <SelectItem key={tank.id} value={tank.id}>
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
                    Assign to a fermentation tank
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {selectedVersion && (
              <div className="rounded-lg bg-muted p-3 space-y-1 text-sm">
                <p className="font-medium">Recipe Targets:</p>
                <div className="grid grid-cols-2 gap-2 text-muted-foreground">
                  {selectedVersion.target_og && (
                    <span>OG: {selectedVersion.target_og.toFixed(3)}</span>
                  )}
                  {selectedVersion.target_fg && (
                    <span>FG: {selectedVersion.target_fg.toFixed(3)}</span>
                  )}
                  {selectedVersion.target_abv && (
                    <span>ABV: {selectedVersion.target_abv.toFixed(1)}%</span>
                  )}
                  {selectedVersion.target_ibu && (
                    <span>IBU: {selectedVersion.target_ibu}</span>
                  )}
                </div>
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
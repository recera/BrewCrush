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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@brewcrush/ui';
import { createClient } from '@/lib/supabase/client';
import { CreateRecipeForm } from '@/types/production';

const recipeSchema = z.object({
  name: z.string().min(1, 'Recipe name is required'),
  style: z.string().optional(),
  target_volume: z.number().positive('Volume must be positive').optional(),
  target_og: z.number().min(1).max(2).optional(),
  target_fg: z.number().min(1).max(2).optional(),
  target_abv: z.number().min(0).max(20).optional(),
  target_ibu: z.number().min(0).max(200).optional(),
  target_srm: z.number().min(0).max(100).optional(),
  target_ph: z.number().min(0).max(14).optional(),
  efficiency_pct: z.number().min(0).max(100).optional(),
  notes: z.string().optional(),
});

interface CreateRecipeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export function CreateRecipeDialog({
  open,
  onOpenChange,
  onSuccess,
}: CreateRecipeDialogProps) {
  const supabase = createClient();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<CreateRecipeForm>({
    resolver: zodResolver(recipeSchema),
    defaultValues: {
      name: '',
      style: '',
      target_volume: 20,
      target_og: 1.050,
      target_fg: 1.010,
      target_abv: 5.0,
      target_ibu: 30,
      target_srm: 10,
      target_ph: 5.4,
      efficiency_pct: 75,
      notes: '',
    },
  });

  const onSubmit = async (values: CreateRecipeForm) => {
    setIsSubmitting(true);
    try {
      // Create the recipe
      const { data: recipe, error: recipeError } = await supabase
        .from('recipes')
        .insert({
          name: values.name,
          style: values.style || null,
          target_volume: values.target_volume,
          target_og: values.target_og,
          target_fg: values.target_fg,
          target_abv: values.target_abv,
          target_ibu: values.target_ibu,
          target_srm: values.target_srm,
          efficiency_pct: values.efficiency_pct,
          notes: values.notes || null,
        })
        .select()
        .single();

      if (recipeError) throw recipeError;

      // Create the first version
      const { error: versionError } = await supabase
        .from('recipe_versions')
        .insert({
          recipe_id: recipe.id,
          workspace_id: recipe.workspace_id,
          version_number: 1,
          name: `${values.name} v1`,
          target_volume: values.target_volume,
          target_og: values.target_og,
          target_fg: values.target_fg,
          target_abv: values.target_abv,
          target_ibu: values.target_ibu,
          target_srm: values.target_srm,
          target_ph: values.target_ph,
          efficiency_pct: values.efficiency_pct,
          notes: values.notes || null,
          // Set QA spec ranges (±5% of targets as default)
          og_min: values.target_og ? values.target_og * 0.95 : null,
          og_max: values.target_og ? values.target_og * 1.05 : null,
          fg_min: values.target_fg ? values.target_fg * 0.95 : null,
          fg_max: values.target_fg ? values.target_fg * 1.05 : null,
          abv_min: values.target_abv ? values.target_abv * 0.9 : null,
          abv_max: values.target_abv ? values.target_abv * 1.1 : null,
          ibu_min: values.target_ibu ? values.target_ibu * 0.9 : null,
          ibu_max: values.target_ibu ? values.target_ibu * 1.1 : null,
          srm_min: values.target_srm ? Math.max(0, values.target_srm - 2) : null,
          srm_max: values.target_srm ? values.target_srm + 2 : null,
          ph_min: values.target_ph ? values.target_ph - 0.2 : null,
          ph_max: values.target_ph ? values.target_ph + 0.2 : null,
        });

      if (versionError) throw versionError;

      onSuccess?.();
    } catch (error) {
      console.error('Error creating recipe:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create New Recipe</DialogTitle>
          <DialogDescription>
            Add a new recipe to your brewery. You can add ingredients and steps after creation.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <Tabs defaultValue="basic" className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="basic">Basic Info</TabsTrigger>
                <TabsTrigger value="targets">Targets</TabsTrigger>
              </TabsList>

              <TabsContent value="basic" className="space-y-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Recipe Name</FormLabel>
                      <FormControl>
                        <Input placeholder="West Coast IPA" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="style"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Style</FormLabel>
                      <FormControl>
                        <Input placeholder="American IPA" {...field} />
                      </FormControl>
                      <FormDescription>
                        Beer style (e.g., IPA, Stout, Lager)
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid grid-cols-2 gap-4">
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
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="efficiency_pct"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Efficiency %</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            step="1"
                            {...field}
                            onChange={(e) => field.onChange(parseFloat(e.target.value))}
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
                      <FormLabel>Notes</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="Recipe notes..."
                          className="resize-none"
                          rows={4}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </TabsContent>

              <TabsContent value="targets" className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="target_og"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Target OG</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            step="0.001"
                            min="1.000"
                            max="2.000"
                            {...field}
                            onChange={(e) => field.onChange(parseFloat(e.target.value))}
                          />
                        </FormControl>
                        <FormDescription>Original Gravity</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="target_fg"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Target FG</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            step="0.001"
                            min="1.000"
                            max="2.000"
                            {...field}
                            onChange={(e) => field.onChange(parseFloat(e.target.value))}
                          />
                        </FormControl>
                        <FormDescription>Final Gravity</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="target_abv"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Target ABV %</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            step="0.1"
                            min="0"
                            max="20"
                            {...field}
                            onChange={(e) => field.onChange(parseFloat(e.target.value))}
                          />
                        </FormControl>
                        <FormDescription>Alcohol by Volume</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="target_ibu"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Target IBU</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            step="1"
                            min="0"
                            max="200"
                            {...field}
                            onChange={(e) => field.onChange(parseFloat(e.target.value))}
                          />
                        </FormControl>
                        <FormDescription>International Bitterness Units</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="target_srm"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Target SRM</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            step="1"
                            min="0"
                            max="100"
                            {...field}
                            onChange={(e) => field.onChange(parseFloat(e.target.value))}
                          />
                        </FormControl>
                        <FormDescription>Color (SRM)</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="target_ph"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Target pH</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            step="0.1"
                            min="0"
                            max="14"
                            {...field}
                            onChange={(e) => field.onChange(parseFloat(e.target.value))}
                          />
                        </FormControl>
                        <FormDescription>Mash pH</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </TabsContent>
            </Tabs>

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
                {isSubmitting ? 'Creating...' : 'Create Recipe'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@brewcrush/ui';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@brewcrush/ui';
import { Badge } from '@brewcrush/ui';
import { Button } from '@brewcrush/ui';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@brewcrush/ui';
import { Separator } from '@brewcrush/ui';
import { ScrollArea } from '@brewcrush/ui';
import { 
  FileText, 
  DollarSign, 
  Beaker, 
  Clock, 
  FlaskConical,
  History,
  Lock,
  Unlock,
  Plus
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useUserRole } from '@/hooks/useUserRole';
import { Recipe, RecipeVersion, RecipeIngredient, RecipeStep } from '@/types/production';
import { formatCurrency } from '@/lib/utils';

interface RecipeDetailDialogProps {
  recipe: Recipe;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRefresh?: () => void;
}

export function RecipeDetailDialog({
  recipe,
  open,
  onOpenChange,
  onRefresh,
}: RecipeDetailDialogProps) {
  const supabase = createClient();
  const { role, canViewCosts } = useUserRole();
  const [selectedVersion, setSelectedVersion] = useState<string | null>(null);
  
  const canEdit = role === 'admin' || role === 'brewer';

  // Fetch recipe versions
  const { data: versions } = useQuery({
    queryKey: ['recipe-versions', recipe.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('recipe_versions')
        .select('*')
        .eq('recipe_id', recipe.id)
        .order('version_number', { ascending: false });

      if (error) throw error;
      return data as RecipeVersion[];
    },
    enabled: open,
  });

  const currentVersion = versions?.find(v => v.id === (selectedVersion || recipe.latest_version?.id));

  // Fetch ingredients for current version
  const { data: ingredients } = useQuery({
    queryKey: ['recipe-ingredients', currentVersion?.id],
    queryFn: async () => {
      if (!currentVersion?.id) return [];
      
      const { data, error } = await supabase
        .from('recipe_ingredients')
        .select(`
          *,
          item:items(name, type, uom)
        `)
        .eq('recipe_version_id', currentVersion.id)
        .order('sort_order');

      if (error) throw error;
      return data as RecipeIngredient[];
    },
    enabled: !!currentVersion?.id,
  });

  // Fetch steps for current version
  const { data: steps } = useQuery({
    queryKey: ['recipe-steps', currentVersion?.id],
    queryFn: async () => {
      if (!currentVersion?.id) return [];
      
      const { data, error } = await supabase
        .from('recipe_steps')
        .select('*')
        .eq('recipe_version_id', currentVersion.id)
        .order('step_number');

      if (error) throw error;
      return data as RecipeStep[];
    },
    enabled: !!currentVersion?.id,
  });

  // Calculate recipe cost
  const { data: costData } = useQuery({
    queryKey: ['recipe-cost', currentVersion?.id],
    queryFn: async () => {
      if (!currentVersion?.id || !canViewCosts) return null;
      
      const { data, error } = await supabase.rpc('calculate_recipe_cost', {
        p_recipe_version_id: currentVersion.id,
      });

      if (error) throw error;
      return data;
    },
    enabled: !!currentVersion?.id && canViewCosts,
  });

  const handleLockVersion = async () => {
    if (!currentVersion?.id) return;

    try {
      const { error } = await supabase.rpc('lock_recipe_version', {
        p_version_id: currentVersion.id,
      });

      if (error) throw error;
      onRefresh?.();
    } catch (error) {
      console.error('Error locking version:', error);
    }
  };

  const handleCreateNewVersion = async () => {
    try {
      const { data, error } = await supabase.rpc('create_recipe_version', {
        p_recipe_id: recipe.id,
        p_copy_from_version_id: currentVersion?.id,
      });

      if (error) throw error;
      
      setSelectedVersion(data);
      onRefresh?.();
    } catch (error) {
      console.error('Error creating version:', error);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="text-2xl">{recipe.name}</DialogTitle>
          <DialogDescription className="flex items-center gap-4">
            {recipe.style && <span>{recipe.style}</span>}
            {recipe.recipe_code && (
              <Badge variant="outline">{recipe.recipe_code}</Badge>
            )}
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="overview" className="w-full">
          <TabsList className="grid w-full grid-cols-6">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="ingredients">Ingredients</TabsTrigger>
            <TabsTrigger value="steps">Steps</TabsTrigger>
            <TabsTrigger value="costing" disabled={!canViewCosts}>
              Costing
            </TabsTrigger>
            <TabsTrigger value="specs">Specs</TabsTrigger>
            <TabsTrigger value="versions">Versions</TabsTrigger>
          </TabsList>

          <ScrollArea className="h-[500px] mt-4">
            <TabsContent value="overview" className="space-y-4">
              {/* Version Selector */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center justify-between">
                    <span>Current Version</span>
                    {currentVersion?.is_locked ? (
                      <Badge variant="secondary">
                        <Lock className="mr-1 h-3 w-3" />
                        Locked
                      </Badge>
                    ) : (
                      canEdit && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={handleLockVersion}
                        >
                          <Unlock className="mr-1 h-3 w-3" />
                          Lock Version
                        </Button>
                      )
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <select
                    className="w-full p-2 border rounded"
                    value={selectedVersion || recipe.latest_version?.id || ''}
                    onChange={(e) => setSelectedVersion(e.target.value)}
                  >
                    {versions?.map((v) => (
                      <option key={v.id} value={v.id}>
                        Version {v.version_number}: {v.name}
                        {v.is_locked && ' (Locked)'}
                      </option>
                    ))}
                  </select>
                </CardContent>
              </Card>

              {/* Recipe Stats */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Recipe Targets</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    {currentVersion?.target_volume && (
                      <div>
                        <p className="text-sm text-muted-foreground">Volume</p>
                        <p className="font-medium">{currentVersion.target_volume} L</p>
                      </div>
                    )}
                    {currentVersion?.target_og && (
                      <div>
                        <p className="text-sm text-muted-foreground">Original Gravity</p>
                        <p className="font-medium">{currentVersion.target_og.toFixed(3)}</p>
                      </div>
                    )}
                    {currentVersion?.target_fg && (
                      <div>
                        <p className="text-sm text-muted-foreground">Final Gravity</p>
                        <p className="font-medium">{currentVersion.target_fg.toFixed(3)}</p>
                      </div>
                    )}
                    {currentVersion?.target_abv && (
                      <div>
                        <p className="text-sm text-muted-foreground">ABV</p>
                        <p className="font-medium">{currentVersion.target_abv.toFixed(1)}%</p>
                      </div>
                    )}
                    {currentVersion?.target_ibu && (
                      <div>
                        <p className="text-sm text-muted-foreground">IBU</p>
                        <p className="font-medium">{currentVersion.target_ibu}</p>
                      </div>
                    )}
                    {currentVersion?.target_srm && (
                      <div>
                        <p className="text-sm text-muted-foreground">SRM</p>
                        <p className="font-medium">{currentVersion.target_srm}</p>
                      </div>
                    )}
                    {currentVersion?.efficiency_pct && (
                      <div>
                        <p className="text-sm text-muted-foreground">Efficiency</p>
                        <p className="font-medium">{currentVersion.efficiency_pct}%</p>
                      </div>
                    )}
                    {currentVersion?.boil_time && (
                      <div>
                        <p className="text-sm text-muted-foreground">Boil Time</p>
                        <p className="font-medium">{currentVersion.boil_time} min</p>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Notes */}
              {currentVersion?.notes && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Notes</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm whitespace-pre-wrap">{currentVersion.notes}</p>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="ingredients" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Recipe Ingredients</CardTitle>
                  <CardDescription>
                    All ingredients for {currentVersion?.target_volume}L batch
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {ingredients && ingredients.length > 0 ? (
                    <div className="space-y-4">
                      {['mash', 'boil', 'fermentation', 'dry_hop', 'packaging'].map((phase) => {
                        const phaseIngredients = ingredients.filter(i => i.phase === phase);
                        if (phaseIngredients.length === 0) return null;

                        return (
                          <div key={phase}>
                            <h4 className="font-semibold text-sm mb-2 capitalize">
                              {phase.replace('_', ' ')}
                            </h4>
                            <div className="space-y-2">
                              {phaseIngredients.map((ingredient) => (
                                <div
                                  key={ingredient.id}
                                  className="flex justify-between items-center py-2 px-3 bg-muted/50 rounded"
                                >
                                  <div className="flex-1">
                                    <p className="font-medium">{ingredient.item?.name}</p>
                                    {ingredient.timing && (
                                      <p className="text-sm text-muted-foreground">
                                        {ingredient.timing}
                                      </p>
                                    )}
                                  </div>
                                  <div className="text-right">
                                    <p className="font-medium">
                                      {ingredient.qty} {ingredient.uom}
                                    </p>
                                    {canViewCosts && ingredient.unit_cost && (
                                      <p className="text-sm text-muted-foreground">
                                        {formatCurrency(ingredient.qty * ingredient.unit_cost)}
                                      </p>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-muted-foreground">No ingredients added yet</p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="steps" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Brewing Steps</CardTitle>
                </CardHeader>
                <CardContent>
                  {steps && steps.length > 0 ? (
                    <div className="space-y-4">
                      {steps.map((step) => (
                        <div
                          key={step.id}
                          className="border-l-4 border-primary pl-4"
                        >
                          <div className="flex items-center gap-2 mb-1">
                            <Badge>{step.phase}</Badge>
                            <h4 className="font-semibold">
                              Step {step.step_number}: {step.name}
                            </h4>
                          </div>
                          {step.description && (
                            <p className="text-sm text-muted-foreground mb-2">
                              {step.description}
                            </p>
                          )}
                          <div className="flex gap-4 text-sm">
                            {step.duration_minutes && (
                              <div className="flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                {step.duration_minutes} min
                              </div>
                            )}
                            {step.temperature && (
                              <div className="flex items-center gap-1">
                                <FlaskConical className="h-3 w-3" />
                                {step.temperature}°{step.temperature_unit || 'C'}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-muted-foreground">No steps defined yet</p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="costing" className="space-y-4">
              {canViewCosts && costData ? (
                <>
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Cost Summary</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-4">
                        <div className="flex justify-between items-center">
                          <span>Ingredient Cost</span>
                          <span className="font-medium">
                            {formatCurrency(costData.ingredient_cost)}
                          </span>
                        </div>
                        {costData.overhead_cost > 0 && (
                          <div className="flex justify-between items-center">
                            <span>Overhead ({currentVersion?.overhead_pct || 0}%)</span>
                            <span className="font-medium">
                              {formatCurrency(costData.overhead_cost)}
                            </span>
                          </div>
                        )}
                        <Separator />
                        <div className="flex justify-between items-center text-lg font-semibold">
                          <span>Total Cost</span>
                          <span>{formatCurrency(costData.total_cost)}</span>
                        </div>
                        {currentVersion?.target_volume && (
                          <div className="flex justify-between items-center text-sm text-muted-foreground">
                            <span>Cost per Liter</span>
                            <span>{formatCurrency(costData.cost_per_liter)}</span>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>

                  {costData.cost_breakdown?.ingredients && (
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base">Ingredient Breakdown</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-2">
                          {costData.cost_breakdown.ingredients.map((item: any, idx: number) => (
                            <div
                              key={idx}
                              className="flex justify-between items-center py-2"
                            >
                              <div>
                                <p className="font-medium">{item.item_name}</p>
                                <p className="text-sm text-muted-foreground">
                                  {item.qty} {item.uom} @ {formatCurrency(item.unit_cost)}/{item.uom}
                                </p>
                              </div>
                              <span className="font-medium">
                                {formatCurrency(item.total_cost)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </>
              ) : (
                <Card>
                  <CardContent className="py-8 text-center text-muted-foreground">
                    Cost information not available
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="specs" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">QA Specifications</CardTitle>
                  <CardDescription>
                    Acceptable ranges for quality control
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-4">
                    {currentVersion?.og_min && currentVersion?.og_max && (
                      <div>
                        <p className="text-sm text-muted-foreground">Original Gravity</p>
                        <p className="font-medium">
                          {currentVersion.og_min.toFixed(3)} - {currentVersion.og_max.toFixed(3)}
                        </p>
                      </div>
                    )}
                    {currentVersion?.fg_min && currentVersion?.fg_max && (
                      <div>
                        <p className="text-sm text-muted-foreground">Final Gravity</p>
                        <p className="font-medium">
                          {currentVersion.fg_min.toFixed(3)} - {currentVersion.fg_max.toFixed(3)}
                        </p>
                      </div>
                    )}
                    {currentVersion?.abv_min && currentVersion?.abv_max && (
                      <div>
                        <p className="text-sm text-muted-foreground">ABV %</p>
                        <p className="font-medium">
                          {currentVersion.abv_min.toFixed(1)} - {currentVersion.abv_max.toFixed(1)}
                        </p>
                      </div>
                    )}
                    {currentVersion?.ibu_min && currentVersion?.ibu_max && (
                      <div>
                        <p className="text-sm text-muted-foreground">IBU</p>
                        <p className="font-medium">
                          {currentVersion.ibu_min} - {currentVersion.ibu_max}
                        </p>
                      </div>
                    )}
                    {currentVersion?.srm_min && currentVersion?.srm_max && (
                      <div>
                        <p className="text-sm text-muted-foreground">SRM</p>
                        <p className="font-medium">
                          {currentVersion.srm_min} - {currentVersion.srm_max}
                        </p>
                      </div>
                    )}
                    {currentVersion?.ph_min && currentVersion?.ph_max && (
                      <div>
                        <p className="text-sm text-muted-foreground">pH</p>
                        <p className="font-medium">
                          {currentVersion.ph_min.toFixed(1)} - {currentVersion.ph_max.toFixed(1)}
                        </p>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="versions" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center justify-between">
                    <span>Version History</span>
                    {canEdit && (
                      <Button size="sm" onClick={handleCreateNewVersion}>
                        <Plus className="mr-1 h-3 w-3" />
                        New Version
                      </Button>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {versions && versions.length > 0 ? (
                    <div className="space-y-2">
                      {versions.map((version) => (
                        <div
                          key={version.id}
                          className={`p-3 rounded border cursor-pointer transition-colors ${
                            version.id === currentVersion?.id
                              ? 'border-primary bg-primary/5'
                              : 'hover:bg-muted/50'
                          }`}
                          onClick={() => setSelectedVersion(version.id)}
                        >
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="font-medium">
                                Version {version.version_number}: {version.name}
                              </p>
                              <p className="text-sm text-muted-foreground">
                                Created {new Date(version.created_at).toLocaleDateString()}
                              </p>
                            </div>
                            {version.is_locked && (
                              <Badge variant="secondary">
                                <Lock className="mr-1 h-3 w-3" />
                                Locked
                              </Badge>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-muted-foreground">No versions found</p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </ScrollArea>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
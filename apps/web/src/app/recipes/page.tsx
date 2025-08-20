'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, Search, Filter, ChevronDown, DollarSign, Beaker, Copy } from 'lucide-react';
import { Button } from '@brewcrush/ui';
import { Input } from '@brewcrush/ui';
import { Badge } from '@brewcrush/ui';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@brewcrush/ui';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@brewcrush/ui';
import { createClient } from '@/lib/supabase/client';
import { useUserRole } from '@/hooks/useUserRole';
import { Recipe } from '@/types/production';
import { formatCurrency } from '@/lib/utils';
import { RecipeDetailDialog } from '@/components/recipes/RecipeDetailDialog';
import { CreateRecipeDialog } from '@/components/recipes/CreateRecipeDialog';
import { UseForBatchDialog } from '@/components/recipes/UseForBatchDialog';

export default function RecipesPage() {
  const supabase = createClient();
  const { role, canViewCosts } = useUserRole();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedStyle, setSelectedStyle] = useState<string | null>(null);
  const [selectedRecipe, setSelectedRecipe] = useState<Recipe | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [useForBatchRecipe, setUseForBatchRecipe] = useState<Recipe | null>(null);

  const canCreateRecipes = role === 'admin' || role === 'brewer';

  // Fetch recipes with cost visibility
  const { data: recipes, isLoading, refetch } = useQuery({
    queryKey: ['recipes', searchTerm, selectedStyle],
    queryFn: async () => {
      let query = supabase
        .from('v_recipes_with_costs')
        .select('*')
        .eq('is_active', true)
        .order('name');

      if (searchTerm) {
        query = query.ilike('name', `%${searchTerm}%`);
      }

      if (selectedStyle) {
        query = query.eq('style', selectedStyle);
      }

      const { data, error } = await query;

      if (error) throw error;
      return data as Recipe[];
    },
  });

  // Fetch unique styles for filter
  const { data: styles } = useQuery({
    queryKey: ['recipe-styles'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('recipes')
        .select('style')
        .eq('is_active', true)
        .not('style', 'is', null);

      if (error) throw error;
      
      const uniqueStyles = [...new Set(data?.map(r => r.style))].filter(Boolean);
      return uniqueStyles;
    },
  });

  const handleDuplicateRecipe = async (recipe: Recipe) => {
    try {
      const { data, error } = await supabase.rpc('create_recipe_version', {
        p_recipe_id: recipe.id,
        p_name: `${recipe.name} (Copy)`,
        p_copy_from_version_id: recipe.latest_version?.id,
      });

      if (error) throw error;
      
      refetch();
    } catch (error) {
      console.error('Error duplicating recipe:', error);
    }
  };

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
        <div>
          <h1 className="text-3xl font-bold">Recipes</h1>
          <p className="text-muted-foreground">Manage your brewing recipes and versions</p>
        </div>
        {canCreateRecipes && (
          <Button onClick={() => setCreateDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            New Recipe
          </Button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
          <Input
            placeholder="Search recipes..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline">
              <Filter className="mr-2 h-4 w-4" />
              {selectedStyle || 'All Styles'}
              <ChevronDown className="ml-2 h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLabel>Filter by Style</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setSelectedStyle(null)}>
              All Styles
            </DropdownMenuItem>
            {styles?.map((style) => (
              <DropdownMenuItem
                key={style}
                onClick={() => setSelectedStyle(style)}
              >
                {style}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Recipe Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <Card key={i} className="animate-pulse">
              <CardHeader>
                <div className="h-6 bg-muted rounded w-3/4 mb-2" />
                <div className="h-4 bg-muted rounded w-1/2" />
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="h-4 bg-muted rounded" />
                  <div className="h-4 bg-muted rounded w-5/6" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : recipes?.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="text-muted-foreground mb-4">No recipes found</p>
          {canCreateRecipes && (
            <Button onClick={() => setCreateDialogOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Create Your First Recipe
            </Button>
          )}
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {recipes?.map((recipe) => (
            <Card
              key={recipe.id}
              className="cursor-pointer hover:shadow-lg transition-shadow"
              onClick={() => setSelectedRecipe(recipe)}
            >
              <CardHeader>
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <CardTitle className="text-lg">{recipe.name}</CardTitle>
                    {recipe.style && (
                      <CardDescription>{recipe.style}</CardDescription>
                    )}
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      onClick={(e) => e.stopPropagation()}
                      asChild
                    >
                      <Button variant="ghost" size="icon">
                        <ChevronDown className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedRecipe(recipe);
                        }}
                      >
                        View Details
                      </DropdownMenuItem>
                      {canCreateRecipes && (
                        <>
                          <DropdownMenuItem
                            onClick={(e) => {
                              e.stopPropagation();
                              setUseForBatchRecipe(recipe);
                            }}
                          >
                            <Beaker className="mr-2 h-4 w-4" />
                            Use for Batch
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDuplicateRecipe(recipe);
                            }}
                          >
                            <Copy className="mr-2 h-4 w-4" />
                            Duplicate
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {/* Recipe Stats */}
                  <div className="flex flex-wrap gap-2">
                    {recipe.target_volume && (
                      <Badge variant="secondary">
                        {recipe.target_volume}L
                      </Badge>
                    )}
                    {recipe.target_abv && (
                      <Badge variant="secondary">
                        {recipe.target_abv.toFixed(1)}% ABV
                      </Badge>
                    )}
                    {recipe.target_ibu && (
                      <Badge variant="secondary">
                        {recipe.target_ibu} IBU
                      </Badge>
                    )}
                  </div>

                  {/* Version Info */}
                  {recipe.latest_version && (
                    <div className="text-sm text-muted-foreground">
                      Version {recipe.latest_version.version_number}
                      {recipe.latest_version.is_locked && (
                        <Badge variant="outline" className="ml-2">
                          Locked
                        </Badge>
                      )}
                    </div>
                  )}

                  {/* Cost Info */}
                  {canViewCosts && recipe.calculated_cost && (
                    <div className="flex items-center gap-2 text-sm">
                      <DollarSign className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium">
                        {formatCurrency(recipe.calculated_cost)}
                      </span>
                      {recipe.target_volume && (
                        <span className="text-muted-foreground">
                          ({formatCurrency(recipe.calculated_cost / recipe.target_volume)}/L)
                        </span>
                      )}
                    </div>
                  )}

                  {/* Batch Count */}
                  {recipe.batch_count !== undefined && recipe.batch_count > 0 && (
                    <div className="text-sm text-muted-foreground">
                      {recipe.batch_count} batch{recipe.batch_count !== 1 ? 'es' : ''} brewed
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Dialogs */}
      {selectedRecipe && (
        <RecipeDetailDialog
          recipe={selectedRecipe}
          open={!!selectedRecipe}
          onOpenChange={(open) => !open && setSelectedRecipe(null)}
          onRefresh={refetch}
        />
      )}

      {createDialogOpen && (
        <CreateRecipeDialog
          open={createDialogOpen}
          onOpenChange={setCreateDialogOpen}
          onSuccess={() => {
            refetch();
            setCreateDialogOpen(false);
          }}
        />
      )}

      {useForBatchRecipe && (
        <UseForBatchDialog
          recipe={useForBatchRecipe}
          open={!!useForBatchRecipe}
          onOpenChange={(open) => !open && setUseForBatchRecipe(null)}
        />
      )}
    </div>
  );
}
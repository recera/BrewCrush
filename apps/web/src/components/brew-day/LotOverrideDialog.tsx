'use client';

import { useState } from 'react';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@brewcrush/ui';
import { Button } from '@brewcrush/ui';
import { Card, CardContent } from '@brewcrush/ui';
import { Badge } from '@brewcrush/ui';
import { Alert, AlertDescription } from '@brewcrush/ui';
import { 
  Package, 
  DollarSign, 
  TrendingUp, 
  TrendingDown,
  AlertCircle,
  Check,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { formatCurrency, formatNumber } from '@/lib/utils';
import { addToOutbox } from '@/lib/offline/db';

interface Ingredient {
  id: string;
  item_id: string;
  qty: number;
  uom: string;
  item: {
    id: string;
    name: string;
    type: string;
  };
}

interface ItemLot {
  id: string;
  item_id: string;
  lot_code: string;
  qty: number;
  uom: string;
  unit_cost: number;
  expiry?: string;
  location?: {
    name: string;
  };
}

interface LotOverride {
  ingredientId: string;
  lotId: string;
}

interface LotOverrideDialogProps {
  ingredients: Ingredient[];
  batchId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function LotOverrideDialog({
  ingredients,
  batchId,
  open,
  onOpenChange,
}: LotOverrideDialogProps) {
  const supabase = createClient();
  const [overrides, setOverrides] = useState<LotOverride[]>([]);
  const [isApplying, setIsApplying] = useState(false);

  // Fetch available lots for all ingredients
  const { data: lotsData } = useQuery({
    queryKey: ['ingredient-lots', ingredients.map(i => i.item_id)],
    queryFn: async () => {
      const itemIds = ingredients.map(i => i.item_id);
      
      const { data, error } = await supabase
        .from('item_lots')
        .select(`
          *,
          location:inventory_locations(name)
        `)
        .in('item_id', itemIds)
        .gt('qty', 0)
        .order('created_at'); // FIFO order

      if (error) throw error;
      
      // Group lots by item
      const lotsByItem: Record<string, ItemLot[]> = {};
      (data as ItemLot[]).forEach(lot => {
        if (!lotsByItem[lot.item_id]) {
          lotsByItem[lot.item_id] = [];
        }
        lotsByItem[lot.item_id].push(lot);
      });
      
      return lotsByItem;
    },
    enabled: open && ingredients.length > 0,
  });

  // Calculate COGS impact
  const calculateCOGSDelta = () => {
    let fifoCost = 0;
    let overrideCost = 0;

    ingredients.forEach(ingredient => {
      const lots = lotsData?.[ingredient.item_id] || [];
      const override = overrides.find(o => o.ingredientId === ingredient.id);
      
      // Calculate FIFO cost
      let remainingQty = ingredient.qty;
      for (const lot of lots) {
        if (remainingQty <= 0) break;
        const qtyToUse = Math.min(remainingQty, lot.qty);
        fifoCost += qtyToUse * lot.unit_cost;
        remainingQty -= qtyToUse;
      }
      
      // Calculate override cost if selected
      if (override) {
        const selectedLot = lots.find(l => l.id === override.lotId);
        if (selectedLot) {
          overrideCost += ingredient.qty * selectedLot.unit_cost;
        }
      } else {
        // Use FIFO for non-overridden items
        overrideCost += fifoCost;
      }
    });

    return {
      fifoCost,
      overrideCost,
      delta: overrideCost - fifoCost,
    };
  };

  const handleOverrideChange = (ingredientId: string, lotId: string) => {
    setOverrides(prev => {
      const existing = prev.findIndex(o => o.ingredientId === ingredientId);
      if (existing >= 0) {
        const updated = [...prev];
        if (lotId === 'fifo') {
          // Remove override
          updated.splice(existing, 1);
        } else {
          updated[existing] = { ingredientId, lotId };
        }
        return updated;
      }
      if (lotId !== 'fifo') {
        return [...prev, { ingredientId, lotId }];
      }
      return prev;
    });
  };

  const handleApply = async () => {
    setIsApplying(true);
    try {
      // Prepare the override data
      const lotOverrides: Record<string, string> = {};
      overrides.forEach(override => {
        lotOverrides[override.ingredientId] = override.lotId;
      });

      // Add to offline queue
      const user = await supabase.auth.getUser();
      if (user.data.user) {
        await addToOutbox({
          operation: 'batch.consume_inventory',
          payload: {
            batch_id: batchId,
            lot_overrides: lotOverrides,
          },
          workspaceId: '', // Will be filled from batch
          userId: user.data.user.id,
        });
      }

      onOpenChange(false);
    } catch (error) {
      console.error('Error applying lot overrides:', error);
    } finally {
      setIsApplying(false);
    }
  };

  const { fifoCost, overrideCost, delta } = calculateCOGSDelta();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle>Override Ingredient Lots</DialogTitle>
          <DialogDescription>
            Select specific lots to use instead of FIFO. This will affect your batch COGS.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 overflow-y-auto max-h-[50vh]">
          {/* COGS Impact Summary */}
          <Card>
            <CardContent className="pt-4">
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">FIFO Cost</p>
                  <p className="font-medium">{formatCurrency(fifoCost)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Override Cost</p>
                  <p className="font-medium">{formatCurrency(overrideCost)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Delta</p>
                  <p className={`font-medium flex items-center gap-1 ${
                    delta > 0 ? 'text-red-600' : delta < 0 ? 'text-green-600' : ''
                  }`}>
                    {delta > 0 && <TrendingUp className="h-3 w-3" />}
                    {delta < 0 && <TrendingDown className="h-3 w-3" />}
                    {formatCurrency(Math.abs(delta))}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Ingredient List */}
          {ingredients.map(ingredient => {
            const lots = lotsData?.[ingredient.item_id] || [];
            const override = overrides.find(o => o.ingredientId === ingredient.id);
            
            return (
              <Card key={ingredient.id}>
                <CardContent className="pt-4">
                  <div className="space-y-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-medium">{ingredient.item.name}</p>
                        <p className="text-sm text-muted-foreground">
                          Need: {formatNumber(ingredient.qty, 2)} {ingredient.uom}
                        </p>
                      </div>
                      <Package className="h-4 w-4 text-muted-foreground" />
                    </div>

                    <Select
                      value={override?.lotId || 'fifo'}
                      onValueChange={(value) => handleOverrideChange(ingredient.id, value)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="fifo">
                          <div className="flex items-center justify-between w-full">
                            <span>Use FIFO (Default)</span>
                            <Badge variant="secondary">Auto</Badge>
                          </div>
                        </SelectItem>
                        {lots.map(lot => (
                          <SelectItem key={lot.id} value={lot.id}>
                            <div className="flex flex-col">
                              <div className="flex items-center gap-2">
                                <span>{lot.lot_code}</span>
                                {lot.location && (
                                  <Badge variant="outline" className="text-xs">
                                    {lot.location.name}
                                  </Badge>
                                )}
                              </div>
                              <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                                <span>Available: {formatNumber(lot.qty, 2)} {lot.uom}</span>
                                <span>Cost: {formatCurrency(lot.unit_cost)}/{lot.uom}</span>
                                {lot.expiry && (
                                  <span>Exp: {new Date(lot.expiry).toLocaleDateString()}</span>
                                )}
                              </div>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    {override && (
                      <div className="flex items-center gap-2 text-sm">
                        <Check className="h-3 w-3 text-green-500" />
                        <span className="text-muted-foreground">
                          Override applied - Cost impact: {
                            (() => {
                              const selectedLot = lots.find(l => l.id === override.lotId);
                              if (!selectedLot) return formatCurrency(0);
                              
                              // Calculate FIFO cost for this ingredient
                              let fifoCost = 0;
                              let remainingQty = ingredient.qty;
                              for (const lot of lots) {
                                if (remainingQty <= 0) break;
                                const qtyToUse = Math.min(remainingQty, lot.qty);
                                fifoCost += qtyToUse * lot.unit_cost;
                                remainingQty -= qtyToUse;
                              }
                              
                              const overrideCost = ingredient.qty * selectedLot.unit_cost;
                              const delta = overrideCost - fifoCost;
                              
                              return (
                                <span className={delta > 0 ? 'text-red-600' : 'text-green-600'}>
                                  {delta > 0 ? '+' : ''}{formatCurrency(delta)}
                                </span>
                              );
                            })()
                          }
                        </span>
                      </div>
                    )}

                    {lots.length === 0 && (
                      <Alert>
                        <AlertCircle className="h-4 w-4" />
                        <AlertDescription>
                          No lots available for this ingredient
                        </AlertDescription>
                      </Alert>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isApplying}
          >
            Cancel
          </Button>
          <Button
            onClick={handleApply}
            disabled={isApplying}
          >
            {isApplying ? (
              <>Applying...</>
            ) : (
              <>
                <DollarSign className="mr-2 h-4 w-4" />
                Apply Overrides
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
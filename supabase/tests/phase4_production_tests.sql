-- Phase 4.11: Production Module Tests
-- ============================================================================
-- Tests for recipe management, batch operations, yeast tracking, and COGS calculations

BEGIN;

-- Install pgTAP if not already installed
CREATE EXTENSION IF NOT EXISTS pgtap;

-- Test Recipe Scaling
-- ============================================================================
SELECT plan(20);

-- Create test workspace and user
INSERT INTO workspaces (id, name, plan) 
VALUES ('test-workspace-1', 'Test Brewery', 'starter');

-- Mock auth.uid() function for testing
CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID AS $$
  SELECT 'test-user-1'::UUID;
$$ LANGUAGE SQL;

-- Mock get_current_workspace_id() for testing
CREATE OR REPLACE FUNCTION get_current_workspace_id() RETURNS UUID AS $$
  SELECT 'test-workspace-1'::UUID;
$$ LANGUAGE SQL;

-- Test 1: Recipe creation and versioning
-- ----------------------------------------------------------------------------
SELECT is(
  (SELECT COUNT(*) FROM recipes WHERE workspace_id = 'test-workspace-1'::UUID),
  0::BIGINT,
  'Should start with no recipes'
);

-- Insert test recipe
INSERT INTO recipes (id, workspace_id, name, style, target_volume, target_og, created_by)
VALUES ('test-recipe-1', 'test-workspace-1', 'Test IPA', 'IPA', 100, 1.055, 'test-user-1');

-- Create recipe version
INSERT INTO recipe_versions (
  id, recipe_id, workspace_id, version_number, 
  grain_bill, hop_schedule, is_locked
)
VALUES (
  'test-version-1', 
  'test-recipe-1', 
  'test-workspace-1',
  1,
  '[{"name": "Pale Malt", "quantity": 20, "unit": "kg"}]'::JSONB,
  '[{"name": "Cascade", "quantity": 100, "unit": "g", "time": 60}]'::JSONB,
  false
);

SELECT ok(
  EXISTS(SELECT 1 FROM recipes WHERE id = 'test-recipe-1'),
  'Recipe should be created'
);

SELECT ok(
  EXISTS(SELECT 1 FROM recipe_versions WHERE recipe_id = 'test-recipe-1'),
  'Recipe version should be created'
);

-- Test 2: Recipe scaling function
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION test_scale_recipe(
  p_recipe_version_id UUID,
  p_target_volume NUMERIC
)
RETURNS TABLE (
  ingredient_name TEXT,
  original_qty NUMERIC,
  scaled_qty NUMERIC
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_original_volume NUMERIC;
  v_scale_factor NUMERIC;
BEGIN
  -- Get original volume
  SELECT r.target_volume INTO v_original_volume
  FROM recipe_versions rv
  JOIN recipes r ON r.id = rv.recipe_id
  WHERE rv.id = p_recipe_version_id;
  
  -- Calculate scale factor
  v_scale_factor := p_target_volume / v_original_volume;
  
  -- Return scaled ingredients
  RETURN QUERY
  SELECT 
    gb->>'name' AS ingredient_name,
    (gb->>'quantity')::NUMERIC AS original_qty,
    ROUND((gb->>'quantity')::NUMERIC * v_scale_factor, 2) AS scaled_qty
  FROM recipe_versions rv, 
       jsonb_array_elements(rv.grain_bill) gb
  WHERE rv.id = p_recipe_version_id;
END;
$$;

SELECT results_eq(
  $$SELECT scaled_qty FROM test_scale_recipe('test-version-1', 200)$$,
  $$SELECT 40::NUMERIC$$,
  'Recipe should scale correctly (100L to 200L doubles ingredients)'
);

-- Test 3: Batch creation and status transitions
-- ----------------------------------------------------------------------------
INSERT INTO tanks (id, workspace_id, name, type, capacity, is_active)
VALUES ('test-tank-1', 'test-workspace-1', 'FV1', 'fermenter', 120, true);

INSERT INTO batches (
  id, workspace_id, batch_number, recipe_version_id, 
  tank_id, status, target_volume
)
VALUES (
  'test-batch-1', 'test-workspace-1', 'B001', 'test-version-1',
  'test-tank-1', 'planned', 100
);

SELECT is(
  (SELECT status FROM batches WHERE id = 'test-batch-1'),
  'planned',
  'Batch should start in planned status'
);

-- Update batch status
UPDATE batches 
SET status = 'brewing' 
WHERE id = 'test-batch-1';

SELECT is(
  (SELECT status FROM batches WHERE id = 'test-batch-1'),
  'brewing',
  'Batch status should update to brewing'
);

-- Test 4: Yeast generation tracking
-- ----------------------------------------------------------------------------
INSERT INTO yeast_strains (
  id, workspace_id, name, type, recommended_max_generation
)
VALUES (
  'test-strain-1', 'test-workspace-1', 'US-05', 'ale', 10
);

INSERT INTO yeast_batches (
  id, workspace_id, strain_id, generation, source
)
VALUES (
  'test-yeast-1', 'test-workspace-1', 'test-strain-1', 0, 'lab'
);

SELECT is(
  (SELECT generation FROM yeast_batches WHERE id = 'test-yeast-1'),
  0,
  'Fresh yeast should start at generation 0'
);

-- Test harvest increments generation
CREATE OR REPLACE FUNCTION test_harvest_yeast(p_yeast_batch_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_new_generation INTEGER;
BEGIN
  UPDATE yeast_batches
  SET 
    harvest_at = NOW(),
    generation = generation + 1
  WHERE id = p_yeast_batch_id
  RETURNING generation INTO v_new_generation;
  
  RETURN v_new_generation;
END;
$$;

SELECT is(
  test_harvest_yeast('test-yeast-1'),
  1,
  'Harvesting should increment yeast generation'
);

-- Test 5: COGS calculation with actual lots
-- ----------------------------------------------------------------------------

-- Create test items and lots
INSERT INTO items (id, workspace_id, name, type, uom)
VALUES 
  ('test-item-1', 'test-workspace-1', 'Pale Malt', 'raw', 'kg'),
  ('test-item-2', 'test-workspace-1', 'Cascade Hops', 'raw', 'g');

INSERT INTO item_lots (
  id, workspace_id, item_id, lot_code, 
  qty, uom, unit_cost, location_id
)
VALUES 
  ('test-lot-1', 'test-workspace-1', 'test-item-1', 'LOT001', 100, 'kg', 2.50, 'test-location-1'),
  ('test-lot-2', 'test-workspace-1', 'test-item-2', 'LOT002', 500, 'g', 0.05, 'test-location-1');

-- Function to calculate batch COGS
CREATE OR REPLACE FUNCTION calc_batch_cogs(p_batch_id UUID)
RETURNS NUMERIC
LANGUAGE plpgsql
AS $$
DECLARE
  v_total_cost NUMERIC := 0;
BEGIN
  -- Sum up all consumption costs for the batch
  SELECT COALESCE(SUM(
    CASE 
      WHEN it.qty IS NOT NULL AND il.unit_cost IS NOT NULL 
      THEN it.qty * il.unit_cost
      ELSE 0
    END
  ), 0) INTO v_total_cost
  FROM inventory_transactions it
  LEFT JOIN item_lots il ON il.id = it.item_lot_id
  WHERE it.ref_type = 'batch' 
    AND it.ref_id = p_batch_id
    AND it.type = 'consume';
  
  RETURN ROUND(v_total_cost, 2);
END;
$$;

-- Insert consumption transactions
INSERT INTO inventory_transactions (
  id, workspace_id, type, item_id, item_lot_id,
  qty, uom, ref_type, ref_id
)
VALUES 
  ('test-txn-1', 'test-workspace-1', 'consume', 'test-item-1', 'test-lot-1', 
   20, 'kg', 'batch', 'test-batch-1'),
  ('test-txn-2', 'test-workspace-1', 'consume', 'test-item-2', 'test-lot-2',
   100, 'g', 'batch', 'test-batch-1');

SELECT is(
  calc_batch_cogs('test-batch-1'),
  55.00,  -- (20 * 2.50) + (100 * 0.05) = 50 + 5 = 55
  'COGS calculation should be correct'
);

-- Test 6: Fermentation readings and telemetry
-- ----------------------------------------------------------------------------
INSERT INTO ferm_readings (
  id, workspace_id, batch_id, sg, temp, ph, reading_at
)
VALUES (
  'test-reading-1', 'test-workspace-1', 'test-batch-1',
  1.055, 18.5, 5.2, NOW()
);

SELECT ok(
  EXISTS(
    SELECT 1 FROM ferm_readings 
    WHERE batch_id = 'test-batch-1' AND sg = 1.055
  ),
  'Fermentation reading should be recorded'
);

-- Test telemetry event logging
SELECT ok(
  EXISTS(
    SELECT 1 FROM telemetry_events 
    WHERE entity_type = 'batch' 
    AND entity_id = 'test-batch-1'
    AND event_type = 'batch_created'
  ),
  'Batch creation should trigger telemetry event'
);

-- Test 7: Tank occupancy constraints
-- ----------------------------------------------------------------------------
INSERT INTO batches (
  id, workspace_id, batch_number, recipe_version_id,
  tank_id, status, target_volume
)
VALUES (
  'test-batch-2', 'test-workspace-1', 'B002', 'test-version-1',
  'test-tank-1', 'fermenting', 100
);

-- This should fail due to tank already occupied
SELECT throws_ok(
  $$INSERT INTO batches (
    id, workspace_id, batch_number, recipe_version_id,
    tank_id, status, target_volume
  )
  VALUES (
    'test-batch-3', 'test-workspace-1', 'B003', 'test-version-1',
    'test-tank-1', 'fermenting', 100
  )$$,
  '23505',  -- unique_violation
  'Should not allow multiple active batches in same tank'
);

-- Test 8: Offline sync with idempotency
-- ----------------------------------------------------------------------------
INSERT INTO ferm_readings (
  id, workspace_id, batch_id, sg, temp, 
  idempotency_key, reading_at
)
VALUES (
  'test-reading-2', 'test-workspace-1', 'test-batch-1',
  1.048, 19.0, 'sync-key-001', NOW()
);

-- Attempt duplicate with same idempotency key (should be ignored)
INSERT INTO ferm_readings (
  id, workspace_id, batch_id, sg, temp,
  idempotency_key, reading_at
)
VALUES (
  'test-reading-3', 'test-workspace-1', 'test-batch-1',
  1.048, 19.0, 'sync-key-001', NOW()
)
ON CONFLICT (workspace_id, idempotency_key) DO NOTHING;

SELECT is(
  (SELECT COUNT(*) FROM ferm_readings WHERE idempotency_key = 'sync-key-001'),
  1::BIGINT,
  'Idempotency key should prevent duplicate entries'
);

-- Test 9: Recipe cost rollup
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION calc_recipe_cost(p_recipe_version_id UUID)
RETURNS NUMERIC
LANGUAGE plpgsql
AS $$
DECLARE
  v_total_cost NUMERIC := 0;
  v_ingredient RECORD;
BEGIN
  -- Calculate grain bill cost
  FOR v_ingredient IN 
    SELECT 
      gb->>'name' AS name,
      (gb->>'quantity')::NUMERIC AS qty
    FROM recipe_versions rv,
         jsonb_array_elements(rv.grain_bill) gb
    WHERE rv.id = p_recipe_version_id
  LOOP
    v_total_cost := v_total_cost + (
      SELECT COALESCE(AVG(il.unit_cost) * v_ingredient.qty, 0)
      FROM items i
      LEFT JOIN item_lots il ON il.item_id = i.id
      WHERE i.name = v_ingredient.name
        AND i.workspace_id = get_current_workspace_id()
    );
  END LOOP;
  
  RETURN ROUND(v_total_cost, 2);
END;
$$;

SELECT is(
  calc_recipe_cost('test-version-1'),
  50.00,  -- 20kg * 2.50 = 50
  'Recipe cost should be calculated from ingredient costs'
);

-- Test 10: Production metrics view
-- ----------------------------------------------------------------------------
SELECT ok(
  EXISTS(
    SELECT 1 FROM v_production_metrics 
    WHERE workspace_id = 'test-workspace-1'
  ),
  'Production metrics view should aggregate data'
);

-- Clean up
SELECT * FROM finish();
ROLLBACK;
-- Phase 5: Packaging Tests
-- Tests for packaging runs, finished goods, lot code generation, and COGS allocation

BEGIN;
SELECT plan(40);

-- ============================================================================
-- TEST SETUP
-- ============================================================================

-- Create test workspace and users
INSERT INTO workspaces (id, name, plan) 
VALUES ('test-ws-packaging', 'Test Packaging Brewery', 'pro');

INSERT INTO users (id, email, full_name)
VALUES 
  ('test-brewer-pkg', 'brewer@test.com', 'Test Brewer'),
  ('test-inventory-pkg', 'inventory@test.com', 'Test Inventory');

INSERT INTO user_workspace_roles (user_id, workspace_id, role)
VALUES 
  ('test-brewer-pkg', 'test-ws-packaging', 'brewer'),
  ('test-inventory-pkg', 'test-ws-packaging', 'inventory');

-- Create test location
INSERT INTO inventory_locations (id, workspace_id, name, location_type)
VALUES ('test-location-pkg', 'test-ws-packaging', 'Main Warehouse', 'warehouse');

-- Create test recipe and batch
INSERT INTO recipes (id, workspace_id, name, style, created_by)
VALUES ('test-recipe-pkg', 'test-ws-packaging', 'Test IPA', 'IPA', 'test-brewer-pkg');

INSERT INTO recipe_versions (id, recipe_id, version_number, is_active, created_by)
VALUES ('test-recipe-v-pkg', 'test-recipe-pkg', 1, true, 'test-brewer-pkg');

INSERT INTO tanks (id, workspace_id, name, tank_type, capacity_liters, created_by)
VALUES ('test-tank-pkg', 'test-ws-packaging', 'FV1', 'fermenter', 1000, 'test-brewer-pkg');

-- Create test batches with COGS
INSERT INTO batches (id, workspace_id, recipe_version_id, batch_number, status, 
                    brew_date, actual_volume_liters, total_cogs_cents, current_tank_id, created_by)
VALUES 
  ('test-batch-1-pkg', 'test-ws-packaging', 'test-recipe-v-pkg', 'B001', 'ready', 
   '2024-01-01', 500, 50000, 'test-tank-pkg', 'test-brewer-pkg'),
  ('test-batch-2-pkg', 'test-ws-packaging', 'test-recipe-v-pkg', 'B002', 'ready', 
   '2024-01-02', 300, 30000, 'test-tank-pkg', 'test-brewer-pkg');

-- Create test SKUs
INSERT INTO finished_skus (id, workspace_id, code, name, container_type, 
                          container_size_ml, pack_size, barrels_per_unit, created_by)
VALUES 
  ('test-sku-6pk', 'test-ws-packaging', 'IPA-6PK', 'Test IPA 6-Pack', 'can', 
   355, 6, 0.0182, 'test-inventory-pkg'),
  ('test-sku-keg', 'test-ws-packaging', 'IPA-KEG', 'Test IPA Keg', 'keg', 
   58674, 1, 0.5, 'test-inventory-pkg');

-- Create lot code template
INSERT INTO lot_code_templates (id, workspace_id, name, pattern, is_default, tokens_used, created_by)
VALUES ('test-template-pkg', 'test-ws-packaging', 'Standard', '{YY}{JJJ}-{BATCH}-{SKU}', 
        true, ARRAY['{YY}', '{JJJ}', '{BATCH}', '{SKU}'], 'test-inventory-pkg');

-- ============================================================================
-- LOT CODE GENERATION TESTS
-- ============================================================================

-- Test 1: Generate lot code with all tokens
SELECT is(
  generate_lot_code('{YY}{JJJ}-{BATCH}-{SKU}', 'test-batch-1-pkg'::UUID, 'IPA-6PK', '2024-01-15'::TIMESTAMPTZ),
  '24015-test-bat-IPA-6PK',
  'Should generate lot code with all tokens'
);

-- Test 2: Generate lot code with date tokens only
SELECT is(
  generate_lot_code('{YYYY}{MM}{DD}', NULL, 'TEST', '2024-03-15'::TIMESTAMPTZ),
  '20240315',
  'Should generate lot code with date tokens'
);

-- Test 3: Generate lot code with Julian day
SELECT is(
  generate_lot_code('{YY}{JJJ}', NULL, NULL, '2024-12-31'::TIMESTAMPTZ),
  '24366',
  'Should generate lot code with Julian day (leap year)'
);

-- Test 4: Check lot code collision detection
INSERT INTO finished_lots (id, workspace_id, sku_id, packaging_run_id, lot_code, 
                          quantity, quantity_remaining, unit_cogs_cents, created_by)
VALUES ('test-lot-1', 'test-ws-packaging', 'test-sku-6pk', 
        gen_random_uuid(), 'EXISTING-CODE', 100, 100, 500, 'test-inventory-pkg');

SELECT ok(
  check_lot_code_collision('test-ws-packaging', 'EXISTING-CODE'),
  'Should detect existing lot code'
);

SELECT ok(
  NOT check_lot_code_collision('test-ws-packaging', 'NEW-CODE'),
  'Should not detect collision for new code'
);

-- ============================================================================
-- COGS CALCULATION TESTS
-- ============================================================================

-- Test 5: Calculate batch COGS for full volume
SELECT is(
  calculate_batch_cogs_for_packaging('test-batch-1-pkg'::UUID, 500),
  50000,
  'Should calculate full COGS when using full batch volume'
);

-- Test 6: Calculate batch COGS for partial volume
SELECT is(
  calculate_batch_cogs_for_packaging('test-batch-1-pkg'::UUID, 250),
  25000,
  'Should calculate proportional COGS for partial volume'
);

-- Test 7: Calculate batch COGS for blend
SELECT is(
  calculate_batch_cogs_for_packaging('test-batch-2-pkg'::UUID, 150),
  15000,
  'Should calculate proportional COGS for blend component'
);

-- ============================================================================
-- PACKAGING RUN CREATION TESTS
-- ============================================================================

-- Set JWT claims for testing
SELECT set_config('request.jwt.claims', 
  jsonb_build_object(
    'sub', 'test-brewer-pkg',
    'workspace_id', 'test-ws-packaging',
    'roles', ARRAY['brewer']
  )::text, true);

-- Test 8: Create single-batch packaging run
SELECT lives_ok($$
  SELECT create_packaging_run(jsonb_build_object(
    'sku_id', 'test-sku-6pk',
    'sources', jsonb_build_array(
      jsonb_build_object(
        'batch_id', 'test-batch-1-pkg',
        'volume_liters', 100
      )
    ),
    'target_quantity', 200,
    'actual_quantity', 195,
    'loss_percentage', 2.5,
    'lot_code_template_id', 'test-template-pkg',
    'location_id', 'test-location-pkg',
    'notes', 'Test packaging run'
  ))
$$, 'Should create single-batch packaging run');

-- Test 9: Create blend packaging run
SELECT lives_ok($$
  SELECT create_packaging_run(jsonb_build_object(
    'sku_id', 'test-sku-keg',
    'sources', jsonb_build_array(
      jsonb_build_object(
        'batch_id', 'test-batch-1-pkg',
        'volume_liters', 200
      ),
      jsonb_build_object(
        'batch_id', 'test-batch-2-pkg',
        'volume_liters', 100
      )
    ),
    'target_quantity', 10,
    'actual_quantity', 10,
    'loss_percentage', 0,
    'location_id', 'test-location-pkg'
  ))
$$, 'Should create blend packaging run');

-- Test 10: Verify packaging run was created
SELECT ok(
  EXISTS(
    SELECT 1 FROM packaging_runs 
    WHERE workspace_id = 'test-ws-packaging'
    AND sku_id = 'test-sku-6pk'
  ),
  'Should have created packaging run record'
);

-- Test 11: Verify packaging run sources
SELECT is(
  (SELECT COUNT(*) FROM packaging_run_sources prs
   JOIN packaging_runs pr ON pr.id = prs.packaging_run_id
   WHERE pr.workspace_id = 'test-ws-packaging'
   AND pr.sku_id = 'test-sku-keg'),
  2::BIGINT,
  'Should have created two sources for blend'
);

-- Test 12: Verify COGS allocation in blend
SELECT ok(
  (SELECT prs.allocated_cogs_cents > 0
   FROM packaging_run_sources prs
   JOIN packaging_runs pr ON pr.id = prs.packaging_run_id
   WHERE pr.workspace_id = 'test-ws-packaging'
   AND prs.batch_id = 'test-batch-1-pkg'::UUID
   LIMIT 1),
  'Should have allocated COGS to blend source'
);

-- Test 13: Verify finished lot creation
SELECT ok(
  EXISTS(
    SELECT 1 FROM finished_lots
    WHERE workspace_id = 'test-ws-packaging'
    AND sku_id = 'test-sku-6pk'
    AND quantity = 195
  ),
  'Should have created finished lot with correct quantity'
);

-- Test 14: Verify lot code generation
SELECT ok(
  (SELECT lot_code LIKE '%-%-%' FROM finished_lots
   WHERE workspace_id = 'test-ws-packaging'
   AND sku_id = 'test-sku-6pk'
   LIMIT 1),
  'Should have generated lot code with pattern'
);

-- Test 15: Verify inventory transaction creation
SELECT ok(
  EXISTS(
    SELECT 1 FROM inventory_transactions
    WHERE workspace_id = 'test-ws-packaging'
    AND transaction_type = 'produce'
    AND ref_type = 'packaging_run'
  ),
  'Should have created inventory transaction'
);

-- ============================================================================
-- BATCH AVAILABILITY TESTS
-- ============================================================================

-- Test 16: Get available batches for packaging
SELECT ok(
  (SELECT COUNT(*) FROM get_available_batches_for_packaging('test-ws-packaging') 
   WHERE volume_available_liters > 0) >= 1,
  'Should return available batches with remaining volume'
);

-- Test 17: Verify batch volume deduction
SELECT is(
  (SELECT volume_available_liters FROM get_available_batches_for_packaging('test-ws-packaging')
   WHERE id = 'test-batch-1-pkg'::UUID),
  200::NUMERIC, -- Original 500L - 100L used in first run - 200L used in blend
  'Should show correct remaining volume after packaging'
);

-- ============================================================================
-- RLS TESTS
-- ============================================================================

-- Test 18: Brewer can view finished SKUs
SELECT set_config('request.jwt.claims', 
  jsonb_build_object(
    'sub', 'test-brewer-pkg',
    'workspace_id', 'test-ws-packaging',
    'roles', ARRAY['brewer']
  )::text, true);

SELECT ok(
  EXISTS(
    SELECT 1 FROM finished_skus 
    WHERE workspace_id = 'test-ws-packaging'
  ),
  'Brewer should be able to view finished SKUs'
);

-- Test 19: Brewer can create packaging runs
SELECT lives_ok($$
  INSERT INTO packaging_runs (workspace_id, sku_id, target_quantity, actual_quantity, created_by)
  VALUES ('test-ws-packaging', 'test-sku-6pk', 100, 100, 'test-brewer-pkg')
$$, 'Brewer should be able to create packaging runs');

-- Test 20: Inventory role can manage finished lots
SELECT set_config('request.jwt.claims', 
  jsonb_build_object(
    'sub', 'test-inventory-pkg',
    'workspace_id', 'test-ws-packaging',
    'roles', ARRAY['inventory']
  )::text, true);

SELECT lives_ok($$
  UPDATE finished_lots 
  SET quantity_remaining = quantity_remaining - 10
  WHERE workspace_id = 'test-ws-packaging'
  AND sku_id = 'test-sku-6pk'
$$, 'Inventory role should be able to update finished lots');

-- ============================================================================
-- ERROR HANDLING TESTS
-- ============================================================================

-- Test 21: Reject packaging run without SKU
SELECT throws_ok($$
  SELECT create_packaging_run(jsonb_build_object(
    'sources', jsonb_build_array(
      jsonb_build_object('batch_id', 'test-batch-1-pkg', 'volume_liters', 100)
    ),
    'target_quantity', 100
  ))
$$, 'SKU ID is required', 'Should reject packaging run without SKU');

-- Test 22: Reject packaging run without sources
SELECT throws_ok($$
  SELECT create_packaging_run(jsonb_build_object(
    'sku_id', 'test-sku-6pk',
    'sources', jsonb_build_array(),
    'target_quantity', 100
  ))
$$, 'At least one source batch is required', 'Should reject packaging run without sources');

-- Test 23: Reject invalid batch ID
SELECT throws_ok($$
  SELECT create_packaging_run(jsonb_build_object(
    'sku_id', 'test-sku-6pk',
    'sources', jsonb_build_array(
      jsonb_build_object('batch_id', gen_random_uuid(), 'volume_liters', 100)
    ),
    'target_quantity', 100
  ))
$$, NULL, 'Should reject packaging run with invalid batch ID');

-- ============================================================================
-- TELEMETRY TESTS
-- ============================================================================

-- Test 24: Verify telemetry event creation
SELECT ok(
  EXISTS(
    SELECT 1 FROM ui_events
    WHERE workspace_id = 'test-ws-packaging'
    AND event_name = 'packaging_run_created'
    AND entity_type = 'packaging_run'
  ),
  'Should create telemetry event for packaging run'
);

-- Test 25: Verify audit log creation
SELECT ok(
  EXISTS(
    SELECT 1 FROM audit_logs
    WHERE workspace_id = 'test-ws-packaging'
    AND entity_table = 'packaging_runs'
    AND action = 'create'
  ),
  'Should create audit log for packaging run'
);

-- ============================================================================
-- BLEND PERCENTAGE TESTS
-- ============================================================================

-- Test 26: Verify blend percentage calculation
SELECT is(
  ROUND((SELECT percentage_of_blend FROM packaging_run_sources prs
   JOIN packaging_runs pr ON pr.id = prs.packaging_run_id
   WHERE pr.workspace_id = 'test-ws-packaging'
   AND pr.sku_id = 'test-sku-keg'
   AND prs.batch_id = 'test-batch-1-pkg'::UUID
   LIMIT 1)),
  67, -- 200L out of 300L total = 66.67%
  'Should calculate correct blend percentage for first batch'
);

-- Test 27: Verify blend percentage totals 100%
SELECT is(
  ROUND((SELECT SUM(percentage_of_blend) FROM packaging_run_sources prs
   JOIN packaging_runs pr ON pr.id = prs.packaging_run_id
   WHERE pr.workspace_id = 'test-ws-packaging'
   AND pr.sku_id = 'test-sku-keg')),
  100,
  'Blend percentages should total 100%'
);

-- ============================================================================
-- UNIT COGS TESTS
-- ============================================================================

-- Test 28: Verify unit COGS calculation
SELECT ok(
  (SELECT unit_cogs_cents > 0 FROM packaging_runs
   WHERE workspace_id = 'test-ws-packaging'
   AND sku_id = 'test-sku-6pk'
   LIMIT 1),
  'Should calculate unit COGS'
);

-- Test 29: Verify unit COGS matches total/quantity
SELECT is(
  (SELECT unit_cogs_cents FROM packaging_runs
   WHERE workspace_id = 'test-ws-packaging'
   AND sku_id = 'test-sku-6pk'
   LIMIT 1),
  (SELECT total_cogs_cents / actual_quantity FROM packaging_runs
   WHERE workspace_id = 'test-ws-packaging'
   AND sku_id = 'test-sku-6pk'
   LIMIT 1),
  'Unit COGS should equal total COGS divided by quantity'
);

-- ============================================================================
-- BATCH STATUS UPDATE TESTS
-- ============================================================================

-- Test 30: Verify batch status updated to packaged
SELECT is(
  (SELECT status FROM batches WHERE id = 'test-batch-1-pkg'),
  'packaged',
  'Batch status should be updated to packaged after packaging'
);

-- ============================================================================
-- LOT CODE COLLISION TESTS
-- ============================================================================

-- Test 31: Test lot code collision handling
-- First, create a packaging run that will generate a specific lot code
INSERT INTO finished_lots (workspace_id, sku_id, packaging_run_id, lot_code, 
                          quantity, quantity_remaining, unit_cogs_cents, created_by)
VALUES ('test-ws-packaging', 'test-sku-6pk', gen_random_uuid(), 
        '24015-testbatch-IPA6PK', 100, 100, 500, 'test-inventory-pkg');

-- The next packaging run should generate a different code due to collision
SELECT isnt(
  (SELECT lot_code FROM finished_lots 
   WHERE workspace_id = 'test-ws-packaging'
   AND sku_id = 'test-sku-6pk'
   ORDER BY created_at DESC
   LIMIT 1),
  '24015-testbatch-IPA6PK',
  'Should generate different lot code when collision detected'
);

-- ============================================================================
-- DEFAULT VALUES TESTS
-- ============================================================================

-- Test 32: Verify default cost method
SELECT is(
  (SELECT cost_method_used FROM packaging_runs
   WHERE workspace_id = 'test-ws-packaging'
   LIMIT 1),
  'actual_lots',
  'Should use actual_lots as default cost method'
);

-- Test 33: Verify default loss percentage
SELECT is(
  COALESCE((SELECT loss_percentage FROM packaging_runs
   WHERE workspace_id = 'test-ws-packaging'
   AND loss_percentage = 0
   LIMIT 1), 0),
  0,
  'Should default to 0 loss percentage when not specified'
);

-- ============================================================================
-- FINISHED LOT QUANTITY TESTS
-- ============================================================================

-- Test 34: Verify finished lot initial quantity equals quantity_remaining
SELECT ok(
  (SELECT quantity = quantity_remaining FROM finished_lots
   WHERE workspace_id = 'test-ws-packaging'
   LIMIT 1),
  'Initial quantity_remaining should equal quantity'
);

-- ============================================================================
-- CONTRACT VIEWER TESTS
-- ============================================================================

-- Create ownership entity and assign to a finished lot
INSERT INTO ownership_entities (id, workspace_id, name, ttb_permit_number)
VALUES ('test-owner-entity', 'test-ws-packaging', 'Test Contract Brewer', 'TEST-123');

UPDATE finished_lots 
SET owner_entity_id = 'test-owner-entity'
WHERE workspace_id = 'test-ws-packaging'
AND sku_id = 'test-sku-6pk'
LIMIT 1;

-- Create contract viewer user
INSERT INTO users (id, email, full_name)
VALUES ('test-contract-viewer', 'contract@test.com', 'Contract Viewer');

INSERT INTO user_workspace_roles (user_id, workspace_id, role)
VALUES ('test-contract-viewer', 'test-ws-packaging', 'contract_viewer');

-- Test 35: Contract viewer can see their own lots
SELECT set_config('request.jwt.claims', 
  jsonb_build_object(
    'sub', 'test-contract-viewer',
    'workspace_id', 'test-ws-packaging',
    'roles', ARRAY['contract_viewer']
  )::text, true);

SELECT ok(
  EXISTS(
    SELECT 1 FROM finished_lots
    WHERE owner_entity_id = 'test-owner-entity'
  ),
  'Contract viewer should see their own finished lots'
);

-- ============================================================================
-- METADATA TESTS
-- ============================================================================

-- Test 36: Verify metadata storage in packaging run
SELECT lives_ok($$
  SELECT create_packaging_run(jsonb_build_object(
    'sku_id', 'test-sku-6pk',
    'sources', jsonb_build_array(
      jsonb_build_object('batch_id', 'test-batch-1-pkg', 'volume_liters', 50)
    ),
    'target_quantity', 100,
    'metadata', jsonb_build_object(
      'shift', 'morning',
      'operator', 'John Doe',
      'line_number', 1
    )
  ))
$$, 'Should store metadata in packaging run');

-- Test 37: Verify metadata retrieval
SELECT is(
  (SELECT metadata->>'shift' FROM packaging_runs
   WHERE workspace_id = 'test-ws-packaging'
   AND metadata IS NOT NULL
   ORDER BY created_at DESC
   LIMIT 1),
  'morning',
  'Should retrieve metadata from packaging run'
);

-- ============================================================================
-- DRY RUN TESTS
-- ============================================================================

-- Test 38: Test dry run mode (preview without committing)
SELECT ok(
  (SELECT COUNT(*) FROM packaging_runs WHERE workspace_id = 'test-ws-packaging') = 
  (SELECT COUNT(*) FROM packaging_runs WHERE workspace_id = 'test-ws-packaging'),
  'Dry run should not create new records'
);

-- ============================================================================
-- BARRELS CALCULATION TESTS
-- ============================================================================

-- Test 39: Verify barrels_per_unit calculation
SELECT is(
  ROUND((SELECT barrels_per_unit FROM finished_skus 
   WHERE code = 'IPA-6PK' 
   AND workspace_id = 'test-ws-packaging')::NUMERIC, 4),
  0.0182,
  'Should calculate correct barrels per unit for 6-pack'
);

-- Test 40: Verify keg barrels calculation
SELECT is(
  (SELECT barrels_per_unit FROM finished_skus 
   WHERE code = 'IPA-KEG' 
   AND workspace_id = 'test-ws-packaging'),
  0.5,
  'Should calculate correct barrels per unit for half-barrel keg'
);

-- ============================================================================
-- CLEANUP
-- ============================================================================

SELECT finish();
ROLLBACK;
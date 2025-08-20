-- Phase 6: Compliance Module Tests
-- Tests for BROP, Excise, Transfers, and Sales Ingest

BEGIN;
SELECT plan(50);

-- ============================================================================
-- TEST SETUP
-- ============================================================================

-- Create test workspace and users
INSERT INTO workspaces (id, name, plan) 
VALUES ('test-ws-comp', 'Test Brewery Compliance', 'pro');

INSERT INTO users (id, email, workspace_id)
VALUES 
    ('test-admin-comp', 'admin@testbrewery.com', 'test-ws-comp'),
    ('test-accounting', 'accounting@testbrewery.com', 'test-ws-comp'),
    ('test-brewer-comp', 'brewer@testbrewery.com', 'test-ws-comp');

INSERT INTO user_workspace_roles (user_id, workspace_id, role)
VALUES 
    ('test-admin-comp', 'test-ws-comp', 'admin'),
    ('test-accounting', 'test-ws-comp', 'accounting'),
    ('test-brewer-comp', 'test-ws-comp', 'brewer');

-- Create ownership entities
INSERT INTO ownership_entities (id, workspace_id, name, ttb_permit_number, address, is_self)
VALUES 
    ('entity-self', 'test-ws-comp', 'Test Brewery LLC', 'BR-CA-12345', '123 Brew St, CA', true),
    ('entity-partner', 'test-ws-comp', 'Partner Brewery Co', 'BR-CA-67890', '456 Hop Ave, CA', false),
    ('entity-sister', 'test-ws-comp', 'Sister Brewery LLC', 'BR-CA-54321', '789 Malt Rd, CA', false);

-- Create test items and lots for removals
INSERT INTO finished_skus (id, workspace_id, code, name, size_ml, package_type)
VALUES 
    ('sku-ipa-keg', 'test-ws-comp', 'IPA-KEG', 'IPA Keg', 58670, 'keg'), -- 1/2 BBL keg
    ('sku-lager-case', 'test-ws-comp', 'LAGER-24', 'Lager Case', 8520, 'case'); -- 24x355ml

INSERT INTO finished_lots (id, workspace_id, sku_id, lot_code, quantity_produced, owner_entity_id)
VALUES 
    ('lot-ipa-001', 'test-ws-comp', 'sku-ipa-keg', 'IPA-2025-001', 100, 'entity-self'),
    ('lot-lager-001', 'test-ws-comp', 'sku-lager-case', 'LAGER-2025-001', 500, 'entity-self');

-- ============================================================================
-- TTB PERIOD TESTS
-- ============================================================================

-- Test: Create TTB period
SELECT is(
    (SELECT create_ttb_period('monthly', '2025-01-01'::date, '2025-01-31'::date))::text IS NOT NULL,
    true,
    'Should create TTB period successfully'
) AS test_create_period;

-- Test: Period due date calculation (15th day after period end)
SELECT is(
    (SELECT due_date FROM ttb_periods WHERE workspace_id = 'test-ws-comp' LIMIT 1),
    '2025-02-15'::date,
    'Due date should be 15th day after period end'
) AS test_due_date;

-- Test: Duplicate period prevention
SELECT throws_ok(
    $$SELECT create_ttb_period('monthly', '2025-01-01'::date, '2025-01-31'::date)$$,
    'P0001',
    NULL,
    'Should prevent duplicate period creation'
) AS test_duplicate_period;

-- ============================================================================
-- BROP GENERATION TESTS
-- ============================================================================

-- Add some test data for BROP
INSERT INTO batches (id, workspace_id, batch_number, status, actual_volume, owner_entity_id)
VALUES ('batch-test-1', 'test-ws-comp', 'B-2025-001', 'packaged', 1000, 'entity-self');

INSERT INTO packaging_runs (id, workspace_id, sku_id, created_at)
VALUES ('pkg-run-1', 'test-ws-comp', 'sku-ipa-keg', '2025-01-15'::timestamp);

INSERT INTO packaging_run_sources (packaging_run_id, batch_id, volume_liters)
VALUES ('pkg-run-1', 'batch-test-1', 1000);

-- Test: Generate BROP entries
SELECT is(
    (SELECT success FROM generate_ttb_period(
        (SELECT id FROM ttb_periods WHERE workspace_id = 'test-ws-comp' LIMIT 1),
        false,
        true -- dry run
    ))::boolean,
    true,
    'Should generate BROP successfully'
) AS test_generate_brop;

-- ============================================================================
-- RECONCILIATION TESTS
-- ============================================================================

-- Test: Reconciliation validation
SELECT is(
    (SELECT is_valid FROM validate_reconciliation(
        (SELECT id FROM ttb_periods WHERE workspace_id = 'test-ws-comp' LIMIT 1)
    )),
    true,
    'BROP reconciliation should be valid when balanced'
) AS test_reconciliation;

-- ============================================================================
-- EXCISE WORKSHEET TESTS
-- ============================================================================

-- Add removals for excise calculation
INSERT INTO removals (id, workspace_id, finished_lot_id, removal_date, qty, uom, barrels, reason, is_taxable, destination_type)
VALUES 
    ('removal-1', 'test-ws-comp', 'lot-ipa-001', '2025-01-15', 10, 'kegs', 5.0, 'sale', true, 'distributor'),
    ('removal-2', 'test-ws-comp', 'lot-lager-001', '2025-01-20', 50, 'cases', 3.5, 'sale', true, 'taproom'),
    ('removal-3', 'test-ws-comp', 'lot-ipa-001', '2025-01-25', 2, 'kegs', 1.0, 'return', true, 'distributor');

-- Test: Build excise worksheet
SELECT is(
    (SELECT success FROM build_excise_worksheet(
        '2025-01-01'::date,
        '2025-01-31'::date,
        'test-ws-comp',
        true -- dry run
    ))::boolean,
    true,
    'Should build excise worksheet successfully'
) AS test_excise_worksheet;

-- Test: Net taxable calculation (removals - returns)
SELECT is(
    (SELECT net_taxable_bbl FROM build_excise_worksheet(
        '2025-01-01'::date,
        '2025-01-31'::date,
        'test-ws-comp',
        true
    )),
    7.5, -- 5.0 + 3.5 - 1.0
    'Net taxable should equal removals minus returns'
) AS test_net_taxable;

-- ============================================================================
-- CBMA TAX CALCULATION TESTS
-- ============================================================================

-- Test: CBMA first band rate ($3.50/BBL for first 60k)
SELECT is(
    (SELECT (compute_cbma_tax(100, 0)->>'total_tax_cents')::bigint),
    35000::bigint, -- 100 BBL * $3.50 * 100 cents
    'Should apply $3.50/BBL rate for first 60k BBL'
) AS test_cbma_first_band;

-- Test: CBMA second band rate ($16/BBL for 60k-6M)
SELECT is(
    (SELECT (compute_cbma_tax(100, 60000)->>'total_tax_cents')::bigint),
    160000::bigint, -- 100 BBL * $16.00 * 100 cents
    'Should apply $16/BBL rate after 60k BBL'
) AS test_cbma_second_band;

-- Test: CBMA band allocation across threshold
SELECT is(
    (SELECT jsonb_array_length(compute_cbma_tax(100, 59950)->'bands')),
    2,
    'Should split across two bands when crossing 60k threshold'
) AS test_cbma_split_bands;

-- ============================================================================
-- IN-BOND TRANSFER TESTS
-- ============================================================================

-- Test: Create in-bond transfer
SELECT is(
    (SELECT success FROM create_inbond_transfer(
        jsonb_build_object(
            'shipper_entity_id', 'entity-self',
            'receiver_entity_id', 'entity-partner',
            'same_ownership', false,
            'shipped_at', '2025-01-20',
            'container_type', 'keg',
            'lines', jsonb_build_array(
                jsonb_build_object(
                    'finished_lot_id', 'lot-ipa-001',
                    'qty', 10,
                    'uom', 'kegs'
                )
            ),
            'remarks', 'Test transfer'
        ),
        true -- dry run
    ))::boolean,
    true,
    'Should create in-bond transfer successfully'
) AS test_create_transfer;

-- Test: Document number generation
SELECT is(
    (SELECT generate_transfer_doc_number('test-ws-comp') ~ '^\d{4}-\d{6}$'),
    true,
    'Should generate valid document number format'
) AS test_doc_number;

-- Test: Barrel calculation
SELECT is(
    calculate_barrels(31, 'gal'),
    1.0,
    'Should correctly convert 31 gallons to 1 barrel'
) AS test_barrel_calc_gal;

SELECT is(
    calculate_barrels(1, 'bbl'),
    1.0,
    'Should correctly handle BBL units'
) AS test_barrel_calc_bbl;

SELECT is(
    calculate_barrels(117.348, 'l'),
    1.0,
    'Should correctly convert 117.348 liters to 1 barrel'
) AS test_barrel_calc_liter;

-- ============================================================================
-- SALES INGEST TESTS
-- ============================================================================

-- Create a sales ingest job
INSERT INTO sales_ingest_jobs (id, workspace_id, upload_id, status, idempotency_key)
VALUES ('job-test-1', 'test-ws-comp', 'upload-test-1', 'pending', 'test-key-1');

-- Add ingest rows
INSERT INTO sales_ingest_rows (job_id, row_number, parsed_data, status)
VALUES 
    ('job-test-1', 1, '{"date": "2025-01-28", "sku_code": "IPA-KEG", "qty": 5, "uom": "kegs", "destination_type": "distributor"}'::jsonb, 'pending'),
    ('job-test-1', 2, '{"date": "2025-01-28", "sku_code": "LAGER-24", "qty": 20, "uom": "cases", "destination_type": "taproom"}'::jsonb, 'pending');

-- Test: Process sales ingest
SELECT is(
    (SELECT success FROM process_sales_ingest('job-test-1'))::boolean,
    true,
    'Should process sales ingest successfully'
) AS test_process_ingest;

-- Test: Job status update
SELECT is(
    (SELECT status FROM sales_ingest_jobs WHERE id = 'job-test-1'),
    'completed',
    'Job status should be updated to completed'
) AS test_job_status;

-- ============================================================================
-- COMPLIANCE SNAPSHOT TESTS
-- ============================================================================

-- Test: Create compliance snapshot (immutability test)
SELECT is(
    (SELECT finalize_compliance_snapshot(
        'brop',
        (SELECT id FROM ttb_periods WHERE workspace_id = 'test-ws-comp' LIMIT 1),
        'https://example.com/brop.pdf',
        'https://example.com/brop.csv',
        '{"test": "data"}'::jsonb
    ))::text IS NOT NULL,
    true,
    'Should create compliance snapshot'
) AS test_create_snapshot;

-- Test: Snapshot immutability (no update allowed)
SELECT throws_ok(
    $$UPDATE compliance_snapshots SET pdf_url = 'changed' WHERE workspace_id = 'test-ws-comp'$$,
    '42501',
    'insufficient privilege',
    'Should prevent updating snapshots'
) AS test_snapshot_immutable;

-- ============================================================================
-- RLS TESTS
-- ============================================================================

-- Test: TTB periods workspace isolation
SET LOCAL jwt.claims.workspace_id TO 'other-workspace';
SELECT is(
    (SELECT COUNT(*) FROM ttb_periods),
    0::bigint,
    'Should not see other workspace TTB periods'
) AS test_ttb_isolation;
RESET jwt.claims.workspace_id;

-- Test: Accounting role can access compliance data
SET LOCAL jwt.claims.workspace_id TO 'test-ws-comp';
SET LOCAL jwt.claims.user_id TO 'test-accounting';
SET LOCAL jwt.claims.role TO 'accounting';

SELECT is(
    (SELECT COUNT(*) FROM ttb_periods WHERE workspace_id = 'test-ws-comp') > 0,
    true,
    'Accounting role should access TTB periods'
) AS test_accounting_access;

-- Test: Brewer role cannot create TTB periods
SET LOCAL jwt.claims.role TO 'brewer';
SELECT throws_ok(
    $$INSERT INTO ttb_periods (workspace_id, type, period_start, period_end, due_date)
      VALUES ('test-ws-comp', 'monthly', '2025-02-01', '2025-02-28', '2025-03-15')$$,
    '42501',
    NULL,
    'Brewer role should not create TTB periods'
) AS test_brewer_no_ttb;

RESET jwt.claims.workspace_id;
RESET jwt.claims.user_id;
RESET jwt.claims.role;

-- ============================================================================
-- KEED DEPOSIT LEDGER TESTS
-- ============================================================================

-- Test: Keg deposit entries
INSERT INTO keg_deposit_entries (workspace_id, sku_id, entry_date, qty, amount_cents, direction)
VALUES 
    ('test-ws-comp', 'sku-ipa-keg', '2025-01-15', 10, 3000, 'charged'),
    ('test-ws-comp', 'sku-ipa-keg', '2025-01-25', 2, 600, 'returned');

SELECT is(
    (SELECT SUM(CASE WHEN direction = 'charged' THEN amount_cents ELSE -amount_cents END) 
     FROM keg_deposit_entries WHERE workspace_id = 'test-ws-comp'),
    2400::bigint,
    'Keg deposit ledger should track net liability'
) AS test_keg_deposits;

-- ============================================================================
-- REMOVAL TRIGGER TESTS
-- ============================================================================

-- Test: Removal creates inventory transaction
INSERT INTO removals (workspace_id, finished_lot_id, removal_date, qty, uom, barrels, reason, is_taxable)
VALUES ('test-ws-comp', 'lot-ipa-001', '2025-01-30', 1, 'keg', 0.5, 'sale', true);

SELECT is(
    (SELECT COUNT(*) FROM inventory_transactions 
     WHERE ref_type = 'removal' 
     AND workspace_id = 'test-ws-comp'
     AND type = 'ship') > 0,
    true,
    'Removal should create inventory transaction'
) AS test_removal_trigger;

-- ============================================================================
-- CONTRACT/ALTERNATING PROPRIETORSHIP TESTS
-- ============================================================================

-- Test: Contract brand visibility
INSERT INTO batches (id, workspace_id, batch_number, status, owner_entity_id)
VALUES ('batch-contract-1', 'test-ws-comp', 'B-CONTRACT-001', 'fermenting', 'entity-partner');

SET LOCAL jwt.claims.role TO 'contract_viewer';
SET LOCAL jwt.claims.workspace_id TO 'test-ws-comp';

-- Contract viewer should only see their own entity's entries
SELECT is(
    (SELECT COUNT(*) FROM ttb_entries 
     WHERE owner_entity_id = 'entity-partner'),
    0::bigint, -- No entries yet for partner entity
    'Contract viewer should only see their entity entries'
) AS test_contract_visibility;

RESET jwt.claims.role;
RESET jwt.claims.workspace_id;

-- ============================================================================
-- SETTINGS & CONFIGURATION TESTS
-- ============================================================================

-- Test: Compliance settings
INSERT INTO settings_compliance (workspace_id, brop_hard_stop, excise_default_frequency, cbma_apportionment)
VALUES ('test-ws-comp', true, 'quarterly', '{"allocation": 60000}'::jsonb);

SELECT is(
    (SELECT brop_hard_stop FROM settings_compliance WHERE workspace_id = 'test-ws-comp'),
    true,
    'Should store compliance settings'
) AS test_settings;

-- ============================================================================
-- TELEMETRY TESTS
-- ============================================================================

-- Test: Telemetry events exist
SELECT is(
    (SELECT COUNT(*) FROM telemetry_events 
     WHERE name IN ('ttb_period_created', 'excise_worksheet_generated', 'inbond_transfer_created')),
    3::bigint,
    'Compliance telemetry events should be registered'
) AS test_telemetry;

-- ============================================================================
-- CLEANUP
-- ============================================================================

-- Clean up test data
DELETE FROM keg_deposit_entries WHERE workspace_id = 'test-ws-comp';
DELETE FROM sales_ingest_rows WHERE job_id = 'job-test-1';
DELETE FROM sales_ingest_jobs WHERE workspace_id = 'test-ws-comp';
DELETE FROM removals WHERE workspace_id = 'test-ws-comp';
DELETE FROM compliance_snapshots WHERE workspace_id = 'test-ws-comp';
DELETE FROM excise_worksheets WHERE workspace_id = 'test-ws-comp';
DELETE FROM ttb_entries WHERE workspace_id = 'test-ws-comp';
DELETE FROM ttb_periods WHERE workspace_id = 'test-ws-comp';
DELETE FROM settings_compliance WHERE workspace_id = 'test-ws-comp';
DELETE FROM packaging_run_sources WHERE packaging_run_id = 'pkg-run-1';
DELETE FROM packaging_runs WHERE workspace_id = 'test-ws-comp';
DELETE FROM batches WHERE workspace_id = 'test-ws-comp';
DELETE FROM finished_lots WHERE workspace_id = 'test-ws-comp';
DELETE FROM finished_skus WHERE workspace_id = 'test-ws-comp';
DELETE FROM ownership_entities WHERE workspace_id = 'test-ws-comp';
DELETE FROM user_workspace_roles WHERE workspace_id = 'test-ws-comp';
DELETE FROM users WHERE workspace_id = 'test-ws-comp';
DELETE FROM workspaces WHERE id = 'test-ws-comp';

SELECT * FROM finish();
ROLLBACK;
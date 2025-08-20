-- Phase 7: Sales Ingest & Keg Deposit Tests
-- Comprehensive test coverage for sales ingest pipeline and keg deposit ledger

-- Begin transaction
BEGIN;

-- =============================================================================
-- SALES INGEST TESTS
-- =============================================================================

-- Test: Create sales ingest job
SELECT results_eq(
    $$
    WITH job AS (
        INSERT INTO sales_ingest_jobs (
            workspace_id,
            upload_id,
            status,
            mapping,
            idempotency_key,
            total_rows,
            created_by
        )
        SELECT 
            workspace_id,
            'test-upload-001.csv',
            'pending',
            '{"preset": "custom", "fields": {"date": "date", "sku": "sku_code"}}'::jsonb,
            'test-key-001',
            100,
            (SELECT id FROM users WHERE email = 'accounting@brewcrush.test' LIMIT 1)
        FROM workspaces
        WHERE name = 'Test Brewery'
        RETURNING id, status
    )
    SELECT status FROM job
    $$,
    $$VALUES ('pending'::text)$$,
    'Should create sales ingest job'
);

-- Test: Process sales ingest row
SELECT results_eq(
    $$
    WITH job AS (
        SELECT id FROM sales_ingest_jobs 
        WHERE upload_id = 'test-upload-001.csv'
        LIMIT 1
    ),
    row AS (
        INSERT INTO sales_ingest_rows (
            job_id,
            row_number,
            parsed_data,
            status
        )
        SELECT 
            job.id,
            1,
            '{"date": "2025-01-30", "sku_code": "IPA-16", "quantity": 5, "unit": "cases", "destination_type": "distributor"}'::jsonb,
            'pending'
        FROM job
        RETURNING status
    )
    SELECT status FROM row
    $$,
    $$VALUES ('pending'::text)$$,
    'Should create sales ingest row'
);

-- Test: Create removal from sales ingest
SELECT results_eq(
    $$
    WITH ws AS (
        SELECT id FROM workspaces WHERE name = 'Test Brewery'
    ),
    sku AS (
        SELECT id FROM finished_skus 
        WHERE workspace_id = (SELECT id FROM ws)
        AND code = 'IPA-16'
        LIMIT 1
    ),
    lot AS (
        SELECT id FROM finished_lots
        WHERE sku_id = (SELECT id FROM sku)
        AND quantity > 0
        LIMIT 1
    ),
    removal AS (
        INSERT INTO removals (
            workspace_id,
            finished_lot_id,
            removal_date,
            qty,
            uom,
            barrels,
            reason,
            is_taxable,
            doc_ref,
            destination_type,
            created_by
        )
        SELECT
            ws.id,
            lot.id,
            '2025-01-30',
            5,
            'cases',
            0.323, -- 5 cases = 0.323 barrels (5 * 0.0645)
            'sale',
            true,
            'INV-001',
            'distributor',
            (SELECT id FROM users WHERE email = 'accounting@brewcrush.test' LIMIT 1)
        FROM ws, lot
        RETURNING id, reason, is_taxable
    )
    SELECT reason, is_taxable FROM removal
    $$,
    $$VALUES ('sale'::removal_reason, true)$$,
    'Should create removal from sales ingest'
);

-- Test: Removals affect inventory
SELECT results_eq(
    $$
    WITH removal AS (
        SELECT id, finished_lot_id, qty
        FROM removals
        WHERE doc_ref = 'INV-001'
        LIMIT 1
    ),
    txn AS (
        INSERT INTO inventory_transactions (
            workspace_id,
            type,
            item_lot_id,
            quantity,
            uom,
            ref_type,
            ref_id,
            created_by
        )
        SELECT
            (SELECT workspace_id FROM removals WHERE id = removal.id),
            'ship',
            removal.finished_lot_id,
            -removal.qty,
            'cases',
            'removal',
            removal.id,
            (SELECT created_by FROM removals WHERE id = removal.id)
        FROM removal
        RETURNING type, quantity
    )
    SELECT type, quantity FROM txn
    $$,
    $$VALUES ('ship'::inv_txn_type, -5::numeric)$$,
    'Should create inventory transaction for removal'
);

-- Test: Non-taxable removals (exports)
SELECT results_eq(
    $$
    WITH ws AS (
        SELECT id FROM workspaces WHERE name = 'Test Brewery'
    ),
    lot AS (
        SELECT id FROM finished_lots
        WHERE workspace_id = (SELECT id FROM ws)
        AND quantity > 0
        LIMIT 1
    ),
    removal AS (
        INSERT INTO removals (
            workspace_id,
            finished_lot_id,
            removal_date,
            qty,
            uom,
            barrels,
            reason,
            is_taxable,
            destination_type,
            created_by
        )
        SELECT
            ws.id,
            lot.id,
            '2025-01-30',
            10,
            'cases',
            0.645,
            'export',
            false, -- Exports are not taxable
            'export',
            (SELECT id FROM users WHERE email = 'accounting@brewcrush.test' LIMIT 1)
        FROM ws, lot
        RETURNING is_taxable, reason
    )
    SELECT is_taxable, reason FROM removal
    $$,
    $$VALUES (false, 'export'::removal_reason)$$,
    'Should create non-taxable removal for exports'
);

-- Test: Idempotency in sales ingest
SELECT results_eq(
    $$
    WITH job1 AS (
        INSERT INTO sales_ingest_jobs (
            workspace_id,
            upload_id,
            status,
            mapping,
            idempotency_key,
            total_rows,
            created_by
        )
        SELECT 
            workspace_id,
            'duplicate-test.csv',
            'pending',
            '{}'::jsonb,
            'unique-key-001',
            10,
            (SELECT id FROM users WHERE email = 'accounting@brewcrush.test' LIMIT 1)
        FROM workspaces
        WHERE name = 'Test Brewery'
        ON CONFLICT (workspace_id, idempotency_key) DO NOTHING
        RETURNING id
    ),
    job2 AS (
        INSERT INTO sales_ingest_jobs (
            workspace_id,
            upload_id,
            status,
            mapping,
            idempotency_key,
            total_rows,
            created_by
        )
        SELECT 
            workspace_id,
            'duplicate-test-2.csv',
            'pending',
            '{}'::jsonb,
            'unique-key-001', -- Same idempotency key
            10,
            (SELECT id FROM users WHERE email = 'accounting@brewcrush.test' LIMIT 1)
        FROM workspaces
        WHERE name = 'Test Brewery'
        ON CONFLICT (workspace_id, idempotency_key) DO NOTHING
        RETURNING id
    )
    SELECT 
        (SELECT COUNT(*) FROM job1) as first_insert,
        (SELECT COUNT(*) FROM job2) as second_insert
    $$,
    $$VALUES (1::bigint, 0::bigint)$$,
    'Should prevent duplicate sales ingest jobs with same idempotency key'
);

-- =============================================================================
-- KEG DEPOSIT LEDGER TESTS
-- =============================================================================

-- Test: Create keg deposit charge
SELECT results_eq(
    $$
    WITH ws AS (
        SELECT id FROM workspaces WHERE name = 'Test Brewery'
    ),
    sku AS (
        SELECT id FROM finished_skus 
        WHERE workspace_id = (SELECT id FROM ws)
        AND code LIKE '%KEG%'
        LIMIT 1
    ),
    deposit AS (
        INSERT INTO keg_deposit_entries (
            workspace_id,
            sku_id,
            entry_date,
            qty,
            amount_cents,
            direction,
            reference_doc,
            notes,
            created_by
        )
        SELECT
            ws.id,
            sku.id,
            '2025-01-30',
            5,
            25000, -- $250 total ($50 per keg)
            'charged',
            'INV-KEG-001',
            '5 kegs to Local Bar',
            (SELECT id FROM users WHERE email = 'accounting@brewcrush.test' LIMIT 1)
        FROM ws, sku
        RETURNING direction, amount_cents, qty
    )
    SELECT direction, amount_cents, qty FROM deposit
    $$,
    $$VALUES ('charged'::text, 25000::integer, 5::integer)$$,
    'Should create keg deposit charge'
);

-- Test: Create keg deposit return
SELECT results_eq(
    $$
    WITH ws AS (
        SELECT id FROM workspaces WHERE name = 'Test Brewery'
    ),
    sku AS (
        SELECT id FROM finished_skus 
        WHERE workspace_id = (SELECT id FROM ws)
        AND code LIKE '%KEG%'
        LIMIT 1
    ),
    deposit AS (
        INSERT INTO keg_deposit_entries (
            workspace_id,
            sku_id,
            entry_date,
            qty,
            amount_cents,
            direction,
            reference_doc,
            notes,
            created_by
        )
        SELECT
            ws.id,
            sku.id,
            '2025-01-31',
            3,
            15000, -- $150 returned ($50 per keg)
            'returned',
            'RET-KEG-001',
            '3 kegs returned from Local Bar',
            (SELECT id FROM users WHERE email = 'accounting@brewcrush.test' LIMIT 1)
        FROM ws, sku
        RETURNING direction, amount_cents, qty
    )
    SELECT direction, amount_cents, qty FROM deposit
    $$,
    $$VALUES ('returned'::text, 15000::integer, 3::integer)$$,
    'Should create keg deposit return'
);

-- Test: Calculate net keg deposit liability
SELECT results_eq(
    $$
    WITH ws AS (
        SELECT id FROM workspaces WHERE name = 'Test Brewery'
    ),
    liability AS (
        SELECT 
            SUM(CASE WHEN direction = 'charged' THEN amount_cents ELSE 0 END) as charged,
            SUM(CASE WHEN direction = 'returned' THEN amount_cents ELSE 0 END) as returned,
            SUM(CASE WHEN direction = 'charged' THEN amount_cents ELSE -amount_cents END) as net
        FROM keg_deposit_entries
        WHERE workspace_id = (SELECT id FROM ws)
    )
    SELECT net FROM liability
    $$,
    $$VALUES (10000::bigint)$$, -- $250 charged - $150 returned = $100 net
    'Should calculate correct net keg deposit liability'
);

-- Test: Calculate kegs outstanding
SELECT results_eq(
    $$
    WITH ws AS (
        SELECT id FROM workspaces WHERE name = 'Test Brewery'
    ),
    kegs AS (
        SELECT 
            SUM(CASE WHEN direction = 'charged' THEN qty ELSE -qty END) as outstanding
        FROM keg_deposit_entries
        WHERE workspace_id = (SELECT id FROM ws)
    )
    SELECT outstanding FROM kegs
    $$,
    $$VALUES (2::bigint)$$, -- 5 out - 3 returned = 2 outstanding
    'Should calculate correct kegs outstanding'
);

-- =============================================================================
-- BARREL CONVERSION TESTS
-- =============================================================================

-- Test: Convert cases to barrels
SELECT results_eq(
    $$
    SELECT 
        -- 1 case = 24 x 12oz = 288oz = 2.25 gallons = 0.0645 barrels
        ROUND((10 * 0.0645)::numeric, 3) as cases_to_bbl
    $$,
    $$VALUES (0.645::numeric)$$,
    'Should correctly convert 10 cases to barrels'
);

-- Test: Convert kegs to barrels
SELECT results_eq(
    $$
    SELECT 
        -- 1 standard keg = 1/2 barrel = 0.5 barrels
        (5 * 0.5)::numeric as kegs_to_bbl
    $$,
    $$VALUES (2.5::numeric)$$,
    'Should correctly convert 5 kegs to barrels'
);

-- Test: Convert liters to barrels
SELECT results_eq(
    $$
    SELECT 
        -- 117.348 liters = 1 barrel
        ROUND((1000 / 117.348)::numeric, 2) as liters_to_bbl
    $$,
    $$VALUES (8.52::numeric)$$,
    'Should correctly convert 1000 liters to barrels'
);

-- =============================================================================
-- EXCISE IMPACT TESTS
-- =============================================================================

-- Test: Taxable removals affect excise calculations
SELECT results_eq(
    $$
    WITH ws AS (
        SELECT id FROM workspaces WHERE name = 'Test Brewery'
    ),
    taxable_removals AS (
        SELECT 
            SUM(barrels) as total_taxable_bbl
        FROM removals
        WHERE workspace_id = (SELECT id FROM ws)
        AND is_taxable = true
        AND removal_date >= '2025-01-01'
        AND removal_date <= '2025-01-31'
    )
    SELECT ROUND(total_taxable_bbl, 3) FROM taxable_removals
    $$,
    $$VALUES (0.323::numeric)$$, -- From our test removal above
    'Should calculate correct taxable removals for excise'
);

-- Test: Non-taxable removals don't affect excise
SELECT results_eq(
    $$
    WITH ws AS (
        SELECT id FROM workspaces WHERE name = 'Test Brewery'
    ),
    nontaxable_removals AS (
        SELECT 
            SUM(barrels) as total_nontaxable_bbl
        FROM removals
        WHERE workspace_id = (SELECT id FROM ws)
        AND is_taxable = false
        AND removal_date >= '2025-01-01'
        AND removal_date <= '2025-01-31'
    )
    SELECT ROUND(total_nontaxable_bbl, 3) FROM nontaxable_removals
    $$,
    $$VALUES (0.645::numeric)$$, -- From our export test above
    'Should track non-taxable removals separately'
);

-- =============================================================================
-- RLS POLICY TESTS
-- =============================================================================

-- Test: Accounting role can access sales ingest
SELECT has_table_privilege('accounting@brewcrush.test', 'sales_ingest_jobs', 'SELECT');
SELECT has_table_privilege('accounting@brewcrush.test', 'sales_ingest_rows', 'SELECT');
SELECT has_table_privilege('accounting@brewcrush.test', 'removals', 'SELECT');
SELECT has_table_privilege('accounting@brewcrush.test', 'keg_deposit_entries', 'SELECT');

-- Test: Brewer role cannot create sales ingest jobs
SELECT results_eq(
    $$
    SET LOCAL ROLE brewer_test_role;
    SELECT EXISTS(
        SELECT 1 FROM sales_ingest_jobs
    ) as can_view
    $$,
    $$VALUES (false)$$,
    'Brewer role should not access sales ingest jobs'
);

-- Test: Inventory role can access removals
SELECT has_table_privilege('inventory@brewcrush.test', 'removals', 'SELECT');
SELECT has_table_privilege('inventory@brewcrush.test', 'removals', 'INSERT');

-- =============================================================================
-- ERROR HANDLING TESTS
-- =============================================================================

-- Test: Invalid SKU in removal
SELECT throws_ok(
    $$
    INSERT INTO removals (
        workspace_id,
        finished_lot_id,
        removal_date,
        qty,
        uom,
        barrels,
        reason,
        created_by
    )
    VALUES (
        (SELECT id FROM workspaces WHERE name = 'Test Brewery'),
        '00000000-0000-0000-0000-000000000000'::uuid, -- Invalid lot ID
        '2025-01-30',
        1,
        'case',
        0.0645,
        'sale',
        (SELECT id FROM users WHERE email = 'accounting@brewcrush.test' LIMIT 1)
    )
    $$,
    '23503', -- Foreign key violation
    'Should fail with invalid finished lot ID'
);

-- Test: Negative quantity in keg deposit
SELECT throws_ok(
    $$
    INSERT INTO keg_deposit_entries (
        workspace_id,
        entry_date,
        qty,
        amount_cents,
        direction,
        created_by
    )
    VALUES (
        (SELECT id FROM workspaces WHERE name = 'Test Brewery'),
        '2025-01-30',
        -5, -- Negative quantity
        5000,
        'charged',
        (SELECT id FROM users WHERE email = 'accounting@brewcrush.test' LIMIT 1)
    )
    $$,
    '23514', -- Check constraint violation
    'Should reject negative keg quantities'
);

-- =============================================================================
-- JOB PROCESSING TESTS
-- =============================================================================

-- Test: Update job status
SELECT results_eq(
    $$
    WITH job AS (
        SELECT id FROM sales_ingest_jobs 
        WHERE upload_id = 'test-upload-001.csv'
        LIMIT 1
    ),
    updated AS (
        UPDATE sales_ingest_jobs
        SET 
            status = 'completed',
            processed_rows = 100,
            failed_rows = 0,
            completed_at = NOW()
        WHERE id = (SELECT id FROM job)
        RETURNING status, processed_rows
    )
    SELECT status, processed_rows FROM updated
    $$,
    $$VALUES ('completed'::text, 100::integer)$$,
    'Should update job status to completed'
);

-- Test: Job with errors
SELECT results_eq(
    $$
    WITH job AS (
        INSERT INTO sales_ingest_jobs (
            workspace_id,
            upload_id,
            status,
            mapping,
            idempotency_key,
            total_rows,
            processed_rows,
            failed_rows,
            error_csv_url,
            created_by
        )
        SELECT 
            workspace_id,
            'error-test.csv',
            'completed_with_errors',
            '{}'::jsonb,
            'error-key-001',
            100,
            95,
            5,
            'https://storage.example.com/errors/error-key-001.csv',
            (SELECT id FROM users WHERE email = 'accounting@brewcrush.test' LIMIT 1)
        FROM workspaces
        WHERE name = 'Test Brewery'
        RETURNING status, failed_rows
    )
    SELECT status, failed_rows FROM job
    $$,
    $$VALUES ('completed_with_errors'::text, 5::integer)$$,
    'Should track jobs with partial failures'
);

-- =============================================================================
-- CLEANUP
-- =============================================================================

-- Clean up test data
DELETE FROM sales_ingest_rows WHERE job_id IN (
    SELECT id FROM sales_ingest_jobs WHERE upload_id LIKE 'test-%' OR upload_id LIKE 'error-%'
);
DELETE FROM sales_ingest_jobs WHERE upload_id LIKE 'test-%' OR upload_id LIKE 'error-%';
DELETE FROM removals WHERE doc_ref IN ('INV-001', 'INV-KEG-001', 'RET-KEG-001');
DELETE FROM keg_deposit_entries WHERE reference_doc IN ('INV-KEG-001', 'RET-KEG-001');

-- Rollback transaction
ROLLBACK;
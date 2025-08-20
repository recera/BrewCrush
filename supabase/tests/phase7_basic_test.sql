-- Phase 7: Basic Sales Ingest & Keg Deposit Test
-- Simple test to verify core functionality

BEGIN;

-- =============================================================================
-- 1. TEST SALES INGEST JOB CREATION
-- =============================================================================
\echo '=== Testing sales ingest job creation ==='

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
    w.id,
    'test-phase7.csv',
    'pending',
    '{"preset": "custom"}'::jsonb,
    'test-phase7-key',
    10,
    u.id
FROM workspaces w
CROSS JOIN users u
WHERE w.name = 'Demo Brewery'
AND u.email = 'accounting@demo.brewcrush.test'
LIMIT 1;

SELECT COUNT(*) as jobs_created FROM sales_ingest_jobs WHERE upload_id = 'test-phase7.csv';

-- =============================================================================
-- 2. TEST REMOVAL CREATION
-- =============================================================================
\echo '=== Testing removal creation ==='

-- Create a test removal
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
    w.id,
    fl.id,
    CURRENT_DATE,
    2,
    'cases',
    0.129,
    'sale',
    true,
    'TEST-REM-001',
    'distributor',
    u.id
FROM workspaces w
CROSS JOIN users u
JOIN finished_lots fl ON fl.workspace_id = w.id
WHERE w.name = 'Demo Brewery'
AND u.email = 'accounting@demo.brewcrush.test'
AND fl.quantity > 0
LIMIT 1;

SELECT COUNT(*) as removals_created FROM removals WHERE doc_ref = 'TEST-REM-001';

-- =============================================================================
-- 3. TEST KEG DEPOSIT ENTRIES
-- =============================================================================
\echo '=== Testing keg deposit entries ==='

-- Create keg deposit charge
INSERT INTO keg_deposit_entries (
    workspace_id,
    entry_date,
    qty,
    amount_cents,
    direction,
    reference_doc,
    created_by
)
SELECT 
    w.id,
    CURRENT_DATE,
    5,
    25000,
    'charged',
    'TEST-KEG-001',
    u.id
FROM workspaces w
CROSS JOIN users u
WHERE w.name = 'Demo Brewery'
AND u.email = 'accounting@demo.brewcrush.test';

-- Create keg deposit return
INSERT INTO keg_deposit_entries (
    workspace_id,
    entry_date,
    qty,
    amount_cents,
    direction,
    reference_doc,
    created_by
)
SELECT 
    w.id,
    CURRENT_DATE,
    3,
    15000,
    'returned',
    'TEST-KEG-002',
    u.id
FROM workspaces w
CROSS JOIN users u
WHERE w.name = 'Demo Brewery'
AND u.email = 'accounting@demo.brewcrush.test';

SELECT 
    direction,
    COUNT(*) as count,
    SUM(qty) as total_qty,
    SUM(amount_cents) as total_amount
FROM keg_deposit_entries
WHERE reference_doc IN ('TEST-KEG-001', 'TEST-KEG-002')
GROUP BY direction;

-- =============================================================================
-- 4. VERIFY BARREL CONVERSIONS
-- =============================================================================
\echo '=== Testing barrel conversions ==='

SELECT 
    'Cases to BBL' as conversion,
    ROUND((10 * 0.0645)::numeric, 3) as result,
    0.645 as expected
UNION ALL
SELECT 
    'Kegs to BBL',
    ROUND((5 * 0.5)::numeric, 3),
    2.5
UNION ALL
SELECT 
    'Liters to BBL',
    ROUND((117.348 / 117.348)::numeric, 3),
    1.0;

-- =============================================================================
-- 5. CLEANUP
-- =============================================================================
\echo '=== Cleaning up test data ==='

DELETE FROM sales_ingest_rows WHERE job_id IN (
    SELECT id FROM sales_ingest_jobs WHERE upload_id = 'test-phase7.csv'
);
DELETE FROM sales_ingest_jobs WHERE upload_id = 'test-phase7.csv';
DELETE FROM removals WHERE doc_ref = 'TEST-REM-001';
DELETE FROM keg_deposit_entries WHERE reference_doc IN ('TEST-KEG-001', 'TEST-KEG-002');

\echo '=== Phase 7 basic test completed ==='

ROLLBACK;
-- Phase 7: Simple Sales Ingest & Keg Deposit Integration Test
-- Manual test to verify sales ingest and keg deposit functionality

-- Get workspace ID
\set workspace_id '''SELECT id FROM workspaces WHERE name = ''Demo Brewery'' LIMIT 1'''
\set user_id '''SELECT id FROM users WHERE email = ''accounting@demo.brewcrush.test'' LIMIT 1'''

-- =============================================================================
-- 1. TEST SALES INGEST JOB CREATION
-- =============================================================================
\echo 'Testing sales ingest job creation...'

INSERT INTO sales_ingest_jobs (
    workspace_id,
    upload_id,
    status,
    mapping,
    idempotency_key,
    total_rows,
    created_by
)
VALUES (
    (:workspace_id),
    'test-upload-phase7.csv',
    'pending',
    '{"preset": "custom", "fields": {"date": "date", "sku": "sku_code"}}'::jsonb,
    'test-phase7-' || NOW()::text,
    10,
    (:user_id)
);

-- Verify job was created
SELECT id, upload_id, status, total_rows 
FROM sales_ingest_jobs 
WHERE upload_id = 'test-upload-phase7.csv';

-- =============================================================================
-- 2. TEST REMOVAL CREATION
-- =============================================================================
\echo 'Testing removal creation...'

-- First, get a finished lot
WITH lot AS (
    SELECT fl.id, fl.sku_id, fs.code 
    FROM finished_lots fl
    JOIN finished_skus fs ON fs.id = fl.sku_id
    WHERE fl.workspace_id = (:workspace_id)
    AND fl.quantity > 0
    LIMIT 1
)
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
    (:workspace_id),
    lot.id,
    CURRENT_DATE,
    2,
    'cases',
    0.129, -- 2 cases = 0.129 barrels
    'sale',
    true,
    'TEST-INV-001',
    'distributor',
    (:user_id)
FROM lot;

-- Verify removal was created
SELECT id, doc_ref, qty, barrels, reason, is_taxable 
FROM removals 
WHERE doc_ref = 'TEST-INV-001';

-- =============================================================================
-- 3. TEST KEG DEPOSIT CHARGE
-- =============================================================================
\echo 'Testing keg deposit charge...'

INSERT INTO keg_deposit_entries (
    workspace_id,
    entry_date,
    qty,
    amount_cents,
    direction,
    reference_doc,
    notes,
    created_by
)
VALUES (
    (:workspace_id),
    CURRENT_DATE,
    5,
    25000, -- $250 ($50 per keg)
    'charged',
    'TEST-KEG-001',
    'Test: 5 kegs to distributor',
    (:user_id)
);

-- Verify keg deposit was created
SELECT id, reference_doc, qty, amount_cents, direction 
FROM keg_deposit_entries 
WHERE reference_doc = 'TEST-KEG-001';

-- =============================================================================
-- 4. TEST KEG DEPOSIT RETURN
-- =============================================================================
\echo 'Testing keg deposit return...'

INSERT INTO keg_deposit_entries (
    workspace_id,
    entry_date,
    qty,
    amount_cents,
    direction,
    reference_doc,
    notes,
    created_by
)
VALUES (
    (:workspace_id),
    CURRENT_DATE,
    3,
    15000, -- $150 ($50 per keg)
    'returned',
    'TEST-KEG-RET-001',
    'Test: 3 kegs returned',
    (:user_id)
);

-- Verify keg return was created
SELECT id, reference_doc, qty, amount_cents, direction 
FROM keg_deposit_entries 
WHERE reference_doc = 'TEST-KEG-RET-001';

-- =============================================================================
-- 5. VERIFY NET LIABILITY CALCULATION
-- =============================================================================
\echo 'Calculating net keg deposit liability...'

SELECT 
    SUM(CASE WHEN direction = 'charged' THEN amount_cents ELSE 0 END) as total_charged,
    SUM(CASE WHEN direction = 'returned' THEN amount_cents ELSE 0 END) as total_returned,
    SUM(CASE WHEN direction = 'charged' THEN amount_cents ELSE -amount_cents END) as net_liability,
    SUM(CASE WHEN direction = 'charged' THEN qty ELSE -qty END) as kegs_outstanding
FROM keg_deposit_entries
WHERE workspace_id = (:workspace_id)
AND reference_doc IN ('TEST-KEG-001', 'TEST-KEG-RET-001');

-- =============================================================================
-- 6. TEST IMPACT ON EXCISE CALCULATIONS
-- =============================================================================
\echo 'Testing impact on excise calculations...'

-- Check taxable removals for the period
SELECT 
    COUNT(*) as removal_count,
    SUM(barrels) as total_taxable_barrels,
    SUM(barrels) * 350 as estimated_tax_cents -- $3.50 per barrel
FROM removals
WHERE workspace_id = (:workspace_id)
AND is_taxable = true
AND removal_date = CURRENT_DATE
AND doc_ref = 'TEST-INV-001';

-- =============================================================================
-- 7. TEST NON-TAXABLE REMOVAL (EXPORT)
-- =============================================================================
\echo 'Testing non-taxable removal...'

-- Create an export removal
WITH lot AS (
    SELECT fl.id 
    FROM finished_lots fl
    WHERE fl.workspace_id = (:workspace_id)
    AND fl.quantity > 0
    LIMIT 1
)
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
    (:workspace_id),
    lot.id,
    CURRENT_DATE,
    5,
    'cases',
    0.323, -- 5 cases
    'export',
    false, -- Not taxable
    'TEST-EXPORT-001',
    'export',
    (:user_id)
FROM lot;

-- Verify non-taxable removals are separate
SELECT 
    reason,
    is_taxable,
    SUM(barrels) as total_barrels
FROM removals
WHERE workspace_id = (:workspace_id)
AND removal_date = CURRENT_DATE
AND doc_ref IN ('TEST-INV-001', 'TEST-EXPORT-001')
GROUP BY reason, is_taxable
ORDER BY is_taxable DESC;

-- =============================================================================
-- 8. CLEANUP TEST DATA
-- =============================================================================
\echo 'Cleaning up test data...'

DELETE FROM removals 
WHERE doc_ref IN ('TEST-INV-001', 'TEST-EXPORT-001');

DELETE FROM keg_deposit_entries 
WHERE reference_doc IN ('TEST-KEG-001', 'TEST-KEG-RET-001');

DELETE FROM sales_ingest_jobs 
WHERE upload_id = 'test-upload-phase7.csv';

\echo 'Phase 7 integration test completed successfully!'
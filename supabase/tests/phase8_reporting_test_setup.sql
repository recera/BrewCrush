-- ============================================================================
-- Phase 8 Reporting Test Setup
-- Comprehensive test data for reporting system validation
-- ============================================================================

BEGIN;

-- Enable pgTAP extension if not already enabled
CREATE EXTENSION IF NOT EXISTS pgtap;

-- ============================================================================
-- TEST DATA SETUP FUNCTIONS
-- ============================================================================

-- Function to create test workspace and users
CREATE OR REPLACE FUNCTION setup_test_workspace()
RETURNS TABLE(workspace_id UUID, admin_user_id UUID, brewer_user_id UUID, inventory_user_id UUID, accounting_user_id UUID)
LANGUAGE plpgsql
AS $$
DECLARE
    test_workspace_id UUID := gen_random_uuid();
    test_admin_id UUID := gen_random_uuid();
    test_brewer_id UUID := gen_random_uuid();
    test_inventory_id UUID := gen_random_uuid();
    test_accounting_id UUID := gen_random_uuid();
BEGIN
    -- Create test workspace
    INSERT INTO workspaces (id, name, plan, settings) VALUES 
    (test_workspace_id, 'Test Brewery', 'pro', '{}'::jsonb);
    
    -- Create test users (shadow auth.users for testing)
    INSERT INTO users (id, workspace_id, email) VALUES
    (test_admin_id, test_workspace_id, 'admin@testbrewery.com'),
    (test_brewer_id, test_workspace_id, 'brewer@testbrewery.com'),
    (test_inventory_id, test_workspace_id, 'inventory@testbrewery.com'),
    (test_accounting_id, test_workspace_id, 'accounting@testbrewery.com');
    
    -- Create user roles
    INSERT INTO user_workspace_roles (user_id, workspace_id, role) VALUES
    (test_admin_id, test_workspace_id, 'admin'),
    (test_brewer_id, test_workspace_id, 'brewer'),
    (test_inventory_id, test_workspace_id, 'inventory'),
    (test_accounting_id, test_workspace_id, 'accounting');
    
    RETURN QUERY SELECT test_workspace_id, test_admin_id, test_brewer_id, test_inventory_id, test_accounting_id;
END;
$$;

-- Function to create comprehensive test inventory data
CREATE OR REPLACE FUNCTION setup_test_inventory(p_workspace_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    warehouse_location_id UUID := gen_random_uuid();
    taproom_location_id UUID := gen_random_uuid();
    
    -- Raw materials
    malt_2row_id UUID := gen_random_uuid();
    malt_munich_id UUID := gen_random_uuid();
    hops_cascade_id UUID := gen_random_uuid();
    hops_citra_id UUID := gen_random_uuid();
    yeast_ale_id UUID := gen_random_uuid();
    
    -- Packaging materials
    cans_16oz_id UUID := gen_random_uuid();
    kegs_half_id UUID := gen_random_uuid();
    labels_ipa_id UUID := gen_random_uuid();
    
    -- Finished goods
    ipa_16oz_id UUID := gen_random_uuid();
    ipa_keg_id UUID := gen_random_uuid();
    
    -- Vendors
    malt_vendor_id UUID := gen_random_uuid();
    hops_vendor_id UUID := gen_random_uuid();
    packaging_vendor_id UUID := gen_random_uuid();
    
    -- Sample lot IDs for traceability
    malt_lot_1 UUID := gen_random_uuid();
    malt_lot_2 UUID := gen_random_uuid();
    hops_lot_1 UUID := gen_random_uuid();
    yeast_lot_1 UUID := gen_random_uuid();
    can_lot_1 UUID := gen_random_uuid();
    keg_lot_1 UUID := gen_random_uuid();
BEGIN
    -- Create inventory locations
    INSERT INTO inventory_locations (id, workspace_id, name, type) VALUES
    (warehouse_location_id, p_workspace_id, 'Main Warehouse', 'warehouse'),
    (taproom_location_id, p_workspace_id, 'Taproom Storage', 'taproom');
    
    -- Create vendors
    INSERT INTO vendors (id, workspace_id, name, email, terms) VALUES
    (malt_vendor_id, p_workspace_id, 'Premium Malt Co', 'orders@premiummalt.com', 'Net 30'),
    (hops_vendor_id, p_workspace_id, 'Pacific Hops Supply', 'sales@pacifichops.com', 'Net 15'),
    (packaging_vendor_id, p_workspace_id, 'Craft Packaging Solutions', 'orders@craftpack.com', 'Net 30');
    
    -- Create raw materials
    INSERT INTO items (id, workspace_id, name, type, uom, reorder_level, vendor_id) VALUES
    (malt_2row_id, p_workspace_id, '2-Row Pale Malt', 'raw', 'lbs', 500, malt_vendor_id),
    (malt_munich_id, p_workspace_id, 'Munich Malt', 'raw', 'lbs', 100, malt_vendor_id),
    (hops_cascade_id, p_workspace_id, 'Cascade Hops', 'raw', 'lbs', 10, hops_vendor_id),
    (hops_citra_id, p_workspace_id, 'Citra Hops', 'raw', 'lbs', 5, hops_vendor_id),
    (yeast_ale_id, p_workspace_id, 'American Ale Yeast', 'raw', 'pack', 20, hops_vendor_id);
    
    -- Create packaging materials  
    INSERT INTO items (id, workspace_id, name, type, uom, reorder_level, vendor_id) VALUES
    (cans_16oz_id, p_workspace_id, '16oz Aluminum Cans', 'packaging', 'each', 2400, packaging_vendor_id),
    (kegs_half_id, p_workspace_id, 'Half Barrel Kegs', 'packaging', 'each', 10, packaging_vendor_id),
    (labels_ipa_id, p_workspace_id, 'IPA Labels', 'packaging', 'each', 1000, packaging_vendor_id);
    
    -- Create finished goods
    INSERT INTO finished_skus (id, workspace_id, code, size_ml, pack_config) VALUES
    (ipa_16oz_id, p_workspace_id, 'IPA-16OZ', 473, '{"type": "can", "pack_size": 4}'),
    (ipa_keg_id, p_workspace_id, 'IPA-KEG', 58674, '{"type": "keg", "size": "half_barrel"}');
    
    INSERT INTO items (id, workspace_id, name, type, uom, finished_sku_id) VALUES
    (gen_random_uuid(), p_workspace_id, 'West Coast IPA - 16oz Can', 'finished', 'each', ipa_16oz_id),
    (gen_random_uuid(), p_workspace_id, 'West Coast IPA - Keg', 'finished', 'each', ipa_keg_id);
    
    -- Create initial inventory lots with varying scenarios
    
    -- Malt lots (adequate stock)
    INSERT INTO item_lots (id, workspace_id, item_id, lot_code, qty, uom, unit_cost, location_id, received_at) VALUES
    (malt_lot_1, p_workspace_id, malt_2row_id, '2ROW-2025-001', 800, 'lbs', 0.85, warehouse_location_id, CURRENT_DATE - INTERVAL '30 days'),
    (malt_lot_2, p_workspace_id, malt_munich_id, 'MUN-2025-001', 200, 'lbs', 1.20, warehouse_location_id, CURRENT_DATE - INTERVAL '20 days');
    
    -- Hops lots (one low stock scenario for testing alerts)
    INSERT INTO item_lots (id, workspace_id, item_id, lot_code, qty, uom, unit_cost, location_id, received_at, expiry_date) VALUES
    (hops_lot_1, p_workspace_id, hops_cascade_id, 'CAS-2024-H1', 3, 'lbs', 15.50, warehouse_location_id, CURRENT_DATE - INTERVAL '60 days', CURRENT_DATE + INTERVAL '90 days'),
    (gen_random_uuid(), p_workspace_id, hops_citra_id, 'CIT-2024-H2', 12, 'lbs', 18.75, warehouse_location_id, CURRENT_DATE - INTERVAL '45 days', CURRENT_DATE + INTERVAL '120 days');
    
    -- Yeast (adequate stock)
    INSERT INTO item_lots (id, workspace_id, item_id, lot_code, qty, uom, unit_cost, location_id, received_at, expiry_date) VALUES
    (yeast_lot_1, p_workspace_id, yeast_ale_id, 'YEAST-001', 25, 'pack', 8.50, warehouse_location_id, CURRENT_DATE - INTERVAL '10 days', CURRENT_DATE + INTERVAL '180 days');
    
    -- Packaging (one low stock, one expiring soon for testing)
    INSERT INTO item_lots (id, workspace_id, item_id, lot_code, qty, uom, unit_cost, location_id, received_at, expiry_date) VALUES
    (can_lot_1, p_workspace_id, cans_16oz_id, 'CAN16-B001', 1200, 'each', 0.42, warehouse_location_id, CURRENT_DATE - INTERVAL '15 days', NULL),
    (keg_lot_1, p_workspace_id, kegs_half_id, 'KEG-HALF-001', 15, 'each', 85.00, warehouse_location_id, CURRENT_DATE - INTERVAL '90 days', NULL),
    (gen_random_uuid(), p_workspace_id, labels_ipa_id, 'LBL-IPA-001', 800, 'each', 0.08, warehouse_location_id, CURRENT_DATE - INTERVAL '25 days', CURRENT_DATE + INTERVAL '20 days');
    
    -- Create inventory transactions for history
    INSERT INTO inventory_transactions (workspace_id, item_lot_id, type, qty, uom, ref_type, ref_id, created_at) VALUES
    (p_workspace_id, malt_lot_1, 'receive', 800, 'lbs', 'po_receipt_line', gen_random_uuid(), CURRENT_DATE - INTERVAL '30 days'),
    (p_workspace_id, malt_lot_2, 'receive', 200, 'lbs', 'po_receipt_line', gen_random_uuid(), CURRENT_DATE - INTERVAL '20 days'),
    (p_workspace_id, hops_lot_1, 'receive', 5, 'lbs', 'po_receipt_line', gen_random_uuid(), CURRENT_DATE - INTERVAL '60 days'),
    (p_workspace_id, hops_lot_1, 'consume', -2, 'lbs', 'batch_ingredient', gen_random_uuid(), CURRENT_DATE - INTERVAL '45 days');
    
    -- Update supplier price history
    INSERT INTO supplier_price_history (workspace_id, item_id, vendor_id, receipt_date, unit_cost, qty_received) VALUES
    (p_workspace_id, malt_2row_id, malt_vendor_id, CURRENT_DATE - INTERVAL '60 days', 0.80, 1000),
    (p_workspace_id, malt_2row_id, malt_vendor_id, CURRENT_DATE - INTERVAL '30 days', 0.85, 800),
    (p_workspace_id, hops_cascade_id, hops_vendor_id, CURRENT_DATE - INTERVAL '90 days', 14.00, 10),
    (p_workspace_id, hops_cascade_id, hops_vendor_id, CURRENT_DATE - INTERVAL '60 days', 15.50, 5),
    (p_workspace_id, hops_citra_id, hops_vendor_id, CURRENT_DATE - INTERVAL '45 days', 18.75, 12);
    
END;
$$;

-- Function to create test production data (recipes, batches, packaging)
CREATE OR REPLACE FUNCTION setup_test_production(p_workspace_id UUID)
RETURNS TABLE(recipe_id UUID, batch_id UUID, finished_lot_id UUID)
LANGUAGE plpgsql
AS $$
DECLARE
    test_recipe_id UUID := gen_random_uuid();
    test_batch_id UUID := gen_random_uuid();
    test_finished_lot_id UUID := gen_random_uuid();
    test_tank_id UUID := gen_random_uuid();
    packaging_run_id UUID := gen_random_uuid();
    ipa_sku_id UUID;
BEGIN
    -- Get the IPA SKU we created
    SELECT id INTO ipa_sku_id FROM finished_skus 
    WHERE workspace_id = p_workspace_id AND code = 'IPA-16OZ';
    
    -- Create test tank
    INSERT INTO tanks (id, workspace_id, name, type, capacity, cip_status) VALUES
    (test_tank_id, p_workspace_id, 'Fermenter #1', 'fermenter', 1000, 'clean');
    
    -- Create test recipe
    INSERT INTO recipes (id, workspace_id, name, style, target_volume, efficiency_pct) VALUES
    (test_recipe_id, p_workspace_id, 'West Coast IPA', 'American IPA', 800, 75);
    
    INSERT INTO recipe_versions (workspace_id, recipe_id, version, is_active, ingredients) VALUES
    (p_workspace_id, test_recipe_id, 1, true, '[
        {"item_name": "2-Row Pale Malt", "quantity": 150, "unit": "lbs"},
        {"item_name": "Munich Malt", "quantity": 20, "unit": "lbs"},
        {"item_name": "Cascade Hops", "quantity": 2, "unit": "lbs"},
        {"item_name": "Citra Hops", "quantity": 1.5, "unit": "lbs"}
    ]'::jsonb);
    
    -- Create test batch with complete production cycle
    INSERT INTO batches (id, workspace_id, recipe_id, batch_number, status, tank_id, target_volume, actual_volume, brew_date, og_target, og_actual, fg_actual, abv_actual) VALUES
    (test_batch_id, p_workspace_id, test_recipe_id, 'IPA-001', 'completed', test_tank_id, 800, 785, CURRENT_DATE - INTERVAL '21 days', 1.058, 1.060, 1.012, 6.3);
    
    -- Add fermentation readings for testing
    INSERT INTO ferm_readings (workspace_id, batch_id, sg, temp, ph, reading_at) VALUES
    (p_workspace_id, test_batch_id, 1.060, 68, 5.2, CURRENT_DATE - INTERVAL '21 days'),
    (p_workspace_id, test_batch_id, 1.045, 70, 4.8, CURRENT_DATE - INTERVAL '19 days'),
    (p_workspace_id, test_batch_id, 1.025, 69, 4.6, CURRENT_DATE - INTERVAL '17 days'),
    (p_workspace_id, test_batch_id, 1.015, 68, 4.5, CURRENT_DATE - INTERVAL '15 days'),
    (p_workspace_id, test_batch_id, 1.012, 67, 4.4, CURRENT_DATE - INTERVAL '14 days'),
    (p_workspace_id, test_batch_id, 1.012, 67, 4.4, CURRENT_DATE - INTERVAL '7 days');
    
    -- Create packaging run
    INSERT INTO packaging_runs (id, workspace_id, sku_id, at, loss_pct, cost_method_used, code_template_id) VALUES
    (packaging_run_id, p_workspace_id, ipa_sku_id, CURRENT_DATE - INTERVAL '5 days', 3.2, 'actual_lots', NULL);
    
    INSERT INTO packaging_run_sources (workspace_id, run_id, batch_id, volume_liters) VALUES
    (p_workspace_id, packaging_run_id, test_batch_id, 785);
    
    -- Create finished lot for traceability testing
    INSERT INTO finished_lots (id, workspace_id, sku_id, lot_code, produced_qty, uom, run_id, produced_at) VALUES
    (test_finished_lot_id, p_workspace_id, ipa_sku_id, '25021-IPA-001-16OZ', 1800, 'each', packaging_run_id, CURRENT_DATE - INTERVAL '5 days');
    
    -- Create some removals for sales tracking
    INSERT INTO removals (workspace_id, finished_lot_id, qty, reason, destination_type, doc_ref, removed_at) VALUES
    (p_workspace_id, test_finished_lot_id, 200, 'sale', 'taproom', 'TAPROOM-001', CURRENT_DATE - INTERVAL '4 days'),
    (p_workspace_id, test_finished_lot_id, 600, 'sale', 'distributor', 'DIST-INV-001', CURRENT_DATE - INTERVAL '3 days'),
    (p_workspace_id, test_finished_lot_id, 100, 'consumption', 'taproom', 'TASTING-001', CURRENT_DATE - INTERVAL '2 days');
    
    RETURN QUERY SELECT test_recipe_id, test_batch_id, test_finished_lot_id;
END;
$$;

-- Function to create test PO data
CREATE OR REPLACE FUNCTION setup_test_purchasing(p_workspace_id UUID)
RETURNS TABLE(po_id UUID, overdue_po_id UUID)
LANGUAGE plpgsql
AS $$
DECLARE
    test_po_id UUID := gen_random_uuid();
    test_overdue_po_id UUID := gen_random_uuid();
    malt_vendor_id UUID;
    hops_vendor_id UUID;
    malt_2row_id UUID;
    hops_cascade_id UUID;
BEGIN
    -- Get vendor and item IDs
    SELECT id INTO malt_vendor_id FROM vendors WHERE workspace_id = p_workspace_id AND name = 'Premium Malt Co';
    SELECT id INTO hops_vendor_id FROM vendors WHERE workspace_id = p_workspace_id AND name = 'Pacific Hops Supply';
    SELECT id INTO malt_2row_id FROM items WHERE workspace_id = p_workspace_id AND name = '2-Row Pale Malt';
    SELECT id INTO hops_cascade_id FROM items WHERE workspace_id = p_workspace_id AND name = 'Cascade Hops';
    
    -- Create current PO (approved, pending receipt)
    INSERT INTO purchase_orders (id, workspace_id, po_number, vendor_id, status, order_date, expected_delivery_date, terms) VALUES
    (test_po_id, p_workspace_id, 'PO-2025-001', malt_vendor_id, 'approved', CURRENT_DATE - INTERVAL '5 days', CURRENT_DATE + INTERVAL '10 days', 'Net 30');
    
    INSERT INTO po_lines (workspace_id, po_id, item_id, qty, uom, expected_unit_cost, due_date, location_id) VALUES
    (p_workspace_id, test_po_id, malt_2row_id, 1000, 'lbs', 0.88, CURRENT_DATE + INTERVAL '10 days', (SELECT id FROM inventory_locations WHERE workspace_id = p_workspace_id LIMIT 1));
    
    -- Create overdue PO for testing aging
    INSERT INTO purchase_orders (id, workspace_id, po_number, vendor_id, status, order_date, expected_delivery_date, terms) VALUES
    (test_overdue_po_id, p_workspace_id, 'PO-2025-002', hops_vendor_id, 'approved', CURRENT_DATE - INTERVAL '25 days', CURRENT_DATE - INTERVAL '5 days', 'Net 15');
    
    INSERT INTO po_lines (workspace_id, po_id, item_id, qty, uom, expected_unit_cost, due_date, location_id) VALUES
    (p_workspace_id, test_overdue_po_id, hops_cascade_id, 10, 'lbs', 16.00, CURRENT_DATE - INTERVAL '5 days', (SELECT id FROM inventory_locations WHERE workspace_id = p_workspace_id LIMIT 1));
    
    RETURN QUERY SELECT test_po_id, test_overdue_po_id;
END;
$$;

-- Function to create TTB compliance test data
CREATE OR REPLACE FUNCTION setup_test_compliance(p_workspace_id UUID)
RETURNS TABLE(ttb_period_id UUID, excise_worksheet_id UUID)
LANGUAGE plpgsql
AS $$
DECLARE
    test_period_id UUID := gen_random_uuid();
    test_worksheet_id UUID := gen_random_uuid();
BEGIN
    -- Create TTB period
    INSERT INTO ttb_periods (id, workspace_id, type, period_start, period_end, status, due_date) VALUES
    (test_period_id, p_workspace_id, 'monthly', DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month'), DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '1 day', 'draft', CURRENT_DATE + INTERVAL '15 days');
    
    -- Create excise worksheet
    INSERT INTO excise_worksheets (id, workspace_id, period_id, taxable_removals_total, breakdown, created_at) VALUES
    (test_worksheet_id, p_workspace_id, test_period_id, 700, '{"taproom": 100, "distributor": 600}'::jsonb, CURRENT_DATE);
    
    RETURN QUERY SELECT test_period_id, test_worksheet_id;
END;
$$;

-- Function to clean up test data
CREATE OR REPLACE FUNCTION cleanup_test_data()
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
    -- Delete in reverse dependency order to avoid FK constraint violations
    DELETE FROM removals WHERE workspace_id IN (SELECT id FROM workspaces WHERE name LIKE '%Test%');
    DELETE FROM finished_lots WHERE workspace_id IN (SELECT id FROM workspaces WHERE name LIKE '%Test%');
    DELETE FROM packaging_run_sources WHERE workspace_id IN (SELECT id FROM workspaces WHERE name LIKE '%Test%');
    DELETE FROM packaging_runs WHERE workspace_id IN (SELECT id FROM workspaces WHERE name LIKE '%Test%');
    DELETE FROM ferm_readings WHERE workspace_id IN (SELECT id FROM workspaces WHERE name LIKE '%Test%');
    DELETE FROM batches WHERE workspace_id IN (SELECT id FROM workspaces WHERE name LIKE '%Test%');
    DELETE FROM recipe_versions WHERE workspace_id IN (SELECT id FROM workspaces WHERE name LIKE '%Test%');
    DELETE FROM recipes WHERE workspace_id IN (SELECT id FROM workspaces WHERE name LIKE '%Test%');
    DELETE FROM tanks WHERE workspace_id IN (SELECT id FROM workspaces WHERE name LIKE '%Test%');
    DELETE FROM po_lines WHERE workspace_id IN (SELECT id FROM workspaces WHERE name LIKE '%Test%');
    DELETE FROM purchase_orders WHERE workspace_id IN (SELECT id FROM workspaces WHERE name LIKE '%Test%');
    DELETE FROM inventory_transactions WHERE workspace_id IN (SELECT id FROM workspaces WHERE name LIKE '%Test%');
    DELETE FROM supplier_price_history WHERE workspace_id IN (SELECT id FROM workspaces WHERE name LIKE '%Test%');
    DELETE FROM item_lots WHERE workspace_id IN (SELECT id FROM workspaces WHERE name LIKE '%Test%');
    DELETE FROM items WHERE workspace_id IN (SELECT id FROM workspaces WHERE name LIKE '%Test%');
    DELETE FROM finished_skus WHERE workspace_id IN (SELECT id FROM workspaces WHERE name LIKE '%Test%');
    DELETE FROM inventory_locations WHERE workspace_id IN (SELECT id FROM workspaces WHERE name LIKE '%Test%');
    DELETE FROM vendors WHERE workspace_id IN (SELECT id FROM workspaces WHERE name LIKE '%Test%');
    DELETE FROM excise_worksheets WHERE workspace_id IN (SELECT id FROM workspaces WHERE name LIKE '%Test%');
    DELETE FROM ttb_periods WHERE workspace_id IN (SELECT id FROM workspaces WHERE name LIKE '%Test%');
    DELETE FROM user_workspace_roles WHERE workspace_id IN (SELECT id FROM workspaces WHERE name LIKE '%Test%');
    DELETE FROM users WHERE workspace_id IN (SELECT id FROM workspaces WHERE name LIKE '%Test%');
    DELETE FROM workspaces WHERE name LIKE '%Test%';
    
    -- Refresh materialized views to ensure clean state
    REFRESH MATERIALIZED VIEW mv_inventory_on_hand;
    REFRESH MATERIALIZED VIEW mv_batch_summary;
    REFRESH MATERIALIZED VIEW mv_production_summary;
    REFRESH MATERIALIZED VIEW mv_po_aging;
    REFRESH MATERIALIZED VIEW mv_supplier_price_trends;
    REFRESH MATERIALIZED VIEW mv_keg_deposit_summary;
END;
$$;

COMMIT;
-- Phase 8: Comprehensive Reporting and Dashboard Views
-- Creating materialized views and functions for reporting, dashboards, and recall drill

-- ============================================================================
-- MATERIALIZED VIEWS FOR PERFORMANCE
-- ============================================================================

-- Inventory On-Hand Summary by Item and Location
CREATE MATERIALIZED VIEW mv_inventory_on_hand AS
WITH inventory_balance AS (
    SELECT 
        il.workspace_id,
        il.item_id,
        il.location_id,
        il.id as lot_id,
        il.lot_code,
        il.qty,
        il.uom,
        il.unit_cost,
        il.expiry,
        -- Calculate consumed quantity
        COALESCE(
            (SELECT SUM(ABS(it.quantity)) 
             FROM inventory_transactions it 
             WHERE it.item_lot_id = il.id 
               AND it.type IN ('consume', 'ship', 'destroy', 'transfer')),
            0
        ) as consumed_qty,
        -- Calculate remaining quantity
        il.qty - COALESCE(
            (SELECT SUM(ABS(it.quantity)) 
             FROM inventory_transactions it 
             WHERE it.item_lot_id = il.id 
               AND it.type IN ('consume', 'ship', 'destroy', 'transfer')),
            0
        ) as remaining_qty
    FROM item_lots il
    WHERE il.qty > 0
)
SELECT 
    ib.workspace_id,
    i.id as item_id,
    i.name as item_name,
    i.type as item_type,
    i.uom as base_uom,
    loc.id as location_id,
    loc.name as location_name,
    loc.type as location_type,
    COUNT(ib.lot_id) as lot_count,
    SUM(ib.remaining_qty) as total_qty,
    AVG(ib.unit_cost) as avg_unit_cost,
    SUM(ib.remaining_qty * COALESCE(ib.unit_cost, 0)) as total_value,
    MIN(ib.expiry) as earliest_expiry,
    i.reorder_level,
    CASE 
        WHEN SUM(ib.remaining_qty) <= COALESCE(i.reorder_level, 0) THEN true
        ELSE false
    END as below_reorder_level
FROM inventory_balance ib
JOIN items i ON i.id = ib.item_id
JOIN inventory_locations loc ON loc.id = ib.location_id
WHERE ib.remaining_qty > 0
GROUP BY 
    ib.workspace_id, i.id, i.name, i.type, i.uom, i.reorder_level,
    loc.id, loc.name, loc.type;

-- Create unique index on the materialized view
CREATE UNIQUE INDEX idx_mv_inventory_on_hand_unique 
ON mv_inventory_on_hand (workspace_id, item_id, location_id);

-- ============================================================================
-- BATCH SUMMARY VIEW
-- ============================================================================

CREATE MATERIALIZED VIEW mv_batch_summary AS
WITH batch_costs AS (
    SELECT 
        b.id as batch_id,
        b.workspace_id,
        -- Ingredient costs from consumption
        COALESCE(
            (SELECT SUM(it.quantity * COALESCE(il.unit_cost, 0))
             FROM inventory_transactions it
             JOIN item_lots il ON il.id = it.item_lot_id
             WHERE it.ref_type = 'batch' 
               AND it.ref_id = b.id
               AND it.type = 'consume'), 
            0
        ) as ingredient_cost,
        -- Packaging costs from packaging runs
        COALESCE(
            (SELECT SUM(prs.volume_liters / b.actual_volume * pr.total_cost)
             FROM packaging_run_sources prs
             JOIN packaging_runs pr ON pr.id = prs.packaging_run_id
             WHERE prs.batch_id = b.id),
            0
        ) as packaging_cost
    FROM batches b
),
batch_yields AS (
    SELECT 
        b.id as batch_id,
        b.workspace_id,
        -- Calculate total packaged volume
        COALESCE(
            (SELECT SUM(prs.volume_liters)
             FROM packaging_run_sources prs
             WHERE prs.batch_id = b.id),
            0
        ) as packaged_liters,
        -- Calculate yield percentage
        CASE 
            WHEN b.actual_volume > 0 THEN
                COALESCE(
                    (SELECT SUM(prs.volume_liters) * 100.0 / b.actual_volume
                     FROM packaging_run_sources prs
                     WHERE prs.batch_id = b.id),
                    0
                )
            ELSE 0
        END as yield_percentage
    FROM batches b
)
SELECT 
    b.workspace_id,
    b.id as batch_id,
    b.batch_number,
    r.name as recipe_name,
    r.style,
    b.status,
    b.target_volume,
    b.actual_volume,
    b.og_target,
    b.og_actual,
    b.fg_target,
    b.fg_actual,
    b.abv_target,
    b.abv_actual,
    b.brew_date,
    b.package_date,
    b.created_at,
    -- Cost breakdown
    bc.ingredient_cost,
    bc.packaging_cost,
    bc.ingredient_cost + bc.packaging_cost as total_cost,
    CASE 
        WHEN by.packaged_liters > 0 THEN
            (bc.ingredient_cost + bc.packaging_cost) / by.packaged_liters
        ELSE 0
    END as cost_per_liter,
    -- Yield data
    by.packaged_liters,
    by.yield_percentage,
    -- Duration calculations
    CASE 
        WHEN b.package_date IS NOT NULL AND b.brew_date IS NOT NULL THEN
            b.package_date - b.brew_date
        ELSE NULL
    END as total_duration_days,
    -- Fermentation readings count
    (SELECT COUNT(*) FROM ferm_readings fr WHERE fr.batch_id = b.id) as reading_count,
    -- Owner entity for contract brewing
    oe.name as owner_name
FROM batches b
LEFT JOIN recipes r ON r.id = b.recipe_id
LEFT JOIN batch_costs bc ON bc.batch_id = b.id
LEFT JOIN batch_yields by ON by.batch_id = b.id
LEFT JOIN ownership_entities oe ON oe.id = b.owner_entity_id;

-- Create index for performance
CREATE INDEX idx_mv_batch_summary_workspace ON mv_batch_summary (workspace_id);
CREATE INDEX idx_mv_batch_summary_status ON mv_batch_summary (workspace_id, status);
CREATE INDEX idx_mv_batch_summary_dates ON mv_batch_summary (workspace_id, brew_date, package_date);

-- ============================================================================
-- PRODUCTION SUMMARY VIEW (Last 30 days)
-- ============================================================================

CREATE MATERIALIZED VIEW mv_production_summary AS
WITH date_range AS (
    SELECT 
        CURRENT_DATE - INTERVAL '30 days' as start_date,
        CURRENT_DATE as end_date
),
production_stats AS (
    SELECT 
        b.workspace_id,
        -- Brewed this period
        COUNT(CASE WHEN b.brew_date >= dr.start_date THEN 1 END) as batches_brewed,
        SUM(CASE WHEN b.brew_date >= dr.start_date THEN b.actual_volume END) as volume_brewed,
        -- Packaged this period  
        COUNT(CASE WHEN b.package_date >= dr.start_date THEN 1 END) as batches_packaged,
        SUM(CASE 
            WHEN b.package_date >= dr.start_date THEN
                (SELECT SUM(prs.volume_liters) 
                 FROM packaging_run_sources prs 
                 WHERE prs.batch_id = b.id)
            END) as volume_packaged,
        -- Currently in process
        COUNT(CASE WHEN b.status IN ('brewing', 'fermenting') THEN 1 END) as active_batches,
        COUNT(CASE WHEN b.status = 'conditioning' THEN 1 END) as conditioning_batches,
        COUNT(CASE WHEN b.status = 'ready_to_package' THEN 1 END) as ready_to_package,
        -- By style breakdown
        jsonb_object_agg(
            COALESCE(r.style, 'Unknown'),
            COUNT(CASE WHEN b.brew_date >= dr.start_date THEN 1 END)
        ) FILTER (WHERE b.brew_date >= dr.start_date) as style_breakdown
    FROM batches b
    LEFT JOIN recipes r ON r.id = b.recipe_id
    CROSS JOIN date_range dr
    GROUP BY b.workspace_id
),
tank_usage AS (
    SELECT 
        t.workspace_id,
        COUNT(t.id) as total_tanks,
        COUNT(CASE WHEN b.id IS NOT NULL THEN 1 END) as tanks_in_use,
        COUNT(CASE WHEN t.cip_status = 'clean' THEN 1 END) as tanks_clean,
        COUNT(CASE WHEN t.cip_status = 'dirty' THEN 1 END) as tanks_dirty,
        COUNT(CASE WHEN t.cip_status = 'in_progress' THEN 1 END) as tanks_cip_in_progress
    FROM tanks t
    LEFT JOIN batches b ON b.tank_id = t.id AND b.status IN ('brewing', 'fermenting', 'conditioning')
    GROUP BY t.workspace_id
)
SELECT 
    ps.workspace_id,
    ps.batches_brewed,
    ps.volume_brewed,
    ps.batches_packaged,
    ps.volume_packaged,
    ps.active_batches,
    ps.conditioning_batches,
    ps.ready_to_package,
    ps.style_breakdown,
    tu.total_tanks,
    tu.tanks_in_use,
    tu.tanks_clean,
    tu.tanks_dirty,
    tu.tanks_cip_in_progress,
    CASE 
        WHEN tu.total_tanks > 0 THEN
            (tu.tanks_in_use * 100.0 / tu.total_tanks)
        ELSE 0
    END as tank_utilization_pct
FROM production_stats ps
LEFT JOIN tank_usage tu ON tu.workspace_id = ps.workspace_id;

-- Create index
CREATE UNIQUE INDEX idx_mv_production_summary_workspace ON mv_production_summary (workspace_id);

-- ============================================================================
-- PO AGING AND SUPPLIER TRENDS
-- ============================================================================

CREATE MATERIALIZED VIEW mv_po_aging AS
WITH po_summary AS (
    SELECT 
        po.workspace_id,
        po.id as po_id,
        po.po_number,
        v.name as vendor_name,
        po.status,
        po.order_date,
        po.expected_delivery_date,
        po.created_at,
        -- Days since order
        CURRENT_DATE - po.order_date as days_since_order,
        -- Days overdue (if past expected delivery)
        CASE 
            WHEN po.expected_delivery_date < CURRENT_DATE AND po.status NOT IN ('received', 'closed') THEN
                CURRENT_DATE - po.expected_delivery_date
            ELSE 0
        END as days_overdue,
        -- Total value
        (SELECT SUM(pol.qty * pol.expected_unit_cost) 
         FROM po_lines pol 
         WHERE pol.po_id = po.id) as total_value,
        -- Received value
        (SELECT SUM(prl.qty_received * prl.unit_cost)
         FROM po_receipt_lines prl
         JOIN po_lines pol ON pol.id = prl.po_line_id
         WHERE pol.po_id = po.id) as received_value,
        -- Line count
        (SELECT COUNT(*) FROM po_lines pol WHERE pol.po_id = po.id) as line_count,
        -- Received line count
        (SELECT COUNT(DISTINCT pol.id) 
         FROM po_lines pol 
         JOIN po_receipt_lines prl ON prl.po_line_id = pol.id
         WHERE pol.po_id = po.id) as received_line_count
    FROM purchase_orders po
    JOIN vendors v ON v.id = po.vendor_id
)
SELECT 
    workspace_id,
    po_id,
    po_number,
    vendor_name,
    status,
    order_date,
    expected_delivery_date,
    days_since_order,
    days_overdue,
    total_value,
    received_value,
    COALESCE(total_value - received_value, total_value) as outstanding_value,
    line_count,
    received_line_count,
    CASE 
        WHEN line_count > 0 THEN
            (received_line_count * 100.0 / line_count)
        ELSE 0
    END as completion_pct,
    -- Age category
    CASE 
        WHEN days_since_order <= 7 THEN 'new'
        WHEN days_since_order <= 14 THEN 'recent'
        WHEN days_since_order <= 30 THEN 'aging'
        ELSE 'old'
    END as age_category,
    -- Overdue status
    days_overdue > 0 as is_overdue
FROM po_summary;

-- Create indexes
CREATE INDEX idx_mv_po_aging_workspace ON mv_po_aging (workspace_id);
CREATE INDEX idx_mv_po_aging_status ON mv_po_aging (workspace_id, status);
CREATE INDEX idx_mv_po_aging_vendor ON mv_po_aging (workspace_id, vendor_name);
CREATE INDEX idx_mv_po_aging_overdue ON mv_po_aging (workspace_id, is_overdue);

-- ============================================================================
-- SUPPLIER PRICE TRENDS
-- ============================================================================

CREATE MATERIALIZED VIEW mv_supplier_price_trends AS
WITH price_history AS (
    SELECT 
        sph.workspace_id,
        sph.item_id,
        i.name as item_name,
        i.type as item_type,
        sph.vendor_id,
        v.name as vendor_name,
        sph.receipt_date,
        sph.unit_cost,
        -- Calculate price change vs previous receipt
        LAG(sph.unit_cost) OVER (
            PARTITION BY sph.workspace_id, sph.item_id, sph.vendor_id 
            ORDER BY sph.receipt_date
        ) as prev_unit_cost,
        -- Calculate days since last receipt
        LAG(sph.receipt_date) OVER (
            PARTITION BY sph.workspace_id, sph.item_id, sph.vendor_id 
            ORDER BY sph.receipt_date
        ) as prev_receipt_date
    FROM supplier_price_history sph
    JOIN items i ON i.id = sph.item_id
    JOIN vendors v ON v.id = sph.vendor_id
    WHERE sph.receipt_date >= CURRENT_DATE - INTERVAL '365 days'  -- Last year
)
SELECT 
    workspace_id,
    item_id,
    item_name,
    item_type,
    vendor_id,
    vendor_name,
    -- Current pricing
    (SELECT unit_cost 
     FROM price_history ph2 
     WHERE ph2.workspace_id = ph.workspace_id 
       AND ph2.item_id = ph.item_id 
       AND ph2.vendor_id = ph.vendor_id 
     ORDER BY receipt_date DESC 
     LIMIT 1) as current_price,
    -- Average price last 30 days
    (SELECT AVG(unit_cost) 
     FROM price_history ph2 
     WHERE ph2.workspace_id = ph.workspace_id 
       AND ph2.item_id = ph.item_id 
       AND ph2.vendor_id = ph.vendor_id 
       AND receipt_date >= CURRENT_DATE - INTERVAL '30 days') as avg_price_30d,
    -- Average price last 90 days
    (SELECT AVG(unit_cost) 
     FROM price_history ph2 
     WHERE ph2.workspace_id = ph.workspace_id 
       AND ph2.item_id = ph.item_id 
       AND ph2.vendor_id = ph.vendor_id 
       AND receipt_date >= CURRENT_DATE - INTERVAL '90 days') as avg_price_90d,
    -- Price volatility (standard deviation)
    (SELECT STDDEV(unit_cost) 
     FROM price_history ph2 
     WHERE ph2.workspace_id = ph.workspace_id 
       AND ph2.item_id = ph.item_id 
       AND ph2.vendor_id = ph.vendor_id 
       AND receipt_date >= CURRENT_DATE - INTERVAL '90 days') as price_volatility,
    -- Min/Max in period
    (SELECT MIN(unit_cost) 
     FROM price_history ph2 
     WHERE ph2.workspace_id = ph.workspace_id 
       AND ph2.item_id = ph.item_id 
       AND ph2.vendor_id = ph.vendor_id 
       AND receipt_date >= CURRENT_DATE - INTERVAL '90 days') as min_price_90d,
    (SELECT MAX(unit_cost) 
     FROM price_history ph2 
     WHERE ph2.workspace_id = ph.workspace_id 
       AND ph2.item_id = ph.item_id 
       AND ph2.vendor_id = ph.vendor_id 
       AND receipt_date >= CURRENT_DATE - INTERVAL '90 days') as max_price_90d,
    -- Count of receipts
    (SELECT COUNT(*) 
     FROM price_history ph2 
     WHERE ph2.workspace_id = ph.workspace_id 
       AND ph2.item_id = ph.item_id 
       AND ph2.vendor_id = ph.vendor_id 
       AND receipt_date >= CURRENT_DATE - INTERVAL '90 days') as receipt_count_90d,
    -- Last receipt date
    (SELECT MAX(receipt_date) 
     FROM price_history ph2 
     WHERE ph2.workspace_id = ph.workspace_id 
       AND ph2.item_id = ph.item_id 
       AND ph2.vendor_id = ph.vendor_id) as last_receipt_date
FROM price_history ph
GROUP BY workspace_id, item_id, item_name, item_type, vendor_id, vendor_name;

-- Create indexes
CREATE UNIQUE INDEX idx_mv_supplier_price_trends_unique 
ON mv_supplier_price_trends (workspace_id, item_id, vendor_id);

-- ============================================================================
-- KEG DEPOSIT SUMMARY
-- ============================================================================

CREATE MATERIALIZED VIEW mv_keg_deposit_summary AS
WITH deposit_balance AS (
    SELECT 
        kde.workspace_id,
        kde.sku_id,
        fs.code as sku_code,
        fs.size_ml,
        kde.customer_id,
        c.name as customer_name,
        -- Total deposits charged
        SUM(CASE WHEN kde.direction = 'charged' THEN kde.qty ELSE 0 END) as total_charged,
        SUM(CASE WHEN kde.direction = 'charged' THEN kde.amount ELSE 0 END) as total_charged_amount,
        -- Total deposits returned
        SUM(CASE WHEN kde.direction = 'returned' THEN kde.qty ELSE 0 END) as total_returned,
        SUM(CASE WHEN kde.direction = 'returned' THEN kde.amount ELSE 0 END) as total_returned_amount,
        -- Net outstanding
        SUM(CASE 
            WHEN kde.direction = 'charged' THEN kde.qty 
            WHEN kde.direction = 'returned' THEN -kde.qty 
            ELSE 0 
        END) as kegs_outstanding,
        SUM(CASE 
            WHEN kde.direction = 'charged' THEN kde.amount 
            WHEN kde.direction = 'returned' THEN -kde.amount 
            ELSE 0 
        END) as liability_amount,
        -- Latest activity
        MAX(kde.created_at) as last_activity
    FROM keg_deposit_entries kde
    LEFT JOIN finished_skus fs ON fs.id = kde.sku_id
    LEFT JOIN customers c ON c.id = kde.customer_id
    GROUP BY kde.workspace_id, kde.sku_id, fs.code, fs.size_ml, kde.customer_id, c.name
)
SELECT 
    workspace_id,
    sku_id,
    sku_code,
    size_ml,
    customer_id,
    customer_name,
    total_charged,
    total_charged_amount,
    total_returned,
    total_returned_amount,
    kegs_outstanding,
    liability_amount,
    last_activity,
    -- Age categories for outstanding deposits
    CASE 
        WHEN kegs_outstanding <= 0 THEN 'none'
        WHEN last_activity >= CURRENT_DATE - INTERVAL '30 days' THEN 'recent'
        WHEN last_activity >= CURRENT_DATE - INTERVAL '90 days' THEN 'aging'
        ELSE 'old'
    END as aging_category
FROM deposit_balance
WHERE kegs_outstanding != 0 OR total_charged > 0;  -- Only include active deposit relationships

-- Create indexes
CREATE INDEX idx_mv_keg_deposit_workspace ON mv_keg_deposit_summary (workspace_id);
CREATE INDEX idx_mv_keg_deposit_customer ON mv_keg_deposit_summary (workspace_id, customer_id);
CREATE INDEX idx_mv_keg_deposit_sku ON mv_keg_deposit_summary (workspace_id, sku_id);
CREATE INDEX idx_mv_keg_deposit_outstanding ON mv_keg_deposit_summary (workspace_id, kegs_outstanding);

-- ============================================================================
-- REFRESH FUNCTION FOR ALL MATERIALIZED VIEWS
-- ============================================================================

CREATE OR REPLACE FUNCTION refresh_reporting_views()
RETURNS VOID AS $$
BEGIN
    -- Log the refresh operation
    INSERT INTO ui_events (event_name, workspace_id, entity_type)
    SELECT 'reporting_views_refreshed', id, 'system'
    FROM workspaces;
    
    -- Refresh all materialized views concurrently
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_inventory_on_hand;
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_batch_summary;  
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_production_summary;
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_po_aging;
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_supplier_price_trends;
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_keg_deposit_summary;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION refresh_reporting_views TO authenticated;

-- Create a function that can be called by cron to refresh views
CREATE OR REPLACE FUNCTION scheduled_view_refresh()
RETURNS VOID AS $$
BEGIN
    PERFORM refresh_reporting_views();
    
    -- Log successful refresh
    INSERT INTO ui_events (
        event_name, 
        workspace_id, 
        entity_type,
        duration_ms
    ) 
    SELECT 
        'scheduled_view_refresh_completed',
        id,
        'system',
        EXTRACT(EPOCH FROM (NOW() - NOW())) * 1000
    FROM workspaces;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Schedule the refresh to run every hour
SELECT cron.schedule('refresh-reporting-views', '0 * * * *', 'SELECT scheduled_view_refresh();');

-- ============================================================================
-- UTILITY FUNCTIONS FOR REPORTING
-- ============================================================================

-- Function to get dashboard stats for a specific role
CREATE OR REPLACE FUNCTION get_dashboard_stats(
    p_workspace_id UUID,
    p_role TEXT
)
RETURNS JSONB AS $$
DECLARE
    v_stats JSONB := '{}'::jsonb;
    v_temp RECORD;
BEGIN
    -- Check permissions
    IF NOT (get_jwt_workspace_id() = p_workspace_id) THEN
        RAISE EXCEPTION 'Insufficient permissions';
    END IF;
    
    IF p_role IN ('admin', 'accounting') THEN
        -- Get inventory value
        SELECT COALESCE(SUM(total_value), 0) as inventory_value
        INTO v_temp
        FROM mv_inventory_on_hand
        WHERE workspace_id = p_workspace_id;
        
        v_stats := v_stats || jsonb_build_object('inventory_value', v_temp.inventory_value);
        
        -- Get production stats
        SELECT 
            batches_brewed,
            volume_brewed,
            active_batches,
            tank_utilization_pct
        INTO v_temp
        FROM mv_production_summary
        WHERE workspace_id = p_workspace_id;
        
        v_stats := v_stats || jsonb_build_object(
            'monthly_production_bbls', COALESCE(v_temp.volume_brewed, 0) / 117.348,
            'active_batches', COALESCE(v_temp.active_batches, 0),
            'tank_utilization', COALESCE(v_temp.tank_utilization_pct, 0)
        );
        
        -- Get open POs
        SELECT COUNT(*) as open_pos
        INTO v_temp
        FROM mv_po_aging
        WHERE workspace_id = p_workspace_id 
          AND status NOT IN ('received', 'closed');
        
        v_stats := v_stats || jsonb_build_object('open_pos', v_temp.open_pos);
        
        -- Get compliance status (placeholder)
        v_stats := v_stats || jsonb_build_object('compliance_status', 'Current');
        
    ELSIF p_role = 'brewer' THEN
        -- Brewer-specific stats (no costs)
        SELECT 
            active_batches,
            conditioning_batches,
            ready_to_package,
            tanks_in_use,
            total_tanks
        INTO v_temp
        FROM mv_production_summary
        WHERE workspace_id = p_workspace_id;
        
        v_stats := jsonb_build_object(
            'active_batches', COALESCE(v_temp.active_batches, 0),
            'conditioning_batches', COALESCE(v_temp.conditioning_batches, 0),
            'ready_to_package', COALESCE(v_temp.ready_to_package, 0),
            'tanks_in_use', COALESCE(v_temp.tanks_in_use, 0),
            'total_tanks', COALESCE(v_temp.total_tanks, 0)
        );
        
        -- Get readings due (simplified)
        SELECT COUNT(*) as readings_due
        INTO v_temp
        FROM batches b
        WHERE b.workspace_id = p_workspace_id
          AND b.status IN ('fermenting', 'conditioning')
          AND NOT EXISTS (
              SELECT 1 FROM ferm_readings fr 
              WHERE fr.batch_id = b.id 
                AND fr.reading_at >= CURRENT_DATE
          );
        
        v_stats := v_stats || jsonb_build_object('readings_due', v_temp.readings_due);
        
    ELSIF p_role = 'inventory' THEN
        -- Inventory-specific stats
        SELECT COUNT(*) as low_stock_items
        INTO v_temp
        FROM mv_inventory_on_hand
        WHERE workspace_id = p_workspace_id 
          AND below_reorder_level = true;
        
        v_stats := jsonb_build_object('low_stock_items', v_temp.low_stock_items);
        
        -- Pending receiving
        SELECT COUNT(*) as pending_receiving
        INTO v_temp
        FROM mv_po_aging
        WHERE workspace_id = p_workspace_id 
          AND status = 'approved';
        
        v_stats := v_stats || jsonb_build_object('pending_receiving', v_temp.pending_receiving);
        
        -- Open POs
        SELECT COUNT(*) as open_pos
        INTO v_temp
        FROM mv_po_aging
        WHERE workspace_id = p_workspace_id 
          AND status NOT IN ('received', 'closed');
        
        v_stats := v_stats || jsonb_build_object('open_pos', v_temp.open_pos);
        
    END IF;
    
    RETURN v_stats;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION get_dashboard_stats TO authenticated;

-- ============================================================================
-- RLS POLICIES FOR MATERIALIZED VIEWS
-- ============================================================================

-- Enable RLS on all materialized views
ALTER MATERIALIZED VIEW mv_inventory_on_hand ENABLE ROW LEVEL SECURITY;
ALTER MATERIALIZED VIEW mv_batch_summary ENABLE ROW LEVEL SECURITY;
ALTER MATERIALIZED VIEW mv_production_summary ENABLE ROW LEVEL SECURITY;
ALTER MATERIALIZED VIEW mv_po_aging ENABLE ROW LEVEL SECURITY;
ALTER MATERIALIZED VIEW mv_supplier_price_trends ENABLE ROW LEVEL SECURITY;
ALTER MATERIALIZED VIEW mv_keg_deposit_summary ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for workspace isolation
CREATE POLICY tenant_isolation ON mv_inventory_on_hand
    FOR ALL USING (workspace_id = get_jwt_workspace_id());

CREATE POLICY tenant_isolation ON mv_batch_summary
    FOR ALL USING (workspace_id = get_jwt_workspace_id());

CREATE POLICY tenant_isolation ON mv_production_summary
    FOR ALL USING (workspace_id = get_jwt_workspace_id());

CREATE POLICY tenant_isolation ON mv_po_aging
    FOR ALL USING (workspace_id = get_jwt_workspace_id());

CREATE POLICY tenant_isolation ON mv_supplier_price_trends
    FOR ALL USING (workspace_id = get_jwt_workspace_id());

CREATE POLICY tenant_isolation ON mv_keg_deposit_summary
    FOR ALL USING (workspace_id = get_jwt_workspace_id());

-- Cost visibility policies (hide costs from brewer role)
CREATE POLICY cost_visibility ON mv_inventory_on_hand
    FOR SELECT USING (
        workspace_id = get_jwt_workspace_id() 
        AND (has_cost_visibility() OR (avg_unit_cost IS NULL AND total_value IS NULL))
    );

CREATE POLICY cost_visibility ON mv_batch_summary
    FOR SELECT USING (
        workspace_id = get_jwt_workspace_id()
        AND (has_cost_visibility() OR (ingredient_cost IS NULL AND packaging_cost IS NULL AND total_cost IS NULL))
    );

CREATE POLICY cost_visibility ON mv_po_aging
    FOR SELECT USING (
        workspace_id = get_jwt_workspace_id()
        AND (has_cost_visibility() OR (total_value IS NULL AND received_value IS NULL))
    );

CREATE POLICY cost_visibility ON mv_supplier_price_trends
    FOR SELECT USING (
        workspace_id = get_jwt_workspace_id()
        AND has_cost_visibility()
    );
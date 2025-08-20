-- ============================================================================
-- Phase 8: Comprehensive Reporting and Dashboard Views (CORRECTED)
-- Creating materialized views and functions for reporting, dashboards, and recall drill
-- ============================================================================

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
            (SELECT SUM(ABS(it.qty)) 
             FROM inventory_transactions it 
             WHERE it.item_lot_id = il.id 
               AND it.type IN ('consume', 'ship', 'destroy', 'transfer')),
            0
        ) as consumed_qty,
        -- Calculate remaining quantity
        il.qty - COALESCE(
            (SELECT SUM(ABS(it.qty)) 
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
            (SELECT SUM(ABS(it.qty) * COALESCE(il.unit_cost, 0))
             FROM inventory_transactions it
             JOIN item_lots il ON il.id = it.item_lot_id
             JOIN items i ON i.id = il.item_id
             WHERE it.ref_type = 'batch' 
               AND it.ref_id::text = b.id::text
               AND it.type = 'consume'
               AND i.type = 'raw'),
            0
        ) as ingredient_cost,
        -- Packaging costs from packaging materials consumption
        COALESCE(
            (SELECT SUM(ABS(it.qty) * COALESCE(il.unit_cost, 0))
             FROM inventory_transactions it
             JOIN item_lots il ON il.id = it.item_lot_id
             JOIN items i ON i.id = il.item_id
             JOIN packaging_run_sources prs ON prs.batch_id = b.id
             JOIN packaging_runs pr ON pr.id = prs.packaging_run_id
             WHERE it.ref_type = 'packaging_run' 
               AND it.ref_id::text = pr.id::text
               AND it.type = 'consume'
               AND i.type = 'packaging'),
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
    b.target_og,
    b.actual_og,
    b.target_fg,
    b.actual_fg,
    b.actual_abv,
    b.brew_date,
    by.packaged_liters,
    by.yield_percentage,
    bc.ingredient_cost,
    bc.packaging_cost,
    (bc.ingredient_cost + bc.packaging_cost) as total_cost,
    CASE 
        WHEN by.packaged_liters > 0 THEN (bc.ingredient_cost + bc.packaging_cost) / by.packaged_liters
        ELSE NULL
    END as cost_per_liter,
    -- Calculate total duration in days
    CASE 
        WHEN b.brew_date IS NOT NULL AND b.status IN ('closed', 'packaged') THEN
            EXTRACT(DAYS FROM (COALESCE(
                (SELECT MAX(pr.packaging_date) 
                 FROM packaging_runs pr
                 JOIN packaging_run_sources prs ON prs.packaging_run_id = pr.id
                 WHERE prs.batch_id = b.id),
                CURRENT_DATE
            ) - b.brew_date))
        ELSE NULL
    END as total_duration_days
FROM batches b
JOIN recipe_versions rv ON rv.id = b.recipe_version_id
JOIN recipes r ON r.id = rv.recipe_id
JOIN batch_costs bc ON bc.batch_id = b.id AND bc.workspace_id = b.workspace_id
JOIN batch_yields by ON by.batch_id = b.id AND by.workspace_id = b.workspace_id;

-- Index for performance
CREATE INDEX idx_mv_batch_summary_workspace ON mv_batch_summary (workspace_id);
CREATE INDEX idx_mv_batch_summary_status ON mv_batch_summary (workspace_id, status);

-- ============================================================================
-- PRODUCTION SUMMARY VIEW 
-- ============================================================================

CREATE MATERIALIZED VIEW mv_production_summary AS
SELECT 
    b.workspace_id,
    COUNT(*) as total_batches,
    COUNT(CASE WHEN b.status IN ('brewing', 'fermenting') THEN 1 END) as active_batches,
    COUNT(CASE WHEN b.status = 'conditioning' THEN 1 END) as conditioning_batches,
    COUNT(CASE WHEN b.status = 'conditioning' THEN 1 END) as ready_to_package,
    COALESCE(SUM(b.actual_volume), 0) as total_volume_produced,
    COALESCE(SUM(CASE WHEN b.brew_date >= CURRENT_DATE - INTERVAL '30 days' THEN b.actual_volume END), 0) as monthly_production_bbls,
    -- Tank utilization
    (SELECT COUNT(*) FROM tanks t WHERE t.workspace_id = b.workspace_id AND EXISTS(
        SELECT 1 FROM batches b2 WHERE b2.tank_id = t.id AND b2.status IN ('brewing', 'fermenting', 'conditioning')
    )) as tanks_in_use,
    (SELECT COUNT(*) FROM tanks t WHERE t.workspace_id = b.workspace_id) as total_tanks,
    CASE 
        WHEN (SELECT COUNT(*) FROM tanks t WHERE t.workspace_id = b.workspace_id) > 0 THEN
            (SELECT COUNT(*) FROM tanks t WHERE t.workspace_id = b.workspace_id AND EXISTS(
                SELECT 1 FROM batches b2 WHERE b2.tank_id = t.id AND b2.status IN ('brewing', 'fermenting', 'conditioning')
            )) * 100.0 / (SELECT COUNT(*) FROM tanks t WHERE t.workspace_id = b.workspace_id)
        ELSE 0
    END as tank_utilization
FROM batches b
GROUP BY b.workspace_id;

-- Index for performance
CREATE UNIQUE INDEX idx_mv_production_summary_workspace ON mv_production_summary (workspace_id);

-- ============================================================================
-- PO AGING VIEW
-- ============================================================================

CREATE MATERIALIZED VIEW mv_po_aging AS
SELECT 
    po.workspace_id,
    po.id as po_id,
    po.po_number,
    v.name as vendor_name,
    po.status,
    po.order_date,
    po.due_date as expected_delivery_date,
    (CURRENT_DATE - po.order_date) as days_since_order,
    CASE 
        WHEN po.due_date IS NOT NULL AND CURRENT_DATE > po.due_date THEN 
            (CURRENT_DATE - po.due_date)
        ELSE 0
    END as days_overdue,
    COALESCE(
        (SELECT SUM(pol.qty * pol.expected_unit_cost) 
         FROM po_lines pol WHERE pol.po_id = po.id), 
        0
    ) as total_value,
    COALESCE(
        (SELECT SUM(prl.qty_received * prl.unit_cost) 
         FROM po_lines pol
         JOIN po_receipt_lines prl ON prl.po_line_id = pol.id
         WHERE pol.po_id = po.id), 
        0
    ) as received_value,
    COALESCE(
        (SELECT SUM(pol.qty * pol.expected_unit_cost) - SUM(prl.qty_received * prl.unit_cost)
         FROM po_lines pol
         LEFT JOIN po_receipt_lines prl ON prl.po_line_id = pol.id
         WHERE pol.po_id = po.id), 
        0
    ) as outstanding_value,
    CASE 
        WHEN (SELECT SUM(pol.qty) FROM po_lines pol WHERE pol.po_id = po.id) > 0 THEN
            COALESCE(
                (SELECT SUM(prl.qty_received) * 100.0 / SUM(pol.qty)
                 FROM po_lines pol
                 LEFT JOIN po_receipt_lines prl ON prl.po_line_id = pol.id
                 WHERE pol.po_id = po.id), 
                0
            )
        ELSE 0
    END as completion_pct,
    CASE 
        WHEN po.due_date IS NULL THEN 'no_date'
        WHEN CURRENT_DATE > po.due_date + INTERVAL '14 days' THEN 'severely_overdue'
        WHEN CURRENT_DATE > po.due_date THEN 'overdue'
        WHEN CURRENT_DATE > po.due_date - INTERVAL '7 days' THEN 'due_soon'
        ELSE 'on_time'
    END as age_category
FROM purchase_orders po
JOIN vendors v ON v.id = po.vendor_id;

-- Index for performance
CREATE INDEX idx_mv_po_aging_workspace ON mv_po_aging (workspace_id);
CREATE INDEX idx_mv_po_aging_status ON mv_po_aging (workspace_id, status);

-- ============================================================================
-- SUPPLIER PRICE TRENDS VIEW
-- ============================================================================

CREATE MATERIALIZED VIEW mv_supplier_price_trends AS
WITH price_history AS (
    SELECT 
        sph.workspace_id,
        sph.item_id,
        sph.vendor_id,
        i.name as item_name,
        i.type as item_type,
        v.name as supplier_name,
        sph.unit_cost as price,
        sph.receipt_date,
        ROW_NUMBER() OVER (PARTITION BY sph.item_id, sph.vendor_id ORDER BY sph.receipt_date DESC) as price_rank
    FROM supplier_price_history sph
    JOIN items i ON i.id = sph.item_id
    JOIN vendors v ON v.id = sph.vendor_id
),
latest_prices AS (
    SELECT *
    FROM price_history 
    WHERE price_rank = 1
),
previous_prices AS (
    SELECT *
    FROM price_history 
    WHERE price_rank = 2
)
SELECT 
    lp.workspace_id,
    lp.item_id,
    lp.vendor_id,
    lp.supplier_name,
    lp.item_name,
    lp.item_type,
    lp.price as latest_price,
    pp.price as previous_price,
    CASE 
        WHEN pp.price IS NOT NULL AND pp.price > 0 THEN
            ((lp.price - pp.price) * 100.0 / pp.price)
        ELSE NULL
    END as price_change_pct,
    CASE 
        WHEN pp.price IS NOT NULL AND pp.price > 0 THEN
            CASE 
                WHEN lp.price > pp.price * 1.01 THEN 'up'
                WHEN lp.price < pp.price * 0.99 THEN 'down'
                ELSE 'stable'
            END
        ELSE NULL
    END as price_change_direction,
    (SELECT COUNT(*) FROM price_history ph WHERE ph.item_id = lp.item_id AND ph.vendor_id = lp.vendor_id) as receipt_count,
    (SELECT MIN(receipt_date) FROM price_history ph WHERE ph.item_id = lp.item_id AND ph.vendor_id = lp.vendor_id) as first_receipt_date,
    lp.receipt_date as latest_receipt_date,
    CASE 
        WHEN (SELECT STDDEV(price) FROM price_history ph WHERE ph.item_id = lp.item_id AND ph.vendor_id = lp.vendor_id) / NULLIF(lp.price, 0) > 0.2 THEN 'high'
        WHEN (SELECT STDDEV(price) FROM price_history ph WHERE ph.item_id = lp.item_id AND ph.vendor_id = lp.vendor_id) / NULLIF(lp.price, 0) > 0.1 THEN 'medium'
        ELSE 'low'
    END as price_volatility
FROM latest_prices lp
LEFT JOIN previous_prices pp ON pp.item_id = lp.item_id AND pp.vendor_id = lp.vendor_id;

-- Index for performance
CREATE INDEX idx_mv_supplier_price_trends_workspace ON mv_supplier_price_trends (workspace_id);

-- ============================================================================
-- KEG DEPOSIT SUMMARY VIEW
-- ============================================================================

CREATE MATERIALIZED VIEW mv_keg_deposit_summary AS
SELECT 
    kde.workspace_id,
    kde.customer_id,
    COALESCE(kde.customer_id::TEXT, 'Walk-in Customer') as customer_name,
    fs.sku_code as sku_code,
    fs.name as sku_description,
    SUM(CASE WHEN kde.direction = 'charged' THEN kde.amount_cents / 100.0 ELSE 0 END) as total_charged,
    SUM(CASE WHEN kde.direction = 'returned' THEN kde.amount_cents / 100.0 ELSE 0 END) as total_returned,
    SUM(CASE WHEN kde.direction = 'charged' THEN kde.amount_cents / 100.0 ELSE -kde.amount_cents / 100.0 END) as outstanding_deposits,
    SUM(CASE WHEN kde.direction = 'charged' THEN kde.qty ELSE -kde.qty END) as outstanding_kegs,
    MAX(kde.created_at) as last_transaction_date,
    CASE 
        WHEN MAX(kde.created_at) < CURRENT_DATE - INTERVAL '90 days' AND SUM(CASE WHEN kde.direction = 'charged' THEN kde.amount_cents ELSE -kde.amount_cents END) > 0 THEN 'aging'
        WHEN MAX(kde.created_at) < CURRENT_DATE - INTERVAL '60 days' AND SUM(CASE WHEN kde.direction = 'charged' THEN kde.amount_cents ELSE -kde.amount_cents END) > 0 THEN 'overdue'
        ELSE 'current'
    END as liability_status
FROM keg_deposit_entries kde
JOIN finished_skus fs ON fs.id = kde.sku_id
GROUP BY kde.workspace_id, kde.customer_id, fs.id, fs.sku_code, fs.name
HAVING SUM(CASE WHEN kde.direction = 'charged' THEN kde.amount_cents ELSE -kde.amount_cents END) != 0;

-- Index for performance
CREATE INDEX idx_mv_keg_deposit_summary_workspace ON mv_keg_deposit_summary (workspace_id);

-- ============================================================================
-- REFRESH FUNCTIONS
-- ============================================================================

-- Function to refresh inventory materialized view
CREATE OR REPLACE FUNCTION refresh_inventory_materialized_view()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_inventory_on_hand;
    RETURN 'SUCCESS';
EXCEPTION
    WHEN OTHERS THEN
        RETURN 'ERROR: ' || SQLERRM;
END;
$$;

-- Function to refresh batch summary materialized view  
CREATE OR REPLACE FUNCTION refresh_batch_materialized_view()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_batch_summary;
    RETURN 'SUCCESS';
EXCEPTION
    WHEN OTHERS THEN
        RETURN 'ERROR: ' || SQLERRM;
END;
$$;

-- Function to refresh production summary materialized view
CREATE OR REPLACE FUNCTION refresh_production_materialized_view()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_production_summary;
    RETURN 'SUCCESS';
EXCEPTION
    WHEN OTHERS THEN
        RETURN 'ERROR: ' || SQLERRM;
END;
$$;

-- ============================================================================
-- AUTOMATED REFRESH TRIGGERS AND SCHEDULES
-- ============================================================================

-- Schedule materialized view refreshes (every 15 minutes for real-time feel)
-- NOTE: Commented out for local development - pg_cron extension not available
-- In production, these should be enabled with pg_cron extension
-- SELECT cron.schedule('refresh-inventory-views', '*/15 * * * *', 'SELECT refresh_inventory_materialized_view();');
-- SELECT cron.schedule('refresh-batch-views', '*/15 * * * *', 'SELECT refresh_batch_materialized_view();'); 
-- SELECT cron.schedule('refresh-production-views', '*/15 * * * *', 'SELECT refresh_production_materialized_view();');

-- ============================================================================
-- DASHBOARD STATS FUNCTION
-- ============================================================================

CREATE OR REPLACE FUNCTION get_dashboard_stats(p_workspace_id UUID, p_role TEXT)
RETURNS JSONB
AS $$
DECLARE
    v_stats JSONB := '{}'::jsonb;
    v_temp RECORD;
BEGIN
    -- Common stats for admin and accounting roles (with cost data)
    IF p_role IN ('admin', 'accounting') THEN
        -- Get inventory value and production metrics
        SELECT 
            COALESCE(SUM(total_value), 0) as inventory_value,
            COUNT(CASE WHEN below_reorder_level THEN 1 END) as low_stock_items
        INTO v_temp
        FROM mv_inventory_on_hand
        WHERE workspace_id = p_workspace_id;
        
        v_stats := jsonb_build_object(
            'inventory_value', v_temp.inventory_value,
            'low_stock_items', v_temp.low_stock_items
        );
        
        -- Get production metrics
        SELECT monthly_production_bbls, active_batches, tank_utilization, open_pos
        INTO v_temp  
        FROM mv_production_summary ps
        LEFT JOIN (
            SELECT workspace_id, COUNT(*) as open_pos
            FROM mv_po_aging  
            WHERE status NOT IN ('received', 'closed')
            GROUP BY workspace_id
        ) po ON po.workspace_id = ps.workspace_id
        WHERE ps.workspace_id = p_workspace_id;
        
        v_stats := v_stats || jsonb_build_object(
            'monthly_production_bbls', COALESCE(v_temp.monthly_production_bbls, 0),
            'active_batches', COALESCE(v_temp.active_batches, 0),
            'tank_utilization', COALESCE(v_temp.tank_utilization, 0),
            'open_pos', COALESCE(v_temp.open_pos, 0)
        );
        
        -- Add compliance status placeholder
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
        
    ELSIF p_role = 'inventory' THEN
        -- Inventory-specific stats
        SELECT COUNT(*) as low_stock_items
        INTO v_temp
        FROM mv_inventory_on_hand
        WHERE workspace_id = p_workspace_id 
          AND below_reorder_level = true;
        
        v_stats := jsonb_build_object('low_stock_items', v_temp.low_stock_items);
        
        -- Get inventory value (accessible to inventory role)
        SELECT COALESCE(SUM(total_value), 0) as inventory_value
        INTO v_temp
        FROM mv_inventory_on_hand
        WHERE workspace_id = p_workspace_id;
        
        v_stats := v_stats || jsonb_build_object('inventory_value', v_temp.inventory_value);
        
        -- Pending receiving and open POs
        SELECT COUNT(CASE WHEN status = 'approved' THEN 1 END) as pending_receiving,
               COUNT(CASE WHEN status NOT IN ('received', 'closed') THEN 1 END) as open_pos
        INTO v_temp
        FROM mv_po_aging
        WHERE workspace_id = p_workspace_id;
        
        v_stats := v_stats || jsonb_build_object(
            'pending_receiving', v_temp.pending_receiving,
            'open_pos', v_temp.open_pos
        );
        
    END IF;
    
    RETURN v_stats;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION get_dashboard_stats TO authenticated;
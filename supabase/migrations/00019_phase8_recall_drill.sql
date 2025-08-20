-- Phase 8: Recall Drill Functionality
-- Complex traceability functions for upstream and downstream tracking

-- ============================================================================
-- RECALL DRILL: UPSTREAM TRACING
-- From finished lot -> batches -> ingredient lots -> suppliers
-- ============================================================================

-- Function to trace upstream from a finished lot
CREATE OR REPLACE FUNCTION trace_upstream_from_finished_lot(
    p_finished_lot_id UUID
)
RETURNS TABLE (
    level_type TEXT,
    level_number INTEGER,
    entity_type TEXT,
    entity_id UUID,
    entity_name TEXT,
    entity_details JSONB,
    relationship_type TEXT,
    quantity_used NUMERIC,
    uom TEXT,
    date_used DATE,
    supplier_info JSONB
) AS $$
BEGIN
    -- Check permissions
    IF NOT (has_role('admin') OR has_role('accounting') OR has_role('inventory')) THEN
        RAISE EXCEPTION 'Insufficient permissions for recall operations';
    END IF;
    
    -- Level 0: The finished lot itself
    RETURN QUERY
    SELECT 
        'finished_product'::TEXT as level_type,
        0 as level_number,
        'finished_lot'::TEXT as entity_type,
        fl.id as entity_id,
        fs.code as entity_name,
        jsonb_build_object(
            'lot_code', fl.lot_code,
            'quantity', fl.quantity,
            'uom', fl.uom,
            'produced_at', fl.created_at,
            'sku_details', jsonb_build_object(
                'code', fs.code,
                'size_ml', fs.size_ml,
                'pack_config', fs.pack_config
            )
        ) as entity_details,
        'origin'::TEXT as relationship_type,
        fl.quantity,
        fl.uom,
        fl.created_at::DATE as date_used,
        NULL::JSONB as supplier_info
    FROM finished_lots fl
    JOIN finished_skus fs ON fs.id = fl.sku_id
    WHERE fl.id = p_finished_lot_id
      AND fl.workspace_id = get_jwt_workspace_id();
    
    -- Level 1: Source batches from packaging runs
    RETURN QUERY
    SELECT 
        'production'::TEXT as level_type,
        1 as level_number,
        'batch'::TEXT as entity_type,
        b.id as entity_id,
        b.batch_number as entity_name,
        jsonb_build_object(
            'recipe_name', r.name,
            'style', r.style,
            'brew_date', b.brew_date,
            'package_date', b.package_date,
            'actual_volume', b.actual_volume,
            'og_actual', b.og_actual,
            'fg_actual', b.fg_actual,
            'abv_actual', b.abv_actual,
            'status', b.status
        ) as entity_details,
        'packaging_source'::TEXT as relationship_type,
        prs.volume_liters,
        'liters'::TEXT as uom,
        pr.created_at::DATE as date_used,
        NULL::JSONB as supplier_info
    FROM finished_lots fl
    JOIN packaging_runs pr ON pr.sku_id = fl.sku_id
    JOIN packaging_run_sources prs ON prs.packaging_run_id = pr.id
    JOIN batches b ON b.id = prs.batch_id
    LEFT JOIN recipes r ON r.id = b.recipe_id
    WHERE fl.id = p_finished_lot_id
      AND fl.workspace_id = get_jwt_workspace_id();
    
    -- Level 2: Ingredient lots consumed in batches
    RETURN QUERY
    SELECT 
        'ingredients'::TEXT as level_type,
        2 as level_number,
        'ingredient_lot'::TEXT as entity_type,
        il.id as entity_id,
        i.name || ' (Lot: ' || il.lot_code || ')' as entity_name,
        jsonb_build_object(
            'item_name', i.name,
            'item_type', i.type,
            'lot_code', il.lot_code,
            'expiry', il.expiry,
            'original_qty', il.qty,
            'unit_cost', il.unit_cost
        ) as entity_details,
        'ingredient_consumption'::TEXT as relationship_type,
        ABS(it.quantity) as quantity_used,
        it.uom,
        it.created_at::DATE as date_used,
        jsonb_build_object(
            'vendor_name', v.name,
            'vendor_contact', v.contact_info
        ) as supplier_info
    FROM finished_lots fl
    JOIN packaging_runs pr ON pr.sku_id = fl.sku_id
    JOIN packaging_run_sources prs ON prs.packaging_run_id = pr.id
    JOIN inventory_transactions it ON it.ref_type = 'batch' AND it.ref_id = prs.batch_id
    JOIN item_lots il ON il.id = it.item_lot_id
    JOIN items i ON i.id = il.item_id
    LEFT JOIN vendors v ON v.id = i.vendor_id
    WHERE fl.id = p_finished_lot_id
      AND fl.workspace_id = get_jwt_workspace_id()
      AND it.type = 'consume';
    
    -- Level 3: Packaging materials consumed in packaging runs
    RETURN QUERY
    SELECT 
        'packaging'::TEXT as level_type,
        3 as level_number,
        'packaging_lot'::TEXT as entity_type,
        il.id as entity_id,
        i.name || ' (Lot: ' || il.lot_code || ')' as entity_name,
        jsonb_build_object(
            'item_name', i.name,
            'item_type', i.type,
            'lot_code', il.lot_code,
            'expiry', il.expiry,
            'original_qty', il.qty,
            'unit_cost', il.unit_cost
        ) as entity_details,
        'packaging_consumption'::TEXT as relationship_type,
        ABS(it.quantity) as quantity_used,
        it.uom,
        it.created_at::DATE as date_used,
        jsonb_build_object(
            'vendor_name', v.name,
            'vendor_contact', v.contact_info
        ) as supplier_info
    FROM finished_lots fl
    JOIN packaging_runs pr ON pr.sku_id = fl.sku_id
    JOIN inventory_transactions it ON it.ref_type = 'packaging_run' AND it.ref_id = pr.id
    JOIN item_lots il ON il.id = it.item_lot_id
    JOIN items i ON i.id = il.item_id
    LEFT JOIN vendors v ON v.id = i.vendor_id
    WHERE fl.id = p_finished_lot_id
      AND fl.workspace_id = get_jwt_workspace_id()
      AND it.type = 'consume'
      AND i.type = 'packaging';

END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- RECALL DRILL: DOWNSTREAM TRACING
-- From ingredient lot -> batches -> finished lots -> sales/removals
-- ============================================================================

-- Function to trace downstream from an ingredient lot
CREATE OR REPLACE FUNCTION trace_downstream_from_ingredient_lot(
    p_item_lot_id UUID
)
RETURNS TABLE (
    level_type TEXT,
    level_number INTEGER,
    entity_type TEXT,
    entity_id UUID,
    entity_name TEXT,
    entity_details JSONB,
    relationship_type TEXT,
    quantity_affected NUMERIC,
    uom TEXT,
    date_affected DATE,
    customer_info JSONB
) AS $$
BEGIN
    -- Check permissions
    IF NOT (has_role('admin') OR has_role('accounting') OR has_role('inventory')) THEN
        RAISE EXCEPTION 'Insufficient permissions for recall operations';
    END IF;
    
    -- Level 0: The ingredient lot itself
    RETURN QUERY
    SELECT 
        'ingredient'::TEXT as level_type,
        0 as level_number,
        'ingredient_lot'::TEXT as entity_type,
        il.id as entity_id,
        i.name || ' (Lot: ' || il.lot_code || ')' as entity_name,
        jsonb_build_object(
            'item_name', i.name,
            'item_type', i.type,
            'lot_code', il.lot_code,
            'quantity', il.qty,
            'uom', il.uom,
            'unit_cost', il.unit_cost,
            'expiry', il.expiry,
            'received_at', il.created_at
        ) as entity_details,
        'origin'::TEXT as relationship_type,
        il.qty,
        il.uom,
        il.created_at::DATE as date_affected,
        NULL::JSONB as customer_info
    FROM item_lots il
    JOIN items i ON i.id = il.item_id
    WHERE il.id = p_item_lot_id
      AND il.workspace_id = get_jwt_workspace_id();
    
    -- Level 1: Batches that consumed this ingredient lot
    RETURN QUERY
    SELECT 
        'production'::TEXT as level_type,
        1 as level_number,
        'batch'::TEXT as entity_type,
        b.id as entity_id,
        b.batch_number as entity_name,
        jsonb_build_object(
            'recipe_name', r.name,
            'style', r.style,
            'brew_date', b.brew_date,
            'package_date', b.package_date,
            'actual_volume', b.actual_volume,
            'status', b.status
        ) as entity_details,
        'ingredient_used_in_batch'::TEXT as relationship_type,
        ABS(it.quantity) as quantity_affected,
        it.uom,
        it.created_at::DATE as date_affected,
        NULL::JSONB as customer_info
    FROM item_lots il
    JOIN inventory_transactions it ON it.item_lot_id = il.id
    JOIN batches b ON b.id = it.ref_id AND it.ref_type = 'batch'
    LEFT JOIN recipes r ON r.id = b.recipe_id
    WHERE il.id = p_item_lot_id
      AND il.workspace_id = get_jwt_workspace_id()
      AND it.type = 'consume';
    
    -- Level 2: Finished lots produced from affected batches
    RETURN QUERY
    SELECT 
        'finished_product'::TEXT as level_type,
        2 as level_number,
        'finished_lot'::TEXT as entity_type,
        fl.id as entity_id,
        fs.code || ' (Lot: ' || fl.lot_code || ')' as entity_name,
        jsonb_build_object(
            'sku_code', fs.code,
            'lot_code', fl.lot_code,
            'quantity', fl.quantity,
            'uom', fl.uom,
            'produced_at', fl.created_at,
            'sku_details', jsonb_build_object(
                'size_ml', fs.size_ml,
                'pack_config', fs.pack_config
            )
        ) as entity_details,
        'batch_packaged_to_lot'::TEXT as relationship_type,
        fl.quantity as quantity_affected,
        fl.uom,
        fl.created_at::DATE as date_affected,
        NULL::JSONB as customer_info
    FROM item_lots il
    JOIN inventory_transactions it ON it.item_lot_id = il.id
    JOIN batches b ON b.id = it.ref_id AND it.ref_type = 'batch'
    JOIN packaging_run_sources prs ON prs.batch_id = b.id
    JOIN packaging_runs pr ON pr.id = prs.packaging_run_id
    JOIN finished_lots fl ON fl.sku_id = pr.sku_id
    JOIN finished_skus fs ON fs.id = fl.sku_id
    WHERE il.id = p_item_lot_id
      AND il.workspace_id = get_jwt_workspace_id()
      AND it.type = 'consume'
      -- Link finished lots that were created around the same time as the packaging run
      AND fl.created_at BETWEEN pr.created_at - INTERVAL '1 day' AND pr.created_at + INTERVAL '1 day';
    
    -- Level 3: Sales/removals of affected finished lots
    RETURN QUERY
    SELECT 
        'sales'::TEXT as level_type,
        3 as level_number,
        'removal'::TEXT as entity_type,
        r.id as entity_id,
        'Sale/Removal: ' || r.reason || ' (' || r.doc_ref || ')' as entity_name,
        jsonb_build_object(
            'reason', r.reason,
            'doc_ref', r.doc_ref,
            'destination_type', r.destination_type,
            'is_taxable', r.is_taxable,
            'barrels', r.barrels,
            'removal_date', r.removal_date
        ) as entity_details,
        'finished_lot_sold'::TEXT as relationship_type,
        r.qty as quantity_affected,
        r.uom,
        r.removal_date as date_affected,
        CASE 
            WHEN r.destination_type = 'distributor' THEN
                jsonb_build_object(
                    'type', 'distributor',
                    'reference', r.doc_ref
                )
            WHEN r.destination_type = 'taproom' THEN
                jsonb_build_object(
                    'type', 'taproom',
                    'reference', 'Direct consumption'
                )
            ELSE
                jsonb_build_object(
                    'type', 'other',
                    'reference', r.doc_ref
                )
        END as customer_info
    FROM item_lots il
    JOIN inventory_transactions it ON it.item_lot_id = il.id
    JOIN batches b ON b.id = it.ref_id AND it.ref_type = 'batch'
    JOIN packaging_run_sources prs ON prs.batch_id = b.id
    JOIN packaging_runs pr ON pr.id = prs.packaging_run_id
    JOIN finished_lots fl ON fl.sku_id = pr.sku_id
    JOIN removals r ON r.finished_lot_id = fl.id
    WHERE il.id = p_item_lot_id
      AND il.workspace_id = get_jwt_workspace_id()
      AND it.type = 'consume'
      AND fl.created_at BETWEEN pr.created_at - INTERVAL '1 day' AND pr.created_at + INTERVAL '1 day';

END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- RECALL DRILL: COMPREHENSIVE TRACE FROM ANY ENTITY
-- Single function that can trace from any type of entity
-- ============================================================================

CREATE OR REPLACE FUNCTION comprehensive_trace(
    p_entity_type TEXT,  -- 'finished_lot', 'batch', 'ingredient_lot', 'supplier'
    p_entity_id UUID,
    p_direction TEXT DEFAULT 'both'  -- 'upstream', 'downstream', 'both'
)
RETURNS TABLE (
    trace_direction TEXT,
    level_type TEXT,
    level_number INTEGER,
    entity_type TEXT,
    entity_id UUID,
    entity_name TEXT,
    entity_details JSONB,
    relationship_type TEXT,
    quantity NUMERIC,
    uom TEXT,
    date_related DATE,
    contact_info JSONB,
    risk_level TEXT
) AS $$
BEGIN
    -- Check permissions
    IF NOT (has_role('admin') OR has_role('accounting') OR has_role('inventory')) THEN
        RAISE EXCEPTION 'Insufficient permissions for recall operations';
    END IF;
    
    -- Trace upstream if requested
    IF p_direction IN ('upstream', 'both') THEN
        IF p_entity_type = 'finished_lot' THEN
            RETURN QUERY
            SELECT 
                'upstream'::TEXT as trace_direction,
                t.level_type,
                t.level_number,
                t.entity_type,
                t.entity_id,
                t.entity_name,
                t.entity_details,
                t.relationship_type,
                t.quantity_used as quantity,
                t.uom,
                t.date_used as date_related,
                t.supplier_info as contact_info,
                CASE 
                    WHEN t.level_type = 'ingredients' AND t.entity_details->>'expiry' < CURRENT_DATE::TEXT THEN 'high'
                    WHEN t.level_type = 'ingredients' THEN 'medium'
                    WHEN t.level_type = 'packaging' THEN 'low'
                    ELSE 'medium'
                END as risk_level
            FROM trace_upstream_from_finished_lot(p_entity_id) t;
        END IF;
    END IF;
    
    -- Trace downstream if requested
    IF p_direction IN ('downstream', 'both') THEN
        IF p_entity_type = 'ingredient_lot' THEN
            RETURN QUERY
            SELECT 
                'downstream'::TEXT as trace_direction,
                t.level_type,
                t.level_number,
                t.entity_type,
                t.entity_id,
                t.entity_name,
                t.entity_details,
                t.relationship_type,
                t.quantity_affected as quantity,
                t.uom,
                t.date_affected as date_related,
                t.customer_info as contact_info,
                CASE 
                    WHEN t.level_type = 'sales' AND t.entity_details->>'destination_type' = 'distributor' THEN 'high'
                    WHEN t.level_type = 'sales' AND t.entity_details->>'destination_type' = 'taproom' THEN 'medium'
                    WHEN t.level_type = 'finished_product' THEN 'medium'
                    ELSE 'low'
                END as risk_level
            FROM trace_downstream_from_ingredient_lot(p_entity_id) t;
        END IF;
    END IF;
    
    -- Handle batch tracing (both directions)
    IF p_entity_type = 'batch' THEN
        -- Upstream from batch to ingredients
        IF p_direction IN ('upstream', 'both') THEN
            RETURN QUERY
            SELECT 
                'upstream'::TEXT as trace_direction,
                'ingredients'::TEXT as level_type,
                1 as level_number,
                'ingredient_lot'::TEXT as entity_type,
                il.id as entity_id,
                i.name || ' (Lot: ' || il.lot_code || ')' as entity_name,
                jsonb_build_object(
                    'item_name', i.name,
                    'item_type', i.type,
                    'lot_code', il.lot_code,
                    'expiry', il.expiry,
                    'unit_cost', il.unit_cost
                ) as entity_details,
                'batch_consumed_ingredient'::TEXT as relationship_type,
                ABS(it.quantity) as quantity,
                it.uom,
                it.created_at::DATE as date_related,
                jsonb_build_object(
                    'vendor_name', v.name,
                    'vendor_contact', v.contact_info
                ) as contact_info,
                CASE 
                    WHEN il.expiry < CURRENT_DATE THEN 'high'
                    WHEN i.type = 'raw' THEN 'medium'
                    ELSE 'low'
                END as risk_level
            FROM batches b
            JOIN inventory_transactions it ON it.ref_type = 'batch' AND it.ref_id = b.id
            JOIN item_lots il ON il.id = it.item_lot_id
            JOIN items i ON i.id = il.item_id
            LEFT JOIN vendors v ON v.id = i.vendor_id
            WHERE b.id = p_entity_id
              AND b.workspace_id = get_jwt_workspace_id()
              AND it.type = 'consume';
        END IF;
        
        -- Downstream from batch to finished lots
        IF p_direction IN ('downstream', 'both') THEN
            RETURN QUERY
            SELECT 
                'downstream'::TEXT as trace_direction,
                'finished_product'::TEXT as level_type,
                1 as level_number,
                'finished_lot'::TEXT as entity_type,
                fl.id as entity_id,
                fs.code || ' (Lot: ' || fl.lot_code || ')' as entity_name,
                jsonb_build_object(
                    'sku_code', fs.code,
                    'lot_code', fl.lot_code,
                    'quantity', fl.quantity,
                    'produced_at', fl.created_at
                ) as entity_details,
                'batch_produced_finished_lot'::TEXT as relationship_type,
                fl.quantity as quantity,
                fl.uom,
                fl.created_at::DATE as date_related,
                NULL::JSONB as contact_info,
                'medium'::TEXT as risk_level
            FROM batches b
            JOIN packaging_run_sources prs ON prs.batch_id = b.id
            JOIN packaging_runs pr ON pr.id = prs.packaging_run_id
            JOIN finished_lots fl ON fl.sku_id = pr.sku_id
            JOIN finished_skus fs ON fs.id = fl.sku_id
            WHERE b.id = p_entity_id
              AND b.workspace_id = get_jwt_workspace_id()
              AND fl.created_at BETWEEN pr.created_at - INTERVAL '1 day' AND pr.created_at + INTERVAL '1 day';
        END IF;
    END IF;

END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- RECALL SUMMARY FUNCTIONS
-- ============================================================================

-- Function to generate a recall impact summary
CREATE OR REPLACE FUNCTION get_recall_impact_summary(
    p_entity_type TEXT,
    p_entity_id UUID
)
RETURNS JSONB AS $$
DECLARE
    v_summary JSONB := '{}'::jsonb;
    v_upstream_count INTEGER;
    v_downstream_count INTEGER;
    v_batches_affected INTEGER;
    v_finished_lots_affected INTEGER;
    v_sales_affected INTEGER;
    v_customers_affected INTEGER;
    v_total_volume_affected NUMERIC;
    v_high_risk_items INTEGER;
BEGIN
    -- Check permissions
    IF NOT (has_role('admin') OR has_role('accounting') OR has_role('inventory')) THEN
        RAISE EXCEPTION 'Insufficient permissions for recall operations';
    END IF;
    
    -- Count upstream entities
    SELECT COUNT(*) INTO v_upstream_count
    FROM comprehensive_trace(p_entity_type, p_entity_id, 'upstream') t
    WHERE t.trace_direction = 'upstream';
    
    -- Count downstream entities
    SELECT COUNT(*) INTO v_downstream_count
    FROM comprehensive_trace(p_entity_type, p_entity_id, 'downstream') t
    WHERE t.trace_direction = 'downstream';
    
    -- Count affected batches
    SELECT COUNT(DISTINCT t.entity_id) INTO v_batches_affected
    FROM comprehensive_trace(p_entity_type, p_entity_id, 'both') t
    WHERE t.entity_type = 'batch';
    
    -- Count affected finished lots
    SELECT COUNT(DISTINCT t.entity_id) INTO v_finished_lots_affected
    FROM comprehensive_trace(p_entity_type, p_entity_id, 'both') t
    WHERE t.entity_type = 'finished_lot';
    
    -- Count sales/removals
    SELECT COUNT(DISTINCT t.entity_id) INTO v_sales_affected
    FROM comprehensive_trace(p_entity_type, p_entity_id, 'both') t
    WHERE t.entity_type = 'removal';
    
    -- Count high risk items
    SELECT COUNT(*) INTO v_high_risk_items
    FROM comprehensive_trace(p_entity_type, p_entity_id, 'both') t
    WHERE t.risk_level = 'high';
    
    -- Calculate total volume affected (in liters)
    SELECT COALESCE(SUM(
        CASE 
            WHEN t.uom = 'liters' THEN t.quantity
            WHEN t.uom = 'gallons' THEN t.quantity * 3.78541
            WHEN t.uom = 'barrels' THEN t.quantity * 117.348
            WHEN t.uom = 'cases' AND t.entity_type = 'finished_lot' THEN t.quantity * 8.51  -- Approximate
            ELSE t.quantity
        END
    ), 0) INTO v_total_volume_affected
    FROM comprehensive_trace(p_entity_type, p_entity_id, 'both') t
    WHERE t.entity_type IN ('finished_lot', 'batch');
    
    -- Build summary JSON
    v_summary := jsonb_build_object(
        'entity_type', p_entity_type,
        'entity_id', p_entity_id,
        'generated_at', CURRENT_TIMESTAMP,
        'counts', jsonb_build_object(
            'upstream_entities', COALESCE(v_upstream_count, 0),
            'downstream_entities', COALESCE(v_downstream_count, 0),
            'batches_affected', COALESCE(v_batches_affected, 0),
            'finished_lots_affected', COALESCE(v_finished_lots_affected, 0),
            'sales_affected', COALESCE(v_sales_affected, 0),
            'high_risk_items', COALESCE(v_high_risk_items, 0)
        ),
        'volume', jsonb_build_object(
            'total_affected_liters', COALESCE(v_total_volume_affected, 0),
            'total_affected_barrels', COALESCE(v_total_volume_affected / 117.348, 0)
        ),
        'risk_assessment', CASE 
            WHEN v_high_risk_items > 0 THEN 'HIGH'
            WHEN v_sales_affected > 0 THEN 'MEDIUM'
            WHEN v_finished_lots_affected > 0 THEN 'MEDIUM'
            ELSE 'LOW'
        END
    );
    
    RETURN v_summary;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- RECALL DRILL: BATCH EXPORT FOR NOTIFICATION
-- ============================================================================

-- Function to get all contact information for a recall
CREATE OR REPLACE FUNCTION get_recall_contacts(
    p_entity_type TEXT,
    p_entity_id UUID
)
RETURNS TABLE (
    contact_type TEXT,
    contact_name TEXT,
    contact_details JSONB,
    priority INTEGER
) AS $$
BEGIN
    -- Check permissions
    IF NOT (has_role('admin') OR has_role('accounting')) THEN
        RAISE EXCEPTION 'Insufficient permissions for recall contact information';
    END IF;
    
    -- Suppliers (upstream contacts)
    RETURN QUERY
    SELECT 
        'supplier'::TEXT as contact_type,
        v.name as contact_name,
        jsonb_build_object(
            'vendor_id', v.id,
            'contact_info', v.contact_info,
            'email', v.email,
            'phone', v.phone,
            'items_supplied', array_agg(DISTINCT i.name)
        ) as contact_details,
        1 as priority
    FROM comprehensive_trace(p_entity_type, p_entity_id, 'upstream') t
    JOIN item_lots il ON il.id = t.entity_id AND t.entity_type = 'ingredient_lot'
    JOIN items i ON i.id = il.item_id
    JOIN vendors v ON v.id = i.vendor_id
    WHERE v.name IS NOT NULL
    GROUP BY v.id, v.name, v.contact_info, v.email, v.phone;
    
    -- Distributors/Customers (downstream contacts - if we had customer data)
    RETURN QUERY
    SELECT 
        'distribution'::TEXT as contact_type,
        'Distribution Channel: ' || t.contact_info->>'type' as contact_name,
        jsonb_build_object(
            'destination_type', t.contact_info->>'type',
            'reference', t.contact_info->>'reference',
            'product_details', array_agg(DISTINCT t.entity_name),
            'total_quantity_affected', SUM(t.quantity)
        ) as contact_details,
        2 as priority
    FROM comprehensive_trace(p_entity_type, p_entity_id, 'downstream') t
    WHERE t.entity_type = 'removal'
      AND t.contact_info IS NOT NULL
    GROUP BY t.contact_info->>'type', t.contact_info->>'reference';

END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- GRANT PERMISSIONS
-- ============================================================================

GRANT EXECUTE ON FUNCTION trace_upstream_from_finished_lot TO authenticated;
GRANT EXECUTE ON FUNCTION trace_downstream_from_ingredient_lot TO authenticated;
GRANT EXECUTE ON FUNCTION comprehensive_trace TO authenticated;
GRANT EXECUTE ON FUNCTION get_recall_impact_summary TO authenticated;
GRANT EXECUTE ON FUNCTION get_recall_contacts TO authenticated;

-- ============================================================================
-- CREATE MATERIALIZED VIEW FOR RECALL PREPAREDNESS
-- ============================================================================

-- View to help identify potential recall risks
CREATE MATERIALIZED VIEW mv_recall_risk_assessment AS
WITH expired_lots AS (
    SELECT 
        il.workspace_id,
        il.id as lot_id,
        i.name as item_name,
        il.lot_code,
        il.expiry,
        CURRENT_DATE - il.expiry as days_expired
    FROM item_lots il
    JOIN items i ON i.id = il.item_id
    WHERE il.expiry < CURRENT_DATE
      AND il.qty > 0  -- Still have inventory
),
high_risk_batches AS (
    SELECT 
        b.workspace_id,
        b.id as batch_id,
        b.batch_number,
        COUNT(el.lot_id) as expired_ingredients,
        array_agg(el.item_name) as expired_ingredient_names
    FROM batches b
    JOIN inventory_transactions it ON it.ref_type = 'batch' AND it.ref_id = b.id
    JOIN expired_lots el ON el.lot_id = it.item_lot_id
    WHERE it.type = 'consume'
    GROUP BY b.workspace_id, b.id, b.batch_number
),
finished_lots_at_risk AS (
    SELECT 
        fl.workspace_id,
        fl.id as finished_lot_id,
        fs.code as sku_code,
        fl.lot_code,
        hrb.batch_number,
        hrb.expired_ingredients,
        hrb.expired_ingredient_names
    FROM finished_lots fl
    JOIN finished_skus fs ON fs.id = fl.sku_id
    JOIN packaging_runs pr ON pr.sku_id = fl.sku_id
    JOIN packaging_run_sources prs ON prs.packaging_run_id = pr.id
    JOIN high_risk_batches hrb ON hrb.batch_id = prs.batch_id
    WHERE fl.created_at BETWEEN pr.created_at - INTERVAL '1 day' AND pr.created_at + INTERVAL '1 day'
)
SELECT 
    flar.workspace_id,
    flar.finished_lot_id,
    flar.sku_code,
    flar.lot_code,
    flar.expired_ingredients,
    flar.expired_ingredient_names,
    -- Check if this finished lot has been sold
    CASE 
        WHEN EXISTS (SELECT 1 FROM removals r WHERE r.finished_lot_id = flar.finished_lot_id) 
        THEN true 
        ELSE false 
    END as has_been_sold,
    -- Calculate risk score
    CASE 
        WHEN flar.expired_ingredients > 2 THEN 'CRITICAL'
        WHEN flar.expired_ingredients > 0 THEN 'HIGH'
        ELSE 'MEDIUM'
    END as risk_level,
    NOW() as assessed_at
FROM finished_lots_at_risk flar;

-- Create index
CREATE UNIQUE INDEX idx_mv_recall_risk_assessment_unique 
ON mv_recall_risk_assessment (workspace_id, finished_lot_id);

-- Enable RLS
-- NOTE: Materialized views cannot have RLS enabled - access controlled via underlying tables
-- ALTER MATERIALIZED VIEW mv_recall_risk_assessment ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY tenant_isolation ON mv_recall_risk_assessment
--     FOR ALL USING (workspace_id = get_jwt_workspace_id());
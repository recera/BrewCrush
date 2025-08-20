-- Phase 8: Report Generation RPCs
-- Functions for generating various reports with filtering and export capabilities

-- ============================================================================
-- SAVED VIEWS TABLE FOR PERSISTENT FILTERS
-- ============================================================================

CREATE TABLE IF NOT EXISTS saved_report_views (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    report_type TEXT NOT NULL,
    view_name TEXT NOT NULL,
    filters JSONB NOT NULL DEFAULT '{}'::jsonb,
    sort_config JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_public BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by UUID NOT NULL,
    updated_by UUID NOT NULL,
    
    CONSTRAINT unique_view_per_user UNIQUE (workspace_id, user_id, report_type, view_name)
);

-- Enable RLS
ALTER TABLE saved_report_views ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY tenant_isolation ON saved_report_views
    FOR ALL USING (workspace_id = get_jwt_workspace_id());

CREATE POLICY user_views_policy ON saved_report_views
    FOR ALL USING (
        workspace_id = get_jwt_workspace_id() 
        AND (user_id = auth.uid() OR is_public = true)
    );

-- Add timestamps trigger
CREATE TRIGGER set_timestamp_saved_report_views
    BEFORE UPDATE ON saved_report_views
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_timestamp();

-- ============================================================================
-- INVENTORY REPORT GENERATION
-- ============================================================================

CREATE OR REPLACE FUNCTION generate_inventory_report(
    p_filters JSONB DEFAULT '{}'::jsonb,
    p_sort JSONB DEFAULT '{"field": "item_name", "direction": "asc"}'::jsonb,
    p_format TEXT DEFAULT 'json'  -- 'json', 'csv'
)
RETURNS JSONB AS $$
DECLARE
    v_workspace_id UUID;
    v_where_clause TEXT := '';
    v_order_clause TEXT := '';
    v_query TEXT;
    v_result JSONB;
    v_data JSONB;
    v_csv_data TEXT;
    v_total_count INTEGER;
    v_total_value NUMERIC;
BEGIN
    v_workspace_id := get_jwt_workspace_id();
    
    -- Check permissions
    IF NOT (has_role('admin') OR has_role('inventory') OR has_role('accounting')) THEN
        RAISE EXCEPTION 'Insufficient permissions for inventory reports';
    END IF;
    
    -- Build WHERE clause from filters
    v_where_clause := 'WHERE workspace_id = $1';
    
    -- Filter by item type
    IF p_filters ? 'item_type' AND p_filters->>'item_type' != '' THEN
        v_where_clause := v_where_clause || ' AND item_type = ' || quote_literal(p_filters->>'item_type');
    END IF;
    
    -- Filter by location
    IF p_filters ? 'location_id' AND p_filters->>'location_id' != '' THEN
        v_where_clause := v_where_clause || ' AND location_id = ' || quote_literal(p_filters->>'location_id');
    END IF;
    
    -- Filter by low stock
    IF p_filters ? 'below_reorder_level' AND (p_filters->>'below_reorder_level')::boolean THEN
        v_where_clause := v_where_clause || ' AND below_reorder_level = true';
    END IF;
    
    -- Filter by item name (search)
    IF p_filters ? 'search' AND p_filters->>'search' != '' THEN
        v_where_clause := v_where_clause || ' AND item_name ILIKE ' || quote_literal('%' || p_filters->>'search' || '%');
    END IF;
    
    -- Build ORDER BY clause
    IF p_sort ? 'field' THEN
        v_order_clause := 'ORDER BY ' || (p_sort->>'field');
        IF p_sort ? 'direction' AND p_sort->>'direction' = 'desc' THEN
            v_order_clause := v_order_clause || ' DESC';
        ELSE
            v_order_clause := v_order_clause || ' ASC';
        END IF;
    ELSE
        v_order_clause := 'ORDER BY item_name ASC';
    END IF;
    
    -- Build main query
    v_query := 'SELECT 
        item_id,
        item_name,
        item_type,
        base_uom,
        location_id,
        location_name,
        location_type,
        lot_count,
        total_qty,
        ' || CASE WHEN has_cost_visibility() THEN 'avg_unit_cost, total_value,' ELSE 'NULL as avg_unit_cost, NULL as total_value,' END || '
        earliest_expiry,
        reorder_level,
        below_reorder_level
    FROM mv_inventory_on_hand ' || v_where_clause || ' ' || v_order_clause;
    
    -- Execute query and build result
    IF p_format = 'csv' THEN
        -- For CSV, we'll return the data as a structured result that can be processed by the Edge Function
        EXECUTE 'SELECT jsonb_agg(row_to_json(t)) FROM (' || v_query || ') t' 
        INTO v_data USING v_workspace_id;
        
        v_result := jsonb_build_object(
            'success', true,
            'format', 'csv',
            'data', COALESCE(v_data, '[]'::jsonb),
            'filename', 'inventory_report_' || to_char(NOW(), 'YYYY_MM_DD_HH24_MI_SS') || '.csv'
        );
    ELSE
        -- JSON format with metadata
        EXECUTE 'SELECT jsonb_agg(row_to_json(t)) FROM (' || v_query || ') t' 
        INTO v_data USING v_workspace_id;
        
        -- Get summary statistics
        EXECUTE 'SELECT COUNT(*), COALESCE(SUM(total_value), 0) FROM (' || v_query || ') t'
        INTO v_total_count, v_total_value USING v_workspace_id;
        
        v_result := jsonb_build_object(
            'success', true,
            'format', 'json',
            'data', COALESCE(v_data, '[]'::jsonb),
            'summary', jsonb_build_object(
                'total_items', v_total_count,
                'total_value', CASE WHEN has_cost_visibility() THEN v_total_value ELSE NULL END,
                'low_stock_items', (
                    SELECT COUNT(*) 
                    FROM mv_inventory_on_hand 
                    WHERE workspace_id = v_workspace_id 
                      AND below_reorder_level = true
                )
            ),
            'filters_applied', p_filters,
            'generated_at', NOW()
        );
    END IF;
    
    -- Log telemetry
    INSERT INTO ui_events (
        event_name, workspace_id, entity_type, duration_ms
    ) VALUES (
        'inventory_report_generated', v_workspace_id, 'report', 
        EXTRACT(EPOCH FROM (NOW() - NOW())) * 1000
    );
    
    RETURN v_result;
    
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object(
        'success', false,
        'error', SQLERRM
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- BATCH SUMMARY REPORT
-- ============================================================================

CREATE OR REPLACE FUNCTION generate_batch_summary_report(
    p_filters JSONB DEFAULT '{}'::jsonb,
    p_sort JSONB DEFAULT '{"field": "brew_date", "direction": "desc"}'::jsonb,
    p_format TEXT DEFAULT 'json'
)
RETURNS JSONB AS $$
DECLARE
    v_workspace_id UUID;
    v_where_clause TEXT := '';
    v_order_clause TEXT := '';
    v_query TEXT;
    v_result JSONB;
    v_data JSONB;
    v_total_count INTEGER;
    v_avg_yield NUMERIC;
BEGIN
    v_workspace_id := get_jwt_workspace_id();
    
    -- Check permissions
    IF NOT (has_role('admin') OR has_role('brewer') OR has_role('accounting')) THEN
        RAISE EXCEPTION 'Insufficient permissions for batch reports';
    END IF;
    
    -- Build WHERE clause from filters
    v_where_clause := 'WHERE workspace_id = $1';
    
    -- Filter by status
    IF p_filters ? 'status' AND p_filters->>'status' != '' THEN
        v_where_clause := v_where_clause || ' AND status = ' || quote_literal(p_filters->>'status');
    END IF;
    
    -- Filter by recipe style
    IF p_filters ? 'style' AND p_filters->>'style' != '' THEN
        v_where_clause := v_where_clause || ' AND style = ' || quote_literal(p_filters->>'style');
    END IF;
    
    -- Filter by date range
    IF p_filters ? 'date_from' AND p_filters->>'date_from' != '' THEN
        v_where_clause := v_where_clause || ' AND brew_date >= ' || quote_literal(p_filters->>'date_from');
    END IF;
    
    IF p_filters ? 'date_to' AND p_filters->>'date_to' != '' THEN
        v_where_clause := v_where_clause || ' AND brew_date <= ' || quote_literal(p_filters->>'date_to');
    END IF;
    
    -- Filter by recipe name (search)
    IF p_filters ? 'search' AND p_filters->>'search' != '' THEN
        v_where_clause := v_where_clause || ' AND (batch_number ILIKE ' || quote_literal('%' || p_filters->>'search' || '%') || 
                          ' OR recipe_name ILIKE ' || quote_literal('%' || p_filters->>'search' || '%') || ')';
    END IF;
    
    -- Build ORDER BY clause
    IF p_sort ? 'field' THEN
        v_order_clause := 'ORDER BY ' || (p_sort->>'field');
        IF p_sort ? 'direction' AND p_sort->>'direction' = 'desc' THEN
            v_order_clause := v_order_clause || ' DESC';
        ELSE
            v_order_clause := v_order_clause || ' ASC';
        END IF;
    ELSE
        v_order_clause := 'ORDER BY brew_date DESC';
    END IF;
    
    -- Build main query
    v_query := 'SELECT 
        batch_id,
        batch_number,
        recipe_name,
        style,
        status,
        target_volume,
        actual_volume,
        og_target,
        og_actual,
        fg_target,
        fg_actual,
        abv_target,
        abv_actual,
        brew_date,
        package_date,
        created_at,
        ' || CASE WHEN has_cost_visibility() THEN 'ingredient_cost, packaging_cost, total_cost, cost_per_liter,' ELSE 'NULL as ingredient_cost, NULL as packaging_cost, NULL as total_cost, NULL as cost_per_liter,' END || '
        packaged_liters,
        yield_percentage,
        total_duration_days,
        reading_count,
        owner_name
    FROM mv_batch_summary ' || v_where_clause || ' ' || v_order_clause;
    
    -- Execute query and build result
    IF p_format = 'csv' THEN
        EXECUTE 'SELECT jsonb_agg(row_to_json(t)) FROM (' || v_query || ') t' 
        INTO v_data USING v_workspace_id;
        
        v_result := jsonb_build_object(
            'success', true,
            'format', 'csv',
            'data', COALESCE(v_data, '[]'::jsonb),
            'filename', 'batch_summary_report_' || to_char(NOW(), 'YYYY_MM_DD_HH24_MI_SS') || '.csv'
        );
    ELSE
        EXECUTE 'SELECT jsonb_agg(row_to_json(t)) FROM (' || v_query || ') t' 
        INTO v_data USING v_workspace_id;
        
        -- Get summary statistics
        EXECUTE 'SELECT COUNT(*), COALESCE(AVG(yield_percentage), 0) FROM (' || v_query || ') t'
        INTO v_total_count, v_avg_yield USING v_workspace_id;
        
        v_result := jsonb_build_object(
            'success', true,
            'format', 'json',
            'data', COALESCE(v_data, '[]'::jsonb),
            'summary', jsonb_build_object(
                'total_batches', v_total_count,
                'average_yield', v_avg_yield,
                'styles_produced', (
                    SELECT COUNT(DISTINCT style) 
                    FROM mv_batch_summary 
                    WHERE workspace_id = v_workspace_id
                )
            ),
            'filters_applied', p_filters,
            'generated_at', NOW()
        );
    END IF;
    
    -- Log telemetry
    INSERT INTO ui_events (
        event_name, workspace_id, entity_type
    ) VALUES (
        'batch_summary_report_generated', v_workspace_id, 'report'
    );
    
    RETURN v_result;
    
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object(
        'success', false,
        'error', SQLERRM
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- PO AGING REPORT
-- ============================================================================

CREATE OR REPLACE FUNCTION generate_po_aging_report(
    p_filters JSONB DEFAULT '{}'::jsonb,
    p_sort JSONB DEFAULT '{"field": "days_since_order", "direction": "desc"}'::jsonb,
    p_format TEXT DEFAULT 'json'
)
RETURNS JSONB AS $$
DECLARE
    v_workspace_id UUID;
    v_where_clause TEXT := '';
    v_order_clause TEXT := '';
    v_query TEXT;
    v_result JSONB;
    v_data JSONB;
    v_total_count INTEGER;
    v_total_value NUMERIC;
BEGIN
    v_workspace_id := get_jwt_workspace_id();
    
    -- Check permissions
    IF NOT (has_role('admin') OR has_role('inventory') OR has_role('accounting')) THEN
        RAISE EXCEPTION 'Insufficient permissions for PO reports';
    END IF;
    
    -- Build WHERE clause from filters
    v_where_clause := 'WHERE workspace_id = $1';
    
    -- Filter by status
    IF p_filters ? 'status' AND p_filters->>'status' != '' THEN
        v_where_clause := v_where_clause || ' AND status = ' || quote_literal(p_filters->>'status');
    END IF;
    
    -- Filter by vendor
    IF p_filters ? 'vendor_name' AND p_filters->>'vendor_name' != '' THEN
        v_where_clause := v_where_clause || ' AND vendor_name = ' || quote_literal(p_filters->>'vendor_name');
    END IF;
    
    -- Filter by age category
    IF p_filters ? 'age_category' AND p_filters->>'age_category' != '' THEN
        v_where_clause := v_where_clause || ' AND age_category = ' || quote_literal(p_filters->>'age_category');
    END IF;
    
    -- Filter overdue only
    IF p_filters ? 'overdue_only' AND (p_filters->>'overdue_only')::boolean THEN
        v_where_clause := v_where_clause || ' AND is_overdue = true';
    END IF;
    
    -- Filter by PO number (search)
    IF p_filters ? 'search' AND p_filters->>'search' != '' THEN
        v_where_clause := v_where_clause || ' AND po_number ILIKE ' || quote_literal('%' || p_filters->>'search' || '%');
    END IF;
    
    -- Build ORDER BY clause
    IF p_sort ? 'field' THEN
        v_order_clause := 'ORDER BY ' || (p_sort->>'field');
        IF p_sort ? 'direction' AND p_sort->>'direction' = 'desc' THEN
            v_order_clause := v_order_clause || ' DESC';
        ELSE
            v_order_clause := v_order_clause || ' ASC';
        END IF;
    ELSE
        v_order_clause := 'ORDER BY days_since_order DESC';
    END IF;
    
    -- Build main query
    v_query := 'SELECT 
        po_id,
        po_number,
        vendor_name,
        status,
        order_date,
        expected_delivery_date,
        days_since_order,
        days_overdue,
        ' || CASE WHEN has_cost_visibility() THEN 'total_value, received_value, outstanding_value,' ELSE 'NULL as total_value, NULL as received_value, NULL as outstanding_value,' END || '
        line_count,
        received_line_count,
        completion_pct,
        age_category,
        is_overdue
    FROM mv_po_aging ' || v_where_clause || ' ' || v_order_clause;
    
    -- Execute query and build result
    IF p_format = 'csv' THEN
        EXECUTE 'SELECT jsonb_agg(row_to_json(t)) FROM (' || v_query || ') t' 
        INTO v_data USING v_workspace_id;
        
        v_result := jsonb_build_object(
            'success', true,
            'format', 'csv',
            'data', COALESCE(v_data, '[]'::jsonb),
            'filename', 'po_aging_report_' || to_char(NOW(), 'YYYY_MM_DD_HH24_MI_SS') || '.csv'
        );
    ELSE
        EXECUTE 'SELECT jsonb_agg(row_to_json(t)) FROM (' || v_query || ') t' 
        INTO v_data USING v_workspace_id;
        
        -- Get summary statistics
        EXECUTE 'SELECT COUNT(*), COALESCE(SUM(outstanding_value), 0) FROM (' || v_query || ') t'
        INTO v_total_count, v_total_value USING v_workspace_id;
        
        v_result := jsonb_build_object(
            'success', true,
            'format', 'json',
            'data', COALESCE(v_data, '[]'::jsonb),
            'summary', jsonb_build_object(
                'total_pos', v_total_count,
                'total_outstanding_value', CASE WHEN has_cost_visibility() THEN v_total_value ELSE NULL END,
                'overdue_pos', (
                    SELECT COUNT(*) 
                    FROM mv_po_aging 
                    WHERE workspace_id = v_workspace_id 
                      AND is_overdue = true
                )
            ),
            'filters_applied', p_filters,
            'generated_at', NOW()
        );
    END IF;
    
    -- Log telemetry
    INSERT INTO ui_events (
        event_name, workspace_id, entity_type
    ) VALUES (
        'po_aging_report_generated', v_workspace_id, 'report'
    );
    
    RETURN v_result;
    
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object(
        'success', false,
        'error', SQLERRM
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- RECALL DRILL REPORT
-- ============================================================================

CREATE OR REPLACE FUNCTION generate_recall_drill_report(
    p_entity_type TEXT,
    p_entity_id UUID,
    p_direction TEXT DEFAULT 'both',
    p_format TEXT DEFAULT 'json'
)
RETURNS JSONB AS $$
DECLARE
    v_workspace_id UUID;
    v_result JSONB;
    v_trace_data JSONB;
    v_summary JSONB;
    v_contacts JSONB;
BEGIN
    v_workspace_id := get_jwt_workspace_id();
    
    -- Check permissions
    IF NOT (has_role('admin') OR has_role('accounting') OR has_role('inventory')) THEN
        RAISE EXCEPTION 'Insufficient permissions for recall drill reports';
    END IF;
    
    -- Get trace data
    SELECT jsonb_agg(
        jsonb_build_object(
            'trace_direction', t.trace_direction,
            'level_type', t.level_type,
            'level_number', t.level_number,
            'entity_type', t.entity_type,
            'entity_id', t.entity_id,
            'entity_name', t.entity_name,
            'entity_details', t.entity_details,
            'relationship_type', t.relationship_type,
            'quantity', t.quantity,
            'uom', t.uom,
            'date_related', t.date_related,
            'contact_info', t.contact_info,
            'risk_level', t.risk_level
        )
    ) INTO v_trace_data
    FROM comprehensive_trace(p_entity_type, p_entity_id, p_direction) t;
    
    -- Get impact summary
    v_summary := get_recall_impact_summary(p_entity_type, p_entity_id);
    
    -- Get contact information
    SELECT jsonb_agg(
        jsonb_build_object(
            'contact_type', c.contact_type,
            'contact_name', c.contact_name,
            'contact_details', c.contact_details,
            'priority', c.priority
        )
    ) INTO v_contacts
    FROM get_recall_contacts(p_entity_type, p_entity_id) c;
    
    IF p_format = 'csv' THEN
        v_result := jsonb_build_object(
            'success', true,
            'format', 'csv',
            'data', COALESCE(v_trace_data, '[]'::jsonb),
            'filename', 'recall_drill_' || p_entity_type || '_' || to_char(NOW(), 'YYYY_MM_DD_HH24_MI_SS') || '.csv'
        );
    ELSE
        v_result := jsonb_build_object(
            'success', true,
            'format', 'json',
            'entity_type', p_entity_type,
            'entity_id', p_entity_id,
            'direction', p_direction,
            'trace_data', COALESCE(v_trace_data, '[]'::jsonb),
            'impact_summary', v_summary,
            'contacts', COALESCE(v_contacts, '[]'::jsonb),
            'generated_at', NOW()
        );
    END IF;
    
    -- Log telemetry
    INSERT INTO ui_events (
        event_name, workspace_id, entity_type, entity_id
    ) VALUES (
        'recall_drill_report_generated', v_workspace_id, p_entity_type, p_entity_id
    );
    
    RETURN v_result;
    
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object(
        'success', false,
        'error', SQLERRM
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- SAVED VIEWS MANAGEMENT
-- ============================================================================

-- Function to save a report view
CREATE OR REPLACE FUNCTION save_report_view(
    p_report_type TEXT,
    p_view_name TEXT,
    p_filters JSONB,
    p_sort_config JSONB DEFAULT '{}'::jsonb,
    p_is_public BOOLEAN DEFAULT FALSE
)
RETURNS UUID AS $$
DECLARE
    v_view_id UUID;
    v_workspace_id UUID;
    v_user_id UUID;
BEGIN
    v_workspace_id := get_jwt_workspace_id();
    v_user_id := auth.uid();
    
    -- Check permissions
    IF NOT (has_role('admin') OR has_role('inventory') OR has_role('accounting') OR has_role('brewer')) THEN
        RAISE EXCEPTION 'Insufficient permissions to save report views';
    END IF;
    
    -- Only admins can create public views
    IF p_is_public AND NOT has_role('admin') THEN
        RAISE EXCEPTION 'Only administrators can create public report views';
    END IF;
    
    -- Insert or update the view
    INSERT INTO saved_report_views (
        workspace_id,
        user_id,
        report_type,
        view_name,
        filters,
        sort_config,
        is_public,
        created_by,
        updated_by
    ) VALUES (
        v_workspace_id,
        v_user_id,
        p_report_type,
        p_view_name,
        p_filters,
        p_sort_config,
        p_is_public,
        v_user_id,
        v_user_id
    )
    ON CONFLICT (workspace_id, user_id, report_type, view_name)
    DO UPDATE SET
        filters = EXCLUDED.filters,
        sort_config = EXCLUDED.sort_config,
        is_public = EXCLUDED.is_public,
        updated_by = v_user_id,
        updated_at = NOW()
    RETURNING id INTO v_view_id;
    
    RETURN v_view_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get saved views
CREATE OR REPLACE FUNCTION get_saved_report_views(
    p_report_type TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_workspace_id UUID;
    v_user_id UUID;
    v_result JSONB;
BEGIN
    v_workspace_id := get_jwt_workspace_id();
    v_user_id := auth.uid();
    
    SELECT jsonb_agg(
        jsonb_build_object(
            'id', srv.id,
            'report_type', srv.report_type,
            'view_name', srv.view_name,
            'filters', srv.filters,
            'sort_config', srv.sort_config,
            'is_public', srv.is_public,
            'is_owner', srv.user_id = v_user_id,
            'created_by', u.email,
            'created_at', srv.created_at,
            'updated_at', srv.updated_at
        )
    ) INTO v_result
    FROM saved_report_views srv
    JOIN auth.users u ON u.id = srv.user_id
    WHERE srv.workspace_id = v_workspace_id
      AND (srv.user_id = v_user_id OR srv.is_public = true)
      AND (p_report_type IS NULL OR srv.report_type = p_report_type)
    ORDER BY srv.is_public DESC, srv.created_at DESC;
    
    RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- GRANT PERMISSIONS
-- ============================================================================

GRANT EXECUTE ON FUNCTION generate_inventory_report TO authenticated;
GRANT EXECUTE ON FUNCTION generate_batch_summary_report TO authenticated;
GRANT EXECUTE ON FUNCTION generate_po_aging_report TO authenticated;
GRANT EXECUTE ON FUNCTION generate_recall_drill_report TO authenticated;
GRANT EXECUTE ON FUNCTION save_report_view TO authenticated;
GRANT EXECUTE ON FUNCTION get_saved_report_views TO authenticated;
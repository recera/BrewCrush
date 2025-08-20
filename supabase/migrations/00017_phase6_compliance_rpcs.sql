-- Phase 6: Compliance Engine RPCs and Mapping Functions
-- Complex domain logic for BROP, Excise, and Transfers

-- ============================================================================
-- MAPPING VIEWS - Transform operational data into TTB entries
-- ============================================================================

-- View to calculate production (from batches completed to packaging)
CREATE OR REPLACE VIEW v_brop_production AS
SELECT 
    b.workspace_id,
    b.owner_entity_id,
    DATE_TRUNC('month', pr.created_at) as period_month,
    SUM(
        CASE 
            WHEN prs.volume_liters IS NOT NULL THEN prs.volume_liters / 117.348  -- Convert liters to barrels
            ELSE b.actual_volume / 117.348
        END
    ) as produced_bbl
FROM batches b
LEFT JOIN packaging_run_sources prs ON prs.batch_id = b.id
LEFT JOIN packaging_runs pr ON pr.id = prs.packaging_run_id
WHERE b.status IN ('packaging', 'packaged', 'closed')
GROUP BY b.workspace_id, b.owner_entity_id, DATE_TRUNC('month', pr.created_at);

-- View to calculate removals (tax determined)
CREATE OR REPLACE VIEW v_brop_removals_tax AS
SELECT 
    r.workspace_id,
    fl.owner_entity_id,
    DATE_TRUNC('month', r.removal_date) as period_month,
    SUM(r.barrels) as removed_tax_bbl
FROM removals r
JOIN finished_lots fl ON fl.id = r.finished_lot_id
WHERE r.is_taxable = true
GROUP BY r.workspace_id, fl.owner_entity_id, DATE_TRUNC('month', r.removal_date);

-- View to calculate removals (without tax - exports, research, etc.)
CREATE OR REPLACE VIEW v_brop_removals_notax AS
SELECT 
    r.workspace_id,
    fl.owner_entity_id,
    DATE_TRUNC('month', r.removal_date) as period_month,
    SUM(r.barrels) as removed_notax_bbl
FROM removals r
JOIN finished_lots fl ON fl.id = r.finished_lot_id
WHERE r.is_taxable = false
GROUP BY r.workspace_id, fl.owner_entity_id, DATE_TRUNC('month', r.removal_date);

-- View to calculate in-bond transfers received
CREATE OR REPLACE VIEW v_brop_received_inbond AS
SELECT 
    it.workspace_id,
    it.receiver_entity_id as owner_entity_id,
    DATE_TRUNC('month', it.received_at) as period_month,
    SUM(it.total_barrels) as received_bbl
FROM inbond_transfers it
WHERE it.received_at IS NOT NULL
GROUP BY it.workspace_id, it.receiver_entity_id, DATE_TRUNC('month', it.received_at);

-- View to calculate in-bond transfers shipped
CREATE OR REPLACE VIEW v_brop_shipped_inbond AS
SELECT 
    it.workspace_id,
    it.shipper_entity_id as owner_entity_id,
    DATE_TRUNC('month', it.shipped_at) as period_month,
    SUM(it.total_barrels) as shipped_bbl
FROM inbond_transfers it
GROUP BY it.workspace_id, it.shipper_entity_id, DATE_TRUNC('month', it.shipped_at);

-- View to calculate inventory on hand (for closing balance)
CREATE OR REPLACE VIEW v_brop_inventory_onhand AS
SELECT 
    fl.workspace_id,
    fl.owner_entity_id,
    DATE_TRUNC('month', CURRENT_DATE) as period_month,
    SUM(
        CASE 
            WHEN fs.size_ml IS NOT NULL THEN 
                (fl.quantity * fs.size_ml / 1000.0) / 117.348  -- ml to L to bbl
            ELSE 0
        END
    ) as onhand_bbl
FROM finished_lots fl
JOIN finished_skus fs ON fs.id = fl.sku_id
WHERE fl.quantity > 0
  AND NOT EXISTS (
      SELECT 1 FROM removals r 
      WHERE r.finished_lot_id = fl.id
  )
GROUP BY fl.workspace_id, fl.owner_entity_id;

-- ============================================================================
-- MAIN RPC: Generate TTB Period (BROP)
-- ============================================================================

CREATE OR REPLACE FUNCTION generate_ttb_period(
    p_period_id UUID,
    p_finalize BOOLEAN DEFAULT FALSE,
    p_dry_run BOOLEAN DEFAULT FALSE
)
RETURNS JSONB AS $$
DECLARE
    v_period RECORD;
    v_workspace_id UUID;
    v_entries_created INTEGER := 0;
    v_validation RECORD;
    v_result JSONB;
    v_prior_period RECORD;
    v_opening_balance NUMERIC;
BEGIN
    -- Get period details
    SELECT * INTO v_period
    FROM ttb_periods
    WHERE id = p_period_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'TTB period not found';
    END IF;
    
    v_workspace_id := v_period.workspace_id;
    
    -- Check permissions
    IF NOT (has_role('accounting') OR has_role('admin')) THEN
        RAISE EXCEPTION 'Insufficient permissions for TTB operations';
    END IF;
    
    -- Get prior period for opening balance
    SELECT * INTO v_prior_period
    FROM ttb_periods
    WHERE workspace_id = v_workspace_id
      AND period_end < v_period.period_start
    ORDER BY period_end DESC
    LIMIT 1;
    
    -- If not dry run, clear existing entries for regeneration
    IF NOT p_dry_run THEN
        DELETE FROM ttb_entries WHERE period_id = p_period_id;
    END IF;
    
    -- OPENING BALANCE
    IF v_prior_period.id IS NOT NULL THEN
        -- Get closing from prior period
        SELECT COALESCE(SUM(quantity_bbl), 0) INTO v_opening_balance
        FROM ttb_entries
        WHERE period_id = v_prior_period.id
          AND category = 'closing';
    ELSE
        v_opening_balance := 0;
    END IF;
    
    IF NOT p_dry_run THEN
        INSERT INTO ttb_entries (
            workspace_id, period_id, line_code, category, quantity_bbl, notes
        ) VALUES (
            v_workspace_id, p_period_id, '01', 'opening', v_opening_balance, 
            'Opening balance from prior period'
        );
        v_entries_created := v_entries_created + 1;
    END IF;
    
    -- PRODUCTION
    IF NOT p_dry_run THEN
        INSERT INTO ttb_entries (
            workspace_id, period_id, line_code, category, quantity_bbl, 
            owner_entity_id, source_table, notes
        )
        SELECT 
            v_workspace_id, p_period_id, '02', 'produced', 
            COALESCE(SUM(produced_bbl), 0),
            owner_entity_id, 'batches', 'Beer produced by fermentation'
        FROM v_brop_production
        WHERE workspace_id = v_workspace_id
          AND period_month >= DATE_TRUNC('month', v_period.period_start)
          AND period_month <= DATE_TRUNC('month', v_period.period_end)
        GROUP BY owner_entity_id;
        
        v_entries_created := v_entries_created + SQL%ROWCOUNT;
    END IF;
    
    -- RECEIVED IN BOND
    IF NOT p_dry_run THEN
        INSERT INTO ttb_entries (
            workspace_id, period_id, line_code, category, quantity_bbl,
            owner_entity_id, source_table, notes
        )
        SELECT 
            v_workspace_id, p_period_id, '03', 'received_in_bond',
            COALESCE(SUM(received_bbl), 0),
            owner_entity_id, 'inbond_transfers', 'Received from other breweries'
        FROM v_brop_received_inbond
        WHERE workspace_id = v_workspace_id
          AND period_month >= DATE_TRUNC('month', v_period.period_start)
          AND period_month <= DATE_TRUNC('month', v_period.period_end)
        GROUP BY owner_entity_id;
        
        v_entries_created := v_entries_created + SQL%ROWCOUNT;
    END IF;
    
    -- REMOVALS (TAX DETERMINED)
    IF NOT p_dry_run THEN
        INSERT INTO ttb_entries (
            workspace_id, period_id, line_code, category, quantity_bbl,
            owner_entity_id, source_table, notes
        )
        SELECT 
            v_workspace_id, p_period_id, '07', 'removed_tax_determined',
            COALESCE(SUM(removed_tax_bbl), 0),
            owner_entity_id, 'removals', 'Removed for consumption or sale'
        FROM v_brop_removals_tax
        WHERE workspace_id = v_workspace_id
          AND period_month >= DATE_TRUNC('month', v_period.period_start)
          AND period_month <= DATE_TRUNC('month', v_period.period_end)
        GROUP BY owner_entity_id;
        
        v_entries_created := v_entries_created + SQL%ROWCOUNT;
    END IF;
    
    -- REMOVALS (WITHOUT TAX)
    IF NOT p_dry_run THEN
        INSERT INTO ttb_entries (
            workspace_id, period_id, line_code, category, quantity_bbl,
            owner_entity_id, source_table, notes
        )
        SELECT 
            v_workspace_id, p_period_id, '08', 'removed_without_tax',
            COALESCE(SUM(removed_notax_bbl), 0),
            owner_entity_id, 'removals', 'Exports, research, supplies'
        FROM v_brop_removals_notax
        WHERE workspace_id = v_workspace_id
          AND period_month >= DATE_TRUNC('month', v_period.period_start)
          AND period_month <= DATE_TRUNC('month', v_period.period_end)
        GROUP BY owner_entity_id;
        
        v_entries_created := v_entries_created + SQL%ROWCOUNT;
    END IF;
    
    -- CLOSING BALANCE (calculated)
    IF NOT p_dry_run THEN
        WITH calculations AS (
            SELECT 
                COALESCE(SUM(CASE WHEN category = 'opening' THEN quantity_bbl ELSE 0 END), 0) as opening,
                COALESCE(SUM(CASE WHEN category = 'produced' THEN quantity_bbl ELSE 0 END), 0) as produced,
                COALESCE(SUM(CASE WHEN category = 'received_in_bond' THEN quantity_bbl ELSE 0 END), 0) as received,
                COALESCE(SUM(CASE WHEN category = 'returned_to_brewery' THEN quantity_bbl ELSE 0 END), 0) as returned,
                COALESCE(SUM(CASE WHEN category = 'removed_tax_determined' THEN quantity_bbl ELSE 0 END), 0) as removed_tax,
                COALESCE(SUM(CASE WHEN category = 'removed_without_tax' THEN quantity_bbl ELSE 0 END), 0) as removed_notax,
                COALESCE(SUM(CASE WHEN category = 'consumed_on_premises' THEN quantity_bbl ELSE 0 END), 0) as consumed,
                COALESCE(SUM(CASE WHEN category = 'destroyed' THEN quantity_bbl ELSE 0 END), 0) as destroyed,
                COALESCE(SUM(CASE WHEN category IN ('loss', 'shortage') THEN quantity_bbl ELSE 0 END), 0) as losses
            FROM ttb_entries
            WHERE period_id = p_period_id
        )
        INSERT INTO ttb_entries (
            workspace_id, period_id, line_code, category, quantity_bbl, notes
        )
        SELECT 
            v_workspace_id, p_period_id, '15', 'closing',
            opening + produced + received + returned - removed_tax - removed_notax - consumed - destroyed - losses,
            'Calculated closing balance'
        FROM calculations;
        
        v_entries_created := v_entries_created + 1;
    END IF;
    
    -- Validate reconciliation
    SELECT * INTO v_validation FROM validate_reconciliation(p_period_id);
    
    -- Check for hard stop setting
    IF NOT v_validation.is_valid THEN
        SELECT brop_hard_stop INTO STRICT v_result 
        FROM settings_compliance 
        WHERE workspace_id = v_workspace_id;
        
        IF v_result->>'brop_hard_stop' = 'true' AND NOT p_dry_run THEN
            RAISE EXCEPTION 'BROP reconciliation failed: variance of % bbl', v_validation.variance;
        END IF;
    END IF;
    
    -- Finalize if requested
    IF p_finalize AND NOT p_dry_run THEN
        UPDATE ttb_periods 
        SET status = 'finalized',
            finalized_at = NOW(),
            finalized_by = auth.uid()
        WHERE id = p_period_id;
        
        -- Log telemetry
        INSERT INTO ui_events (
            event_name, workspace_id, entity_type, entity_id, form_type
        ) VALUES (
            'ttb_period_finalized', v_workspace_id, 'ttb_period', p_period_id, 'brop'
        );
    END IF;
    
    -- Return result
    RETURN jsonb_build_object(
        'success', true,
        'period_id', p_period_id,
        'entries_created', v_entries_created,
        'validation', row_to_json(v_validation),
        'finalized', p_finalize AND NOT p_dry_run
    );
    
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object(
        'success', false,
        'error', SQLERRM
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- RPC: Build Excise Worksheet
-- ============================================================================

CREATE OR REPLACE FUNCTION build_excise_worksheet(
    p_period_start DATE,
    p_period_end DATE,
    p_workspace_id UUID DEFAULT NULL,
    p_dry_run BOOLEAN DEFAULT FALSE
)
RETURNS JSONB AS $$
DECLARE
    v_workspace_id UUID;
    v_net_taxable_bbl NUMERIC;
    v_ytd_used_bbl NUMERIC;
    v_tax_calc JSONB;
    v_worksheet_id UUID;
    v_frequency excise_filing_frequency;
BEGIN
    -- Use provided workspace or get from JWT
    v_workspace_id := COALESCE(p_workspace_id, get_jwt_workspace_id());
    
    -- Check permissions
    IF NOT (has_role('accounting') OR has_role('admin')) THEN
        RAISE EXCEPTION 'Insufficient permissions for excise operations';
    END IF;
    
    -- Get filing frequency from settings
    SELECT excise_default_frequency INTO v_frequency
    FROM settings_compliance
    WHERE workspace_id = v_workspace_id;
    
    IF v_frequency IS NULL THEN
        v_frequency := 'quarterly';  -- Default
    END IF;
    
    -- Calculate net taxable removals
    -- Net = Removals for consumption/sale - Returns in same period
    WITH removals AS (
        SELECT COALESCE(SUM(r.barrels), 0) as total_removed
        FROM removals r
        WHERE r.workspace_id = v_workspace_id
          AND r.removal_date >= p_period_start
          AND r.removal_date <= p_period_end
          AND r.is_taxable = true
          AND r.reason NOT IN ('return', 'destroyed')
    ),
    returns AS (
        SELECT COALESCE(SUM(r.barrels), 0) as total_returned
        FROM removals r
        WHERE r.workspace_id = v_workspace_id
          AND r.removal_date >= p_period_start
          AND r.removal_date <= p_period_end
          AND r.reason = 'return'
    )
    SELECT 
        removals.total_removed - returns.total_returned
    INTO v_net_taxable_bbl
    FROM removals, returns;
    
    -- Get YTD CBMA allocation used
    SELECT COALESCE(SUM(cbma_allocation_used_bbl), 0) INTO v_ytd_used_bbl
    FROM excise_worksheets
    WHERE workspace_id = v_workspace_id
      AND EXTRACT(YEAR FROM period_start) = EXTRACT(YEAR FROM p_period_start)
      AND period_end < p_period_start
      AND finalized_at IS NOT NULL;
    
    -- Calculate tax with CBMA rates
    v_tax_calc := compute_cbma_tax(v_net_taxable_bbl, v_ytd_used_bbl);
    
    -- Create worksheet if not dry run
    IF NOT p_dry_run THEN
        INSERT INTO excise_worksheets (
            workspace_id,
            period_start,
            period_end,
            filing_frequency,
            net_taxable_bbl,
            cbma_allocation_used_bbl,
            rate_bands,
            amount_due_cents,
            payload,
            created_by
        ) VALUES (
            v_workspace_id,
            p_period_start,
            p_period_end,
            v_frequency,
            v_net_taxable_bbl,
            LEAST(v_net_taxable_bbl + v_ytd_used_bbl, 60000) - v_ytd_used_bbl,
            v_tax_calc->'bands',
            (v_tax_calc->>'total_tax_cents')::BIGINT,
            jsonb_build_object(
                'calculation', v_tax_calc,
                'removals_detail', (
                    SELECT jsonb_agg(
                        jsonb_build_object(
                            'date', removal_date,
                            'lot_id', finished_lot_id,
                            'barrels', barrels,
                            'reason', reason,
                            'destination', destination_type
                        )
                    )
                    FROM removals
                    WHERE workspace_id = v_workspace_id
                      AND removal_date >= p_period_start
                      AND removal_date <= p_period_end
                      AND is_taxable = true
                )
            ),
            auth.uid()
        )
        RETURNING id INTO v_worksheet_id;
        
        -- Log telemetry
        INSERT INTO ui_events (
            event_name, workspace_id, entity_type, entity_id, form_type
        ) VALUES (
            'excise_worksheet_generated', v_workspace_id, 'excise_worksheet', v_worksheet_id, 'excise'
        );
    END IF;
    
    RETURN jsonb_build_object(
        'success', true,
        'worksheet_id', v_worksheet_id,
        'period_start', p_period_start,
        'period_end', p_period_end,
        'net_taxable_bbl', v_net_taxable_bbl,
        'tax_calculation', v_tax_calc,
        'due_date', p_period_end + INTERVAL '14 days'
    );
    
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object(
        'success', false,
        'error', SQLERRM
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- RPC: Create In-Bond Transfer
-- ============================================================================

CREATE OR REPLACE FUNCTION create_inbond_transfer(
    p_data JSONB,
    p_dry_run BOOLEAN DEFAULT FALSE
)
RETURNS JSONB AS $$
DECLARE
    v_transfer_id UUID;
    v_doc_number TEXT;
    v_workspace_id UUID;
    v_total_barrels NUMERIC := 0;
    v_line JSONB;
    v_line_barrels NUMERIC;
BEGIN
    v_workspace_id := get_jwt_workspace_id();
    
    -- Check permissions
    IF NOT (has_role('admin') OR has_role('accounting') OR 
            has_role('brewer') OR has_role('inventory')) THEN
        RAISE EXCEPTION 'Insufficient permissions for transfers';
    END IF;
    
    -- Generate document number
    v_doc_number := generate_transfer_doc_number(v_workspace_id);
    
    -- Calculate total barrels from lines
    FOR v_line IN SELECT * FROM jsonb_array_elements(p_data->'lines')
    LOOP
        v_line_barrels := calculate_barrels(
            (v_line->>'qty')::NUMERIC, 
            v_line->>'uom'
        );
        v_total_barrels := v_total_barrels + v_line_barrels;
    END LOOP;
    
    IF NOT p_dry_run THEN
        -- Create transfer record
        INSERT INTO inbond_transfers (
            workspace_id,
            doc_number,
            shipper_entity_id,
            receiver_entity_id,
            same_ownership,
            shipped_at,
            container_type,
            total_barrels,
            remarks,
            created_by
        ) VALUES (
            v_workspace_id,
            v_doc_number,
            (p_data->>'shipper_entity_id')::UUID,
            (p_data->>'receiver_entity_id')::UUID,
            COALESCE((p_data->>'same_ownership')::BOOLEAN, false),
            (p_data->>'shipped_at')::DATE,
            (p_data->>'container_type')::container_type,
            v_total_barrels,
            p_data->>'remarks',
            auth.uid()
        )
        RETURNING id INTO v_transfer_id;
        
        -- Create transfer lines
        FOR v_line IN SELECT * FROM jsonb_array_elements(p_data->'lines')
        LOOP
            INSERT INTO inbond_transfer_lines (
                transfer_id,
                finished_lot_id,
                bulk_reference,
                qty,
                uom,
                barrels
            ) VALUES (
                v_transfer_id,
                CASE 
                    WHEN v_line->>'finished_lot_id' != 'null' 
                    THEN (v_line->>'finished_lot_id')::UUID 
                    ELSE NULL 
                END,
                v_line->>'bulk_reference',
                (v_line->>'qty')::NUMERIC,
                v_line->>'uom',
                calculate_barrels((v_line->>'qty')::NUMERIC, v_line->>'uom')
            );
            
            -- Create inventory transaction for the transfer
            IF v_line->>'finished_lot_id' != 'null' THEN
                INSERT INTO inventory_transactions (
                    workspace_id,
                    type,
                    item_id,
                    item_lot_id,
                    quantity,
                    uom,
                    ref_type,
                    ref_id,
                    notes,
                    created_by
                )
                SELECT
                    v_workspace_id,
                    'in_bond'::inv_txn_type,
                    fl.sku_id,
                    (v_line->>'finished_lot_id')::UUID,
                    (v_line->>'qty')::NUMERIC * -1,  -- Negative for shipment
                    v_line->>'uom',
                    'inbond_transfer',
                    v_transfer_id,
                    'Transfer in bond - ' || v_doc_number,
                    auth.uid()
                FROM finished_lots fl
                WHERE fl.id = (v_line->>'finished_lot_id')::UUID;
            END IF;
        END LOOP;
        
        -- Log telemetry
        INSERT INTO ui_events (
            event_name, workspace_id, entity_type, entity_id
        ) VALUES (
            'inbond_transfer_created', v_workspace_id, 'inbond_transfer', v_transfer_id
        );
    END IF;
    
    RETURN jsonb_build_object(
        'success', true,
        'transfer_id', v_transfer_id,
        'doc_number', v_doc_number,
        'total_barrels', v_total_barrels,
        'pdf_url', '/api/compliance/transfers/' || v_transfer_id || '/pdf'
    );
    
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object(
        'success', false,
        'error', SQLERRM
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- RPC: Process Sales Ingest
-- ============================================================================

CREATE OR REPLACE FUNCTION process_sales_ingest(
    p_job_id UUID
)
RETURNS JSONB AS $$
DECLARE
    v_job RECORD;
    v_row RECORD;
    v_removal_id UUID;
    v_processed INTEGER := 0;
    v_failed INTEGER := 0;
    v_workspace_id UUID;
    v_sku_id UUID;
    v_lot_id UUID;
    v_barrels NUMERIC;
BEGIN
    -- Get job details
    SELECT * INTO v_job
    FROM sales_ingest_jobs
    WHERE id = p_job_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Sales ingest job not found';
    END IF;
    
    v_workspace_id := v_job.workspace_id;
    
    -- Update job status
    UPDATE sales_ingest_jobs
    SET status = 'processing'
    WHERE id = p_job_id;
    
    -- Process each row
    FOR v_row IN 
        SELECT * FROM sales_ingest_rows
        WHERE job_id = p_job_id
        AND status = 'pending'
    LOOP
        BEGIN
            -- Parse the row data based on mapping
            -- This is simplified - real implementation would use the mapping config
            
            -- Find the SKU
            SELECT id INTO v_sku_id
            FROM finished_skus
            WHERE workspace_id = v_workspace_id
              AND code = v_row.parsed_data->>'sku_code';
            
            IF NOT FOUND THEN
                RAISE EXCEPTION 'SKU not found: %', v_row.parsed_data->>'sku_code';
            END IF;
            
            -- Find an available lot (FIFO)
            SELECT id INTO v_lot_id
            FROM finished_lots
            WHERE sku_id = v_sku_id
              AND quantity > COALESCE((
                  SELECT SUM(qty) FROM removals WHERE finished_lot_id = finished_lots.id
              ), 0)
            ORDER BY created_at
            LIMIT 1;
            
            IF NOT FOUND THEN
                RAISE EXCEPTION 'No available inventory for SKU: %', v_row.parsed_data->>'sku_code';
            END IF;
            
            -- Calculate barrels
            v_barrels := calculate_barrels(
                (v_row.parsed_data->>'qty')::NUMERIC,
                COALESCE(v_row.parsed_data->>'uom', 'cases')
            );
            
            -- Create removal
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
            ) VALUES (
                v_workspace_id,
                v_lot_id,
                (v_row.parsed_data->>'date')::DATE,
                (v_row.parsed_data->>'qty')::NUMERIC,
                COALESCE(v_row.parsed_data->>'uom', 'cases'),
                v_barrels,
                CASE 
                    WHEN v_row.parsed_data->>'destination_type' = 'taproom' 
                    THEN 'consumption'::removal_reason
                    ELSE 'sale'::removal_reason
                END,
                true,  -- Assuming taxable
                v_row.parsed_data->>'doc_ref',
                v_row.parsed_data->>'destination_type',
                auth.uid()
            )
            RETURNING id INTO v_removal_id;
            
            -- Update row status
            UPDATE sales_ingest_rows
            SET status = 'processed',
                removal_id = v_removal_id
            WHERE id = v_row.id;
            
            v_processed := v_processed + 1;
            
        EXCEPTION WHEN OTHERS THEN
            -- Mark row as failed
            UPDATE sales_ingest_rows
            SET status = 'failed',
                error_text = SQLERRM
            WHERE id = v_row.id;
            
            v_failed := v_failed + 1;
        END;
    END LOOP;
    
    -- Update job status
    UPDATE sales_ingest_jobs
    SET status = CASE 
            WHEN v_failed = 0 THEN 'completed'
            WHEN v_processed = 0 THEN 'failed'
            ELSE 'completed_with_errors'
        END,
        processed_rows = v_processed,
        failed_rows = v_failed,
        completed_at = NOW()
    WHERE id = p_job_id;
    
    -- Log telemetry
    INSERT INTO ui_events (
        event_name, workspace_id, entity_type, entity_id
    ) VALUES (
        'sales_ingest_completed', v_workspace_id, 'sales_ingest_job', p_job_id
    );
    
    RETURN jsonb_build_object(
        'success', true,
        'job_id', p_job_id,
        'processed', v_processed,
        'failed', v_failed,
        'status', CASE 
            WHEN v_failed = 0 THEN 'completed'
            WHEN v_processed = 0 THEN 'failed'
            ELSE 'completed_with_errors'
        END
    );
    
EXCEPTION WHEN OTHERS THEN
    -- Update job as failed
    UPDATE sales_ingest_jobs
    SET status = 'failed',
        completed_at = NOW()
    WHERE id = p_job_id;
    
    RETURN jsonb_build_object(
        'success', false,
        'error', SQLERRM
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- RPC: Create TTB Period
-- ============================================================================

CREATE OR REPLACE FUNCTION create_ttb_period(
    p_type ttb_period_type,
    p_period_start DATE,
    p_period_end DATE
)
RETURNS UUID AS $$
DECLARE
    v_period_id UUID;
    v_workspace_id UUID;
    v_due_date DATE;
BEGIN
    v_workspace_id := get_jwt_workspace_id();
    
    -- Check permissions
    IF NOT (has_role('accounting') OR has_role('admin')) THEN
        RAISE EXCEPTION 'Insufficient permissions to create TTB periods';
    END IF;
    
    -- Calculate due date (15th day after period end)
    v_due_date := p_period_end + INTERVAL '15 days';
    
    -- Check for existing period
    IF EXISTS (
        SELECT 1 FROM ttb_periods
        WHERE workspace_id = v_workspace_id
          AND period_start = p_period_start
          AND period_end = p_period_end
    ) THEN
        RAISE EXCEPTION 'TTB period already exists for this date range';
    END IF;
    
    -- Create period
    INSERT INTO ttb_periods (
        workspace_id,
        type,
        period_start,
        period_end,
        due_date,
        status,
        created_by
    ) VALUES (
        v_workspace_id,
        p_type,
        p_period_start,
        p_period_end,
        v_due_date,
        'open',
        auth.uid()
    )
    RETURNING id INTO v_period_id;
    
    -- Log telemetry
    INSERT INTO ui_events (
        event_name, workspace_id, entity_type, entity_id
    ) VALUES (
        'ttb_period_created', v_workspace_id, 'ttb_period', v_period_id
    );
    
    RETURN v_period_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- RPC: Finalize Compliance Snapshot
-- ============================================================================

CREATE OR REPLACE FUNCTION finalize_compliance_snapshot(
    p_type TEXT,  -- 'brop', 'excise', 'transfer'
    p_entity_id UUID,
    p_pdf_url TEXT,
    p_csv_url TEXT,
    p_payload JSONB
)
RETURNS UUID AS $$
DECLARE
    v_snapshot_id UUID;
    v_workspace_id UUID;
    v_content_hash TEXT;
BEGIN
    v_workspace_id := get_jwt_workspace_id();
    
    -- Check permissions
    IF NOT (has_role('accounting') OR has_role('admin')) THEN
        RAISE EXCEPTION 'Insufficient permissions to create snapshots';
    END IF;
    
    -- Generate content hash
    v_content_hash := encode(
        sha256(convert_to(p_payload::TEXT, 'UTF8')),
        'hex'
    );
    
    -- Create immutable snapshot
    INSERT INTO compliance_snapshots (
        workspace_id,
        period_id,
        worksheet_id,
        snapshot_type,
        pdf_url,
        csv_url,
        content_hash,
        payload,
        created_by
    ) VALUES (
        v_workspace_id,
        CASE WHEN p_type = 'brop' THEN p_entity_id ELSE NULL END,
        CASE WHEN p_type = 'excise' THEN p_entity_id ELSE NULL END,
        p_type,
        p_pdf_url,
        p_csv_url,
        v_content_hash,
        p_payload,
        auth.uid()
    )
    RETURNING id INTO v_snapshot_id;
    
    -- Update the source entity as finalized
    IF p_type = 'brop' THEN
        UPDATE ttb_periods
        SET status = 'finalized',
            finalized_at = NOW(),
            finalized_by = auth.uid()
        WHERE id = p_entity_id;
    ELSIF p_type = 'excise' THEN
        UPDATE excise_worksheets
        SET finalized_at = NOW(),
            finalized_by = auth.uid()
        WHERE id = p_entity_id;
    END IF;
    
    RETURN v_snapshot_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION generate_ttb_period TO authenticated;
GRANT EXECUTE ON FUNCTION build_excise_worksheet TO authenticated;
GRANT EXECUTE ON FUNCTION create_inbond_transfer TO authenticated;
GRANT EXECUTE ON FUNCTION process_sales_ingest TO authenticated;
GRANT EXECUTE ON FUNCTION create_ttb_period TO authenticated;
GRANT EXECUTE ON FUNCTION finalize_compliance_snapshot TO authenticated;
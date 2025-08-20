-- Phase 6: Compliance Engine - BROP, Excise, Transfers in bond, Contract/Alt
-- Implements TTB regulatory requirements for reporting and tax compliance

-- ============================================================================
-- ENUMS
-- ============================================================================

-- TTB Period types (BROP filing frequency)
CREATE TYPE ttb_period_type AS ENUM ('monthly', 'quarterly');

-- TTB Period status
CREATE TYPE ttb_period_status AS ENUM ('open', 'draft', 'finalized');

-- Excise filing frequency
CREATE TYPE excise_filing_frequency AS ENUM ('semi_monthly', 'quarterly', 'annual');

-- TTB Entry categories (normalized for both 5130.9 & 5130.26)
CREATE TYPE ttb_entry_category AS ENUM (
    'opening',                  -- Beginning inventory
    'produced',                 -- Beer produced by fermentation
    'received_in_bond',         -- Received from other breweries
    'returned_to_brewery',      -- Previously taxpaid beer returned
    'overage',                  -- Physical inventory overage
    'special_addition',         -- TTB-directed entries
    'removed_tax_determined',   -- Removed for consumption/sale
    'removed_without_tax',      -- Exports, supplies, research (Subpart L)
    'consumed_on_premises',     -- Consumed on brewery premises (not tax determined)
    'destroyed',                -- Destroyed nontaxpaid
    'loss',                     -- Known losses
    'shortage',                 -- Inventory-revealed shortages
    'closing',                  -- Ending inventory
    'total',                    -- Computed totals
    'adjustment_add',           -- Prior period adjustments (additions)
    'adjustment_rem'            -- Prior period adjustments (removals)
);

-- Container types for transfers
CREATE TYPE container_type AS ENUM ('keg', 'case', 'bulk');

-- Add new removal reasons to existing enum
-- The base enum already exists with: sale, consumption, testing, destroyed, return
ALTER TYPE removal_reason ADD VALUE IF NOT EXISTS 'export';
ALTER TYPE removal_reason ADD VALUE IF NOT EXISTS 'supplies_vessels';
ALTER TYPE removal_reason ADD VALUE IF NOT EXISTS 'research';

-- ============================================================================
-- TABLES
-- ============================================================================

-- TTB Reporting Periods (BROP)
CREATE TABLE ttb_periods (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    type ttb_period_type NOT NULL,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    status ttb_period_status NOT NULL DEFAULT 'open',
    due_date DATE NOT NULL,
    filing_frequency_excise excise_filing_frequency,
    remarks TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID REFERENCES users(id),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by UUID REFERENCES users(id),
    finalized_at TIMESTAMPTZ,
    finalized_by UUID REFERENCES users(id),
    UNIQUE(workspace_id, period_start, period_end)
);

-- TTB Entries (line items for BROP)
CREATE TABLE ttb_entries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    period_id UUID NOT NULL REFERENCES ttb_periods(id) ON DELETE CASCADE,
    line_code TEXT NOT NULL, -- Maps to form line numbers
    category ttb_entry_category NOT NULL,
    quantity_bbl NUMERIC(12,2) NOT NULL DEFAULT 0,
    source_table TEXT, -- Reference to source data
    source_id UUID, -- Reference to source record
    owner_entity_id UUID REFERENCES ownership_entities(id),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID REFERENCES users(id),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by UUID REFERENCES users(id)
);

-- Excise Tax Worksheets
CREATE TABLE excise_worksheets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    period_id UUID REFERENCES ttb_periods(id),
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    filing_frequency excise_filing_frequency NOT NULL,
    net_taxable_bbl NUMERIC(12,2) NOT NULL DEFAULT 0,
    cbma_allocation_used_bbl INTEGER DEFAULT 0,
    rate_bands JSONB NOT NULL DEFAULT '[]'::JSONB, -- [{band, rate, qty_bbl, tax_cents}]
    amount_due_cents BIGINT NOT NULL DEFAULT 0,
    payload JSONB NOT NULL DEFAULT '{}'::JSONB, -- Full worksheet data
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID REFERENCES users(id),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by UUID REFERENCES users(id),
    finalized_at TIMESTAMPTZ,
    finalized_by UUID REFERENCES users(id)
);

-- Compliance Snapshots (immutable records)
CREATE TABLE compliance_snapshots (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    period_id UUID REFERENCES ttb_periods(id),
    worksheet_id UUID REFERENCES excise_worksheets(id),
    snapshot_type TEXT NOT NULL, -- 'brop', 'excise', 'transfer'
    pdf_url TEXT,
    csv_url TEXT,
    content_hash TEXT NOT NULL, -- SHA-256 of content
    payload JSONB NOT NULL, -- Full snapshot data
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID REFERENCES users(id)
    -- No updated_at/by - these are immutable
);

-- In-Bond Transfers
CREATE TABLE inbond_transfers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    doc_number TEXT NOT NULL, -- Serial number for transfer
    shipper_entity_id UUID NOT NULL REFERENCES ownership_entities(id),
    receiver_entity_id UUID NOT NULL REFERENCES ownership_entities(id),
    same_ownership BOOLEAN NOT NULL DEFAULT false,
    shipped_at DATE NOT NULL,
    received_at DATE,
    container_type container_type NOT NULL,
    total_barrels NUMERIC(12,2) NOT NULL,
    docs_url TEXT,
    remarks TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID REFERENCES users(id),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by UUID REFERENCES users(id),
    UNIQUE(workspace_id, doc_number)
);

-- In-Bond Transfer Line Items
CREATE TABLE inbond_transfer_lines (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    transfer_id UUID NOT NULL REFERENCES inbond_transfers(id) ON DELETE CASCADE,
    finished_lot_id UUID REFERENCES finished_lots(id),
    bulk_reference TEXT, -- For bulk transfers without specific lots
    qty NUMERIC(12,2) NOT NULL,
    uom TEXT NOT NULL,
    barrels NUMERIC(12,2) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Removals (for tracking taxable and non-taxable removals)
CREATE TABLE removals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    finished_lot_id UUID REFERENCES finished_lots(id),
    removal_date DATE NOT NULL,
    qty NUMERIC(12,2) NOT NULL,
    uom TEXT NOT NULL,
    barrels NUMERIC(12,2) NOT NULL,
    reason removal_reason NOT NULL,
    is_taxable BOOLEAN NOT NULL DEFAULT true,
    doc_ref TEXT, -- Reference document (invoice, etc.)
    destination_type TEXT, -- 'taproom', 'distributor', 'export', etc.
    customer_id UUID, -- Reference to customer if applicable
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID REFERENCES users(id),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by UUID REFERENCES users(id)
);

-- Sales Ingest Jobs (for CSV/API imports)
CREATE TABLE sales_ingest_jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    upload_id TEXT,
    status TEXT NOT NULL DEFAULT 'pending', -- pending, processing, completed, failed
    mapping JSONB NOT NULL DEFAULT '{}'::JSONB,
    idempotency_key TEXT NOT NULL,
    total_rows INTEGER DEFAULT 0,
    processed_rows INTEGER DEFAULT 0,
    failed_rows INTEGER DEFAULT 0,
    error_csv_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID REFERENCES users(id),
    completed_at TIMESTAMPTZ,
    UNIQUE(workspace_id, idempotency_key)
);

-- Sales Ingest Rows (individual records from imports)
CREATE TABLE sales_ingest_rows (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id UUID NOT NULL REFERENCES sales_ingest_jobs(id) ON DELETE CASCADE,
    row_number INTEGER NOT NULL,
    parsed_data JSONB NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', -- pending, processed, failed
    error_text TEXT,
    removal_id UUID REFERENCES removals(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Keg Deposit Entries (liability tracking)
CREATE TABLE keg_deposit_entries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    customer_id UUID, -- Reference to customer
    sku_id UUID REFERENCES finished_skus(id),
    entry_date DATE NOT NULL,
    qty INTEGER NOT NULL,
    amount_cents INTEGER NOT NULL,
    direction TEXT NOT NULL CHECK (direction IN ('charged', 'returned')),
    reference_doc TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID REFERENCES users(id),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by UUID REFERENCES users(id)
);

-- Compliance Settings (per workspace)
CREATE TABLE settings_compliance (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    brop_hard_stop BOOLEAN NOT NULL DEFAULT false, -- Warning vs error on reconciliation
    excise_default_frequency excise_filing_frequency DEFAULT 'quarterly',
    cbma_apportionment JSONB DEFAULT '{}'::JSONB, -- CBMA allocation settings
    return_serial_prefix TEXT, -- For excise return numbering
    controlled_group_key TEXT, -- For CBMA apportionment across entities
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID REFERENCES users(id),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by UUID REFERENCES users(id),
    UNIQUE(workspace_id)
);

-- Update ownership_entities table to add controlled group support
ALTER TABLE ownership_entities
ADD COLUMN IF NOT EXISTS controlled_group_key TEXT,
ADD COLUMN IF NOT EXISTS cbma_eligible BOOLEAN DEFAULT true;

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX idx_ttb_entries_period ON ttb_entries(period_id, category);
CREATE INDEX idx_ttb_entries_source ON ttb_entries(source_table, source_id);
CREATE INDEX idx_excise_worksheets_period ON excise_worksheets(period_start, period_end);
CREATE INDEX idx_inbond_transfers_shipped ON inbond_transfers(shipped_at);
CREATE INDEX idx_inbond_transfers_entities ON inbond_transfers(shipper_entity_id, receiver_entity_id);
CREATE INDEX idx_removals_date ON removals(workspace_id, removal_date);
CREATE INDEX idx_removals_lot ON removals(finished_lot_id);
CREATE INDEX idx_sales_ingest_jobs_status ON sales_ingest_jobs(workspace_id, status);
CREATE INDEX idx_keg_deposits_customer ON keg_deposit_entries(customer_id);
CREATE INDEX idx_ownership_entities_group ON ownership_entities(controlled_group_key) WHERE controlled_group_key IS NOT NULL;

-- ============================================================================
-- RLS POLICIES
-- ============================================================================

-- Enable RLS on all tables
ALTER TABLE ttb_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE ttb_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE excise_worksheets ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbond_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbond_transfer_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE removals ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_ingest_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_ingest_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE keg_deposit_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings_compliance ENABLE ROW LEVEL SECURITY;

-- TTB Periods policies
CREATE POLICY workspace_isolation_ttb_periods ON ttb_periods
    FOR ALL USING (workspace_id = get_jwt_workspace_id());

CREATE POLICY role_accounting_ttb_periods ON ttb_periods
    FOR ALL USING (has_role('accounting') OR has_role('admin'))
    WITH CHECK (has_role('accounting') OR has_role('admin'));

-- TTB Entries policies
CREATE POLICY workspace_isolation_ttb_entries ON ttb_entries
    FOR ALL USING (workspace_id = get_jwt_workspace_id());

CREATE POLICY role_accounting_ttb_entries ON ttb_entries
    FOR ALL USING (has_role('accounting') OR has_role('admin'))
    WITH CHECK (has_role('accounting') OR has_role('admin'));

-- Contract viewer can see their own entries
CREATE POLICY contract_viewer_ttb_entries ON ttb_entries
    FOR SELECT USING (
        has_role('contract_viewer') AND 
        owner_entity_id IN (
            SELECT id FROM ownership_entities 
            WHERE workspace_id = get_jwt_workspace_id()
        )
    );

-- Excise Worksheets policies
CREATE POLICY workspace_isolation_excise ON excise_worksheets
    FOR ALL USING (workspace_id = get_jwt_workspace_id());

CREATE POLICY role_accounting_excise ON excise_worksheets
    FOR ALL USING (has_role('accounting') OR has_role('admin'))
    WITH CHECK (has_role('accounting') OR has_role('admin'));

-- Compliance Snapshots policies (immutable - no update/delete)
CREATE POLICY workspace_isolation_snapshots ON compliance_snapshots
    FOR SELECT USING (workspace_id = get_jwt_workspace_id());

CREATE POLICY role_create_snapshots ON compliance_snapshots
    FOR INSERT WITH CHECK (
        workspace_id = get_jwt_workspace_id() AND
        (has_role('accounting') OR has_role('admin'))
    );

-- No UPDATE or DELETE policies - snapshots are immutable

-- In-Bond Transfers policies
CREATE POLICY workspace_isolation_transfers ON inbond_transfers
    FOR ALL USING (workspace_id = get_jwt_workspace_id());

CREATE POLICY role_transfers ON inbond_transfers
    FOR ALL USING (
        has_role('admin') OR 
        has_role('accounting') OR 
        has_role('brewer') OR
        has_role('inventory')
    )
    WITH CHECK (
        has_role('admin') OR 
        has_role('accounting') OR 
        has_role('brewer') OR
        has_role('inventory')
    );

-- In-Bond Transfer Lines policies
CREATE POLICY workspace_isolation_transfer_lines ON inbond_transfer_lines
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM inbond_transfers
            WHERE id = inbond_transfer_lines.transfer_id
            AND workspace_id = get_jwt_workspace_id()
        )
    );

-- Removals policies
CREATE POLICY workspace_isolation_removals ON removals
    FOR ALL USING (workspace_id = get_jwt_workspace_id());

CREATE POLICY role_removals ON removals
    FOR ALL USING (
        has_role('admin') OR 
        has_role('accounting') OR 
        has_role('inventory')
    )
    WITH CHECK (
        has_role('admin') OR 
        has_role('accounting') OR 
        has_role('inventory')
    );

-- Sales Ingest policies
CREATE POLICY workspace_isolation_ingest_jobs ON sales_ingest_jobs
    FOR ALL USING (workspace_id = get_jwt_workspace_id());

CREATE POLICY role_ingest_jobs ON sales_ingest_jobs
    FOR ALL USING (has_role('accounting') OR has_role('admin'))
    WITH CHECK (has_role('accounting') OR has_role('admin'));

CREATE POLICY workspace_isolation_ingest_rows ON sales_ingest_rows
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM sales_ingest_jobs
            WHERE id = sales_ingest_rows.job_id
            AND workspace_id = get_jwt_workspace_id()
        )
    );

-- Keg Deposit policies
CREATE POLICY workspace_isolation_keg_deposits ON keg_deposit_entries
    FOR ALL USING (workspace_id = get_jwt_workspace_id());

CREATE POLICY role_keg_deposits ON keg_deposit_entries
    FOR ALL USING (
        has_role('admin') OR 
        has_role('accounting') OR 
        has_role('inventory')
    )
    WITH CHECK (
        has_role('admin') OR 
        has_role('accounting') OR 
        has_role('inventory')
    );

-- Settings Compliance policies
CREATE POLICY workspace_isolation_settings ON settings_compliance
    FOR ALL USING (workspace_id = get_jwt_workspace_id());

CREATE POLICY role_settings ON settings_compliance
    FOR ALL USING (has_role('admin'))
    WITH CHECK (has_role('admin'));

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Update triggers for updated_at
CREATE TRIGGER update_ttb_periods_updated_at BEFORE UPDATE ON ttb_periods
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_ttb_entries_updated_at BEFORE UPDATE ON ttb_entries
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_excise_worksheets_updated_at BEFORE UPDATE ON excise_worksheets
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_inbond_transfers_updated_at BEFORE UPDATE ON inbond_transfers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_removals_updated_at BEFORE UPDATE ON removals
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_keg_deposits_updated_at BEFORE UPDATE ON keg_deposit_entries
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_settings_compliance_updated_at BEFORE UPDATE ON settings_compliance
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Trigger to create inventory transactions for removals
CREATE OR REPLACE FUNCTION process_removal_transaction()
RETURNS TRIGGER AS $$
BEGIN
    -- Create inventory transaction for the removal
    INSERT INTO inventory_transactions (
        workspace_id,
        type,
        item_id,
        item_lot_id,
        location_id,
        quantity,
        uom,
        ref_type,
        ref_id,
        notes,
        created_by
    )
    SELECT
        NEW.workspace_id,
        CASE 
            WHEN NEW.reason = 'destroyed' THEN 'destroy'::inv_txn_type
            ELSE 'ship'::inv_txn_type
        END,
        fl.sku_id,
        NEW.finished_lot_id,
        NULL, -- Location will be determined by the lot
        NEW.qty * -1, -- Negative for removal
        NEW.uom,
        'removal',
        NEW.id,
        NEW.notes,
        NEW.created_by
    FROM finished_lots fl
    WHERE fl.id = NEW.finished_lot_id;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER create_removal_transaction
    AFTER INSERT ON removals
    FOR EACH ROW
    EXECUTE FUNCTION process_removal_transaction();

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Function to generate next document number for transfers
CREATE OR REPLACE FUNCTION generate_transfer_doc_number(p_workspace_id UUID)
RETURNS TEXT AS $$
DECLARE
    v_year TEXT;
    v_sequence INTEGER;
    v_doc_number TEXT;
BEGIN
    v_year := TO_CHAR(NOW(), 'YYYY');
    
    -- Get the next sequence number for this workspace and year
    SELECT COALESCE(MAX(
        CAST(
            SUBSTRING(doc_number FROM '\d+$') AS INTEGER
        )
    ), 0) + 1
    INTO v_sequence
    FROM inbond_transfers
    WHERE workspace_id = p_workspace_id
    AND doc_number LIKE v_year || '-%';
    
    v_doc_number := v_year || '-' || LPAD(v_sequence::TEXT, 6, '0');
    
    RETURN v_doc_number;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to calculate barrels from various units
CREATE OR REPLACE FUNCTION calculate_barrels(p_qty NUMERIC, p_uom TEXT)
RETURNS NUMERIC AS $$
BEGIN
    -- 1 barrel = 31 gallons
    RETURN CASE 
        WHEN LOWER(p_uom) = 'bbl' THEN p_qty
        WHEN LOWER(p_uom) = 'gal' THEN p_qty / 31.0
        WHEN LOWER(p_uom) = 'l' THEN p_qty / 117.348  -- 31 gal = 117.348 L
        WHEN LOWER(p_uom) = 'hl' THEN p_qty * 0.852168  -- 1 hL = 0.852168 bbl
        ELSE 0  -- Unknown unit
    END;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to validate TTB period reconciliation
CREATE OR REPLACE FUNCTION validate_reconciliation(p_period_id UUID)
RETURNS TABLE(
    is_valid BOOLEAN,
    opening_bbl NUMERIC,
    produced_bbl NUMERIC,
    received_bbl NUMERIC,
    returned_bbl NUMERIC,
    removed_tax_bbl NUMERIC,
    removed_notax_bbl NUMERIC,
    consumed_bbl NUMERIC,
    destroyed_bbl NUMERIC,
    losses_bbl NUMERIC,
    closing_bbl NUMERIC,
    calculated_closing NUMERIC,
    variance NUMERIC,
    anomalies JSONB
) AS $$
DECLARE
    v_opening NUMERIC;
    v_produced NUMERIC;
    v_received NUMERIC;
    v_returned NUMERIC;
    v_removed_tax NUMERIC;
    v_removed_notax NUMERIC;
    v_consumed NUMERIC;
    v_destroyed NUMERIC;
    v_losses NUMERIC;
    v_closing NUMERIC;
    v_calculated NUMERIC;
    v_anomalies JSONB := '[]'::JSONB;
BEGIN
    -- Get opening balance
    SELECT COALESCE(SUM(quantity_bbl), 0) INTO v_opening
    FROM ttb_entries
    WHERE period_id = p_period_id AND category = 'opening';
    
    -- Get production
    SELECT COALESCE(SUM(quantity_bbl), 0) INTO v_produced
    FROM ttb_entries
    WHERE period_id = p_period_id AND category = 'produced';
    
    -- Get received in bond
    SELECT COALESCE(SUM(quantity_bbl), 0) INTO v_received
    FROM ttb_entries
    WHERE period_id = p_period_id AND category = 'received_in_bond';
    
    -- Get returned
    SELECT COALESCE(SUM(quantity_bbl), 0) INTO v_returned
    FROM ttb_entries
    WHERE period_id = p_period_id AND category = 'returned_to_brewery';
    
    -- Get removals (tax determined)
    SELECT COALESCE(SUM(quantity_bbl), 0) INTO v_removed_tax
    FROM ttb_entries
    WHERE period_id = p_period_id AND category = 'removed_tax_determined';
    
    -- Get removals (without tax)
    SELECT COALESCE(SUM(quantity_bbl), 0) INTO v_removed_notax
    FROM ttb_entries
    WHERE period_id = p_period_id AND category = 'removed_without_tax';
    
    -- Get consumed on premises
    SELECT COALESCE(SUM(quantity_bbl), 0) INTO v_consumed
    FROM ttb_entries
    WHERE period_id = p_period_id AND category = 'consumed_on_premises';
    
    -- Get destroyed
    SELECT COALESCE(SUM(quantity_bbl), 0) INTO v_destroyed
    FROM ttb_entries
    WHERE period_id = p_period_id AND category = 'destroyed';
    
    -- Get losses (loss + shortage)
    SELECT COALESCE(SUM(quantity_bbl), 0) INTO v_losses
    FROM ttb_entries
    WHERE period_id = p_period_id AND category IN ('loss', 'shortage');
    
    -- Get closing balance
    SELECT COALESCE(SUM(quantity_bbl), 0) INTO v_closing
    FROM ttb_entries
    WHERE period_id = p_period_id AND category = 'closing';
    
    -- Calculate what closing should be
    -- OPENING + PRODUCED + RECEIVED + RETURNED - REMOVED_TAX - REMOVED_NOTAX - CONSUMED - DESTROYED - LOSSES = CLOSING
    v_calculated := v_opening + v_produced + v_received + v_returned 
                    - v_removed_tax - v_removed_notax - v_consumed - v_destroyed - v_losses;
    
    -- Check for anomalies
    IF v_closing < 0 THEN
        v_anomalies := v_anomalies || jsonb_build_object(
            'type', 'negative_closing',
            'message', 'Closing balance is negative'
        );
    END IF;
    
    IF v_losses > 0 AND NOT EXISTS (
        SELECT 1 FROM ttb_entries 
        WHERE period_id = p_period_id 
        AND category IN ('loss', 'shortage') 
        AND notes IS NOT NULL AND notes != ''
    ) THEN
        v_anomalies := v_anomalies || jsonb_build_object(
            'type', 'unexplained_losses',
            'message', 'Losses/shortages require explanation'
        );
    END IF;
    
    RETURN QUERY SELECT
        ABS(v_calculated - v_closing) < 0.01, -- Valid if variance < 0.01 bbl
        v_opening,
        v_produced,
        v_received,
        v_returned,
        v_removed_tax,
        v_removed_notax,
        v_consumed,
        v_destroyed,
        v_losses,
        v_closing,
        v_calculated,
        v_calculated - v_closing,
        v_anomalies;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to compute CBMA tax with rate bands
CREATE OR REPLACE FUNCTION compute_cbma_tax(
    p_taxable_bbl NUMERIC,
    p_ytd_used_bbl NUMERIC DEFAULT 0
)
RETURNS JSONB AS $$
DECLARE
    v_remaining_60k NUMERIC;
    v_first_band_bbl NUMERIC;
    v_second_band_bbl NUMERIC;
    v_standard_band_bbl NUMERIC;
    v_total_tax_cents BIGINT := 0;
    v_bands JSONB := '[]'::JSONB;
BEGIN
    -- CBMA rates (cents per barrel):
    -- First 60,000 bbl: $3.50/bbl = 350 cents
    -- 60,001 to 6,000,000 bbl: $16/bbl = 1600 cents
    -- Over 6,000,000 bbl: $18/bbl = 1800 cents (standard rate)
    
    -- Calculate remaining in 60k pool
    v_remaining_60k := GREATEST(0, 60000 - p_ytd_used_bbl);
    
    -- Allocate to bands
    IF p_taxable_bbl <= v_remaining_60k THEN
        -- All in first band
        v_first_band_bbl := p_taxable_bbl;
        v_second_band_bbl := 0;
        v_standard_band_bbl := 0;
    ELSIF p_ytd_used_bbl < 60000 THEN
        -- Some in first band, rest in second
        v_first_band_bbl := v_remaining_60k;
        v_second_band_bbl := p_taxable_bbl - v_remaining_60k;
        v_standard_band_bbl := 0;
    ELSIF p_ytd_used_bbl < 6000000 THEN
        -- All in second band (unless exceeds 6M)
        v_first_band_bbl := 0;
        v_second_band_bbl := LEAST(p_taxable_bbl, 6000000 - p_ytd_used_bbl);
        v_standard_band_bbl := GREATEST(0, p_taxable_bbl - v_second_band_bbl);
    ELSE
        -- All in standard band
        v_first_band_bbl := 0;
        v_second_band_bbl := 0;
        v_standard_band_bbl := p_taxable_bbl;
    END IF;
    
    -- Build bands array and calculate total
    IF v_first_band_bbl > 0 THEN
        v_bands := v_bands || jsonb_build_object(
            'band', 'first_60k',
            'rate_cents', 350,
            'qty_bbl', v_first_band_bbl,
            'tax_cents', (v_first_band_bbl * 350)::BIGINT
        );
        v_total_tax_cents := v_total_tax_cents + (v_first_band_bbl * 350)::BIGINT;
    END IF;
    
    IF v_second_band_bbl > 0 THEN
        v_bands := v_bands || jsonb_build_object(
            'band', '60k_to_6m',
            'rate_cents', 1600,
            'qty_bbl', v_second_band_bbl,
            'tax_cents', (v_second_band_bbl * 1600)::BIGINT
        );
        v_total_tax_cents := v_total_tax_cents + (v_second_band_bbl * 1600)::BIGINT;
    END IF;
    
    IF v_standard_band_bbl > 0 THEN
        v_bands := v_bands || jsonb_build_object(
            'band', 'over_6m',
            'rate_cents', 1800,
            'qty_bbl', v_standard_band_bbl,
            'tax_cents', (v_standard_band_bbl * 1800)::BIGINT
        );
        v_total_tax_cents := v_total_tax_cents + (v_standard_band_bbl * 1800)::BIGINT;
    END IF;
    
    RETURN jsonb_build_object(
        'taxable_bbl', p_taxable_bbl,
        'ytd_used_bbl', p_ytd_used_bbl,
        'bands', v_bands,
        'total_tax_cents', v_total_tax_cents,
        'total_tax_dollars', (v_total_tax_cents / 100.0)
    );
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Grant execute permissions on functions
GRANT EXECUTE ON FUNCTION generate_transfer_doc_number TO authenticated;
GRANT EXECUTE ON FUNCTION calculate_barrels TO authenticated;
GRANT EXECUTE ON FUNCTION validate_reconciliation TO authenticated;
GRANT EXECUTE ON FUNCTION compute_cbma_tax TO authenticated;

-- ============================================================================
-- TELEMETRY
-- ============================================================================

-- Telemetry events are logged through ui_events table in the RPC functions
-- See phase6_compliance_rpcs.sql for actual telemetry implementation
-- Production, Tanks, Fermentation & Yeast tables

-- Tanks table
CREATE TABLE tanks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type tank_type NOT NULL,
  capacity DECIMAL NOT NULL, -- in liters
  current_batch_id UUID, -- References batches(id) - will be added after batches table
  cip_status cip_status NOT NULL DEFAULT 'clean',
  last_cip_date TIMESTAMPTZ,
  location_id UUID REFERENCES inventory_locations(id),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES users(id),
  UNIQUE(workspace_id, name)
);

-- Recipes table
CREATE TABLE recipes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  recipe_code TEXT,
  style TEXT,
  target_volume DECIMAL, -- liters
  target_og DECIMAL,
  target_fg DECIMAL,
  target_abv DECIMAL,
  target_ibu DECIMAL,
  target_srm DECIMAL,
  efficiency_pct DECIMAL DEFAULT 75,
  notes TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES users(id)
);

-- Recipe versions table
CREATE TABLE recipe_versions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  recipe_id UUID NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  name TEXT NOT NULL,
  target_volume DECIMAL,
  target_og DECIMAL,
  target_fg DECIMAL,
  target_abv DECIMAL,
  target_ibu DECIMAL,
  target_srm DECIMAL,
  target_ph DECIMAL,
  efficiency_pct DECIMAL DEFAULT 75,
  mash_steps JSONB DEFAULT '[]'::jsonb,
  boil_time INTEGER DEFAULT 60, -- minutes
  fermentation_steps JSONB DEFAULT '[]'::jsonb,
  notes TEXT,
  qa_specs JSONB DEFAULT '{}'::jsonb, -- QA specification ranges
  overhead_pct DECIMAL DEFAULT 0, -- overhead cost percentage
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  UNIQUE(recipe_id, version_number)
);

-- Recipe ingredients table
CREATE TABLE recipe_ingredients (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  recipe_version_id UUID NOT NULL REFERENCES recipe_versions(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES items(id),
  qty DECIMAL NOT NULL,
  uom TEXT NOT NULL,
  phase TEXT NOT NULL, -- mash, boil, fermentation, dry_hop, packaging
  timing TEXT, -- e.g., "60 min", "flame out", "day 3"
  notes TEXT,
  sort_order INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES users(id)
);

-- Yeast strains table
CREATE TABLE yeast_strains (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  manufacturer TEXT,
  strain_code TEXT,
  type TEXT, -- ale, lager, wild, bacteria
  form TEXT, -- liquid, dry
  attenuation_min DECIMAL,
  attenuation_max DECIMAL,
  temp_min DECIMAL,
  temp_max DECIMAL,
  flocculation TEXT, -- low, medium, high
  recommended_max_generation INTEGER DEFAULT 10,
  notes TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES users(id),
  UNIQUE(workspace_id, name)
);

-- Yeast batches table
CREATE TABLE yeast_batches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  strain_id UUID NOT NULL REFERENCES yeast_strains(id),
  generation INTEGER NOT NULL DEFAULT 0,
  source_batch_id UUID REFERENCES yeast_batches(id), -- parent yeast batch
  pitch_date DATE,
  harvest_date DATE,
  cell_count DECIMAL,
  viability_pct DECIMAL,
  volume DECIMAL, -- liters
  storage_location TEXT,
  notes TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES users(id)
);

-- Ownership entities (for contract brewing)
CREATE TABLE ownership_entities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  ttb_permit_number TEXT,
  address TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  is_self BOOLEAN DEFAULT false, -- marks the brewery's own entity
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES users(id),
  UNIQUE(workspace_id, name)
);

-- Batches table
CREATE TABLE batches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  batch_number TEXT NOT NULL,
  recipe_version_id UUID NOT NULL REFERENCES recipe_versions(id),
  status batch_status NOT NULL DEFAULT 'planned',
  brew_date DATE,
  target_volume DECIMAL, -- liters
  actual_volume DECIMAL,
  target_og DECIMAL,
  actual_og DECIMAL,
  target_fg DECIMAL,
  actual_fg DECIMAL,
  actual_abv DECIMAL,
  actual_ibu DECIMAL,
  actual_ph DECIMAL,
  tank_id UUID REFERENCES tanks(id),
  yeast_batch_id UUID REFERENCES yeast_batches(id),
  owner_entity_id UUID REFERENCES ownership_entities(id), -- for contract brewing
  in_bond BOOLEAN DEFAULT false,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES users(id),
  UNIQUE(workspace_id, batch_number)
);

-- Add foreign key to tanks table
ALTER TABLE tanks ADD CONSTRAINT fk_tanks_current_batch 
  FOREIGN KEY (current_batch_id) REFERENCES batches(id);

-- Batch yeast links table
CREATE TABLE batch_yeast_links (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  batch_id UUID NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  yeast_batch_id UUID NOT NULL REFERENCES yeast_batches(id),
  role TEXT NOT NULL, -- pitched, harvested_from
  pitch_rate DECIMAL, -- cells/ml/°P
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES users(id)
);

-- Fermentation readings table (partitioned by month)
CREATE TABLE ferm_readings (
  id UUID DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  batch_id UUID NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  reading_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sg DECIMAL,
  temp DECIMAL,
  ph DECIMAL,
  pressure DECIMAL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  PRIMARY KEY (id, reading_at)
) PARTITION BY RANGE (reading_at);

-- Create initial partitions for ferm_readings
CREATE TABLE ferm_readings_2025_01 PARTITION OF ferm_readings
  FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');
CREATE TABLE ferm_readings_2025_02 PARTITION OF ferm_readings
  FOR VALUES FROM ('2025-02-01') TO ('2025-03-01');
CREATE TABLE ferm_readings_2025_03 PARTITION OF ferm_readings
  FOR VALUES FROM ('2025-03-01') TO ('2025-04-01');

-- Finished SKUs table
CREATE TABLE finished_skus (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  sku_code TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL, -- keg, can, bottle
  size_ml INTEGER NOT NULL,
  units_per_pack INTEGER DEFAULT 1,
  deposit_amount DECIMAL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES users(id),
  UNIQUE(workspace_id, sku_code)
);

-- Lot code templates table
CREATE TABLE lot_code_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  pattern TEXT NOT NULL, -- e.g., '{YY}{JJJ}-{BATCH}-{SKU}'
  description TEXT,
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES users(id),
  UNIQUE(workspace_id, name)
);

-- Packaging runs table
CREATE TABLE packaging_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  run_number TEXT NOT NULL,
  packaging_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sku_id UUID NOT NULL REFERENCES finished_skus(id),
  total_produced INTEGER NOT NULL,
  loss_pct DECIMAL DEFAULT 0,
  cost_method_used cost_method NOT NULL DEFAULT 'actual_lots',
  lot_code_template_id UUID REFERENCES lot_code_templates(id),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES users(id),
  UNIQUE(workspace_id, run_number)
);

-- Packaging run sources (for blends)
CREATE TABLE packaging_run_sources (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  run_id UUID NOT NULL REFERENCES packaging_runs(id) ON DELETE CASCADE,
  batch_id UUID NOT NULL REFERENCES batches(id),
  volume_liters DECIMAL NOT NULL,
  allocation_pct DECIMAL NOT NULL, -- for COGS allocation
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES users(id)
);

-- Finished lots table
CREATE TABLE finished_lots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  sku_id UUID NOT NULL REFERENCES finished_skus(id),
  lot_code TEXT NOT NULL,
  packaging_run_id UUID NOT NULL REFERENCES packaging_runs(id),
  produced_qty INTEGER NOT NULL,
  remaining_qty INTEGER NOT NULL,
  unit_cost DECIMAL,
  owner_entity_id UUID REFERENCES ownership_entities(id), -- for contract products
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES users(id),
  UNIQUE(workspace_id, lot_code)
);

-- Enable RLS
ALTER TABLE tanks ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipes ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipe_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipe_ingredients ENABLE ROW LEVEL SECURITY;
ALTER TABLE yeast_strains ENABLE ROW LEVEL SECURITY;
ALTER TABLE yeast_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE ownership_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE batch_yeast_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE ferm_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE finished_skus ENABLE ROW LEVEL SECURITY;
ALTER TABLE lot_code_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE packaging_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE packaging_run_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE finished_lots ENABLE ROW LEVEL SECURITY;

-- RLS Policies (workspace isolation)
CREATE POLICY workspace_isolation_tanks ON tanks
  FOR ALL USING (workspace_id = get_jwt_workspace_id());

CREATE POLICY workspace_isolation_recipes ON recipes
  FOR ALL USING (workspace_id = get_jwt_workspace_id());

CREATE POLICY workspace_isolation_recipe_versions ON recipe_versions
  FOR ALL USING (workspace_id = get_jwt_workspace_id());

CREATE POLICY workspace_isolation_recipe_ingredients ON recipe_ingredients
  FOR ALL USING (workspace_id = get_jwt_workspace_id());

CREATE POLICY workspace_isolation_yeast_strains ON yeast_strains
  FOR ALL USING (workspace_id = get_jwt_workspace_id());

CREATE POLICY workspace_isolation_yeast_batches ON yeast_batches
  FOR ALL USING (workspace_id = get_jwt_workspace_id());

CREATE POLICY workspace_isolation_ownership_entities ON ownership_entities
  FOR ALL USING (workspace_id = get_jwt_workspace_id());

CREATE POLICY workspace_isolation_batches ON batches
  FOR ALL USING (workspace_id = get_jwt_workspace_id());

CREATE POLICY workspace_isolation_batch_yeast_links ON batch_yeast_links
  FOR ALL USING (workspace_id = get_jwt_workspace_id());

CREATE POLICY workspace_isolation_ferm_readings ON ferm_readings
  FOR ALL USING (workspace_id = get_jwt_workspace_id());

CREATE POLICY workspace_isolation_finished_skus ON finished_skus
  FOR ALL USING (workspace_id = get_jwt_workspace_id());

CREATE POLICY workspace_isolation_lot_code_templates ON lot_code_templates
  FOR ALL USING (workspace_id = get_jwt_workspace_id());

CREATE POLICY workspace_isolation_packaging_runs ON packaging_runs
  FOR ALL USING (workspace_id = get_jwt_workspace_id());

CREATE POLICY workspace_isolation_packaging_run_sources ON packaging_run_sources
  FOR ALL USING (workspace_id = get_jwt_workspace_id());

CREATE POLICY workspace_isolation_finished_lots ON finished_lots
  FOR ALL USING (workspace_id = get_jwt_workspace_id());

-- Indexes
CREATE INDEX idx_tanks_workspace ON tanks(workspace_id);
CREATE INDEX idx_recipes_workspace ON recipes(workspace_id);
CREATE INDEX idx_recipe_versions_recipe ON recipe_versions(recipe_id);
CREATE INDEX idx_recipe_ingredients_version ON recipe_ingredients(recipe_version_id);
CREATE INDEX idx_batches_workspace_status ON batches(workspace_id, status);
CREATE INDEX idx_batches_tank ON batches(tank_id);
CREATE INDEX idx_ferm_readings_batch ON ferm_readings(batch_id, reading_at DESC);
CREATE INDEX idx_packaging_runs_workspace ON packaging_runs(workspace_id);
CREATE INDEX idx_packaging_run_sources_run ON packaging_run_sources(run_id);
CREATE INDEX idx_finished_lots_sku ON finished_lots(sku_id);

-- Triggers
CREATE TRIGGER update_tanks_updated_at BEFORE UPDATE ON tanks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_recipes_updated_at BEFORE UPDATE ON recipes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_yeast_strains_updated_at BEFORE UPDATE ON yeast_strains
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_yeast_batches_updated_at BEFORE UPDATE ON yeast_batches
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_ownership_entities_updated_at BEFORE UPDATE ON ownership_entities
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_batches_updated_at BEFORE UPDATE ON batches
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_finished_skus_updated_at BEFORE UPDATE ON finished_skus
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_lot_code_templates_updated_at BEFORE UPDATE ON lot_code_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_packaging_runs_updated_at BEFORE UPDATE ON packaging_runs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_finished_lots_updated_at BEFORE UPDATE ON finished_lots
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
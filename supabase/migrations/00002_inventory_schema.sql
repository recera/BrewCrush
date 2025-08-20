-- Inventory tables

-- Vendors table
CREATE TABLE vendors (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  address TEXT,
  terms TEXT,
  contacts JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES users(id),
  UNIQUE(workspace_id, name)
);

-- Inventory locations table
CREATE TABLE inventory_locations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'warehouse', -- warehouse, tank, taproom, bond
  address TEXT,
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES users(id),
  UNIQUE(workspace_id, name)
);

-- Items table
CREATE TABLE items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sku TEXT,
  type item_type NOT NULL,
  category TEXT,
  subcategory TEXT,
  uom TEXT NOT NULL, -- unit of measure
  conversions JSONB NOT NULL DEFAULT '{}'::jsonb,
  reorder_level DECIMAL,
  reorder_qty DECIMAL,
  vendor_id UUID REFERENCES vendors(id),
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES users(id),
  UNIQUE(workspace_id, name),
  UNIQUE(workspace_id, sku)
);

-- Item lots table
CREATE TABLE item_lots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  lot_code TEXT NOT NULL,
  qty DECIMAL NOT NULL CHECK (qty >= 0),
  uom TEXT NOT NULL,
  unit_cost DECIMAL,
  expiry DATE,
  location_id UUID NOT NULL REFERENCES inventory_locations(id),
  received_date DATE,
  fifo_index INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES users(id),
  UNIQUE(workspace_id, item_id, lot_code)
);

-- Inventory transactions table
CREATE TABLE inventory_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  type inv_txn_type NOT NULL,
  item_id UUID NOT NULL REFERENCES items(id),
  item_lot_id UUID REFERENCES item_lots(id),
  qty DECIMAL NOT NULL,
  uom TEXT NOT NULL,
  unit_cost DECIMAL,
  from_location_id UUID REFERENCES inventory_locations(id),
  to_location_id UUID REFERENCES inventory_locations(id),
  ref_type TEXT, -- po_receipt_line, packaging_run, batch, adjustment, etc.
  ref_id UUID,
  notes TEXT,
  transaction_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES users(id)
);

-- Supplier price history table
CREATE TABLE supplier_price_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  vendor_id UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  receipt_date DATE NOT NULL,
  unit_cost DECIMAL NOT NULL,
  uom TEXT NOT NULL,
  qty_received DECIMAL,
  po_number TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES users(id)
);

-- Purchase orders table
CREATE TABLE purchase_orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  po_number TEXT NOT NULL,
  vendor_id UUID NOT NULL REFERENCES vendors(id),
  status po_status NOT NULL DEFAULT 'draft',
  order_date DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date DATE,
  terms TEXT,
  notes TEXT,
  subtotal DECIMAL,
  tax DECIMAL,
  total DECIMAL,
  approved_by UUID REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES users(id),
  UNIQUE(workspace_id, po_number)
);

-- PO lines table
CREATE TABLE po_lines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  po_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES items(id),
  qty DECIMAL NOT NULL,
  uom TEXT NOT NULL,
  expected_unit_cost DECIMAL NOT NULL,
  location_id UUID NOT NULL REFERENCES inventory_locations(id),
  qty_received DECIMAL DEFAULT 0,
  notes TEXT,
  line_number INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES users(id)
);

-- PO receipts table
CREATE TABLE po_receipts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  po_id UUID NOT NULL REFERENCES purchase_orders(id),
  receipt_number TEXT NOT NULL,
  received_by UUID NOT NULL REFERENCES users(id),
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  UNIQUE(workspace_id, receipt_number)
);

-- PO receipt lines table
CREATE TABLE po_receipt_lines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  po_receipt_id UUID NOT NULL REFERENCES po_receipts(id) ON DELETE CASCADE,
  po_line_id UUID NOT NULL REFERENCES po_lines(id),
  qty_received DECIMAL NOT NULL,
  unit_cost DECIMAL NOT NULL,
  lot_code TEXT NOT NULL,
  expiry DATE,
  location_id UUID NOT NULL REFERENCES inventory_locations(id),
  item_lot_id UUID REFERENCES item_lots(id), -- Set after lot creation
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES users(id)
);

-- Enable RLS
ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE items ENABLE ROW LEVEL SECURITY;
ALTER TABLE item_lots ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_price_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE po_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE po_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE po_receipt_lines ENABLE ROW LEVEL SECURITY;

-- Create base RLS policy for workspace isolation (applies to all inventory tables)
CREATE POLICY workspace_isolation_vendors ON vendors
  FOR ALL USING (workspace_id = get_jwt_workspace_id());

CREATE POLICY workspace_isolation_locations ON inventory_locations
  FOR ALL USING (workspace_id = get_jwt_workspace_id());

CREATE POLICY workspace_isolation_items ON items
  FOR ALL USING (workspace_id = get_jwt_workspace_id());

CREATE POLICY workspace_isolation_lots ON item_lots
  FOR ALL USING (workspace_id = get_jwt_workspace_id());

CREATE POLICY workspace_isolation_transactions ON inventory_transactions
  FOR ALL USING (workspace_id = get_jwt_workspace_id());

CREATE POLICY workspace_isolation_price_history ON supplier_price_history
  FOR ALL USING (workspace_id = get_jwt_workspace_id());

CREATE POLICY workspace_isolation_pos ON purchase_orders
  FOR ALL USING (workspace_id = get_jwt_workspace_id());

CREATE POLICY workspace_isolation_po_lines ON po_lines
  FOR ALL USING (workspace_id = get_jwt_workspace_id());

CREATE POLICY workspace_isolation_receipts ON po_receipts
  FOR ALL USING (workspace_id = get_jwt_workspace_id());

CREATE POLICY workspace_isolation_receipt_lines ON po_receipt_lines
  FOR ALL USING (workspace_id = get_jwt_workspace_id());

-- Indexes
CREATE INDEX idx_items_workspace ON items(workspace_id);
CREATE INDEX idx_items_type ON items(workspace_id, type);
CREATE INDEX idx_item_lots_item ON item_lots(item_id);
CREATE INDEX idx_item_lots_location ON item_lots(location_id);
CREATE INDEX idx_inventory_transactions_item ON inventory_transactions(item_id);
CREATE INDEX idx_inventory_transactions_ref ON inventory_transactions(ref_type, ref_id);
CREATE INDEX idx_inventory_transactions_date ON inventory_transactions(workspace_id, transaction_date DESC);
CREATE INDEX idx_supplier_price_history_item_vendor ON supplier_price_history(item_id, vendor_id);
CREATE INDEX idx_purchase_orders_vendor ON purchase_orders(vendor_id);
CREATE INDEX idx_purchase_orders_status ON purchase_orders(workspace_id, status);
CREATE INDEX idx_po_lines_po ON po_lines(po_id);

-- Triggers
CREATE TRIGGER update_vendors_updated_at BEFORE UPDATE ON vendors
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_inventory_locations_updated_at BEFORE UPDATE ON inventory_locations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_items_updated_at BEFORE UPDATE ON items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_item_lots_updated_at BEFORE UPDATE ON item_lots
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_purchase_orders_updated_at BEFORE UPDATE ON purchase_orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_po_lines_updated_at BEFORE UPDATE ON po_lines
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";

-- Create custom types
CREATE TYPE user_role AS ENUM ('admin', 'brewer', 'inventory', 'accounting', 'contract_viewer');
CREATE TYPE item_type AS ENUM ('raw', 'packaging', 'finished', 'misc');
CREATE TYPE inv_txn_type AS ENUM ('receive', 'consume', 'adjust', 'transfer', 'produce', 'package', 'ship', 'destroy', 'return', 'in_bond');
CREATE TYPE po_status AS ENUM ('draft', 'approved', 'partial', 'received', 'closed');
CREATE TYPE batch_status AS ENUM ('planned', 'brewing', 'fermenting', 'conditioning', 'packaging', 'packaged', 'closed');
CREATE TYPE tank_type AS ENUM ('fermenter', 'brite', 'other');
CREATE TYPE cip_status AS ENUM ('clean', 'dirty', 'in_progress');
CREATE TYPE removal_reason AS ENUM ('sale', 'consumption', 'testing', 'destroyed', 'return');
CREATE TYPE cost_method AS ENUM ('actual_lots', 'moving_avg');

-- Create workspaces table
CREATE TABLE workspaces (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'trial',
  stripe_customer_id TEXT,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create users table (shadow of auth.users)
CREATE TABLE users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create user_workspace_roles table
CREATE TABLE user_workspace_roles (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  role user_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, workspace_id)
);

-- Create audit_logs table (immutable)
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  entity_table TEXT NOT NULL,
  entity_id UUID,
  action TEXT NOT NULL, -- insert, update, delete, command
  before JSONB,
  after JSONB,
  actor_user_id UUID REFERENCES users(id),
  idempotency_key TEXT,
  prev_hash TEXT,
  curr_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Helper functions for RLS
CREATE OR REPLACE FUNCTION get_jwt_workspace_id() 
RETURNS UUID AS $$
BEGIN
  RETURN COALESCE(
    current_setting('request.jwt.claims', true)::json->>'workspace_id',
    NULL
  )::UUID;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION get_jwt_user_id() 
RETURNS UUID AS $$
BEGIN
  RETURN COALESCE(
    current_setting('request.jwt.claims', true)::json->>'sub',
    auth.uid()
  )::UUID;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION has_role(required_role user_role) 
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM user_workspace_roles
    WHERE user_id = get_jwt_user_id()
      AND workspace_id = get_jwt_workspace_id()
      AND (role = required_role OR role = 'admin')
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION has_any_role(required_roles user_role[]) 
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM user_workspace_roles
    WHERE user_id = get_jwt_user_id()
      AND workspace_id = get_jwt_workspace_id()
      AND (role = ANY(required_roles) OR role = 'admin')
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Enable RLS on all tables
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_workspace_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- RLS Policies for workspaces
CREATE POLICY workspace_select ON workspaces
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM user_workspace_roles
      WHERE workspace_id = workspaces.id
        AND user_id = get_jwt_user_id()
    )
  );

CREATE POLICY workspace_insert ON workspaces
  FOR INSERT WITH CHECK (false); -- Only through functions

CREATE POLICY workspace_update ON workspaces
  FOR UPDATE USING (has_role('admin'));

-- RLS Policies for users
CREATE POLICY users_select ON users
  FOR SELECT USING (true); -- Can see all users

CREATE POLICY users_insert ON users
  FOR INSERT WITH CHECK (id = auth.uid());

CREATE POLICY users_update ON users
  FOR UPDATE USING (id = auth.uid());

-- RLS Policies for user_workspace_roles
CREATE POLICY roles_select ON user_workspace_roles
  FOR SELECT USING (
    workspace_id = get_jwt_workspace_id()
    OR user_id = get_jwt_user_id()
  );

CREATE POLICY roles_insert ON user_workspace_roles
  FOR INSERT WITH CHECK (has_role('admin'));

CREATE POLICY roles_update ON user_workspace_roles
  FOR UPDATE USING (has_role('admin'));

CREATE POLICY roles_delete ON user_workspace_roles
  FOR DELETE USING (has_role('admin'));

-- RLS Policies for audit_logs (immutable - insert only)
CREATE POLICY audit_select ON audit_logs
  FOR SELECT USING (workspace_id = get_jwt_workspace_id());

CREATE POLICY audit_insert ON audit_logs
  FOR INSERT WITH CHECK (workspace_id = get_jwt_workspace_id());

-- Indexes
CREATE INDEX idx_user_workspace_roles_user ON user_workspace_roles(user_id);
CREATE INDEX idx_user_workspace_roles_workspace ON user_workspace_roles(workspace_id);
CREATE INDEX idx_audit_logs_workspace ON audit_logs(workspace_id);
CREATE INDEX idx_audit_logs_entity ON audit_logs(entity_table, entity_id);
CREATE INDEX idx_audit_logs_created ON audit_logs(created_at DESC);

-- Triggers
CREATE TRIGGER update_workspaces_updated_at BEFORE UPDATE ON workspaces
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_workspace_roles_updated_at BEFORE UPDATE ON user_workspace_roles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
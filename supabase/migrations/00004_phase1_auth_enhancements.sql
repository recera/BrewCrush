-- Phase 1: Authentication, Roles, and Enhanced RLS
-- This migration enhances the auth system with workspace creation,
-- invite flows, and cost visibility redaction

-- =====================================================
-- WORKSPACE MANAGEMENT FUNCTIONS
-- =====================================================

-- Function to create a new workspace and assign creator as admin
CREATE OR REPLACE FUNCTION create_workspace(
  workspace_name TEXT
) RETURNS UUID AS $$
DECLARE
  new_workspace_id UUID;
  current_user_id UUID;
BEGIN
  -- Get current user
  current_user_id := auth.uid();
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'User not authenticated';
  END IF;

  -- Check if user already has a workspace
  IF EXISTS (
    SELECT 1 FROM user_workspace_roles 
    WHERE user_id = current_user_id
  ) THEN
    RAISE EXCEPTION 'User already belongs to a workspace';
  END IF;

  -- Create workspace
  INSERT INTO workspaces (name, plan)
  VALUES (workspace_name, 'trial')
  RETURNING id INTO new_workspace_id;

  -- Assign user as admin
  INSERT INTO user_workspace_roles (user_id, workspace_id, role)
  VALUES (current_user_id, new_workspace_id, 'admin');

  -- Create initial audit log entry
  INSERT INTO audit_logs (
    workspace_id,
    entity_table,
    entity_id,
    action,
    after,
    actor_user_id,
    curr_hash
  ) VALUES (
    new_workspace_id,
    'workspaces',
    new_workspace_id,
    'insert',
    jsonb_build_object('name', workspace_name, 'plan', 'trial'),
    current_user_id,
    encode(sha256(('workspace_created_' || new_workspace_id::text || current_user_id::text)::bytea), 'hex')
  );

  RETURN new_workspace_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- INVITE SYSTEM
-- =====================================================

-- Create invites table
CREATE TABLE IF NOT EXISTS workspace_invites (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role user_role NOT NULL,
  invite_code TEXT NOT NULL UNIQUE DEFAULT substr(md5(random()::text), 1, 8),
  invited_by UUID NOT NULL REFERENCES users(id),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
  accepted_at TIMESTAMPTZ,
  accepted_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS on invites
ALTER TABLE workspace_invites ENABLE ROW LEVEL SECURITY;

-- RLS policies for invites
CREATE POLICY invites_select ON workspace_invites
  FOR SELECT USING (
    workspace_id = get_jwt_workspace_id() AND has_role('admin')
    OR email = (SELECT email FROM users WHERE id = get_jwt_user_id())
  );

CREATE POLICY invites_insert ON workspace_invites
  FOR INSERT WITH CHECK (
    workspace_id = get_jwt_workspace_id() AND has_role('admin')
  );

CREATE POLICY invites_update ON workspace_invites
  FOR UPDATE USING (
    email = (SELECT email FROM users WHERE id = get_jwt_user_id())
    AND accepted_at IS NULL
    AND expires_at > NOW()
  );

-- Function to create an invite
CREATE OR REPLACE FUNCTION create_workspace_invite(
  target_email TEXT,
  target_role user_role
) RETURNS TEXT AS $$
DECLARE
  invite_code TEXT;
  current_workspace_id UUID;
  current_user_id UUID;
BEGIN
  current_user_id := get_jwt_user_id();
  current_workspace_id := get_jwt_workspace_id();

  IF NOT has_role('admin') THEN
    RAISE EXCEPTION 'Only admins can create invites';
  END IF;

  -- Create invite
  INSERT INTO workspace_invites (
    workspace_id,
    email,
    role,
    invited_by
  ) VALUES (
    current_workspace_id,
    target_email,
    target_role,
    current_user_id
  ) RETURNING invite_code INTO invite_code;

  -- Audit log
  INSERT INTO audit_logs (
    workspace_id,
    entity_table,
    action,
    after,
    actor_user_id,
    curr_hash
  ) VALUES (
    current_workspace_id,
    'workspace_invites',
    'insert',
    jsonb_build_object('email', target_email, 'role', target_role),
    current_user_id,
    encode(sha256((current_workspace_id::text || target_email || target_role::text)::bytea), 'hex')
  );

  RETURN invite_code;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to join workspace with invite code
CREATE OR REPLACE FUNCTION join_workspace_with_invite(
  invite_code TEXT
) RETURNS UUID AS $$
DECLARE
  invite_record RECORD;
  current_user_id UUID;
  current_user_email TEXT;
BEGIN
  current_user_id := auth.uid();
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'User not authenticated';
  END IF;

  -- Get user email
  SELECT email INTO current_user_email
  FROM users
  WHERE id = current_user_id;

  -- Find valid invite
  SELECT * INTO invite_record
  FROM workspace_invites
  WHERE workspace_invites.invite_code = join_workspace_with_invite.invite_code
    AND (email = current_user_email OR email = '*')  -- Allow wildcard invites
    AND accepted_at IS NULL
    AND expires_at > NOW();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid or expired invite code';
  END IF;

  -- Check if user already has a workspace
  IF EXISTS (
    SELECT 1 FROM user_workspace_roles 
    WHERE user_id = current_user_id
  ) THEN
    RAISE EXCEPTION 'User already belongs to a workspace';
  END IF;

  -- Add user to workspace
  INSERT INTO user_workspace_roles (user_id, workspace_id, role)
  VALUES (current_user_id, invite_record.workspace_id, invite_record.role);

  -- Mark invite as accepted
  UPDATE workspace_invites
  SET accepted_at = NOW(), accepted_by = current_user_id
  WHERE id = invite_record.id;

  -- Audit log
  INSERT INTO audit_logs (
    workspace_id,
    entity_table,
    action,
    after,
    actor_user_id,
    curr_hash
  ) VALUES (
    invite_record.workspace_id,
    'user_workspace_roles',
    'insert',
    jsonb_build_object('user_id', current_user_id, 'role', invite_record.role),
    current_user_id,
    encode(sha256((invite_record.workspace_id::text || current_user_id::text)::bytea), 'hex')
  );

  RETURN invite_record.workspace_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- COST VISIBILITY FUNCTIONS AND VIEWS
-- =====================================================

-- Function to check if current user has cost visibility
CREATE OR REPLACE FUNCTION has_cost_visibility() 
RETURNS BOOLEAN AS $$
BEGIN
  RETURN has_any_role(ARRAY['admin', 'inventory', 'accounting']::user_role[]);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to redact cost if user doesn't have permission
CREATE OR REPLACE FUNCTION redact_cost(cost NUMERIC) 
RETURNS NUMERIC AS $$
BEGIN
  IF has_cost_visibility() THEN
    RETURN cost;
  ELSE
    RETURN NULL;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- AUDIT LOG HASH CHAIN VERIFICATION
-- =====================================================

-- Function to compute hash for audit log entry
CREATE OR REPLACE FUNCTION compute_audit_hash(
  prev_hash TEXT,
  entity_table TEXT,
  entity_id UUID,
  action TEXT,
  actor_user_id UUID,
  after JSONB
) RETURNS TEXT AS $$
BEGIN
  RETURN encode(
    sha256(
      (
        COALESCE(prev_hash, '') || 
        entity_table || 
        COALESCE(entity_id::text, '') || 
        action || 
        actor_user_id::text || 
        after::text
      )::bytea
    ), 
    'hex'
  );
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Trigger to automatically compute and verify hash chain
CREATE OR REPLACE FUNCTION audit_log_hash_chain_trigger()
RETURNS TRIGGER AS $$
DECLARE
  last_hash TEXT;
BEGIN
  -- Get the hash from the most recent audit log entry for this workspace
  SELECT curr_hash INTO last_hash
  FROM audit_logs
  WHERE workspace_id = NEW.workspace_id
  ORDER BY created_at DESC
  LIMIT 1;

  -- Set prev_hash
  NEW.prev_hash := last_hash;

  -- Compute current hash
  NEW.curr_hash := compute_audit_hash(
    NEW.prev_hash,
    NEW.entity_table,
    NEW.entity_id,
    NEW.action,
    NEW.actor_user_id,
    NEW.after
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for audit log hash chain
DROP TRIGGER IF EXISTS audit_log_hash_chain ON audit_logs;
CREATE TRIGGER audit_log_hash_chain
  BEFORE INSERT ON audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION audit_log_hash_chain_trigger();

-- Function to verify audit log integrity
CREATE OR REPLACE FUNCTION verify_audit_log_integrity(
  workspace_id_param UUID,
  start_date TIMESTAMPTZ DEFAULT NULL,
  end_date TIMESTAMPTZ DEFAULT NULL
) RETURNS TABLE (
  is_valid BOOLEAN,
  invalid_entries INTEGER,
  total_entries INTEGER
) AS $$
DECLARE
  entry RECORD;
  expected_hash TEXT;
  invalid_count INTEGER := 0;
  total_count INTEGER := 0;
  prev_hash TEXT := NULL;
BEGIN
  FOR entry IN 
    SELECT *
    FROM audit_logs
    WHERE workspace_id = workspace_id_param
      AND (start_date IS NULL OR created_at >= start_date)
      AND (end_date IS NULL OR created_at <= end_date)
    ORDER BY created_at ASC
  LOOP
    total_count := total_count + 1;
    
    -- Compute expected hash
    expected_hash := compute_audit_hash(
      prev_hash,
      entry.entity_table,
      entry.entity_id,
      entry.action,
      entry.actor_user_id,
      entry.after
    );
    
    -- Check if hash matches
    IF entry.curr_hash != expected_hash THEN
      invalid_count := invalid_count + 1;
    END IF;
    
    prev_hash := entry.curr_hash;
  END LOOP;

  RETURN QUERY 
  SELECT 
    (invalid_count = 0) AS is_valid,
    invalid_count AS invalid_entries,
    total_count AS total_entries;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- ENHANCED RLS FOR CONTRACT VIEWER ROLE
-- =====================================================

-- Function to check if user is contract viewer
CREATE OR REPLACE FUNCTION is_contract_viewer() 
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM user_workspace_roles
    WHERE user_id = get_jwt_user_id()
      AND workspace_id = get_jwt_workspace_id()
      AND role = 'contract_viewer'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- INDEXES FOR PERFORMANCE
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_invites_code ON workspace_invites(invite_code);
CREATE INDEX IF NOT EXISTS idx_invites_workspace ON workspace_invites(workspace_id);
CREATE INDEX IF NOT EXISTS idx_invites_expires ON workspace_invites(expires_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_hash ON audit_logs(curr_hash);

-- =====================================================
-- GRANT PERMISSIONS
-- =====================================================

GRANT EXECUTE ON FUNCTION create_workspace TO authenticated;
GRANT EXECUTE ON FUNCTION create_workspace_invite TO authenticated;
GRANT EXECUTE ON FUNCTION join_workspace_with_invite TO authenticated;
GRANT EXECUTE ON FUNCTION has_cost_visibility TO authenticated;
GRANT EXECUTE ON FUNCTION redact_cost TO authenticated;
GRANT EXECUTE ON FUNCTION verify_audit_log_integrity TO authenticated;
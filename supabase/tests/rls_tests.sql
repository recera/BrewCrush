-- RLS Tests for BrewCrush Phase 1
-- These tests verify that Row Level Security policies work correctly
-- Run with: supabase test db

BEGIN;

-- Load pgTAP extension if not already loaded
CREATE EXTENSION IF NOT EXISTS pgtap;

-- Start test suite
SELECT plan(50); -- Adjust based on number of tests

-- =====================================================
-- TEST SETUP
-- =====================================================

-- Create test workspace and users
INSERT INTO workspaces (id, name, plan) VALUES 
  ('11111111-1111-1111-1111-111111111111', 'Test Brewery 1', 'trial'),
  ('22222222-2222-2222-2222-222222222222', 'Test Brewery 2', 'trial');

-- Create test users in auth.users (simulated)
INSERT INTO auth.users (id, email) VALUES 
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'admin@test.com'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'brewer@test.com'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'inventory@test.com'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'accounting@test.com'),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'contract@test.com'),
  ('ffffffff-ffff-ffff-ffff-ffffffffffff', 'other@test.com');

-- Create user profiles
INSERT INTO users (id, email, full_name) VALUES 
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'admin@test.com', 'Admin User'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'brewer@test.com', 'Brewer User'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'inventory@test.com', 'Inventory User'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'accounting@test.com', 'Accounting User'),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'contract@test.com', 'Contract Viewer'),
  ('ffffffff-ffff-ffff-ffff-ffffffffffff', 'other@test.com', 'Other Workspace User');

-- Assign roles to workspace 1
INSERT INTO user_workspace_roles (user_id, workspace_id, role) VALUES 
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'admin'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '11111111-1111-1111-1111-111111111111', 'brewer'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'inventory'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', '11111111-1111-1111-1111-111111111111', 'accounting'),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '11111111-1111-1111-1111-111111111111', 'contract_viewer');

-- User in different workspace
INSERT INTO user_workspace_roles (user_id, workspace_id, role) VALUES 
  ('ffffffff-ffff-ffff-ffff-ffffffffffff', '22222222-2222-2222-2222-222222222222', 'admin');

-- =====================================================
-- TEST: WORKSPACE ISOLATION
-- =====================================================

-- Test that users can only see their own workspace
PREPARE workspace_isolation AS
  SELECT COUNT(*) FROM workspaces;

-- Set JWT claims for user in workspace 1
SET request.jwt.claims = '{"sub": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "workspace_id": "11111111-1111-1111-1111-111111111111"}';

SELECT results_eq(
  'workspace_isolation',
  ARRAY[1::bigint],
  'Admin should only see their own workspace'
);

-- Test that user from different workspace cannot see workspace 1
SET request.jwt.claims = '{"sub": "ffffffff-ffff-ffff-ffff-ffffffffffff", "workspace_id": "22222222-2222-2222-2222-222222222222"}';

PREPARE other_workspace AS
  SELECT COUNT(*) FROM workspaces WHERE id = '11111111-1111-1111-1111-111111111111';

SELECT results_eq(
  'other_workspace',
  ARRAY[0::bigint],
  'User from different workspace cannot see workspace 1'
);

-- =====================================================
-- TEST: ROLE-BASED ACCESS
-- =====================================================

-- Test admin can see all users in workspace
SET request.jwt.claims = '{"sub": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "workspace_id": "11111111-1111-1111-1111-111111111111"}';

PREPARE admin_see_roles AS
  SELECT COUNT(*) FROM user_workspace_roles WHERE workspace_id = '11111111-1111-1111-1111-111111111111';

SELECT results_eq(
  'admin_see_roles',
  ARRAY[5::bigint],
  'Admin can see all 5 users in workspace'
);

-- Test non-admin can only see themselves
SET request.jwt.claims = '{"sub": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", "workspace_id": "11111111-1111-1111-1111-111111111111"}';

PREPARE brewer_see_roles AS
  SELECT COUNT(*) FROM user_workspace_roles 
  WHERE workspace_id = '11111111-1111-1111-1111-111111111111'
    AND user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

SELECT results_eq(
  'brewer_see_roles',
  ARRAY[1::bigint],
  'Brewer can only see their own role'
);

-- =====================================================
-- TEST: AUDIT LOG IMMUTABILITY
-- =====================================================

-- Insert audit log as admin
SET request.jwt.claims = '{"sub": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "workspace_id": "11111111-1111-1111-1111-111111111111"}';

INSERT INTO audit_logs (
  workspace_id,
  entity_table,
  entity_id,
  action,
  after,
  actor_user_id,
  curr_hash
) VALUES (
  '11111111-1111-1111-1111-111111111111',
  'test_table',
  '99999999-9999-9999-9999-999999999999',
  'insert',
  '{"test": "data"}'::jsonb,
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'test_hash_001'
);

-- Test that audit log cannot be updated
PREPARE audit_update_test AS
  UPDATE audit_logs 
  SET action = 'update' 
  WHERE curr_hash = 'test_hash_001'
  RETURNING id;

SELECT is_empty(
  'audit_update_test',
  'Audit logs cannot be updated (immutable)'
);

-- Test that audit log cannot be deleted
PREPARE audit_delete_test AS
  DELETE FROM audit_logs 
  WHERE curr_hash = 'test_hash_001'
  RETURNING id;

SELECT is_empty(
  'audit_delete_test',
  'Audit logs cannot be deleted (immutable)'
);

-- =====================================================
-- TEST: COST VISIBILITY
-- =====================================================

-- Test that has_cost_visibility returns correct values for different roles

-- Admin should have cost visibility
SET request.jwt.claims = '{"sub": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "workspace_id": "11111111-1111-1111-1111-111111111111"}';
SELECT ok(has_cost_visibility(), 'Admin has cost visibility');

-- Brewer should NOT have cost visibility (unless brewer_plus)
SET request.jwt.claims = '{"sub": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", "workspace_id": "11111111-1111-1111-1111-111111111111"}';
SELECT ok(NOT has_cost_visibility(), 'Brewer does not have cost visibility');

-- Inventory should have cost visibility
SET request.jwt.claims = '{"sub": "cccccccc-cccc-cccc-cccc-cccccccccccc", "workspace_id": "11111111-1111-1111-1111-111111111111"}';
SELECT ok(has_cost_visibility(), 'Inventory has cost visibility');

-- Accounting should have cost visibility
SET request.jwt.claims = '{"sub": "dddddddd-dddd-dddd-dddd-dddddddddddd", "workspace_id": "11111111-1111-1111-1111-111111111111"}';
SELECT ok(has_cost_visibility(), 'Accounting has cost visibility');

-- Contract viewer should NOT have cost visibility
SET request.jwt.claims = '{"sub": "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee", "workspace_id": "11111111-1111-1111-1111-111111111111"}';
SELECT ok(NOT has_cost_visibility(), 'Contract viewer does not have cost visibility');

-- =====================================================
-- TEST: INVITE SYSTEM
-- =====================================================

-- Test admin can create invites
SET request.jwt.claims = '{"sub": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "workspace_id": "11111111-1111-1111-1111-111111111111"}';

INSERT INTO workspace_invites (
  workspace_id,
  email,
  role,
  invited_by
) VALUES (
  '11111111-1111-1111-1111-111111111111',
  'newuser@test.com',
  'brewer',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
);

PREPARE admin_see_invites AS
  SELECT COUNT(*) FROM workspace_invites 
  WHERE workspace_id = '11111111-1111-1111-1111-111111111111';

SELECT results_eq(
  'admin_see_invites',
  ARRAY[1::bigint],
  'Admin can create and see invites'
);

-- Test non-admin cannot create invites
SET request.jwt.claims = '{"sub": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", "workspace_id": "11111111-1111-1111-1111-111111111111"}';

PREPARE brewer_create_invite AS
  INSERT INTO workspace_invites (
    workspace_id,
    email,
    role,
    invited_by
  ) VALUES (
    '11111111-1111-1111-1111-111111111111',
    'another@test.com',
    'brewer',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
  ) RETURNING id;

SELECT is_empty(
  'brewer_create_invite',
  'Non-admin cannot create invites'
);

-- =====================================================
-- TEST: CONTRACT VIEWER RESTRICTIONS
-- =====================================================

-- Create test data with owner entities
SET request.jwt.claims = '{"sub": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "workspace_id": "11111111-1111-1111-1111-111111111111"}';

-- Test contract viewer function
SET request.jwt.claims = '{"sub": "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee", "workspace_id": "11111111-1111-1111-1111-111111111111"}';
SELECT ok(is_contract_viewer(), 'Contract viewer role is correctly identified');

-- =====================================================
-- TEST: HELPER FUNCTIONS
-- =====================================================

-- Test get_jwt_workspace_id
SET request.jwt.claims = '{"sub": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "workspace_id": "11111111-1111-1111-1111-111111111111"}';

SELECT is(
  get_jwt_workspace_id(),
  '11111111-1111-1111-1111-111111111111'::uuid,
  'get_jwt_workspace_id returns correct workspace'
);

-- Test get_jwt_user_id
SELECT is(
  get_jwt_user_id(),
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  'get_jwt_user_id returns correct user'
);

-- Test has_role
SELECT ok(has_role('admin'), 'Admin has admin role');
SELECT ok(NOT has_role('brewer'), 'Admin does not have brewer role (but has admin which supersedes)');

SET request.jwt.claims = '{"sub": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", "workspace_id": "11111111-1111-1111-1111-111111111111"}';
SELECT ok(has_role('brewer'), 'Brewer has brewer role');
SELECT ok(NOT has_role('admin'), 'Brewer does not have admin role');

-- Test has_any_role
SELECT ok(has_any_role(ARRAY['brewer', 'admin']::user_role[]), 'Brewer matches has_any_role with brewer in array');
SELECT ok(NOT has_any_role(ARRAY['admin', 'accounting']::user_role[]), 'Brewer does not match has_any_role without brewer in array');

-- =====================================================
-- TEST: AUDIT LOG HASH CHAIN
-- =====================================================

-- Test verify_audit_log_integrity function
SET request.jwt.claims = '{"sub": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "workspace_id": "11111111-1111-1111-1111-111111111111"}';

-- Insert a few audit logs to test chain
INSERT INTO audit_logs (
  workspace_id,
  entity_table,
  entity_id,
  action,
  after,
  actor_user_id
) VALUES 
  ('11111111-1111-1111-1111-111111111111', 'test', '11111111-1111-1111-1111-111111111111'::uuid, 'insert', '{"test": 1}'::jsonb, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('11111111-1111-1111-1111-111111111111', 'test', '11111111-1111-1111-1111-111111111111'::uuid, 'update', '{"test": 2}'::jsonb, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

-- Verify integrity
PREPARE verify_integrity AS
  SELECT is_valid FROM verify_audit_log_integrity('11111111-1111-1111-1111-111111111111');

SELECT results_eq(
  'verify_integrity',
  ARRAY[true],
  'Audit log hash chain is valid'
);

-- =====================================================
-- TEST CLEANUP
-- =====================================================

-- Clean up test data
DELETE FROM audit_logs WHERE workspace_id IN ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222');
DELETE FROM workspace_invites WHERE workspace_id IN ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222');
DELETE FROM user_workspace_roles WHERE workspace_id IN ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222');
DELETE FROM users WHERE id IN ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'ffffffff-ffff-ffff-ffff-ffffffffffff');
DELETE FROM auth.users WHERE id IN ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'ffffffff-ffff-ffff-ffff-ffffffffffff');
DELETE FROM workspaces WHERE id IN ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222');

-- Finish tests
SELECT * FROM finish();

ROLLBACK;
-- Fix enum and type issues before applying critical fixes

-- ========================================
-- 1. ADD CANCELLED STATUS TO PO_STATUS ENUM
-- ========================================

-- First, check if 'cancelled' already exists in the enum
DO $$
BEGIN
  -- Add 'cancelled' to po_status enum if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum 
    WHERE enumlabel = 'cancelled' 
    AND enumtypid = 'po_status'::regtype
  ) THEN
    ALTER TYPE po_status ADD VALUE IF NOT EXISTS 'cancelled' AFTER 'closed';
  END IF;
END $$;

-- ========================================
-- 2. CREATE ROLE ENUM IF IT DOESN'T EXIST
-- ========================================

DO $$
BEGIN
  -- Check if role type exists
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'role') THEN
    CREATE TYPE role AS ENUM (
      'admin',
      'brewer',
      'inventory',
      'accounting',
      'contract_viewer'
    );
  END IF;
END $$;

-- ========================================
-- 3. DROP EXISTING FUNCTIONS THAT NEED UPDATES
-- ========================================

-- Drop the old version of get_low_stock_reorder_suggestions
DROP FUNCTION IF EXISTS get_low_stock_reorder_suggestions(UUID);

-- ========================================
-- 4. FIX HAS_ROLE FUNCTION TO ACCEPT TEXT
-- ========================================

-- Drop existing has_role if it exists with wrong signature
DROP FUNCTION IF EXISTS has_role(role);
DROP FUNCTION IF EXISTS has_role(TEXT);

-- Create has_role function that works with role enum
CREATE OR REPLACE FUNCTION has_role(p_role TEXT)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM user_workspace_roles
    WHERE user_id = auth.uid()
      AND workspace_id = get_jwt_workspace_id()
      AND role::text = p_role
  );
$$;

-- ========================================
-- 5. ENSURE AUTH SCHEMA EXISTS
-- ========================================

-- Create auth schema if it doesn't exist (for local dev)
CREATE SCHEMA IF NOT EXISTS auth;

-- Create auth.uid() function if it doesn't exist
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS UUID
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('request.jwt.claims', true)::json->>'sub', '')::UUID;
$$;

-- ========================================
-- 6. ENSURE GET_JWT_WORKSPACE_ID EXISTS
-- ========================================

CREATE OR REPLACE FUNCTION get_jwt_workspace_id()
RETURNS UUID
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claims', true)::json->>'workspace_id', '')::UUID,
    (SELECT workspace_id FROM user_workspace_roles WHERE user_id = auth.uid() LIMIT 1)
  );
$$;

-- ========================================
-- 7. ENSURE HAS_COST_VISIBILITY EXISTS
-- ========================================

CREATE OR REPLACE FUNCTION has_cost_visibility()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM user_workspace_roles
    WHERE user_id = auth.uid()
      AND workspace_id = get_jwt_workspace_id()
      AND role::text IN ('admin', 'inventory', 'accounting')
  );
$$;
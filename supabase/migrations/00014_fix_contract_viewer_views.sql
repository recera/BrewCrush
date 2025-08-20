-- Fix for contract viewer views - creates missing link table
-- This migration fixes the issue where user_contract_entities was referenced but never created

-- Create the missing link table for contract viewers to ownership entities
CREATE TABLE IF NOT EXISTS user_contract_entities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entity_id UUID NOT NULL REFERENCES ownership_entities(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  UNIQUE(user_id, entity_id)
);

-- Enable RLS
ALTER TABLE user_contract_entities ENABLE ROW LEVEL SECURITY;

-- RLS policies for user_contract_entities
CREATE POLICY "Users can view their own contract entities"
  ON user_contract_entities FOR SELECT
  USING (
    workspace_id = get_jwt_workspace_id() 
    AND (
      user_id = auth.uid() 
      OR has_role('admin')
    )
  );

CREATE POLICY "Admins can manage contract entity assignments"
  ON user_contract_entities FOR ALL
  USING (workspace_id = get_jwt_workspace_id() AND has_role('admin'))
  WITH CHECK (workspace_id = get_jwt_workspace_id() AND has_role('admin'));

-- Create index for performance
CREATE INDEX idx_user_contract_entities_user ON user_contract_entities(user_id);
CREATE INDEX idx_user_contract_entities_entity ON user_contract_entities(entity_id);

-- Grant permissions
GRANT SELECT ON user_contract_entities TO authenticated;
GRANT ALL ON user_contract_entities TO service_role;

-- Now recreate the v_contract_batches view with the correct reference
CREATE OR REPLACE VIEW v_contract_batches AS
SELECT 
  b.id,
  b.batch_number,
  b.recipe_version_id,
  rv.name AS recipe_name,
  b.status,
  b.target_volume_liters AS target_volume,
  b.actual_volume_liters AS actual_volume,
  b.brew_date,
  -- No cost information for contract viewers
  b.owner_entity_id
FROM batches b
LEFT JOIN recipe_versions rv ON rv.id = b.recipe_version_id
WHERE b.workspace_id = get_jwt_workspace_id()
  AND (
    -- Non-contract viewers can see all batches
    NOT has_role('contract_viewer')
    OR 
    -- Contract viewers can only see their own batches
    b.owner_entity_id IN (
      SELECT entity_id 
      FROM user_contract_entities 
      WHERE user_id = auth.uid()
    )
  );

GRANT SELECT ON v_contract_batches TO authenticated;

-- Add comment for documentation
COMMENT ON TABLE user_contract_entities IS 'Links contract viewer users to the ownership entities they can access';
COMMENT ON COLUMN user_contract_entities.user_id IS 'The user with contract_viewer role';
COMMENT ON COLUMN user_contract_entities.entity_id IS 'The ownership entity they can view data for';
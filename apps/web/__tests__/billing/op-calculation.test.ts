import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

describe('Observed Production Calculation', () => {
  let testWorkspaceId: string
  let testUserId: string

  beforeEach(async () => {
    // Create test workspace and user
    const { data: workspace } = await supabase
      .from('workspaces')
      .insert({
        name: 'Test Brewery',
        plan: 'starter'
      })
      .select()
      .single()
    
    testWorkspaceId = workspace.id
  })

  afterEach(async () => {
    // Clean up test data
    if (testWorkspaceId) {
      await supabase
        .from('workspaces')
        .delete()
        .eq('id', testWorkspaceId)
    }
  })

  describe('calculate_observed_production', () => {
    it('should return 0 for workspace with no packaging runs', async () => {
      const { data, error } = await supabase
        .rpc('calculate_observed_production', {
          p_workspace_id: testWorkspaceId
        })

      expect(error).toBeNull()
      expect(data).toBe(0)
    })

    it('should correctly annualize 90-day packaging volume', async () => {
      // Create test packaging data
      const testDate = new Date()
      const testVolume = 100 // BBL
      
      // Create finished SKU
      const { data: sku } = await supabase
        .from('finished_skus')
        .insert({
          workspace_id: testWorkspaceId,
          code: 'TEST-BEER',
          name: 'Test Beer',
          size_ml: 355, // 12 oz can
          pack_config: { type: 'case', units: 24 }
        })
        .select()
        .single()

      // Create packaging run (100 BBL = 3100 gallons = ~31,000 12oz cans)
      const { data: packagingRun } = await supabase
        .from('packaging_runs')
        .insert({
          workspace_id: testWorkspaceId,
          sku_id: sku.id,
          at: testDate.toISOString(),
          units_produced: 1291, // cases (31,000 cans / 24)
          loss_pct: 2
        })
        .select()
        .single()

      // Calculate OP
      const { data, error } = await supabase
        .rpc('calculate_observed_production', {
          p_workspace_id: testWorkspaceId
        })

      expect(error).toBeNull()
      // 100 BBL in 90 days = ~405 BBL annualized
      expect(data).toBeCloseTo(405, 0)
    })

    it('should only include last 90 days of production', async () => {
      // Create old packaging run (>90 days ago)
      const oldDate = new Date()
      oldDate.setDate(oldDate.getDate() - 100)
      
      const { data: sku } = await supabase
        .from('finished_skus')
        .insert({
          workspace_id: testWorkspaceId,
          code: 'OLD-BEER',
          name: 'Old Beer',
          size_ml: 355,
          pack_config: { type: 'case', units: 24 }
        })
        .select()
        .single()

      await supabase
        .from('packaging_runs')
        .insert({
          workspace_id: testWorkspaceId,
          sku_id: sku.id,
          at: oldDate.toISOString(),
          units_produced: 1000,
          loss_pct: 2
        })

      // Calculate OP - should be 0 since run is >90 days old
      const { data, error } = await supabase
        .rpc('calculate_observed_production', {
          p_workspace_id: testWorkspaceId
        })

      expect(error).toBeNull()
      expect(data).toBe(0)
    })
  })

  describe('check_plan_suggestions', () => {
    it('should suggest upgrade when OP exceeds tier by >10%', async () => {
      // Set workspace to starter (max 1000 BBL)
      await supabase
        .from('account_billing')
        .insert({
          workspace_id: testWorkspaceId,
          plan_id: (await supabase.from('billing_plans').select().eq('name', 'starter').single()).data.id,
          billing_period: 'monthly'
        })

      // Create OP snapshot exceeding starter limit
      await supabase
        .from('observed_production_snapshots')
        .insert({
          workspace_id: testWorkspaceId,
          date: new Date().toISOString().split('T')[0],
          packaged_bbl_90d: 280, // ~1138 BBL annualized
          op_annualized_bbl: 1138
        })

      // Check for suggestions
      const { error } = await supabase
        .rpc('check_plan_suggestions', {
          p_workspace_id: testWorkspaceId
        })

      expect(error).toBeNull()

      // Verify suggestion was created
      const { data: suggestion } = await supabase
        .from('plan_change_suggestions')
        .select()
        .eq('workspace_id', testWorkspaceId)
        .eq('status', 'suggested')
        .single()

      expect(suggestion).toBeTruthy()
      expect(suggestion.reason).toBe('op_exceeds')
    })

    it('should not suggest changes within 10% grace band', async () => {
      // Set workspace to starter (max 1000 BBL)
      await supabase
        .from('account_billing')
        .insert({
          workspace_id: testWorkspaceId,
          plan_id: (await supabase.from('billing_plans').select().eq('name', 'starter').single()).data.id,
          billing_period: 'monthly'
        })

      // Create OP snapshot within grace band (1000 * 1.09 = 1090)
      await supabase
        .from('observed_production_snapshots')
        .insert({
          workspace_id: testWorkspaceId,
          date: new Date().toISOString().split('T')[0],
          packaged_bbl_90d: 265, // ~1078 BBL annualized
          op_annualized_bbl: 1078
        })

      // Check for suggestions
      await supabase
        .rpc('check_plan_suggestions', {
          p_workspace_id: testWorkspaceId
        })

      // Verify no suggestion was created
      const { data: suggestions } = await supabase
        .from('plan_change_suggestions')
        .select()
        .eq('workspace_id', testWorkspaceId)
        .eq('status', 'suggested')

      expect(suggestions.length).toBe(0)
    })

    it('should require two consecutive months before suggesting', async () => {
      // This test would verify the two-month confirmation logic
      // Implementation depends on the exact SQL logic for consecutive checks
    })
  })
})
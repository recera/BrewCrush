import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { DashboardShell } from '@/components/dashboard/shell'
import { InventoryCatalog } from '@/components/inventory/catalog'

export default async function InventoryPage() {
  const supabase = await createClient()

  // Check authentication
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    redirect('/auth/login')
  }

  // Get user's workspace and role
  const { data: workspaceRole, error } = await supabase
    .from('user_workspace_roles')
    .select(`
      role,
      workspace:workspaces(
        id,
        name,
        plan
      )
    `)
    .eq('user_id', user.id)
    .single()

  if (error || !workspaceRole) {
    redirect('/onboarding')
  }

  // Check permissions
  const allowedRoles = ['admin', 'inventory', 'brewer']
  if (!allowedRoles.includes(workspaceRole.role)) {
    redirect('/dashboard')
  }

  // Get user profile
  const { data: userProfile } = await supabase
    .from('users')
    .select('*')
    .eq('id', user.id)
    .single()

  // Fetch inventory data - use materialized view for performance
  const { data: inventoryData } = await supabase
    .from('inventory_on_hand_by_item_location')
    .select('*')
    .order('item_name')

  // Fetch locations
  const { data: locations } = await supabase
    .from('inventory_locations')
    .select('*')
    .order('name')

  // Fetch low stock items (items below reorder level)
  const { data: lowStockItems } = await supabase
    .from('items')
    .select(`
      *,
      item_lots!inner(
        qty
      )
    `)
    .not('reorder_level', 'is', null)

  return (
    <DashboardShell 
      user={userProfile}
      workspace={workspaceRole.workspace}
      role={workspaceRole.role}
    >
      <InventoryCatalog 
        inventoryData={inventoryData || []}
        locations={locations || []}
        lowStockItems={lowStockItems || []}
        userRole={workspaceRole.role}
      />
    </DashboardShell>
  )
}
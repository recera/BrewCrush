import { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { POList } from '@/components/purchasing/POList'
import { LowStockReorder } from '@/components/purchasing/LowStockReorder'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@brewcrush/ui/tabs'

export const metadata: Metadata = {
  title: 'Purchasing | BrewCrush',
  description: 'Manage purchase orders and supplier relationships',
}

export default async function PurchasingPage() {
  const supabase = await createClient()
  
  // Check authentication
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    redirect('/auth/login')
  }

  // Get user's workspace and role
  const { data: userRole } = await supabase
    .from('user_workspace_roles')
    .select('role, workspace:workspaces(*)')
    .eq('user_id', user.id)
    .single()

  if (!userRole) {
    redirect('/onboarding')
  }

  // Check permissions - only admin, inventory, and accounting can access purchasing
  const allowedRoles = ['admin', 'inventory', 'accounting']
  if (!allowedRoles.includes(userRole.role)) {
    redirect('/dashboard')
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Purchasing</h1>
        <p className="text-muted-foreground">
          Manage purchase orders, track deliveries, and monitor supplier performance
        </p>
      </div>

      <Tabs defaultValue="orders" className="space-y-4">
        <TabsList>
          <TabsTrigger value="orders">Purchase Orders</TabsTrigger>
          <TabsTrigger value="reorder">Low Stock & Reorder</TabsTrigger>
        </TabsList>
        
        <TabsContent value="orders" className="space-y-4">
          <POList />
        </TabsContent>
        
        <TabsContent value="reorder" className="space-y-4">
          <LowStockReorder />
        </TabsContent>
      </Tabs>
    </div>
  )
}
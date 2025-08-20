import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { DashboardShell } from '@/components/dashboard/shell'
import { RoleAwareDashboard } from '@/components/dashboard/role-aware-dashboard'

export default async function DashboardPage() {
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

  // Get user profile
  const { data: userProfile } = await supabase
    .from('users')
    .select('*')
    .eq('id', user.id)
    .single()

  return (
    <DashboardShell 
      user={userProfile}
      workspace={workspaceRole.workspace}
      role={workspaceRole.role}
    >
      <RoleAwareDashboard 
        role={workspaceRole.role}
        workspace={workspaceRole.workspace}
      />
    </DashboardShell>
  )
}
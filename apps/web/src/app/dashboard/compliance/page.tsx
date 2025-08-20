import { ComplianceCenter } from '@/components/compliance';
import { createServerClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';

export const metadata = {
  title: 'Compliance Center | BrewCrush',
  description: 'TTB compliance management - BROP, Excise, Transfers in bond',
};

export default async function CompliancePage() {
  const supabase = createServerClient();
  
  // Check authentication
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    redirect('/auth/login');
  }

  // Check role permissions - only admin and accounting can access compliance
  const { data: userRole } = await supabase
    .from('user_workspace_roles')
    .select('role')
    .eq('user_id', user.id)
    .single();

  if (!userRole || !['admin', 'accounting'].includes(userRole.role)) {
    redirect('/dashboard');
  }

  // Get workspace
  const { data: workspace } = await supabase
    .from('users')
    .select('workspace_id')
    .eq('id', user.id)
    .single();

  if (!workspace?.workspace_id) {
    redirect('/onboarding');
  }

  return <ComplianceCenter workspaceId={workspace.workspace_id} />;
}
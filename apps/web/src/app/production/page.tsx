'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { 
  FlaskConical, 
  Calendar, 
  Package, 
  CheckCircle, 
  AlertCircle, 
  Clock,
  TrendingUp,
  ChevronRight,
  Plus,
  Activity,
  Droplets,
  Beaker,
  Archive,
  Microscope,
  BarChart3,
  AlertTriangle,
  Timer
} from 'lucide-react';
import { Button } from '@brewcrush/ui';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@brewcrush/ui';
import { Badge } from '@brewcrush/ui';
import { Progress } from '@brewcrush/ui';
import { Alert, AlertDescription, AlertTitle } from '@brewcrush/ui';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@brewcrush/ui';
import { createClient } from '@/lib/supabase/client';
import { useUserRole } from '@/hooks/useUserRole';
import { formatDate, getDaysBetween, formatNumber } from '@/lib/utils';

interface ProductionStats {
  active_batches: number;
  tanks_occupied: number;
  tanks_total: number;
  tanks_need_cip: number;
  yeast_batches_active: number;
  yeast_harvest_ready: number;
  upcoming_packages: number;
  low_stock_items: number;
  batches_this_week: number;
  volume_this_week: number;
}

interface UpcomingTask {
  id: string;
  type: 'brew' | 'package' | 'harvest' | 'crash' | 'transfer' | 'cip';
  title: string;
  description: string;
  due_date: string;
  priority: 'high' | 'medium' | 'low';
  entity_id?: string;
  entity_type?: string;
}

interface RecentActivity {
  id: string;
  type: string;
  description: string;
  timestamp: string;
  user_name: string;
  entity_id?: string;
}

export default function ProductionPage() {
  const router = useRouter();
  const supabase = createClient();
  const { role } = useUserRole();
  const [selectedTab, setSelectedTab] = useState('overview');

  const canManageProduction = role === 'admin' || role === 'brewer';

  // Fetch production statistics
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['production-stats'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_production_stats');
      if (error) throw error;
      return data as ProductionStats;
    },
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  // Fetch upcoming tasks
  const { data: tasks, isLoading: tasksLoading } = useQuery({
    queryKey: ['production-tasks'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_upcoming_production_tasks', {
        p_days_ahead: 7
      });
      if (error) throw error;
      return data as UpcomingTask[];
    },
  });

  // Fetch recent activity
  const { data: activity, isLoading: activityLoading } = useQuery({
    queryKey: ['production-activity'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_production_activity')
        .select('*')
        .order('timestamp', { ascending: false })
        .limit(10);
      if (error) throw error;
      return data as RecentActivity[];
    },
  });

  const getTaskIcon = (type: string) => {
    switch (type) {
      case 'brew': return <FlaskConical className="h-4 w-4" />;
      case 'package': return <Package className="h-4 w-4" />;
      case 'harvest': return <Microscope className="h-4 w-4" />;
      case 'crash': return <Droplets className="h-4 w-4" />;
      case 'transfer': return <Activity className="h-4 w-4" />;
      case 'cip': return <Beaker className="h-4 w-4" />;
      default: return <Clock className="h-4 w-4" />;
    }
  };

  const getTaskPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high': return 'text-red-600 bg-red-50';
      case 'medium': return 'text-amber-600 bg-amber-50';
      case 'low': return 'text-blue-600 bg-blue-50';
      default: return 'text-gray-600 bg-gray-50';
    }
  };

  const navigationCards = [
    {
      title: 'Batches',
      description: 'Manage production batches from recipe to package',
      href: '/production/batches',
      icon: <FlaskConical className="h-6 w-6" />,
      stats: stats?.active_batches,
      statsLabel: 'Active',
      color: 'text-blue-600',
      bgColor: 'bg-blue-50',
    },
    {
      title: 'Tanks',
      description: 'Monitor fermentation and tank status',
      href: '/production/tanks',
      icon: <Archive className="h-6 w-6" />,
      stats: stats ? `${stats.tanks_occupied}/${stats.tanks_total}` : '0/0',
      statsLabel: 'Occupied',
      color: 'text-green-600',
      bgColor: 'bg-green-50',
      alert: stats?.tanks_need_cip ? `${stats.tanks_need_cip} need CIP` : null,
    },
    {
      title: 'Production Calendar',
      description: 'Schedule and track batches across time',
      href: '/production/calendar',
      icon: <Calendar className="h-6 w-6" />,
      stats: stats?.upcoming_packages,
      statsLabel: 'This Week',
      color: 'text-purple-600',
      bgColor: 'bg-purple-50',
    },
    {
      title: 'Yeast Management',
      description: 'Track yeast pitches, harvests, and generations',
      href: '/production/yeast',
      icon: <Microscope className="h-6 w-6" />,
      stats: stats?.yeast_batches_active,
      statsLabel: 'Active',
      color: 'text-amber-600',
      bgColor: 'bg-amber-50',
      alert: stats?.yeast_harvest_ready ? `${stats.yeast_harvest_ready} ready to harvest` : null,
    },
  ];

  const quickActions = [
    {
      label: 'Start Brew Day',
      icon: <Plus className="h-4 w-4" />,
      onClick: () => router.push('/recipes'),
      variant: 'default' as const,
    },
    {
      label: 'Log Reading',
      icon: <Activity className="h-4 w-4" />,
      onClick: () => router.push('/production/tanks'),
      variant: 'outline' as const,
    },
    {
      label: 'Package Batch',
      icon: <Package className="h-4 w-4" />,
      onClick: () => router.push('/packaging'),
      variant: 'outline' as const,
    },
    {
      label: 'View Reports',
      icon: <BarChart3 className="h-4 w-4" />,
      onClick: () => router.push('/reports'),
      variant: 'outline' as const,
    },
  ];

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-bold">Production Center</h1>
          <p className="text-muted-foreground mt-1">
            Manage your brewery's production workflow from grain to glass
          </p>
        </div>
        <div className="flex gap-2">
          {canManageProduction && quickActions.map((action) => (
            <Button
              key={action.label}
              variant={action.variant}
              onClick={action.onClick}
              size="sm"
            >
              {action.icon}
              <span className="ml-2 hidden sm:inline">{action.label}</span>
            </Button>
          ))}
        </div>
      </div>

      {/* Critical Alerts */}
      {stats && (stats.tanks_need_cip > 0 || stats.yeast_harvest_ready > 0 || stats.low_stock_items > 0) && (
        <Alert className="mb-6">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Action Required</AlertTitle>
          <AlertDescription>
            <div className="flex flex-wrap gap-4 mt-2">
              {stats.tanks_need_cip > 0 && (
                <span className="flex items-center gap-1">
                  <Badge variant="destructive">{stats.tanks_need_cip}</Badge>
                  tanks need CIP
                </span>
              )}
              {stats.yeast_harvest_ready > 0 && (
                <span className="flex items-center gap-1">
                  <Badge variant="warning">{stats.yeast_harvest_ready}</Badge>
                  yeast ready to harvest
                </span>
              )}
              {stats.low_stock_items > 0 && (
                <span className="flex items-center gap-1">
                  <Badge variant="outline">{stats.low_stock_items}</Badge>
                  items low on stock
                </span>
              )}
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* Navigation Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {navigationCards.map((card) => (
          <Link key={card.href} href={card.href}>
            <Card className="hover:shadow-lg transition-shadow cursor-pointer h-full">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className={`p-2 rounded-lg ${card.bgColor}`}>
                    <div className={card.color}>{card.icon}</div>
                  </div>
                  {card.stats !== undefined && (
                    <div className="text-right">
                      <p className="text-2xl font-bold">{card.stats}</p>
                      <p className="text-xs text-muted-foreground">{card.statsLabel}</p>
                    </div>
                  )}
                </div>
                <CardTitle className="mt-4">{card.title}</CardTitle>
                <CardDescription>{card.description}</CardDescription>
              </CardHeader>
              {card.alert && (
                <CardContent className="pt-0">
                  <div className="flex items-center gap-2 text-sm text-amber-600">
                    <AlertCircle className="h-3 w-3" />
                    {card.alert}
                  </div>
                </CardContent>
              )}
            </Card>
          </Link>
        ))}
      </div>

      {/* Tabs for Overview, Tasks, and Activity */}
      <Tabs value={selectedTab} onValueChange={setSelectedTab} className="space-y-4">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="tasks">
            Tasks
            {tasks && tasks.length > 0 && (
              <Badge variant="secondary" className="ml-2">
                {tasks.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Production Summary */}
            <Card>
              <CardHeader>
                <CardTitle>This Week's Production</CardTitle>
                <CardDescription>
                  Production metrics for the current week
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Batches Brewed</span>
                    <span className="text-2xl font-bold">{stats?.batches_this_week || 0}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Total Volume</span>
                    <span className="text-2xl font-bold">
                      {formatNumber(stats?.volume_this_week || 0)} L
                    </span>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span>Tank Utilization</span>
                      <span>
                        {stats ? Math.round((stats.tanks_occupied / stats.tanks_total) * 100) : 0}%
                      </span>
                    </div>
                    <Progress 
                      value={stats ? (stats.tanks_occupied / stats.tanks_total) * 100 : 0} 
                      className="h-2"
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Quick Stats */}
            <Card>
              <CardHeader>
                <CardTitle>Production Status</CardTitle>
                <CardDescription>
                  Current state of production operations
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <FlaskConical className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium">Active Batches</span>
                    </div>
                    <p className="text-2xl font-bold">{stats?.active_batches || 0}</p>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Archive className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium">Tanks in Use</span>
                    </div>
                    <p className="text-2xl font-bold">
                      {stats?.tanks_occupied || 0}/{stats?.tanks_total || 0}
                    </p>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Microscope className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium">Active Yeast</span>
                    </div>
                    <p className="text-2xl font-bold">{stats?.yeast_batches_active || 0}</p>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Package className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium">To Package</span>
                    </div>
                    <p className="text-2xl font-bold">{stats?.upcoming_packages || 0}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Tasks Tab */}
        <TabsContent value="tasks">
          <Card>
            <CardHeader>
              <CardTitle>Upcoming Tasks</CardTitle>
              <CardDescription>
                Production tasks for the next 7 days
              </CardDescription>
            </CardHeader>
            <CardContent>
              {tasksLoading ? (
                <div className="text-center py-8 text-muted-foreground">
                  Loading tasks...
                </div>
              ) : tasks && tasks.length > 0 ? (
                <div className="space-y-3">
                  {tasks.map((task) => (
                    <div
                      key={task.id}
                      className="flex items-start gap-3 p-3 rounded-lg border hover:bg-accent/50 transition-colors cursor-pointer"
                      onClick={() => {
                        if (task.entity_type === 'batch' && task.entity_id) {
                          router.push(`/production/batches/${task.entity_id}`);
                        } else if (task.entity_type === 'tank' && task.entity_id) {
                          router.push('/production/tanks');
                        }
                      }}
                    >
                      <div className={`p-2 rounded-lg ${getTaskPriorityColor(task.priority)}`}>
                        {getTaskIcon(task.type)}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-start justify-between">
                          <div>
                            <p className="font-medium">{task.title}</p>
                            <p className="text-sm text-muted-foreground">{task.description}</p>
                          </div>
                          <div className="text-right">
                            <Badge variant={task.priority === 'high' ? 'destructive' : 'secondary'}>
                              {task.priority}
                            </Badge>
                            <p className="text-xs text-muted-foreground mt-1">
                              {formatDate(task.due_date)}
                            </p>
                          </div>
                        </div>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-3" />
                  <p className="text-muted-foreground">No pending tasks</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Activity Tab */}
        <TabsContent value="activity">
          <Card>
            <CardHeader>
              <CardTitle>Recent Activity</CardTitle>
              <CardDescription>
                Latest production events and changes
              </CardDescription>
            </CardHeader>
            <CardContent>
              {activityLoading ? (
                <div className="text-center py-8 text-muted-foreground">
                  Loading activity...
                </div>
              ) : activity && activity.length > 0 ? (
                <div className="space-y-3">
                  {activity.map((item) => (
                    <div key={item.id} className="flex items-start gap-3 pb-3 border-b last:border-0">
                      <div className="p-2 rounded-full bg-muted">
                        <Activity className="h-3 w-3" />
                      </div>
                      <div className="flex-1">
                        <p className="text-sm">{item.description}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-xs text-muted-foreground">
                            {item.user_name}
                          </span>
                          <span className="text-xs text-muted-foreground">•</span>
                          <span className="text-xs text-muted-foreground">
                            {formatDate(item.timestamp)}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  No recent activity
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
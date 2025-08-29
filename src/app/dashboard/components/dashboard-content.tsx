'use client';

import { StoreCreationDialog } from '@/components/store-creation-dialog';
import { ManagerAssignmentDialog } from '@/components/manager-assignment-dialog';
import { Button } from '@/components/ui/button';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { Separator } from '@/components/ui/separator';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Store,
  Users,
  BarChart3,
  ChefHat,
  TrendingUp,
  TrendingDown,
  Eye,
} from 'lucide-react';
import Link from 'next/link';
import { RecentReportsTable } from '@/components/analytics/recent-reports-table';

interface StoreData {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  isActive: boolean;
  _count: {
    managers: number;
    reports: number;
  };
}

interface AnalyticsData {
  todayReports: number;
  totalReports: number;
  totalRevenue: number;
  averageTips: number;
  avgPrepCompletion: number;
  trends: {
    revenueGrowth: number;
    currentWeekRevenue: number;
    previousWeekRevenue: number;
  };
  storeCount: number;
}

interface DashboardContentProps {
  initialStores: StoreData[];
  initialAnalytics: AnalyticsData | null;
  recentReports: any[];
  alerts: any[];
  userRole: string;
}

export function DashboardContent({
  initialStores,
  initialAnalytics,
  recentReports,
  alerts,
  userRole,
}: DashboardContentProps) {
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  };

  const getManagerCount = () => {
    return initialStores.reduce(
      (total, store) => total + store._count.managers,
      0
    );
  };

  const getTrendIcon = (growth: number) => {
    if (growth > 0) return <TrendingUp className='h-3 w-3 text-green-600' />;
    if (growth < 0) return <TrendingDown className='h-3 w-3 text-red-600' />;
    return null;
  };

  const getTrendText = (growth: number) => {
    if (growth === 0) return 'No change from last week';
    const direction = growth > 0 ? '+' : '';
    return `${direction}${growth.toFixed(1)}% from last week`;
  };

  return (
    <div>
      <header className='flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12'>
        <div className='flex items-center gap-2 px-4'>
          <SidebarTrigger className='-ml-1' />
          <Separator orientation='vertical' className='mr-2 h-4' />
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem className='hidden md:block'>
                <BreadcrumbLink href='#'>ChrisNEddys Dashboard</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator className='hidden md:block' />
              <BreadcrumbItem>
                <BreadcrumbPage>Overview</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </div>
      </header>

      <div className='flex flex-1 flex-col gap-4 p-4 pt-0'>
        <div className='grid auto-rows-min gap-4 md:grid-cols-4'>
          {/* Total Stores */}
          <div className='rounded-xl border bg-card text-card-foreground shadow p-6'>
            <div className='flex flex-row items-center justify-between space-y-0 pb-2'>
              <h3 className='text-sm font-medium'>Total Stores</h3>
              <Store className='h-4 w-4 text-muted-foreground' />
            </div>
            <div className='text-2xl font-bold'>{initialStores.length}</div>
            <p className='text-xs text-muted-foreground'>
              {initialStores.filter((s) => s.isActive).length} active locations
            </p>
          </div>

          {/* Active Managers */}
          <div className='rounded-xl border bg-card text-card-foreground shadow p-6'>
            <div className='flex flex-row items-center justify-between space-y-0 pb-2'>
              <h3 className='text-sm font-medium'>Active Managers</h3>
              <Users className='h-4 w-4 text-muted-foreground' />
            </div>
            <div className='text-2xl font-bold'>{getManagerCount()}</div>
            <p className='text-xs text-muted-foreground'>
              Across all locations
            </p>
          </div>

          {/* Monthly Revenue */}
          <div className='rounded-xl border bg-card text-card-foreground shadow p-6'>
            <div className='flex flex-row items-center justify-between space-y-0 pb-2'>
              <h3 className='text-sm font-medium'>Monthly Revenue</h3>
              <BarChart3 className='h-4 w-4 text-muted-foreground' />
            </div>
            <div className='text-2xl font-bold'>
              {initialAnalytics
                ? formatCurrency(initialAnalytics.totalRevenue)
                : '$0'}
            </div>
            <p className='text-xs text-muted-foreground flex items-center gap-1'>
              {initialAnalytics &&
                getTrendIcon(initialAnalytics.trends.revenueGrowth)}
              {initialAnalytics
                ? getTrendText(initialAnalytics.trends.revenueGrowth)
                : 'No data'}
            </p>
          </div>

          {/* Average Prep Completion */}
          <div className='rounded-xl border bg-card text-card-foreground shadow p-6'>
            <div className='flex flex-row items-center justify-between space-y-0 pb-2'>
              <h3 className='text-sm font-medium'>Avg Prep Completion</h3>
              <ChefHat className='h-4 w-4 text-muted-foreground' />
            </div>
            <div className='text-2xl font-bold'>
              {initialAnalytics
                ? `${initialAnalytics.avgPrepCompletion}%`
                : '0%'}
            </div>
            <p className='text-xs text-muted-foreground'>
              {initialAnalytics
                ? `From ${initialAnalytics.totalReports} reports`
                : 'No reports'}
            </p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <div className='flex items-center justify-between'>
              <div>
                <CardTitle>Store Management</CardTitle>
                <p className='text-sm text-muted-foreground mt-1'>
                  Overview of all your stores with quick management actions
                </p>
              </div>
              <div className='flex items-center gap-2'>
                <Link href='/dashboard/stores'>
                  <Button variant='outline'>
                    <Store className='mr-2 h-4 w-4' />
                    Manage Stores
                  </Button>
                </Link>
                {userRole === 'OWNER' && <StoreCreationDialog />}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {initialStores.length === 0 ? (
              <div className='text-center py-8'>
                <Store className='h-12 w-12 text-muted-foreground mx-auto mb-4' />
                <h3 className='text-lg font-semibold mb-2'>No stores found</h3>
                <p className='text-muted-foreground'>
                  {userRole === 'OWNER'
                    ? 'Get started by adding your first store location.'
                    : 'You are not assigned to manage any stores yet.'}
                </p>
              </div>
            ) : (
              <div className='grid gap-4 md:grid-cols-2 lg:grid-cols-3'>
                {initialStores.map((store) => (
                  <div key={store.id} className='rounded-lg border p-4'>
                    <div className='flex items-center space-x-4'>
                      <div className='w-12 h-12 bg-primary/20 rounded-lg flex items-center justify-center'>
                        <Store className='h-6 w-6 text-primary' />
                      </div>
                      <div className='flex-1'>
                        <h3 className='font-semibold'>{store.name}</h3>
                        <p className='text-sm text-muted-foreground'>
                          {store.address || 'No address provided'}
                        </p>
                        <p className='text-sm text-muted-foreground'>
                          {store._count.managers} manager
                          {store._count.managers !== 1 ? 's' : ''} •{' '}
                          {store._count.reports} reports
                        </p>
                      </div>
                    </div>
                    <div className='mt-4 flex justify-between items-center'>
                      <span
                        className={`text-sm font-medium ${
                          store.isActive ? 'text-green-600' : 'text-red-600'
                        }`}
                      >
                        {store.isActive ? 'Active' : 'Inactive'}
                      </span>
                      <div className='flex items-center gap-2'>
                        <Link href={`/dashboard/store/${store.id}`}>
                          <Button variant='outline' size='sm'>
                            <Eye className='mr-1 h-3 w-3' />
                            View
                          </Button>
                        </Link>
                        {userRole === 'OWNER' && (
                          <ManagerAssignmentDialog
                            storeId={store.id}
                            storeName={store.name}
                          />
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Activity under Store Management */}
        {recentReports && recentReports.length > 0 && (
          <RecentReportsTable
            data={recentReports.slice(0, 5)}
            title='Recent Activity'
            description='Latest daily reports from all your stores'
          />
        )}
      </div>
    </div>
  );
}

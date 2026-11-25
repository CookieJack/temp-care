import { useEffect } from 'react';
import { createBrowserRouter, Navigate, Outlet, RouterProvider, useLocation } from 'react-router-dom';
import { ROUTES } from './lib/routes';
import { bootstrapApp } from './lib/bootstrap';
import { ToastProvider } from './components/Toast';
import { ConfirmProvider } from './components/ConfirmDialog';
import { ActionSheetProvider } from './components/ActionSheet';
import { UpdatePrompt } from './components/UpdatePrompt';
import { InstallPrompt } from './components/InstallPrompt';
import { ViewportDebug } from './components/ViewportDebug';
import HomePage from './pages/Home';
import RecordPage from './pages/Record';
import TempHistoryPage from './pages/TempHistory';
import MedHistoryPage from './pages/MedHistory';
import ChartReportPage from './pages/ChartReport';
import ProfileManagePage from './pages/ProfileManage';
import BatchManagePage from './pages/BatchManage';
import BatchDetailPage from './pages/BatchDetail';
import MedNameManagePage from './pages/MedNameManage';

function Layout() {
  const location = useLocation();

  // 页面切换滚动复位（小程序每个页面天然从顶部开始）
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  // 启动初始化：首次进入自动创建「本人」档案并设为当前（幂等）
  useEffect(() => {
    void bootstrapApp();
  }, []);

  return (
    <div className="app-shell">
      <InstallPrompt />
      <ViewportDebug />
      <Outlet />
      <UpdatePrompt />
    </div>
  );
}

const router = createBrowserRouter(
  [
    {
      element: <Layout />,
      children: [
        { path: ROUTES.home, element: <HomePage /> },
        { path: ROUTES.record, element: <RecordPage /> },
        { path: ROUTES.tempHistory, element: <TempHistoryPage /> },
        { path: ROUTES.medHistory, element: <MedHistoryPage /> },
        { path: ROUTES.chartReport, element: <ChartReportPage /> },
        { path: ROUTES.profileManage, element: <ProfileManagePage /> },
        { path: ROUTES.batchManage, element: <BatchManagePage /> },
        { path: ROUTES.batchDetail, element: <BatchDetailPage /> },
        { path: ROUTES.medNameManage, element: <MedNameManagePage /> },
        { path: '*', element: <Navigate to={ROUTES.home} replace /> },
      ],
    },
  ],
  // GitHub Pages 部署在子路径（/temp-care/）下，路由需同步带上 base
  { basename: import.meta.env.BASE_URL }
);

export function App() {
  return (
    <ToastProvider>
      <ConfirmProvider>
        <ActionSheetProvider>
          <RouterProvider router={router} />
        </ActionSheetProvider>
      </ConfirmProvider>
    </ToastProvider>
  );
}

import { Routes, Route, Navigate, Outlet } from 'react-router-dom';
import Navbar from './components/layout/Navbar';
import ProtectedRoute from './components/common/ProtectedRoute';
import { useAuth } from './context/AuthContext';

import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import NotFoundPage from './pages/NotFoundPage';

import HomePage from './pages/HomePage';
import DashboardPage from './pages/DashboardPage';
import AssetInventoryPage from './pages/AssetInventoryPage';
import AssetDiscoveryPage from './pages/AssetDiscoveryPage';
import CBOMPage from './pages/CBOMPage';
import PQCPosturePage from './pages/PQCPosturePage';
import CyberRatingPage from './pages/CyberRatingPage';
import ReportingPage from './pages/ReportingPage';
import HistoryPage from './pages/HistoryPage';
import ScanDetailsPage from './pages/ScanDetailsPage';

function AppLayout() {
  return (
    <div className="app-shell">
      <Navbar />
      <div className="app-body">
        <main className="app-main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function PublicOnlyRoute({ children }) {
  const { isAuthenticated, authLoading } = useAuth();

  if (authLoading) {
    return <div className="page-center">Checking authentication...</div>;
  }

  return isAuthenticated ? <Navigate to="/" replace /> : children;
}

function PrivatePage({ children }) {
  return <ProtectedRoute>{children}</ProtectedRoute>;
}

export default function App() {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <PublicOnlyRoute>
            <LoginPage />
          </PublicOnlyRoute>
        }
      />

      <Route
        path="/register"
        element={
          <PublicOnlyRoute>
            <RegisterPage />
          </PublicOnlyRoute>
        }
      />

      <Route path="/" element={<AppLayout />}>
        <Route
          index
          element={
            <PrivatePage>
              <HomePage />
            </PrivatePage>
          }
        />
        <Route
          path="dashboard"
          element={
            <PrivatePage>
              <DashboardPage />
            </PrivatePage>
          }
        />
        <Route
          path="history"
          element={
            <PrivatePage>
              <HistoryPage />
            </PrivatePage>
          }
        />
        <Route
          path="scans/:id"
          element={
            <PrivatePage>
              <ScanDetailsPage />
            </PrivatePage>
          }
        />
        <Route
          path="inventory"
          element={
            <PrivatePage>
              <AssetInventoryPage />
            </PrivatePage>
          }
        />
        <Route
          path="discovery"
          element={
            <PrivatePage>
              <AssetDiscoveryPage />
            </PrivatePage>
          }
        />
        <Route
          path="cbom"
          element={
            <PrivatePage>
              <CBOMPage />
            </PrivatePage>
          }
        />
        <Route
          path="pqc-posture"
          element={
            <PrivatePage>
              <PQCPosturePage />
            </PrivatePage>
          }
        />
        <Route
          path="cyber-rating"
          element={
            <PrivatePage>
              <CyberRatingPage />
            </PrivatePage>
          }
        />
        <Route
          path="reporting"
          element={
            <PrivatePage>
              <ReportingPage />
            </PrivatePage>
          }
        />
        <Route
          path="reporting/executive"
          element={
            <PrivatePage>
              <Navigate to="/reporting" replace />
            </PrivatePage>
          }
        />
        <Route
          path="reporting/scheduled"
          element={
            <PrivatePage>
              <Navigate to="/reporting" replace />
            </PrivatePage>
          }
        />
        <Route
          path="reporting/on-demand"
          element={
            <PrivatePage>
              <Navigate to="/reporting" replace />
            </PrivatePage>
          }
        />
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
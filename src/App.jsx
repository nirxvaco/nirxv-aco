import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import LoginPage from './pages/LoginPage'
import DashboardLayout from './pages/DashboardLayout'
import ProfilesPage from './pages/ProfilesPage'
import InvoicesPage from './pages/InvoicesPage'
import ProfitPage from './pages/ProfitPage'
import ExpensesPage from './pages/ExpensesPage'
import LeaderboardPage from './pages/LeaderboardPage'
import AdminPage from './pages/AdminPage'
import OrderTrackingPage from './pages/OrderTrackingPage'
import PasTrackerPage from './pages/PasTrackerPage'
import DropsPage from './pages/DropsPage'
import DropManagerPage from './pages/DropManagerPage'
import MyRunsPage from './pages/MyRunsPage'

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <LoadingScreen />
  if (!user) return <Navigate to="/login" replace />
  return children
}

function AdminRoute({ children }) {
  const { user, isAdmin, loading } = useAuth()
  if (loading) return <LoadingScreen />
  if (!user) return <Navigate to="/login" replace />
  if (!isAdmin) return <Navigate to="/profiles" replace />
  return children
}

function LoadingScreen() {
  return (
    <div className="min-h-screen bg-vault-bg flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="w-10 h-10 border-2 border-vault-accent border-t-transparent rounded-full animate-spin" />
        <p className="text-vault-text-dim font-mono text-sm">Loading Nirxv ACO...</p>
      </div>
    </div>
  )
}

export default function App() {
  const { user, loading } = useAuth()

  if (loading) return <LoadingScreen />

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/profiles" replace /> : <LoginPage />} />
      <Route path="/" element={<ProtectedRoute><DashboardLayout /></ProtectedRoute>}>
        <Route index element={<Navigate to="/profiles" replace />} />
        <Route path="profiles" element={<ProfilesPage />} />
        <Route path="invoices" element={<InvoicesPage />} />
        <Route path="profit" element={<ProfitPage />} />
        <Route path="expenses" element={<ExpensesPage />} />
        <Route path="leaderboard" element={<LeaderboardPage />} />
        <Route path="drops" element={<DropsPage />} />
        <Route path="orders" element={<AdminRoute><OrderTrackingPage /></AdminRoute>} />
        <Route path="pas" element={<AdminRoute><PasTrackerPage /></AdminRoute>} />
        <Route path="drop-manager" element={<AdminRoute><DropManagerPage /></AdminRoute>} />
        <Route path="admin" element={<AdminRoute><AdminPage /></AdminRoute>} />
        <Route path="runs" element={<MyRunsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/profiles" replace />} />
    </Routes>
  )
}

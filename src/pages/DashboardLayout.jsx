import { useState, useEffect, useRef } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import { createPortal } from 'react-dom'
import { Activity } from 'lucide-react'
import {
  CreditCard, FileText, TrendingUp, Receipt,
  Trophy, ShieldCheck, LogOut, Menu, X, ChevronRight,
  User, Bell, AlertCircle, ExternalLink, CheckCircle, Package, PoundSterling, Layers
} from 'lucide-react'
import { format } from 'date-fns'

const NAV = [
  { to: '/profiles',    icon: CreditCard,  label: 'Profiles' },
  { to: '/invoices',    icon: FileText,     label: 'Invoices' },
  { to: '/drops',       icon: Layers,       label: 'Drops' },
  { to: '/profit',      icon: TrendingUp,   label: 'Profit Tracker' },
  { to: '/expenses',    icon: Receipt,      label: 'Expenses' },
  { to: '/runs', icon: Activity, label: 'My Runs' },
  { to: '/leaderboard', icon: Trophy,       label: 'Leaderboard' },
]

export default function DashboardLayout() {
  const { user, profile, isAdmin } = useAuth()
  const navigate = useNavigate()
  const [mobileOpen, setMobileOpen]       = useState(false)
  const [notifOpen, setNotifOpen]         = useState(false)
  const [unpaidInvoices, setUnpaidInvoices] = useState([])
  const [dismissed, setDismissed]         = useState(() => {
    try { return JSON.parse(sessionStorage.getItem('dismissedInvoices') || '[]') } catch { return [] }
  })
  const bellRef = useRef(null)
  const panelRef = useRef(null)

  // Load unpaid invoices for this user
  useEffect(() => {
    if (!user || isAdmin) return
    async function loadInvoices() {
      const { data } = await supabase
        .from('invoices')
        .select('*')
        .eq('target_user_id', user.id)
        .neq('status', 'paid')
        .order('created_at', { ascending: false })
      setUnpaidInvoices(data || [])
    }
    loadInvoices()
    // Poll every 60s so new invoices appear without refresh
    const interval = setInterval(loadInvoices, 60000)
    return () => clearInterval(interval)
  }, [user, isAdmin])

  // Close panel when clicking outside
  useEffect(() => {
    function handleClick(e) {
      if (panelRef.current && !panelRef.current.contains(e.target) &&
          bellRef.current && !bellRef.current.contains(e.target)) {
        setNotifOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  function dismiss(id) {
    const next = [...dismissed, id]
    setDismissed(next)
    try { sessionStorage.setItem('dismissedInvoices', JSON.stringify(next)) } catch {}
  }

  async function handleLogout() {
    await supabase.auth.signOut()
    navigate('/login')
  }

  // Only show invoices not yet dismissed this session
  const visibleInvoices = unpaidInvoices.filter(i => !dismissed.includes(i.id))
  const unreadCount = visibleInvoices.length

  return (
    <div className="flex h-screen overflow-hidden bg-vault-bg">
      {mobileOpen && (
        <div className="fixed inset-0 bg-black/70 z-20 lg:hidden" onClick={() => setMobileOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed top-0 left-0 h-screen w-60 bg-vault-surface border-r border-vault-border z-30
        flex flex-col transition-transform duration-300 shrink-0
        ${mobileOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0 lg:relative lg:z-auto
      `}>
        {/* Logo */}
        <div className="p-5 border-b border-vault-border flex items-center gap-3 shrink-0">
          <div>
            <p className="font-display text-vault-accent text-lg leading-none tracking-wide neon-cyan">NIRXV</p>
            <p className="font-display text-vault-gold text-sm leading-none tracking-widest neon-gold">ACO</p>
          </div>
          <button className="ml-auto lg:hidden text-vault-muted" onClick={() => setMobileOpen(false)}>
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {NAV.map(({ to, icon: Icon, label }) => (
            <NavLink key={to} to={to} onClick={() => setMobileOpen(false)}
              className={({ isActive }) => `
                flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-body font-medium
                transition-all duration-150 border
                ${isActive
                  ? 'bg-vault-accent/10 text-vault-accent border-vault-accent/30 glow-cyan'
                  : 'text-vault-text-dim hover:text-vault-text hover:bg-vault-border border-transparent'}
              `}>
              {({ isActive }) => (
                <>
                  <Icon className="w-4 h-4 shrink-0" />
                  {label}
                  {/* Show dot on Invoices nav item if there are unpaid ones */}
                  {to === '/invoices' && unreadCount > 0 && !isActive && (
                    <span className="ml-auto w-2 h-2 rounded-full bg-vault-red animate-pulse" />
                  )}
                  {isActive && <ChevronRight className="w-3 h-3 ml-auto text-vault-accent" />}
                </>
              )}
            </NavLink>
          ))}

          {isAdmin && (
            <div className="pt-3 mt-3 border-t border-vault-border">
              <p className="text-[10px] font-mono text-vault-muted uppercase tracking-widest px-3 mb-2">Admin</p>
              <NavLink to="/orders" onClick={() => setMobileOpen(false)}
                className={({ isActive }) => `
                  flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-body font-medium
                  transition-all duration-150 border
                  ${isActive
                    ? 'bg-vault-gold/10 text-vault-gold border-vault-gold/30 glow-gold'
                    : 'text-vault-text-dim hover:text-vault-text hover:bg-vault-border border-transparent'}
                `}>
                <Package className="w-4 h-4 shrink-0" />
                Order Tracker
              </NavLink>
              <NavLink to="/drop-manager" onClick={() => setMobileOpen(false)}
                className={({ isActive }) => `
                  flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-body font-medium
                  transition-all duration-150 border
                  ${isActive
                    ? 'bg-vault-gold/10 text-vault-gold border-vault-gold/30 glow-gold'
                    : 'text-vault-text-dim hover:text-vault-text hover:bg-vault-border border-transparent'}
                `}>
                <Layers className="w-4 h-4 shrink-0" />
                Drop Manager
              </NavLink>
              <NavLink to="/pas" onClick={() => setMobileOpen(false)}
                className={({ isActive }) => `
                  flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-body font-medium
                  transition-all duration-150 border
                  ${isActive
                    ? 'bg-vault-gold/10 text-vault-gold border-vault-gold/30 glow-gold'
                    : 'text-vault-text-dim hover:text-vault-text hover:bg-vault-border border-transparent'}
                `}>
                <PoundSterling className="w-4 h-4 shrink-0" />
                PAS Tracker
              </NavLink>
              <NavLink to="/admin" onClick={() => setMobileOpen(false)}
                className={({ isActive }) => `
                  flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-body font-medium
                  transition-all duration-150 border
                  ${isActive
                    ? 'bg-vault-gold/10 text-vault-gold border-vault-gold/30 glow-gold'
                    : 'text-vault-text-dim hover:text-vault-text hover:bg-vault-border border-transparent'}
                `}>
                <ShieldCheck className="w-4 h-4 shrink-0" />
                Admin Panel
              </NavLink>
            </div>
          )}
        </nav>

        {/* User footer */}
        <div className="p-3 border-t border-vault-border shrink-0">
          <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg">
            <div className="w-8 h-8 rounded-full bg-vault-accent/20 border border-vault-accent/30 flex items-center justify-center text-vault-accent shrink-0">
              <User className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-vault-text text-sm font-body font-medium truncate">{profile?.username || 'User'}</p>
              <p className="text-vault-muted text-xs font-mono truncate">{profile?.role || 'user'}</p>
            </div>
            <button onClick={handleLogout} className="text-vault-muted hover:text-vault-red transition-colors shrink-0" title="Sign out">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top bar */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-vault-border bg-vault-surface shrink-0">
          {/* Mobile menu button */}
          <button onClick={() => setMobileOpen(true)} className="lg:hidden text-vault-text-dim">
            <Menu className="w-5 h-5" />
          </button>
          <span className="lg:hidden font-display text-vault-accent tracking-wide neon-cyan">NIRXV</span>
          <span className="lg:hidden font-display text-vault-gold neon-gold">ACO</span>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Invoice alert banner — shown inline in topbar when unpaid invoices exist */}
          {!isAdmin && unreadCount > 0 && (
            <button
              onClick={() => setNotifOpen(o => !o)}
              className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-vault-red/10 border border-vault-red/30 text-vault-red text-xs font-body font-medium animate-pulse hover:bg-vault-red/20 transition-colors">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              {unreadCount} unpaid invoice{unreadCount > 1 ? 's' : ''}
            </button>
          )}

          {/* Bell button */}
          {!isAdmin && (
            <button
              ref={bellRef}
              onClick={() => setNotifOpen(o => !o)}
              className="relative p-2 rounded-lg text-vault-text-dim hover:text-vault-text hover:bg-vault-border transition-all">
              <Bell className="w-5 h-5" />
              {unreadCount > 0 && (
                <span className="absolute top-1 right-1 w-4 h-4 bg-vault-red rounded-full flex items-center justify-center text-[9px] font-mono text-white font-bold animate-pulse">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>
          )}
        </div>

        {/* Page content */}
        <div className="flex-1 overflow-y-auto p-4 lg:p-6 grid-bg">
          <Outlet />
        </div>
      </main>

      {/* Notification panel — portal so it sits above everything */}
      {notifOpen && !isAdmin && createPortal(
        <div
          ref={panelRef}
          className="fixed top-14 right-4 w-80 z-50 animate-fade-in"
          style={{ maxHeight: 'calc(100vh - 80px)' }}>
          <div className="vault-card flex flex-col shadow-2xl shadow-black/60 border-vault-border"
            style={{ maxHeight: 'calc(100vh - 80px)' }}>

            {/* Panel header */}
            <div className="flex items-center justify-between mb-4 shrink-0">
              <div className="flex items-center gap-2">
                <Bell className="w-4 h-4 text-vault-text-dim" />
                <h3 className="font-display text-vault-text text-base tracking-wide">NOTIFICATIONS</h3>
              </div>
              <button onClick={() => setNotifOpen(false)} className="text-vault-muted hover:text-vault-text transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Content */}
            <div className="overflow-y-auto flex-1 space-y-2">
              {visibleInvoices.length === 0 ? (
                <div className="text-center py-8">
                  <CheckCircle className="w-8 h-8 text-vault-green mx-auto mb-2" />
                  <p className="text-vault-text text-sm font-body font-medium">All caught up!</p>
                  <p className="text-vault-text-dim text-xs font-mono mt-1">No pending invoices</p>
                </div>
              ) : (
                <>
                  <p className="text-[10px] font-mono text-vault-muted uppercase tracking-widest mb-1">
                    {unreadCount} unpaid invoice{unreadCount > 1 ? 's' : ''}
                  </p>
                  {visibleInvoices.map(inv => (
                    <div key={inv.id}
                      className="bg-vault-bg border border-vault-red/20 rounded-xl p-3 space-y-2">
                      {/* Invoice header */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="w-7 h-7 rounded-lg bg-vault-red/10 border border-vault-red/20 flex items-center justify-center shrink-0">
                            <FileText className="w-3.5 h-3.5 text-vault-red" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-vault-text text-sm font-body font-medium truncate">{inv.title}</p>
                            <p className="text-vault-muted text-[10px] font-mono">
                              {inv.due_date ? `Due ${format(new Date(inv.due_date), 'dd MMM yyyy')}` : 'No due date'}
                            </p>
                          </div>
                        </div>
                        <p className="font-display text-vault-red text-sm shrink-0">
                          {inv.currency} {parseFloat(inv.amount).toFixed(2)}
                        </p>
                      </div>

                      {inv.notes && (
                        <p className="text-vault-text-dim text-xs font-body italic">{inv.notes}</p>
                      )}

                      {/* Status badge */}
                      <div className="flex items-center justify-between">
                        <span className={`vault-badge border text-[10px] ${
                          inv.status === 'overdue'
                            ? 'text-vault-red bg-vault-red/10 border-vault-red/30'
                            : 'text-vault-gold bg-vault-gold/10 border-vault-gold/30'
                        }`}>
                          <AlertCircle className="w-2.5 h-2.5" />
                          {inv.status === 'overdue' ? 'Overdue' : 'Pending'}
                        </span>

                        <div className="flex gap-1.5">
                          {inv.payment_link && (
                            <a href={inv.payment_link} target="_blank" rel="noopener noreferrer"
                              className="flex items-center gap-1 text-[10px] font-body font-medium text-vault-accent hover:text-vault-accent/80 transition-colors">
                              <ExternalLink className="w-3 h-3" /> Pay Now
                            </a>
                          )}
                          <button onClick={() => dismiss(inv.id)}
                            className="text-[10px] font-mono text-vault-muted hover:text-vault-text-dim transition-colors ml-2">
                            dismiss
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>

            {/* Footer */}
            {visibleInvoices.length > 0 && (
              <div className="mt-4 pt-3 border-t border-vault-border shrink-0">
                <button
                  onClick={() => { navigate('/invoices'); setNotifOpen(false) }}
                  className="vault-btn-primary w-full justify-center text-xs py-2">
                  <FileText className="w-3.5 h-3.5" /> View All Invoices
                </button>
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}

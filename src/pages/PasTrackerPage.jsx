import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { PoundSterling, ArrowLeftRight, Users, Search, X } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { format, startOfMonth, subMonths, isWithinInterval, parseISO } from 'date-fns'

export default function PasTrackerPage() {
  const { user } = useAuth()
  const [invoices, setInvoices] = useState([])
  const [loading, setLoading]   = useState(true)
  const [search, setSearch]     = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo]     = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    // Only load invoices relevant to THIS admin
    // Full invoices where user_id = me, OR split invoices (both get 50%)
    const { data } = await supabase
      .from('invoices')
      .select('id, title, amount, currency, split_with_warrior, created_at, target_user_id, user_id, status')
      .eq('status', 'paid')
      .order('created_at', { ascending: false })

    // FIX (Security Fix 7): Removed client-side `mine` filter — RLS on invoices
    // already scopes to auth.uid() = user_id OR auth.uid() = target_user_id.
    // The previous client-side filter was redundant and leaked filter logic to the client.
    setInvoices(data || [])
    setLoading(false)
  }, [user.id])

  useEffect(() => { load() }, [load])

  // ── Stats for current admin only ──────────────────────────────────────
  const myEarnings = invoices.reduce((s, i) => {
    const amt = parseFloat(i.amount)
    return s + (i.split_with_warrior ? amt * 0.5 : amt)
  }, 0)
  const fullCount  = invoices.filter(i => !i.split_with_warrior).length
  const splitCount = invoices.filter(i => i.split_with_warrior).length
  const splitTotal = invoices.filter(i => i.split_with_warrior)
    .reduce((s, i) => s + parseFloat(i.amount) * 0.5, 0)

  // ── Monthly chart (last 6 months) ────────────────────────────────────
  const months = Array.from({ length: 6 }, (_, i) => {
    const d = subMonths(new Date(), 5 - i)
    return {
      name: format(d, 'MMM'),
      start: startOfMonth(d).toISOString(),
      end: startOfMonth(subMonths(d, -1)).toISOString(),
    }
  })
  const chartData = months.map(m => ({
    name: m.name,
    amount: invoices
      .filter(i => i.created_at >= m.start && i.created_at < m.end)
      .reduce((s, i) => s + (i.split_with_warrior ? parseFloat(i.amount) * 0.5 : parseFloat(i.amount)), 0)
  }))

  // ── Filtered table ────────────────────────────────────────────────────
  const filtered = invoices.filter(inv => {
    const matchSearch = !search.trim() ||
      inv.title?.toLowerCase().includes(search.toLowerCase())

    let matchDate = true
    if (dateFrom || dateTo) {
      try {
        const invDate = parseISO(inv.created_at)
        if (dateFrom && dateTo) {
          matchDate = isWithinInterval(invDate, { start: parseISO(dateFrom), end: parseISO(dateTo) })
        } else if (dateFrom) {
          matchDate = invDate >= parseISO(dateFrom)
        } else if (dateTo) {
          matchDate = invDate <= parseISO(dateTo)
        }
      } catch { matchDate = true }
    }
    return matchSearch && matchDate
  })

  const filteredEarnings = filtered.reduce((s, i) => {
    return s + (i.split_with_warrior ? parseFloat(i.amount) * 0.5 : parseFloat(i.amount))
  }, 0)

  function clearFilters() { setSearch(''); setDateFrom(''); setDateTo('') }
  const hasFilters = search || dateFrom || dateTo

  return (
    <div className="max-w-4xl mx-auto animate-fade-in">
      <div className="mb-6">
        <h1 className="font-display text-3xl text-vault-gold neon-gold">PAS TRACKER</h1>
        <p className="text-vault-text-dim text-sm font-body mt-0.5">Your personal PAS earnings</p>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-2 border-vault-accent border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {/* Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6 stagger">
            <div className="vault-card">
              <p className="vault-label">Total Earned</p>
              <p className="font-display text-2xl text-vault-green">£{myEarnings.toFixed(2)}</p>
              <p className="text-vault-muted text-xs font-mono mt-1">{invoices.length} paid invoices</p>
            </div>
            <div className="vault-card">
              <p className="vault-label">Full PAS</p>
              <p className="font-display text-2xl text-vault-accent">
                £{invoices.filter(i => !i.split_with_warrior).reduce((s, i) => s + parseFloat(i.amount), 0).toFixed(2)}
              </p>
              <p className="text-vault-muted text-xs font-mono mt-1">{fullCount} invoice{fullCount !== 1 ? 's' : ''} — your runners</p>
            </div>
            <div className="vault-card">
              <p className="vault-label">Split PAS (50%)</p>
              <p className="font-display text-2xl text-vault-gold">£{splitTotal.toFixed(2)}</p>
              <p className="text-vault-muted text-xs font-mono mt-1">{splitCount} invoice{splitCount !== 1 ? 's' : ''} — Warrior's runners</p>
            </div>
          </div>

          {/* Chart */}
          {invoices.length > 0 && (
            <div className="vault-card mb-6">
              <p className="vault-label mb-4">Monthly PAS — Last 6 Months</p>
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={chartData} barSize={28}>
                  <XAxis dataKey="name" tick={{ fill: '#7a7a9a', fontSize: 11, fontFamily: 'JetBrains Mono' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#7a7a9a', fontSize: 11, fontFamily: 'JetBrains Mono' }} axisLine={false} tickLine={false} tickFormatter={v => `£${v}`} />
                  <Tooltip
                    contentStyle={{ background: '#0e0e1a', border: '1px solid #1a1a2e', borderRadius: 8, fontFamily: 'Barlow', color: '#eef0ff' }}
                    formatter={v => [`£${v.toFixed(2)}`, 'Your PAS']}
                    cursor={{ fill: 'rgba(255,230,0,0.04)' }}
                  />
                  <Bar dataKey="amount" radius={[4,4,0,0]} fill="#ffe600" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Search + date filters */}
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <p className="text-[10px] font-mono text-vault-muted uppercase tracking-widest flex-1">
              Paid Invoices
              {hasFilters && <span className="ml-2 text-vault-accent">{filtered.length} results · £{filteredEarnings.toFixed(2)}</span>}
            </p>
          </div>
          <div className="flex gap-2 mb-4 flex-wrap">
            {/* Search */}
            <div className="relative flex-1 min-w-48">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-vault-muted" />
              <input className="vault-input pl-8 text-sm"
                placeholder="Search invoice title..."
                value={search}
                onChange={e => setSearch(e.target.value)} />
            </div>
            {/* Date from */}
            <div className="relative">
              <label className="absolute -top-4 left-0 text-[10px] font-mono text-vault-muted">From</label>
              <input className="vault-input text-sm w-36" type="date"
                value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
            </div>
            {/* Date to */}
            <div className="relative">
              <label className="absolute -top-4 left-0 text-[10px] font-mono text-vault-muted">To</label>
              <input className="vault-input text-sm w-36" type="date"
                value={dateTo} onChange={e => setDateTo(e.target.value)} />
            </div>
            {/* Clear */}
            {hasFilters && (
              <button onClick={clearFilters}
                className="vault-btn-ghost text-xs px-3 py-2">
                <X className="w-3.5 h-3.5" /> Clear
              </button>
            )}
          </div>

          {/* Table */}
          {filtered.length === 0 ? (
            <div className="vault-card text-center py-10">
              <PoundSterling className="w-8 h-8 text-vault-muted mx-auto mb-2" />
              <p className="text-vault-text-dim text-sm">{invoices.length === 0 ? 'No paid invoices yet' : 'No results match your filters'}</p>
            </div>
          ) : (
            <div className="vault-card overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-vault-border">
                    {['Invoice', 'Type', 'Invoice Total', 'Your Cut', 'Date'].map(h => (
                      <th key={h} className="text-left py-3 px-3 text-[10px] font-mono text-vault-muted uppercase tracking-widest whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(inv => {
                    const amt = parseFloat(inv.amount)
                    const yourCut = inv.split_with_warrior ? amt * 0.5 : amt
                    return (
                      <tr key={inv.id} className="border-b border-vault-border/40 hover:bg-vault-bg/50 transition-colors">
                        <td className="py-3 px-3 font-body text-vault-text font-medium max-w-[180px] truncate">{inv.title}</td>
                        <td className="py-3 px-3">
                          {inv.split_with_warrior
                            ? <span className="vault-badge bg-vault-purple/10 text-vault-purple border border-vault-purple/20 text-[10px]"><ArrowLeftRight className="w-2.5 h-2.5" />50/50</span>
                            : <span className="vault-badge bg-vault-accent/10 text-vault-accent border border-vault-accent/20 text-[10px]">Full</span>
                          }
                        </td>
                        <td className="py-3 px-3 font-mono text-vault-text-dim">£{amt.toFixed(2)}</td>
                        <td className="py-3 px-3 font-mono text-vault-green font-semibold">£{yourCut.toFixed(2)}</td>
                        <td className="py-3 px-3 font-mono text-vault-text-dim text-xs whitespace-nowrap">
                          {format(new Date(inv.created_at), 'dd MMM yyyy')}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                {/* Footer totals */}
                <tfoot>
                  <tr className="border-t border-vault-border">
                    <td className="py-3 px-3 font-mono text-vault-muted text-xs" colSpan={3}>
                      {filtered.length} invoice{filtered.length !== 1 ? 's' : ''}
                    </td>
                    <td className="py-3 px-3 font-display text-vault-green">
                      £{filteredEarnings.toFixed(2)}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}

import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { Trophy, Plus, X, Save, Crown, Medal, Award, EyeOff, Trash2 } from 'lucide-react'
import { format, endOfMonth } from 'date-fns'

const EMPTY = { item_name: '', checkouts: 1, estimated_profit: '', target_user_id: '', month: format(new Date(), 'yyyy-MM') }

function RankIcon({ rank }) {
  if (rank === 1) return <Crown className="w-5 h-5 text-vault-gold" />
  if (rank === 2) return <Medal className="w-5 h-5 text-gray-400" />
  if (rank === 3) return <Award className="w-5 h-5 text-amber-600" />
  return <span className="w-5 h-5 flex items-center justify-center font-mono text-xs text-vault-muted">#{rank}</span>
}

export default function LeaderboardPage() {
  const { user, profile, isAdmin } = useAuth()
  const [entries, setEntries]         = useState([])
  const [users, setUsers]             = useState([])
  const [loading, setLoading]         = useState(true)
  const [modal, setModal]             = useState(false)
  const [form, setForm]               = useState(EMPTY)
  const [saving, setSaving]           = useState(false)
  const [selectedMonth, setSelectedMonth] = useState(format(new Date(), 'yyyy-MM'))
  const [anonPref, setAnonPref]       = useState(profile?.anonymous_on_leaderboard || false)
  const [savingPref, setSavingPref]   = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const start = `${selectedMonth}-01`
    const end   = format(endOfMonth(new Date(`${selectedMonth}-01`)), 'yyyy-MM-dd')
    const { data, error } = await supabase
      .from('checkouts')
      .select('*, user_profiles!checkouts_user_id_fkey(username, anonymous_on_leaderboard)')
      .gte('month_date', start)
      .lte('month_date', end)
      .order('checkouts', { ascending: false })
    if (error) console.error('LEADERBOARD LOAD ERROR:', error)
    setEntries(data || [])
    setLoading(false)
  }, [selectedMonth])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (isAdmin) {
      supabase.from('user_profiles').select('id, username').neq('id', user.id).then(({ data }) => setUsers(data || []))
    }
  }, [isAdmin, user.id])

  // Aggregate entries by user, respecting their anonymous preference
  const aggregated = Object.values(
    entries.reduce((acc, e) => {
      const uid = e.user_id
      const isAnon = e.user_profiles?.anonymous_on_leaderboard
      if (!acc[uid]) acc[uid] = {
        user_id: uid,
        username: isAnon ? 'Anonymous' : (e.user_profiles?.username || 'Unknown'),
        checkouts: 0,
        profit: 0,
        anonymous: isAnon,
      }
      acc[uid].checkouts += e.checkouts || 0
      acc[uid].profit    += parseFloat(e.estimated_profit || 0)
      return acc
    }, {})
  ).sort((a, b) => b.checkouts - a.checkouts)

  const myEntry = aggregated.find(e => e.user_id === user.id)

  async function save() {
    if (!form.item_name || !form.checkouts) return
    setSaving(true)
    const targetId = isAdmin ? (form.target_user_id || user.id) : user.id
    const payload = {
      item_name: form.item_name,
      checkouts: parseInt(form.checkouts),
      estimated_profit: form.estimated_profit ? parseFloat(form.estimated_profit) : 0,
      user_id: targetId,
      month_date: `${form.month}-01`,
    }
    const { error } = await supabase.from('checkouts').insert(payload)
    if (error) console.error('LEADERBOARD INSERT ERROR:', error)
    await load(); closeModal(); setSaving(false)
  }

  async function del(id) { await supabase.from('checkouts').delete().eq('id', id); await load() }

  function closeModal() { setModal(false); setForm(EMPTY) }

  async function saveAnonPref(val) {
    setSavingPref(true)
    setAnonPref(val)
    await supabase.from('user_profiles').update({ anonymous_on_leaderboard: val }).eq('id', user.id)
    setSavingPref(false)
  }

  const monthOptions = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(); d.setMonth(d.getMonth() - i)
    return format(d, 'yyyy-MM')
  })

  const myEntries = entries.filter(e => e.user_id === user.id)

  return (
    <div className="max-w-3xl mx-auto animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-3xl text-vault-accent neon-cyan">LEADERBOARD</h1>
          <p className="text-vault-text-dim text-sm font-body mt-0.5">Monthly checkout rankings</p>
        </div>
        <div className="flex gap-2 items-center">
          <select className="vault-input text-sm w-36" value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)}>
            {monthOptions.map(m => <option key={m} value={m}>{format(new Date(`${m}-01`), 'MMM yyyy')}</option>)}
          </select>
          {isAdmin && (
            <button className="vault-btn-primary" onClick={() => setModal(true)}>
              <Plus className="w-4 h-4" /> Log Run
            </button>
          )}
        </div>
      </div>

      {/* Anonymous preference (users only) */}
      {!isAdmin && (
        <div className="vault-card mb-6 flex items-center gap-4">
          <EyeOff className="w-5 h-5 text-vault-text-dim shrink-0" />
          <div className="flex-1">
            <p className="text-vault-text text-sm font-semibold">Stay anonymous on leaderboard</p>
            <p className="text-vault-muted text-xs font-mono">Your checkouts still count — your name is hidden from everyone</p>
          </div>
          <button
            onClick={() => saveAnonPref(!anonPref)}
            disabled={savingPref}
            className={`relative inline-flex w-11 h-6 rounded-full transition-colors duration-200 shrink-0 focus:outline-none ${anonPref ? 'bg-vault-accent' : 'bg-vault-border'}`}>
            <span className={`absolute left-1 top-1 w-4 h-4 bg-white rounded-full shadow transition-transform duration-200 ${anonPref ? 'translate-x-5' : 'translate-x-0'}`} />
          </button>
        </div>
      )}

      {/* My rank */}
      {myEntry && (
        <div className="vault-card mb-6 border-vault-accent/30 animate-pulse-glow">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-vault-accent/10 border border-vault-accent/30 flex items-center justify-center">
              <Trophy className="w-5 h-5 text-vault-accent" />
            </div>
            <div>
              <p className="text-vault-text-dim text-xs font-mono">Your rank this month</p>
              <p className="font-display font-bold text-vault-text">
                #{aggregated.indexOf(myEntry) + 1} · {myEntry.checkouts} checkout{myEntry.checkouts !== 1 ? 's' : ''} · ~£{myEntry.profit.toFixed(2)} profit
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Rankings */}
      {loading ? (
        <div className="flex justify-center py-16"><div className="w-8 h-8 border-2 border-vault-accent border-t-transparent rounded-full animate-spin" /></div>
      ) : aggregated.length === 0 ? (
        <div className="vault-card text-center py-16">
          <Trophy className="w-10 h-10 text-vault-muted mx-auto mb-3" />
          <p className="text-vault-text font-display font-semibold">No entries yet</p>
          <p className="text-vault-text-dim text-sm mt-1">{isAdmin ? 'Log the first run above' : 'Your admin will post results here after drops'}</p>
        </div>
      ) : (
        <div className="space-y-2 stagger">
          {aggregated.map((e, i) => {
            const isMe = e.user_id === user.id
            return (
              <div key={e.user_id}
                className={`vault-card flex items-center gap-4 transition-colors ${isMe ? 'border-vault-accent/40 bg-vault-accent/5' : ''}`}>
                <div className="w-8 flex items-center justify-center shrink-0">
                  <RankIcon rank={i + 1} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-display font-semibold text-vault-text">
                      {e.anonymous
                        ? <span className="flex items-center gap-1.5 text-vault-text-dim"><EyeOff className="w-3.5 h-3.5" />Anonymous</span>
                        : e.username}
                    </p>
                    {isMe && <span className="vault-badge bg-vault-accent/10 text-vault-accent border border-vault-accent/20 text-[10px]">you</span>}
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-display font-bold text-vault-text">{e.checkouts} <span className="text-vault-text-dim font-body font-normal text-sm">checkouts</span></p>
                  <p className="font-mono text-vault-green text-xs">~£{e.profit.toFixed(2)} profit</p>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Admin: show all logged entries this month with delete */}
      {isAdmin && myEntries.length > 0 && (
        <div className="mt-8">
          <p className="text-[10px] font-mono text-vault-muted uppercase tracking-widest mb-3">Logged This Month</p>
          <div className="space-y-1.5 stagger">
            {entries.map(e => (
              <div key={e.id} className="vault-card flex items-center gap-3 py-3">
                <div className="flex-1 min-w-0">
                  <p className="font-body text-vault-text text-sm font-medium">{e.item_name}</p>
                  <p className="text-vault-muted text-xs font-mono">
                    {e.user_profiles?.username || 'Unknown'} · {e.checkouts} checkout{e.checkouts !== 1 ? 's' : ''} · £{parseFloat(e.estimated_profit || 0).toFixed(2)} est.
                  </p>
                </div>
                <button onClick={() => del(e.id)} className="p-1.5 text-vault-muted hover:text-vault-red rounded hover:bg-vault-red/10 transition-all">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Admin Log Run Modal */}
      {modal && isAdmin && createPortal(
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="vault-card max-w-md w-full flex flex-col animate-fade-in" style={{ maxHeight: '90vh' }}>
            <div className="flex items-center justify-between mb-5 shrink-0">
              <h2 className="font-display font-bold text-xl text-vault-text">Log a Run</h2>
              <button onClick={closeModal}><X className="w-5 h-5 text-vault-muted" /></button>
            </div>
            <div className="overflow-y-auto flex-1 pr-1 space-y-3">
              <div>
                <label className="vault-label">User</label>
                <select className="vault-input" value={form.target_user_id} onChange={e => setForm(f => ({ ...f, target_user_id: e.target.value }))}>
                  <option value="">— Myself —</option>
                  {users.map(u => <option key={u.id} value={u.id}>{u.username}</option>)}
                </select>
              </div>
              <div><label className="vault-label">Drop / Item</label><input className="vault-input" placeholder="Nike SNKRS drop, Yeezy 350..." value={form.item_name} onChange={e => setForm(f => ({ ...f, item_name: e.target.value }))} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="vault-label">Checkouts</label><input className="vault-input" type="number" min="1" placeholder="1" value={form.checkouts} onChange={e => setForm(f => ({ ...f, checkouts: e.target.value }))} /></div>
                <div><label className="vault-label">Est. Profit (£)</label><input className="vault-input" type="number" step="0.01" placeholder="0.00" value={form.estimated_profit} onChange={e => setForm(f => ({ ...f, estimated_profit: e.target.value }))} /></div>
              </div>
              <div>
                <label className="vault-label">Month</label>
                <select className="vault-input" value={form.month} onChange={e => setForm(f => ({ ...f, month: e.target.value }))}>
                  {monthOptions.map(m => <option key={m} value={m}>{format(new Date(`${m}-01`), 'MMMM yyyy')}</option>)}
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5 pt-4 border-t border-vault-border shrink-0">
              <button className="vault-btn-ghost" onClick={closeModal}>Cancel</button>
              <button className="vault-btn-primary" onClick={save} disabled={saving}>
                <Trophy className="w-4 h-4" />{saving ? 'Saving...' : 'Log Run'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}

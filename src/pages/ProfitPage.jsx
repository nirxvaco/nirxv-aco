import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { Plus, TrendingUp, TrendingDown, X, Save, Trash2, ShoppingBag, Hash, Sparkles, RefreshCw } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { format } from 'date-fns'

const PLATFORMS = ['Pokemon Center', 'Topps', 'Argos', 'John Lewis', 'Game', 'Blood Records', 'Warhammer', 'Very', 'Other']

const STATUSES = {
  bought: { label: 'Bought',  color: 'text-vault-gold  bg-vault-gold/10  border-vault-gold/30' },
  listed: { label: 'Listed',  color: 'text-vault-accent bg-vault-accent/10 border-vault-accent/30' },
  sold:   { label: 'Sold',    color: 'text-vault-green bg-vault-green/10 border-vault-green/30' },
}

const EMPTY = {
  item_name: '', sku: '', buy_price: '', sell_price: '', estimated_sell_price: '',
  platform: 'Pokemon Center', custom_platform: '', source: '',
  status: 'bought', date: format(new Date(), 'yyyy-MM-dd'), notes: '',
  bought_via_aco: false, pas_paid: '', pas_rate: 0,
}

function generateSKU() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789'
  return 'SKU-' + Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

export default function ProfitPage() {
  const { user, isAdmin } = useAuth()

  if (isAdmin) return (
    <div className="max-w-5xl mx-auto animate-fade-in">
      <div className="vault-card text-center py-20">
        <p className="font-display text-2xl text-vault-text-dim mb-2">ADMIN ACCOUNT</p>
        <p className="text-vault-muted text-sm font-mono">Admins don't have personal profit entries.<br />Use the Admin panel to view user data.</p>
      </div>
    </div>
  )
  const [entries, setEntries]   = useState([])
  const [loading, setLoading]   = useState(true)
  const [modal, setModal]       = useState(false)
  const [form, setForm]         = useState(EMPTY)
  const [editId, setEditId]     = useState(null)
  const [saving, setSaving]     = useState(false)
  const [aiLoading, setAiLoading] = useState(false)
  const [filterStatus, setFilterStatus] = useState('all')

  const load = useCallback(async () => {
    setLoading(true)
    // FIX (Security Fix 7): Removed .eq('user_id', user.id) — RLS on profit_entries
    // scopes via auth.uid() = user_id automatically. Client filter was redundant.
    const { data } = await supabase.from('profit_entries').select('*').order('date', { ascending: false })
    setEntries(data || [])
    setLoading(false)
  }, [user.id])

  useEffect(() => { load() }, [load])

  function F(key, val) { setForm(f => ({ ...f, [key]: val })) }

  async function save() {
    if (!form.item_name || !form.buy_price) return
    setSaving(true)
    const platform = form.platform === 'Other' ? (form.custom_platform || 'Other') : form.platform
    const payload = {
      item_name: form.item_name,
      sku: form.sku,
      buy_price: parseFloat(form.buy_price),
      sell_price: form.sell_price ? parseFloat(form.sell_price) : null,
      estimated_sell_price: form.estimated_sell_price ? parseFloat(form.estimated_sell_price) : null,
      platform,
      custom_platform: form.custom_platform,
      source: form.source,
      status: form.status,
      date: form.date,
      notes: form.notes,
      bought_via_aco: form.bought_via_aco,
      pas_paid: form.pas_paid ? parseFloat(form.pas_paid) : 0,
      pas_rate: form.pas_rate || 0,
      // NOTE: user_id kept in INSERT payload intentionally — the DB column requires it
      // and RLS insert policy validates it matches auth.uid() server-side.
      user_id: user.id,
    }
    if (editId) await supabase.from('profit_entries').update(payload).eq('id', editId)
    else        await supabase.from('profit_entries').insert(payload)
    await load(); closeModal(); setSaving(false)
  }

  async function aiEstimate() {
    if (!form.item_name || !form.buy_price) return
    setAiLoading(true)
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 100,
          messages: [{
            role: 'user',
            content: `I bought "${form.item_name}" for £${form.buy_price}. What is a realistic resale price in GBP on the secondary market today? Reply with ONLY a number, no currency symbol, no explanation. Just the number.`
          }]
        })
      })
      const data = await res.json()
      const text = data.content?.[0]?.text?.trim().replace(/[^0-9.]/g, '')
      if (text && !isNaN(parseFloat(text))) {
        F('estimated_sell_price', parseFloat(text).toFixed(2))
      }
    } catch (e) { console.error('AI estimate failed', e) }
    setAiLoading(false)
  }

  async function del(id) { await supabase.from('profit_entries').delete().eq('id', id); await load() }
  function closeModal() { setModal(false); setForm(EMPTY); setEditId(null) }
  function openEdit(e) {
    setForm({
      ...EMPTY, ...e,
      date: e.date || format(new Date(), 'yyyy-MM-dd'),
      platform: PLATFORMS.includes(e.platform) ? e.platform : 'Other',
      custom_platform: PLATFORMS.includes(e.platform) ? '' : (e.platform || ''),
    })
    setEditId(e.id); setModal(true)
  }

  const filtered = filterStatus === 'all' ? entries : entries.filter(e => e.status === filterStatus)
  const sold = entries.filter(e => e.status === 'sold' && e.sell_price)
  const totalProfit = sold.reduce((s, e) => s + (e.sell_price - e.buy_price), 0)
  const totalPasPaid = entries.reduce((s, e) => s + parseFloat(e.pas_paid || 0), 0)
  const netProfit = totalProfit - totalPasPaid
  const totalInvested = entries.filter(e => e.status !== 'sold').reduce((s, e) => s + parseFloat(e.buy_price || 0), 0)
  const estProfit = entries.filter(e => e.status !== 'sold' && e.estimated_sell_price)
    .reduce((s, e) => s + (e.estimated_sell_price - e.buy_price), 0)

  // Chart by platform (use display name)
  const allPlatforms = [...new Set(entries.map(e => e.platform))]
  const byPlatform = allPlatforms.map(p => ({
    name: p,
    profit: entries.filter(e => e.platform === p && e.sell_price).reduce((s, e) => s + (e.sell_price - e.buy_price), 0)
  })).filter(p => p.profit !== 0)

  return (
    <div className="max-w-5xl mx-auto animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-3xl text-vault-accent neon-cyan">PROFIT TRACKER</h1>
          <p className="text-vault-text-dim text-sm font-body mt-0.5">{entries.length} item{entries.length !== 1 ? 's' : ''} tracked</p>
        </div>
        <button className="vault-btn-primary" onClick={() => setModal(true)}><Plus className="w-4 h-4" />Add Item</button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4 stagger">
        {[
          { label: 'Gross Profit',    value: `£${totalProfit.toFixed(2)}`,  color: totalProfit >= 0 ? 'text-vault-green' : 'text-vault-red' },
          { label: 'ACO PAS Paid',    value: `£${totalPasPaid.toFixed(2)}`, color: 'text-vault-gold' },
          { label: 'Net Profit',      value: `£${netProfit.toFixed(2)}`,    color: netProfit >= 0 ? 'text-vault-green' : 'text-vault-red' },
          { label: 'Capital Tied Up', value: `£${totalInvested.toFixed(2)}`,color: 'text-vault-text-dim' },
        ].map(s => (
          <div key={s.label} className="vault-card">
            <p className="vault-label">{s.label}</p>
            <p className={`font-display text-xl ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Net profit explainer */}
      {totalPasPaid > 0 && (
        <div className="vault-card mb-6 py-3 flex items-center gap-3 border-vault-gold/20 bg-vault-gold/5">
          <div className="flex-1 min-w-0">
            <p className="text-vault-text-dim text-xs font-mono">
              Gross £{totalProfit.toFixed(2)} − ACO PAS £{totalPasPaid.toFixed(2)} = <span className={netProfit >= 0 ? 'text-vault-green' : 'text-vault-red'}>Net £{netProfit.toFixed(2)}</span>
            </p>
          </div>
        </div>
      )}

      {/* Est. unrealised profit banner */}
      {estProfit !== 0 && (
        <div className="vault-card mb-6 flex items-center gap-3 border-vault-accent/20">
          <Sparkles className="w-5 h-5 text-vault-accent shrink-0" />
          <div>
            <p className="text-vault-text text-sm font-body font-medium">Estimated unrealised profit</p>
            <p className="text-vault-text-dim text-xs font-mono">Based on your AI estimates for unsold items</p>
          </div>
          <p className={`font-display text-xl ml-auto ${estProfit >= 0 ? 'text-vault-green' : 'text-vault-red'}`}>
            ~£{estProfit.toFixed(2)}
          </p>
        </div>
      )}

      {/* Chart */}
      {byPlatform.length > 0 && (
        <div className="vault-card mb-6">
          <p className="vault-label mb-4">Profit by Source</p>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={byPlatform} barSize={32}>
              <XAxis dataKey="name" tick={{ fill: '#7a7a9a', fontSize: 10, fontFamily: 'JetBrains Mono' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#7a7a9a', fontSize: 10, fontFamily: 'JetBrains Mono' }} axisLine={false} tickLine={false} tickFormatter={v => `£${v}`} />
              <Tooltip
                contentStyle={{ background: '#0e0e1a', border: '1px solid #1a1a2e', borderRadius: 8, fontFamily: 'Barlow', color: '#eef0ff' }}
                labelStyle={{ color: '#7a7a9a', fontSize: 11 }}
                itemStyle={{ color: '#00e396' }}
                cursor={{ fill: 'rgba(0,200,255,0.04)' }}
                formatter={v => [`£${v.toFixed(2)}`, 'Profit']}
              />
              <Bar dataKey="profit" radius={[4, 4, 0, 0]}>
                {byPlatform.map((e, i) => <Cell key={i} fill={e.profit >= 0 ? '#00e396' : '#ff3355'} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Status filter tabs */}
      <div className="flex gap-1.5 mb-4 flex-wrap">
        {[['all', 'All'], ...Object.entries(STATUSES).map(([k, v]) => [k, v.label])].map(([k, label]) => (
          <button key={k} onClick={() => setFilterStatus(k)}
            className={`px-3 py-1.5 rounded-lg text-xs font-body font-medium transition-all border
              ${filterStatus === k
                ? 'bg-vault-accent/10 text-vault-accent border-vault-accent/30'
                : 'text-vault-text-dim border-vault-border hover:text-vault-text hover:bg-vault-border'}`}>
            {label}
            <span className="ml-1.5 font-mono text-[10px] opacity-60">
              {k === 'all' ? entries.length : entries.filter(e => e.status === k).length}
            </span>
          </button>
        ))}
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex justify-center py-16"><div className="w-8 h-8 border-2 border-vault-accent border-t-transparent rounded-full animate-spin" /></div>
      ) : filtered.length === 0 ? (
        <div className="vault-card text-center py-16">
          <ShoppingBag className="w-10 h-10 text-vault-muted mx-auto mb-3" />
          <p className="text-vault-text font-display">No items tracked</p>
          <p className="text-vault-text-dim text-sm mt-1">Log your first buy to start tracking profit</p>
        </div>
      ) : (
        <div className="vault-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-vault-border">
                {['Item', 'SKU', 'Source', 'Status', 'Bought', 'Sold / Est.', 'Profit', 'PAS Paid', 'Date', ''].map(h => (
                  <th key={h} className="text-left py-3 px-3 text-[10px] font-mono text-vault-muted uppercase tracking-widest whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(e => {
                const profit = e.sell_price ? e.sell_price - e.buy_price : null
                const estP = e.estimated_sell_price ? e.estimated_sell_price - e.buy_price : null
                const s = STATUSES[e.status] || STATUSES.bought
                return (
                  <tr key={e.id} className="border-b border-vault-border/40 hover:bg-vault-bg/50 transition-colors">
                    <td className="py-3 px-3 font-body text-vault-text font-medium max-w-[140px] truncate">{e.item_name}</td>
                    <td className="py-3 px-3 font-mono text-vault-muted text-xs">{e.sku || '—'}</td>
                    <td className="py-3 px-3">
                      <span className="vault-badge bg-vault-border text-vault-text-dim border border-vault-border text-[10px]">{e.platform}</span>
                    </td>
                    <td className="py-3 px-3">
                      <span className={`vault-badge border text-[10px] ${s.color}`}>{s.label}</span>
                    </td>
                    <td className="py-3 px-3 font-mono text-vault-text">£{parseFloat(e.buy_price).toFixed(2)}</td>
                    <td className="py-3 px-3 font-mono">
                      {e.sell_price
                        ? <span className="text-vault-text">£{parseFloat(e.sell_price).toFixed(2)}</span>
                        : e.estimated_sell_price
                          ? <span className="text-vault-text-dim">~£{parseFloat(e.estimated_sell_price).toFixed(2)}</span>
                          : <span className="text-vault-muted">—</span>}
                    </td>
                    <td className="py-3 px-3">
                      {profit !== null ? (
                        <span className={`font-mono font-semibold flex items-center gap-1 ${profit >= 0 ? 'text-vault-green' : 'text-vault-red'}`}>
                          {profit >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                          £{profit.toFixed(2)}
                        </span>
                      ) : estP !== null ? (
                        <span className="text-vault-text-dim font-mono text-xs flex items-center gap-1">
                          <Sparkles className="w-3 h-3 text-vault-accent" />~£{estP.toFixed(2)}
                        </span>
                      ) : (
                        <span className="text-vault-gold font-mono text-xs">holding</span>
                      )}
                    </td>
                    <td className="py-3 px-3 font-mono text-vault-gold text-xs">
                      {e.pas_paid > 0 ? `£${parseFloat(e.pas_paid).toFixed(2)}` : <span className="text-vault-muted">—</span>}
                    </td>
                    <td className="py-3 px-3 font-mono text-vault-text-dim text-xs whitespace-nowrap">{e.date ? format(new Date(e.date), 'dd MMM yy') : '—'}</td>
                    <td className="py-3 px-3">
                      <div className="flex gap-1">
                        <button onClick={() => openEdit(e)} className="p-1.5 text-vault-muted hover:text-vault-accent rounded hover:bg-vault-accent/10 transition-all"><Save className="w-3.5 h-3.5" /></button>
                        <button onClick={() => del(e.id)} className="p-1.5 text-vault-muted hover:text-vault-red rounded hover:bg-vault-red/10 transition-all"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal */}
      {modal && createPortal(
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="vault-card max-w-lg w-full flex flex-col animate-fade-in" style={{ maxHeight: '90vh' }}>
            <div className="flex items-center justify-between mb-5 shrink-0">
              <h2 className="font-display text-2xl text-vault-accent neon-cyan">{editId ? 'EDIT ITEM' : 'LOG ITEM'}</h2>
              <button onClick={closeModal}><X className="w-5 h-5 text-vault-muted" /></button>
            </div>

            <div className="overflow-y-auto flex-1 pr-1 space-y-4">

              {/* Item name */}
              <div>
                <label className="vault-label">Item Name *</label>
                <input className="vault-input" placeholder="Charizard Ex Box, Pokemon Center Exclusive..." value={form.item_name} onChange={e => F('item_name', e.target.value)} />
              </div>

              {/* SKU */}
              <div>
                <label className="vault-label flex items-center gap-1"><Hash className="w-3 h-3" />SKU</label>
                <div className="flex gap-2">
                  <input className="vault-input font-mono" placeholder="Auto-generated or enter manually" value={form.sku} onChange={e => F('sku', e.target.value)} />
                  <button type="button" onClick={() => F('sku', generateSKU())}
                    className="vault-btn-ghost px-3 py-2 shrink-0 text-xs whitespace-nowrap">
                    <RefreshCw className="w-3.5 h-3.5" /> Generate
                  </button>
                </div>
              </div>

              {/* Source + Platform */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="vault-label">Source / Shop</label>
                  <select className="vault-input" value={form.platform} onChange={e => F('platform', e.target.value)}>
                    {PLATFORMS.map(p => <option key={p}>{p}</option>)}
                  </select>
                </div>
                <div>
                  <label className="vault-label">Status *</label>
                  <select className="vault-input" value={form.status} onChange={e => F('status', e.target.value)}>
                    {Object.entries(STATUSES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select>
                </div>
              </div>

              {/* Custom platform input when Other is selected */}
              {form.platform === 'Other' && (
                <div>
                  <label className="vault-label">Custom Source Name</label>
                  <input className="vault-input" placeholder="e.g. Local Car Boot, Facebook Marketplace..." value={form.custom_platform} onChange={e => F('custom_platform', e.target.value)} />
                </div>
              )}

              {/* Source URL / reference */}
              <div>
                <label className="vault-label">Source Reference (optional)</label>
                <input className="vault-input" placeholder="Order number, listing URL, etc." value={form.source} onChange={e => F('source', e.target.value)} />
              </div>

              {/* Prices */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="vault-label">Purchase Price *</label>
                  <div className="relative">
                    <input className="vault-input pr-6" type="number" step="0.01" placeholder="0.00" value={form.buy_price} onChange={e => F('buy_price', e.target.value)} />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-vault-muted text-sm font-mono">£</span>
                  </div>
                </div>
                <div>
                  <label className="vault-label">Purchase Date *</label>
                  <input className="vault-input" type="date" value={form.date} onChange={e => F('date', e.target.value)} />
                </div>
              </div>

              {/* Sell price (only if sold) */}
              {form.status === 'sold' && (
                <div>
                  <label className="vault-label">Actual Sale Price</label>
                  <div className="relative">
                    <input className="vault-input pr-6" type="number" step="0.01" placeholder="0.00" value={form.sell_price} onChange={e => F('sell_price', e.target.value)} />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-vault-muted text-sm font-mono">£</span>
                  </div>
                </div>
              )}

              {/* Estimated sell price with AI button */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="vault-label mb-0">Estimated Sale Price <span className="text-vault-muted font-normal normal-case tracking-normal">(optional)</span></label>
                  <button type="button" onClick={aiEstimate} disabled={aiLoading || !form.item_name}
                    className="flex items-center gap-1.5 text-xs font-body font-medium text-vault-accent hover:text-vault-accent/80 disabled:opacity-40 transition-all">
                    {aiLoading
                      ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Estimating...</>
                      : <><Sparkles className="w-3.5 h-3.5" /> AI Estimate</>}
                  </button>
                </div>
                <div className="relative">
                  <input className="vault-input pr-6" type="number" step="0.01" placeholder="0.00" value={form.estimated_sell_price} onChange={e => F('estimated_sell_price', e.target.value)} />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-vault-muted text-sm font-mono">£</span>
                </div>
                {form.estimated_sell_price && form.buy_price && (
                  <p className={`text-xs font-mono mt-1 ${parseFloat(form.estimated_sell_price) >= parseFloat(form.buy_price) ? 'text-vault-green' : 'text-vault-red'}`}>
                    Est. profit: £{(parseFloat(form.estimated_sell_price) - parseFloat(form.buy_price)).toFixed(2)}
                  </p>
                )}
              </div>

              {/* Notes */}
              <div>
                <label className="vault-label">Notes</label>
                <input className="vault-input" placeholder="Condition, variant, size, etc." value={form.notes} onChange={e => F('notes', e.target.value)} />
              </div>

              {/* ACO / PAS section */}
              <div className="border border-vault-gold/20 rounded-xl p-4 bg-vault-gold/5 space-y-3">
                <p className="text-[10px] font-mono text-vault-gold uppercase tracking-widest">ACO Pay After Success</p>

                {/* Bought via ACO toggle */}
                <div className="flex items-center gap-3">
                  <button type="button" onClick={() => F('bought_via_aco', !form.bought_via_aco)}
                    className={`relative inline-flex w-11 h-6 rounded-full transition-colors duration-200 focus:outline-none shrink-0 ${form.bought_via_aco ? 'bg-vault-gold' : 'bg-vault-border'}`}>
                    <span className={`absolute left-1 top-1 w-4 h-4 bg-white rounded-full shadow transition-transform duration-200 ${form.bought_via_aco ? 'translate-x-5' : 'translate-x-0'}`} />
                  </button>
                  <div>
                    <p className="text-sm font-body text-vault-text">Bought via ACO</p>
                    <p className="text-xs font-mono text-vault-muted">Was this item copped through Nirxv ACO?</p>
                  </div>
                </div>

                {/* PAS amount — only show if bought via ACO and sold */}
                {form.bought_via_aco && form.status === 'sold' && (
                  <div>
                    <label className="vault-label">PAS Amount Paid to ACO</label>
                    <div className="relative">
                      <input className="vault-input pr-6" type="number" step="0.01" placeholder="0.00"
                        value={form.pas_paid} onChange={e => F('pas_paid', e.target.value)} />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-vault-muted text-sm font-mono">£</span>
                    </div>
                    {form.pas_paid && form.sell_price && form.buy_price && (
                      <p className="text-xs font-mono mt-1 text-vault-text-dim">
                        Net after PAS: <span className={parseFloat(form.sell_price) - parseFloat(form.buy_price) - parseFloat(form.pas_paid) >= 0 ? 'text-vault-green' : 'text-vault-red'}>
                          £{(parseFloat(form.sell_price) - parseFloat(form.buy_price) - parseFloat(form.pas_paid)).toFixed(2)}
                        </span>
                      </p>
                    )}
                  </div>
                )}

                {/* If bought via ACO but not sold yet — show reminder */}
                {form.bought_via_aco && form.status !== 'sold' && (
                  <p className="text-xs font-mono text-vault-muted">
                    PAS will be due when you mark this as Sold
                  </p>
                )}
              </div>

            </div>

            <div className="flex justify-end gap-2 mt-5 pt-4 border-t border-vault-border shrink-0">
              <button className="vault-btn-ghost" onClick={closeModal}>Cancel</button>
              <button className="vault-btn-primary" onClick={save} disabled={saving}>
                <Save className="w-4 h-4" />{saving ? 'Saving...' : editId ? 'Save Changes' : 'Log Item'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}

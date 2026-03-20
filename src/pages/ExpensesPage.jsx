import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { Plus, Receipt, X, Save, Trash2, RefreshCw } from 'lucide-react'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { format } from 'date-fns'

const CATEGORIES = [
  'Info Group / Cook Group', // Sole Supplier, Hype Notifier etc
  'Selling Fees',            // eBay, StockX, Vinted commission
  'Shipping',                // postage costs
  'Packaging',               // boxes, bubble wrap, tape
  'Storage',                 // holding stock
  'Returns & Losses',        // returned/lost/damaged items
  'Other',
]
const COLORS = ['#00c8ff', '#ffe600', '#00e396', '#b44fff', '#ff9f43', '#ff3355', '#4a4a6a']
const EMPTY = { label: '', amount: '', category: 'Info Group / Cook Group', recurring: false, date: format(new Date(), 'yyyy-MM-dd'), notes: '' }

export default function ExpensesPage() {
  const { user } = useAuth()
  const [expenses, setExpenses] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState(EMPTY)
  const [editId, setEditId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [filterCat, setFilterCat] = useState('All')

  const load = useCallback(async () => {
    setLoading(true)
    // FIX (Security Fix 7): Removed .eq('user_id', user.id) — RLS on expenses table
    // scopes this to auth.uid() = user_id automatically. Client-side filter was redundant
    // and leaked that user_id is used as a filter param in the URL.
    const { data } = await supabase.from('expenses').select('*').order('date', { ascending: false })
    setExpenses(data || [])
    setLoading(false)
  }, [user.id])

  useEffect(() => { load() }, [load])

  async function save() {
    if (!form.label || !form.amount) return
    setSaving(true)
    // FIX (Security Fix 7): Removed explicit user_id from payload — Supabase RLS
    // insert policy uses auth.uid() to scope the row automatically on the server side.
    const payload = { ...form, amount: parseFloat(form.amount) }
    if (editId) await supabase.from('expenses').update(payload).eq('id', editId)
    else await supabase.from('expenses').insert(payload)
    await load(); closeModal(); setSaving(false)
  }

  async function del(id) { await supabase.from('expenses').delete().eq('id', id); await load() }
  function closeModal() { setModal(false); setForm(EMPTY); setEditId(null) }
  function openEdit(e) { setForm({ ...e, date: e.date || format(new Date(), 'yyyy-MM-dd') }); setEditId(e.id); setModal(true) }

  const filtered = filterCat === 'All' ? expenses : expenses.filter(e => e.category === filterCat)
  const total = expenses.reduce((s, e) => s + parseFloat(e.amount), 0)
  const recurring = expenses.filter(e => e.recurring).reduce((s, e) => s + parseFloat(e.amount), 0)

  const pieData = CATEGORIES.map((cat, i) => ({
    name: cat,
    value: expenses.filter(e => e.category === cat).reduce((s, e) => s + parseFloat(e.amount), 0),
    color: COLORS[i]
  })).filter(d => d.value > 0)

  return (
    <div className="max-w-5xl mx-auto animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-3xl text-vault-accent neon-cyan">EXPENSES</h1>
          <p className="text-vault-text-dim text-sm font-body mt-0.5">{expenses.length} expense{expenses.length !== 1 ? 's' : ''} logged</p>
        </div>
        <button className="vault-btn-primary" onClick={() => setModal(true)}><Plus className="w-4 h-4" />Add Expense</button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6 stagger">
        <div className="vault-card">
          <p className="vault-label">Total Expenses</p>
          <p className="font-display text-2xl text-vault-red">£{total.toFixed(2)}</p>
        </div>
        <div className="vault-card">
          <p className="vault-label">Info Groups</p>
          <p className="font-display text-2xl text-vault-accent">
            £{expenses.filter(e => e.category === 'Info Group / Cook Group').reduce((s, e) => s + parseFloat(e.amount), 0).toFixed(2)}
          </p>
        </div>
        <div className="vault-card">
          <p className="vault-label">Selling Fees</p>
          <p className="font-display text-2xl text-vault-text-dim">
            £{expenses.filter(e => e.category === 'Selling Fees').reduce((s, e) => s + parseFloat(e.amount), 0).toFixed(2)}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        {/* Pie chart */}
        {pieData.length > 0 && (
          <div className="vault-card lg:col-span-1">
            <p className="vault-label mb-2">By Category</p>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value" paddingAngle={2}>
                  {pieData.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Pie>
                <Tooltip contentStyle={{ background: '#111118', border: '1px solid #1e1e2e', borderRadius: 8, fontFamily: 'DM Sans', fontSize: 12 }} formatter={v => [`£${v.toFixed(2)}`]} />
              </PieChart>
            </ResponsiveContainer>
            <div className="space-y-1 mt-2">
              {pieData.map(d => (
                <div key={d.name} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full" style={{ background: d.color }} />
                    <span className="text-vault-text-dim font-body">{d.name}</span>
                  </div>
                  <span className="font-mono text-vault-text">£{d.value.toFixed(2)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Filter + list */}
        <div className={`${pieData.length > 0 ? 'lg:col-span-2' : 'lg:col-span-3'}`}>
          {/* Category filter */}
          <div className="flex gap-1.5 flex-wrap mb-3">
            {['All', ...CATEGORIES].map(cat => (
              <button key={cat} onClick={() => setFilterCat(cat)}
                className={`px-3 py-1 rounded-full text-xs font-mono transition-all ${filterCat === cat ? 'bg-vault-accent text-white' : 'bg-vault-border text-vault-text-dim hover:text-vault-text'}`}>
                {cat}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="flex justify-center py-10"><div className="w-7 h-7 border-2 border-vault-accent border-t-transparent rounded-full animate-spin" /></div>
          ) : filtered.length === 0 ? (
            <div className="vault-card text-center py-10">
              <Receipt className="w-8 h-8 text-vault-muted mx-auto mb-2" />
              <p className="text-vault-text font-display text-sm">No expenses logged</p>
              <p className="text-vault-text-dim text-xs mt-1 font-body">Track your ACO fees, selling costs and shipping here</p>
            </div>
          ) : (
            <div className="space-y-2 stagger">
              {filtered.map(e => (
                <div key={e.id} className="vault-card flex items-center gap-3 hover:border-vault-accent/30 transition-colors py-3">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                    style={{ background: COLORS[CATEGORIES.indexOf(e.category)] + '20', border: `1px solid ${COLORS[CATEGORIES.indexOf(e.category)]}30` }}>
                    <Receipt className="w-4 h-4" style={{ color: COLORS[CATEGORIES.indexOf(e.category)] }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-body font-medium text-vault-text text-sm truncate">{e.label}</p>
                      {e.recurring && <span className="vault-badge bg-vault-accent/10 text-vault-accent border border-vault-accent/20 text-[10px]"><RefreshCw className="w-2.5 h-2.5" />recurring</span>}
                    </div>
                    <p className="text-vault-muted text-xs font-mono">{e.category} · {e.date ? format(new Date(e.date), 'dd MMM yyyy') : ''}</p>
                  </div>
                  <p className="font-display font-bold text-vault-red text-sm">-£{parseFloat(e.amount).toFixed(2)}</p>
                  <div className="flex gap-1">
                    <button onClick={() => openEdit(e)} className="p-1.5 text-vault-muted hover:text-vault-accent rounded hover:bg-vault-accent/10 transition-all"><Save className="w-3.5 h-3.5" /></button>
                    <button onClick={() => del(e.id)} className="p-1.5 text-vault-muted hover:text-vault-red rounded hover:bg-vault-red/10 transition-all"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {modal && createPortal(
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="vault-card max-w-md w-full flex flex-col animate-fade-in" style={{ maxHeight: '90vh' }}>
            <div className="flex items-center justify-between mb-5 shrink-0">
              <h2 className="font-display text-2xl text-vault-accent neon-cyan">{editId ? 'EDIT EXPENSE' : 'ADD EXPENSE'}</h2>
              <button onClick={closeModal}><X className="w-5 h-5 text-vault-muted" /></button>
            </div>
            <div className="overflow-y-auto flex-1 pr-1 space-y-3">
              <div><label className="vault-label">Label</label><input className="vault-input" placeholder="e.g. House Of Resell, eBay fees, Royal Mail..." value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="vault-label">Amount (£)</label><input className="vault-input" type="number" step="0.01" placeholder="0.00" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} /></div>
                <div><label className="vault-label">Category</label>
                  <select className="vault-input" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                    {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>
              </div>
              <div><label className="vault-label">Date</label><input className="vault-input" type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} /></div>
              <div><label className="vault-label">Notes</label><input className="vault-input" placeholder="Optional" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} /></div>
              <div className="flex items-center gap-3">
                <button type="button" onClick={() => setForm(f => ({ ...f, recurring: !f.recurring }))}
                  className={`relative inline-flex w-11 h-6 rounded-full transition-colors duration-200 focus:outline-none ${form.recurring ? 'bg-vault-accent' : 'bg-vault-border'}`}>
                  <span className={`absolute left-1 top-1 w-4 h-4 bg-white rounded-full shadow transition-transform duration-200 ${form.recurring ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
                <span className="text-sm font-body text-vault-text-dim">Monthly recurring (e.g. info group sub)</span>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5 pt-4 border-t border-vault-border shrink-0">
              <button className="vault-btn-ghost" onClick={closeModal}>Cancel</button>
              <button className="vault-btn-primary" onClick={save} disabled={saving}><Save className="w-4 h-4" />{saving ? 'Saving...' : editId ? 'Save' : 'Add'}</button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}

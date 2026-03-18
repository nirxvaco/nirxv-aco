import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { decryptProfile } from '../lib/crypto'
import {
  Plus, X, Save, Trash2, ChevronDown, ChevronUp, Package,
  CheckCircle, XCircle, Truck, Clock, Search, Copy, Check,
  AlertTriangle, PoundSterling, ArrowLeftRight, RefreshCw
} from 'lucide-react'
import { format } from 'date-fns'

const DROP_STATUSES = {
  active:        { label: 'Active',        color: 'text-vault-accent bg-vault-accent/10 border-vault-accent/20' },
  cancellations: { label: 'Cancellations', color: 'text-vault-gold  bg-vault-gold/10  border-vault-gold/20' },
  settled:       { label: 'Settled',       color: 'text-vault-green bg-vault-green/10 border-vault-green/20' },
}

const ORDER_STATUSES = {
  active:    { label: 'Active',    color: 'text-vault-accent bg-vault-accent/10 border-vault-accent/20', icon: Clock },
  cancelled: { label: 'Cancelled', color: 'text-vault-red   bg-vault-red/10   border-vault-red/20',   icon: XCircle },
  shipped:   { label: 'Shipped',   color: 'text-vault-gold  bg-vault-gold/10  border-vault-gold/20',  icon: Truck },
  delivered: { label: 'Delivered', color: 'text-vault-green bg-vault-green/10 border-vault-green/20', icon: CheckCircle },
}

const PKC_ORDER_URL = 'https://www.pokemoncenter.com/en-gb/orders?srsltid='
const EMPTY_DROP = { drop_name: '', drop_date: '', cancellation_date: '', release_date: '', status: 'active', notes: '' }
const EMPTY_ORDER = { profile_id: '', order_number: '', status: 'active', pas_amount: '', pas_paid: false, notes: '' }

export default function OrderTrackingPage() {
  const { user, profile, isAdmin } = useAuth()
  const [drops, setDrops]               = useState([])
  const [loading, setLoading]           = useState(true)
  const [expandedDrop, setExpandedDrop] = useState(null)
  const [dropOrders, setDropOrders]     = useState({}) // { [dropId]: orders[] }
  const [loadingOrders, setLoadingOrders] = useState({})

  // All profiles across all users (admin needs to pick from them)
  const [allProfiles, setAllProfiles]   = useState([])
  const [admins, setAdmins]             = useState([])
  const [pasRevenue, setPasRevenue]     = useState([])

  // Modals
  const [dropModal, setDropModal]       = useState(false)
  const [dropForm, setDropForm]         = useState(EMPTY_DROP)
  const [editDropId, setEditDropId]     = useState(null)
  const [savingDrop, setSavingDrop]     = useState(false)

  const [orderModal, setOrderModal]     = useState(false)
  const [orderForm, setOrderForm]       = useState(EMPTY_ORDER)
  const [editOrderId, setEditOrderId]   = useState(null)
  const [currentDropId, setCurrentDropId] = useState(null)
  const [savingOrder, setSavingOrder]   = useState(false)

  const [orderSearch, setOrderSearch]   = useState({}) // { [dropId]: string }
  const [copied, setCopied]             = useState(null)

  // PAS split modal
  const [pasModal, setPasModal]         = useState(false)
  const [pasForm, setPasForm]           = useState({ to_admin: '', amount: '', description: '', drop_id: '' })
  const [savingPas, setSavingPas]       = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase.from('order_tracking').select('*').order('created_at', { ascending: false })
    if (error) console.error('ORDER LOAD ERROR:', error)
    setDrops(data || [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    // Load all profiles for the profile picker
    async function loadProfiles() {
      const { data } = await supabase.from('profiles').select('id, profile_name, shipping_zip, user_id, assigned_admin')
      if (data) {
        const decrypted = await Promise.all(data.map(async p => {
          const d = await decryptProfile(p)
          return d
        }))
        setAllProfiles(decrypted)
      }
    }
    // Load admins for PAS split
    async function loadAdmins() {
      const { data } = await supabase.from('user_profiles').select('id, username').eq('role', 'admin')
      setAdmins(data || [])
    }
    // Load PAS revenue
    async function loadPasRevenue() {
      const { data } = await supabase.from('pas_revenue').select('*, from_profile:from_admin(username), to_profile:to_admin(username)').order('created_at', { ascending: false })
      setPasRevenue(data || [])
    }
    loadProfiles(); loadAdmins(); loadPasRevenue()
  }, [])

  async function loadOrdersForDrop(dropId) {
    setLoadingOrders(s => ({ ...s, [dropId]: true }))
    const { data } = await supabase.from('drop_orders').select('*').eq('drop_id', dropId).order('created_at', { ascending: true })
    setDropOrders(s => ({ ...s, [dropId]: data || [] }))
    setLoadingOrders(s => ({ ...s, [dropId]: false }))
  }

  function toggleDrop(dropId) {
    if (expandedDrop === dropId) { setExpandedDrop(null); return }
    setExpandedDrop(dropId)
    if (!dropOrders[dropId]) loadOrdersForDrop(dropId)
  }

  // ── Drop CRUD ──────────────────────────────────────────────────────────
  async function saveDrop() {
    if (!dropForm.drop_name) return
    setSavingDrop(true)
    const payload = { ...dropForm, created_by: user.id }
    let error
    if (editDropId) {
      const res = await supabase.from('order_tracking').update(payload).eq('id', editDropId)
      error = res.error
    } else {
      const res = await supabase.from('order_tracking').insert(payload)
      error = res.error
    }
    if (error) console.error('SAVE DROP ERROR:', error)
    await load(); closeDropModal(); setSavingDrop(false)
  }

  async function deleteDrop(id) {
    await supabase.from('order_tracking').delete().eq('id', id)
    await load()
  }

  function openEditDrop(drop) { setDropForm(drop); setEditDropId(drop.id); setDropModal(true) }
  function closeDropModal()   { setDropModal(false); setDropForm(EMPTY_DROP); setEditDropId(null) }

  // ── Order CRUD ─────────────────────────────────────────────────────────
  function openNewOrder(dropId) {
    setOrderForm(EMPTY_ORDER)
    setEditOrderId(null)
    setCurrentDropId(dropId)
    setOrderModal(true)
  }

  function openEditOrder(order, dropId) {
    setOrderForm({ ...order, pas_amount: order.pas_amount || '' })
    setEditOrderId(order.id)
    setCurrentDropId(dropId)
    setOrderModal(true)
  }

  async function saveOrder() {
    if (!orderForm.order_number) return
    setSavingOrder(true)

    // When a profile is selected, pull its postcode
    let postcode = orderForm.postcode || ''
    let profileName = orderForm.profile_name || ''
    let userId = orderForm.user_id || null

    if (orderForm.profile_id) {
      const p = allProfiles.find(p => p.id === orderForm.profile_id)
      if (p) {
        postcode = p.shipping_zip || ''
        profileName = p.profile_name || ''
        userId = p.user_id || null
      }
    }

    const payload = {
      drop_id: currentDropId,
      profile_id: orderForm.profile_id || null,
      profile_name: profileName,
      postcode,
      order_number: orderForm.order_number,
      status: orderForm.status,
      pas_amount: orderForm.pas_amount ? parseFloat(orderForm.pas_amount) : 0,
      pas_paid: orderForm.pas_paid,
      runner_admin: user.id,
      notes: orderForm.notes,
      user_id: userId,
    }

    if (editOrderId) await supabase.from('drop_orders').update(payload).eq('id', editOrderId)
    else             await supabase.from('drop_orders').insert(payload)

    await loadOrdersForDrop(currentDropId)
    closeOrderModal()
    setSavingOrder(false)
  }

  async function deleteOrder(id, dropId) {
    await supabase.from('drop_orders').delete().eq('id', id)
    await loadOrdersForDrop(dropId)
  }

  async function cycleOrderStatus(order, dropId) {
    const cycle = { active: 'shipped', shipped: 'delivered', delivered: 'cancelled', cancelled: 'active' }
    await supabase.from('drop_orders').update({ status: cycle[order.status] }).eq('id', order.id)
    await loadOrdersForDrop(dropId)
  }

  async function togglePasPaid(order, dropId) {
    await supabase.from('drop_orders').update({ pas_paid: !order.pas_paid }).eq('id', order.id)
    await loadOrdersForDrop(dropId)
  }

  function closeOrderModal() { setOrderModal(false); setOrderForm(EMPTY_ORDER); setEditOrderId(null) }

  // ── Copy to clipboard ──────────────────────────────────────────────────
  function copyOrder(order) {
    const text = `${order.profile_name} - ${order.order_number} - Postcode ${order.postcode}`
    navigator.clipboard.writeText(text)
    setCopied(order.id)
    setTimeout(() => setCopied(null), 2000)
  }

  // ── PAS Revenue Split ──────────────────────────────────────────────────
  async function savePas() {
    if (!pasForm.to_admin || !pasForm.amount) return
    setSavingPas(true)
    await supabase.from('pas_revenue').insert({
      from_admin: user.id,
      to_admin: pasForm.to_admin,
      amount: parseFloat(pasForm.amount),
      description: pasForm.description,
      drop_id: pasForm.drop_id || null,
      settled: false,
    })
    const { data } = await supabase.from('pas_revenue').select('*, from_profile:from_admin(username), to_profile:to_admin(username)').order('created_at', { ascending: false })
    setPasRevenue(data || [])
    setPasModal(false); setPasForm({ to_admin: '', amount: '', description: '', drop_id: '' })
    setSavingPas(false)
  }

  async function settlePas(id) {
    await supabase.from('pas_revenue').update({ settled: true }).eq('id', id)
    const { data } = await supabase.from('pas_revenue').select('*, from_profile:from_admin(username), to_profile:to_admin(username)').order('created_at', { ascending: false })
    setPasRevenue(data || [])
  }

  // ── Derived ────────────────────────────────────────────────────────────
  // PAS I'm owed (from partner to me)
  const pasOwedToMe = pasRevenue.filter(p => p.to_admin === user.id && !p.settled)
    .reduce((s, p) => s + parseFloat(p.amount), 0)
  // PAS I owe (from me to partner)
  const pasIOwed = pasRevenue.filter(p => p.from_admin === user.id && !p.settled)
    .reduce((s, p) => s + parseFloat(p.amount), 0)

  // ── Profile picker options grouped by user ─────────────────────────────
  // Only show profiles assigned to current admin
  const myProfiles = allProfiles.filter(p => p.assigned_admin === user.id)

  return (
    <div className="max-w-5xl mx-auto animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-3xl text-vault-accent neon-cyan">ORDER TRACKER</h1>
          <p className="text-vault-text-dim text-sm font-body mt-0.5">Track drop orders, postcodes and PAS</p>
        </div>
        <div className="flex gap-2">
          <button className="vault-btn-ghost" onClick={() => setPasModal(true)}>
            <ArrowLeftRight className="w-4 h-4" /> PAS Split
          </button>
          <button className="vault-btn-primary" onClick={() => setDropModal(true)}>
            <Plus className="w-4 h-4" /> New Drop
          </button>
        </div>
      </div>

      {/* PAS Revenue summary */}
      {(pasOwedToMe > 0 || pasIOwed > 0 || pasRevenue.length > 0) && (
        <div className="grid grid-cols-2 gap-3 mb-6">
          <div className="vault-card border-vault-green/20 bg-vault-green/5">
            <p className="vault-label text-vault-green">Owed to Warrior</p>
            <p className="font-display text-2xl text-vault-green">£{pasIOwed.toFixed(2)}</p>
            <p className="text-vault-muted text-xs font-mono mt-1">50% of his runners' PAS — unsettled</p>
          </div>
          <div className="vault-card border-vault-gold/20 bg-vault-gold/5">
            <p className="vault-label text-vault-gold">Total PAS Logged</p>
            <p className="font-display text-2xl text-vault-gold">
              £{pasRevenue.reduce((s, p) => s + parseFloat(p.amount), 0).toFixed(2)}
            </p>
            <p className="text-vault-muted text-xs font-mono mt-1">all splits logged</p>
          </div>
        </div>
      )}

      {/* Drops list */}
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-2 border-vault-accent border-t-transparent rounded-full animate-spin" />
        </div>
      ) : drops.length === 0 ? (
        <div className="vault-card text-center py-16">
          <Package className="w-10 h-10 text-vault-muted mx-auto mb-3" />
          <p className="text-vault-text font-display">No drops tracked yet</p>
          <p className="text-vault-text-dim text-sm mt-1">Create a drop to start logging orders</p>
        </div>
      ) : (
        <div className="space-y-3 stagger">
          {drops.map(drop => {
            const s = DROP_STATUSES[drop.status] || DROP_STATUSES.active
            const orders = dropOrders[drop.id] || []
            const isExpanded = expandedDrop === drop.id
            const search = orderSearch[drop.id] || ''
            const filteredOrders = search
              ? orders.filter(o =>
                  o.profile_name?.toLowerCase().includes(search.toLowerCase()) ||
                  o.order_number?.toLowerCase().includes(search.toLowerCase()) ||
                  o.postcode?.toLowerCase().includes(search.toLowerCase()))
              : orders
            const cancelledCount = orders.filter(o => o.status === 'cancelled').length
            const unpaidPas = orders.filter(o => o.status !== 'cancelled' && !o.pas_paid && o.pas_amount > 0).length

            return (
              <div key={drop.id} className="vault-card">
                {/* Drop header */}
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-display text-vault-text text-lg">{drop.drop_name}</p>
                      <span className={`vault-badge border text-[10px] ${s.color}`}>{s.label}</span>
                      {cancelledCount > 0 && (
                        <span className="vault-badge border text-[10px] text-vault-red bg-vault-red/10 border-vault-red/20">
                          {cancelledCount} cancelled
                        </span>
                      )}
                      {unpaidPas > 0 && (
                        <span className="vault-badge border text-[10px] text-vault-gold bg-vault-gold/10 border-vault-gold/20">
                          {unpaidPas} PAS pending
                        </span>
                      )}
                    </div>
                    <div className="flex gap-3 mt-0.5 flex-wrap">
                      {drop.drop_date && <p className="text-vault-muted text-[11px] font-mono">Drop: {format(new Date(drop.drop_date), 'dd MMM yyyy')}</p>}
                      {drop.cancellation_date && <p className="text-vault-gold text-[11px] font-mono">PAS due: {format(new Date(drop.cancellation_date), 'dd MMM yyyy')}</p>}
                      {drop.release_date && <p className="text-vault-text-dim text-[11px] font-mono">Release: {format(new Date(drop.release_date), 'dd MMM yyyy')}</p>}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {/* Status cycle */}
                    <select className="vault-input text-xs py-1.5 px-2 w-36"
                      value={drop.status}
                      onChange={async e => {
                        await supabase.from('order_tracking').update({ status: e.target.value }).eq('id', drop.id)
                        await load()
                      }}>
                      {Object.entries(DROP_STATUSES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                    </select>
                    <button onClick={() => openEditDrop(drop)} className="p-1.5 text-vault-muted hover:text-vault-accent rounded hover:bg-vault-accent/10 transition-all">
                      <Save className="w-4 h-4" />
                    </button>
                    <button onClick={() => deleteDrop(drop.id)} className="p-1.5 text-vault-muted hover:text-vault-red rounded hover:bg-vault-red/10 transition-all">
                      <Trash2 className="w-4 h-4" />
                    </button>
                    <button onClick={() => toggleDrop(drop.id)} className="p-1.5 text-vault-muted hover:text-vault-text rounded hover:bg-vault-border transition-all">
                      {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Orders section */}
                {isExpanded && (
                  <div className="mt-4 pt-4 border-t border-vault-border animate-fade-in">
                    {/* Order toolbar */}
                    <div className="flex items-center gap-2 mb-3 flex-wrap">
                      <div className="relative flex-1 min-w-48">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-vault-muted" />
                        <input className="vault-input pl-8 text-xs py-2"
                          placeholder="Search profile, order no, postcode..."
                          value={search}
                          onChange={e => setOrderSearch(s => ({ ...s, [drop.id]: e.target.value }))} />
                      </div>
                      <p className="text-xs font-mono text-vault-muted">{orders.length} order{orders.length !== 1 ? 's' : ''}</p>
                      <button onClick={() => openNewOrder(drop.id)} className="vault-btn-primary text-xs px-3 py-2">
                        <Plus className="w-3.5 h-3.5" /> Add Order
                      </button>
                    </div>

                    {loadingOrders[drop.id] ? (
                      <div className="flex justify-center py-6">
                        <div className="w-5 h-5 border-2 border-vault-accent border-t-transparent rounded-full animate-spin" />
                      </div>
                    ) : filteredOrders.length === 0 ? (
                      <p className="text-vault-muted text-xs font-mono text-center py-6">
                        {orders.length === 0 ? 'No orders yet — add the first one' : 'No orders match your search'}
                      </p>
                    ) : (
                      <div className="space-y-1.5">
                        {filteredOrders.map(order => {
                          const os = ORDER_STATUSES[order.status] || ORDER_STATUSES.active
                          const OsIcon = os.icon
                          return (
                            <div key={order.id}
                              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 border transition-all
                                ${order.status === 'cancelled'
                                  ? 'bg-vault-red/5 border-vault-red/15 opacity-70'
                                  : 'bg-vault-bg border-vault-border hover:border-vault-border'}`}>

                              {/* Status icon — click to cycle */}
                              <button onClick={() => cycleOrderStatus(order, drop.id)}
                                className={`shrink-0 p-1 rounded-lg border transition-all hover:opacity-80 ${os.color}`}
                                title="Click to change status">
                                <OsIcon className="w-3.5 h-3.5" />
                              </button>

                              {/* Main info */}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-display text-vault-text text-sm">{order.profile_name || '—'}</span>
                                  <span className="font-mono text-vault-text-dim text-xs">—</span>
                                  <span className="font-mono text-vault-accent text-xs">{order.order_number}</span>
                                  <span className="font-mono text-vault-text-dim text-xs">—</span>
                                  <span className="font-mono text-vault-text text-xs font-medium">
                                    Postcode {order.postcode || '?'}
                                  </span>
                                </div>
                                {order.notes && (
                                  <p className="text-vault-muted text-[11px] font-mono mt-0.5 truncate">{order.notes}</p>
                                )}
                              </div>

                              {/* PAS */}
                              {order.pas_amount > 0 && (
                                <button onClick={() => togglePasPaid(order, drop.id)}
                                  className={`vault-badge border text-[10px] shrink-0 transition-all ${order.pas_paid ? 'text-vault-green bg-vault-green/10 border-vault-green/20' : 'text-vault-gold bg-vault-gold/10 border-vault-gold/20'}`}>
                                  <PoundSterling className="w-2.5 h-2.5" />
                                  {parseFloat(order.pas_amount).toFixed(2)} {order.pas_paid ? '✓' : 'due'}
                                </button>
                              )}

                              {/* Actions */}
                              <div className="flex gap-1 shrink-0">
                                <button onClick={() => copyOrder(order)}
                                  className="p-1 text-vault-muted hover:text-vault-text-dim rounded transition-colors"
                                  title="Copy order summary">
                                  {copied === order.id ? <Check className="w-3.5 h-3.5 text-vault-green" /> : <Copy className="w-3.5 h-3.5" />}
                                </button>
                                <button onClick={() => openEditOrder(order, drop.id)}
                                  className="p-1 text-vault-muted hover:text-vault-accent rounded transition-colors">
                                  <Save className="w-3.5 h-3.5" />
                                </button>
                                <button onClick={() => deleteOrder(order.id, drop.id)}
                                  className="p-1 text-vault-muted hover:text-vault-red rounded transition-colors">
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          )
                        })}

                        {/* PAS summary for this drop */}
                        {orders.some(o => o.pas_amount > 0) && (
                          <div className="flex gap-4 pt-2 mt-1 border-t border-vault-border">
                            <p className="text-[11px] font-mono text-vault-green">
                              Paid: £{orders.filter(o => o.pas_paid).reduce((s, o) => s + parseFloat(o.pas_amount || 0), 0).toFixed(2)}
                            </p>
                            <p className="text-[11px] font-mono text-vault-gold">
                              Due: £{orders.filter(o => !o.pas_paid && o.pas_amount > 0).reduce((s, o) => s + parseFloat(o.pas_amount || 0), 0).toFixed(2)}
                            </p>
                            <p className="text-[11px] font-mono text-vault-muted">
                              Cancelled: {cancelledCount}
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* PAS Revenue Split history */}
      {pasRevenue.length > 0 && (
        <div className="mt-8">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[10px] font-mono text-vault-muted uppercase tracking-widest">PAS Split History</p>
          </div>
          <div className="vault-card">
            <div className="space-y-2">
              {pasRevenue.map(p => (
                <div key={p.id} className={`flex items-center gap-3 py-2 border-b border-vault-border/40 last:border-0 ${p.settled ? 'opacity-50' : ''}`}>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-body text-vault-text">
                      <span className="text-vault-accent">{p.from_profile?.username || '?'}</span>
                      <span className="text-vault-muted mx-2">→</span>
                      <span className="text-vault-gold">{p.to_profile?.username || '?'}</span>
                    </p>
                    <p className="text-xs font-mono text-vault-muted">{p.description || 'PAS split'} · {format(new Date(p.created_at), 'dd MMM yyyy')}</p>
                  </div>
                  <p className="font-display text-vault-green text-sm shrink-0">£{parseFloat(p.amount).toFixed(2)}</p>
                  {!p.settled && p.from_admin === user.id && (
                    <button onClick={() => settlePas(p.id)}
                      className="vault-btn-ghost text-xs px-2 py-1">
                      <CheckCircle className="w-3 h-3" /> Settle
                    </button>
                  )}
                  {p.settled && <span className="text-[10px] font-mono text-vault-green">settled</span>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* NEW DROP MODAL */}
      {dropModal && createPortal(
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="vault-card max-w-md w-full flex flex-col animate-fade-in" style={{ maxHeight: '90vh' }}>
            <div className="flex items-center justify-between mb-5 shrink-0">
              <h2 className="font-display text-2xl text-vault-accent neon-cyan">{editDropId ? 'EDIT DROP' : 'NEW DROP'}</h2>
              <button onClick={closeDropModal}><X className="w-5 h-5 text-vault-muted" /></button>
            </div>
            <div className="overflow-y-auto flex-1 pr-1 space-y-3">
              <div><label className="vault-label">Drop Name *</label>
                <input className="vault-input" placeholder="e.g. Chaos Rising Preorder" value={dropForm.drop_name} onChange={e => setDropForm(f => ({ ...f, drop_name: e.target.value }))} />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div><label className="vault-label">Drop Date</label>
                  <input className="vault-input" type="date" value={dropForm.drop_date} onChange={e => setDropForm(f => ({ ...f, drop_date: e.target.value }))} />
                </div>
                <div><label className="vault-label">PAS Due Date</label>
                  <input className="vault-input" type="date" value={dropForm.cancellation_date} onChange={e => setDropForm(f => ({ ...f, cancellation_date: e.target.value }))} />
                </div>
                <div><label className="vault-label">Release Date</label>
                  <input className="vault-input" type="date" value={dropForm.release_date} onChange={e => setDropForm(f => ({ ...f, release_date: e.target.value }))} />
                </div>
              </div>
              <div><label className="vault-label">Status</label>
                <select className="vault-input" value={dropForm.status} onChange={e => setDropForm(f => ({ ...f, status: e.target.value }))}>
                  {Object.entries(DROP_STATUSES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              </div>
              <div><label className="vault-label">Notes</label>
                <input className="vault-input" placeholder="e.g. PKC preorder, charge PAS at cancellations" value={dropForm.notes} onChange={e => setDropForm(f => ({ ...f, notes: e.target.value }))} />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5 pt-4 border-t border-vault-border shrink-0">
              <button className="vault-btn-ghost" onClick={closeDropModal}>Cancel</button>
              <button className="vault-btn-primary" onClick={saveDrop} disabled={savingDrop}>
                <Save className="w-4 h-4" />{savingDrop ? 'Saving...' : editDropId ? 'Save' : 'Create Drop'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ADD ORDER MODAL */}
      {orderModal && createPortal(
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="vault-card max-w-md w-full flex flex-col animate-fade-in" style={{ maxHeight: '90vh' }}>
            <div className="flex items-center justify-between mb-5 shrink-0">
              <h2 className="font-display text-2xl text-vault-accent neon-cyan">{editOrderId ? 'EDIT ORDER' : 'ADD ORDER'}</h2>
              <button onClick={closeOrderModal}><X className="w-5 h-5 text-vault-muted" /></button>
            </div>
            <div className="overflow-y-auto flex-1 pr-1 space-y-3">

              {/* Profile picker — pulls postcode automatically */}
              <div>
                <label className="vault-label">Profile (auto-fills postcode)</label>
                <select className="vault-input"
                  value={orderForm.profile_id}
                  onChange={e => {
                    const p = allProfiles.find(p => p.id === e.target.value)
                    setOrderForm(f => ({
                      ...f,
                      profile_id: e.target.value,
                      profile_name: p?.profile_name || '',
                      postcode: p?.shipping_zip || '',
                    }))
                  }}>
                  <option value="">— Select profile —</option>
                  {myProfiles.map(p => (
                    <option key={p.id} value={p.id}>{p.profile_name} ({p.shipping_zip || 'no postcode'})</option>
                  ))}
                </select>
                {orderForm.postcode && (
                  <p className="text-vault-accent text-xs font-mono mt-1">
                    📍 Postcode: <strong>{orderForm.postcode}</strong>
                  </p>
                )}
              </div>

              {/* Manual postcode override */}
              <div>
                <label className="vault-label">Postcode (override if needed)</label>
                <input className="vault-input font-mono" placeholder="NW7 3EX" value={orderForm.postcode || ''}
                  onChange={e => setOrderForm(f => ({ ...f, postcode: e.target.value }))} />
              </div>

              <div>
                <label className="vault-label">Order Number *</label>
                <input className="vault-input font-mono" placeholder="E0005130780" value={orderForm.order_number}
                  onChange={e => setOrderForm(f => ({ ...f, order_number: e.target.value }))} />
              </div>

              <div>
                <label className="vault-label">Status</label>
                <select className="vault-input" value={orderForm.status}
                  onChange={e => setOrderForm(f => ({ ...f, status: e.target.value }))}>
                  {Object.entries(ORDER_STATUSES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="vault-label">PAS Amount (£)</label>
                  <input className="vault-input" type="number" step="0.01" placeholder="0.00"
                    value={orderForm.pas_amount} onChange={e => setOrderForm(f => ({ ...f, pas_amount: e.target.value }))} />
                </div>
                <div className="flex items-end pb-0.5">
                  <div className="flex items-center gap-3">
                    <button type="button"
                      onClick={() => setOrderForm(f => ({ ...f, pas_paid: !f.pas_paid }))}
                      className={`relative inline-flex w-11 h-6 rounded-full transition-colors duration-200 focus:outline-none ${orderForm.pas_paid ? 'bg-vault-green' : 'bg-vault-border'}`}>
                      <span className={`absolute left-1 top-1 w-4 h-4 bg-white rounded-full shadow transition-transform duration-200 ${orderForm.pas_paid ? 'translate-x-5' : 'translate-x-0'}`} />
                    </button>
                    <span className="text-sm font-body text-vault-text-dim">PAS Paid</span>
                  </div>
                </div>
              </div>

              <div>
                <label className="vault-label">Notes</label>
                <input className="vault-input" placeholder="e.g. no URL change needed, space in postcode"
                  value={orderForm.notes} onChange={e => setOrderForm(f => ({ ...f, notes: e.target.value }))} />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5 pt-4 border-t border-vault-border shrink-0">
              <button className="vault-btn-ghost" onClick={closeOrderModal}>Cancel</button>
              <button className="vault-btn-primary" onClick={saveOrder} disabled={savingOrder}>
                <Save className="w-4 h-4" />{savingOrder ? 'Saving...' : editOrderId ? 'Save' : 'Add Order'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* PAS SPLIT MODAL */}
      {pasModal && createPortal(
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="vault-card max-w-sm w-full animate-fade-in">
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-display text-2xl text-vault-gold neon-gold">LOG PAS SPLIT</h2>
              <button onClick={() => setPasModal(false)}><X className="w-5 h-5 text-vault-muted" /></button>
            </div>
            <p className="text-vault-text-dim text-xs font-mono mb-5">
              All PAS comes to you via Stripe. Log what you owe Warrior for his runners here so you can track the bank transfer.
            </p>
            <div className="space-y-3">
              <div>
                <label className="vault-label">Send to</label>
                <select className="vault-input" value={pasForm.to_admin}
                  onChange={e => setPasForm(f => ({ ...f, to_admin: e.target.value }))}>
                  <option value="">— Select admin —</option>
                  {admins.filter(a => a.id !== user.id).map(a => <option key={a.id} value={a.id}>{a.username}</option>)}
                </select>
              </div>
              <div>
                <label className="vault-label">Amount to send (£)</label>
                <input className="vault-input" type="number" step="0.01" placeholder="0.00"
                  value={pasForm.amount} onChange={e => setPasForm(f => ({ ...f, amount: e.target.value }))} />
                <p className="text-vault-muted text-xs font-mono mt-1">This is the 50% split you're bank transferring</p>
              </div>
              <div>
                <label className="vault-label">Description</label>
                <input className="vault-input" placeholder="e.g. 50% of Chaos Rising PAS (Warrior's runners)"
                  value={pasForm.description} onChange={e => setPasForm(f => ({ ...f, description: e.target.value }))} />
              </div>
              <div>
                <label className="vault-label">Linked Drop (optional)</label>
                <select className="vault-input" value={pasForm.drop_id}
                  onChange={e => setPasForm(f => ({ ...f, drop_id: e.target.value }))}>
                  <option value="">— None —</option>
                  {drops.map(d => <option key={d.id} value={d.id}>{d.drop_name}</option>)}
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5 pt-4 border-t border-vault-border">
              <button className="vault-btn-ghost" onClick={() => setPasModal(false)}>Cancel</button>
              <button className="vault-btn-primary" onClick={savePas} disabled={savingPas}>
                <ArrowLeftRight className="w-4 h-4" />{savingPas ? 'Saving...' : 'Log Split'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}

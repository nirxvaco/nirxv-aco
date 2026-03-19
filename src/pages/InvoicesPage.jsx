import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { Plus, FileText, CheckCircle, Clock, AlertCircle, X, Save, Trash2, ExternalLink, Send, Zap, RefreshCw, ArrowLeftRight } from 'lucide-react'
import { notifyDiscord } from '../lib/notify'
import { format } from 'date-fns'

const STATUS = {
  paid:    { label: 'Paid',    color: 'text-vault-green bg-vault-green/10 border-vault-green/20', icon: CheckCircle },
  pending: { label: 'Pending', color: 'text-vault-gold  bg-vault-gold/10  border-vault-gold/20',  icon: Clock },
  overdue: { label: 'Overdue', color: 'text-vault-red   bg-vault-red/10   border-vault-red/20',   icon: AlertCircle },
}

const EMPTY = {
  title: '', amount: '', currency: 'GBP', status: 'pending',
  due_date: '', notes: '', payment_link: '', target_user_id: '',
  split_with_warrior: false,
}

export default function InvoicesPage() {
  const { user, isAdmin } = useAuth()
  const [invoices, setInvoices]         = useState([])
  const [users, setUsers]               = useState([])
  const [loading, setLoading]           = useState(true)
  const [modal, setModal]               = useState(false)
  const [form, setForm]                 = useState(EMPTY)
  const [editId, setEditId]             = useState(null)
  const [saving, setSaving]             = useState(false)
  const [generatingLink, setGeneratingLink] = useState(false)
  const [payModal, setPayModal]         = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    if (isAdmin) {
      // Load invoices, then manually join usernames from user_profiles
      const { data, error } = await supabase
        .from('invoices')
        .select('*')
        .order('created_at', { ascending: false })
      if (error) console.error('INVOICE LOAD ERROR:', error)

      // Enrich with usernames from user_profiles
      if (data && data.length > 0) {
        const { data: profiles } = await supabase.from('user_profiles').select('id, username')
        const profileMap = Object.fromEntries((profiles || []).map(p => [p.id, p]))
        const enriched = data.map(inv => ({
          ...inv,
          user_profiles: profileMap[inv.target_user_id] ? { username: profileMap[inv.target_user_id].username } : null
        }))
        setInvoices(enriched)
      } else {
        setInvoices(data || [])
      }
    } else {
      const { data, error } = await supabase
        .from('invoices')
        .select('*')
        .eq('target_user_id', user.id)
        .order('created_at', { ascending: false })
      if (error) console.error('INVOICE LOAD ERROR:', error)
      setInvoices(data || [])
    }
    setLoading(false)
  }, [user.id, isAdmin])

  // Load all users separately so the dropdown is always populated for admin
  useEffect(() => {
    if (isAdmin) {
      supabase.from('user_profiles').select('id, username').then(({ data }) => setUsers(data || []))
    }
  }, [isAdmin])

  useEffect(() => { load() }, [load])

  // Payment config from env — swap VITE_USE_STRIPE=true when ready
  const USE_STRIPE       = import.meta.env.VITE_USE_STRIPE === 'true'
  const PAYMENT_NAME     = import.meta.env.VITE_PAYMENT_ACCOUNT_NAME || ''
  const PAYMENT_SORT     = import.meta.env.VITE_PAYMENT_SORT_CODE || ''
  const PAYMENT_ACC      = import.meta.env.VITE_PAYMENT_ACCOUNT_NUMBER || ''
  const PAYMENT_PAYPAL   = import.meta.env.VITE_PAYMENT_PAYPAL || ''
  const PAYMENT_REF      = import.meta.env.VITE_PAYMENT_REFERENCE || 'ACO-PAS'

  // Generate Stripe payment link via Edge Function (used when USE_STRIPE=true)
  async function generateStripeLink(amount, currency, title, splitWithWarrior) {
    setGeneratingLink(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-payment-link`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            amount,
            currency: currency.toLowerCase(),
            description: title,
            split_with_warrior: splitWithWarrior,
          }),
        }
      )
      const result = await res.json()
      if (result.error) throw new Error(result.error)
      return result.url
    } catch (e) {
      console.error('Stripe link error:', e)
      return ''
    } finally {
      setGeneratingLink(false)
    }
  }

  async function save() {
    if (!form.title || !form.amount) return
    setSaving(true)

    let paymentLink = form.payment_link

    // Only auto-generate Stripe link if Stripe is enabled
    if (USE_STRIPE && !paymentLink && form.amount && parseFloat(form.amount) > 0) {
      paymentLink = await generateStripeLink(
        form.amount,
        form.currency,
        form.title,
        form.split_with_warrior
      )
    }

    const payload = {
      title: form.title,
      amount: parseFloat(form.amount),
      currency: form.currency,
      status: form.status,
      due_date: form.due_date || null,
      notes: form.notes,
      payment_link: paymentLink || '',
      target_user_id: form.target_user_id || null,
      user_id: user.id,
      split_with_warrior: form.split_with_warrior || false,
    }
    if (editId) {
      const { error } = await supabase.from('invoices').update(payload).eq('id', editId)
      if (error) console.error('INVOICE UPDATE ERROR:', error)
    } else {
      const { error } = await supabase.from('invoices').insert(payload)
      if (error) console.error('INVOICE INSERT ERROR:', error)
    }
    await load(); closeModal(); setSaving(false)
  }

  async function del(id) { await supabase.from('invoices').delete().eq('id', id); await load() }

  async function markPaid(inv) {
    await supabase.from('invoices').update({ status: 'paid' }).eq('id', inv.id)
    notifyDiscord('invoice_paid', { title: inv.title, amount: inv.amount }, profile?.username)
    await load(); setPayModal(null)
  }

  async function adminToggleStatus(inv) {
    const cycle = { pending: 'paid', paid: 'overdue', overdue: 'pending' }
    await supabase.from('invoices').update({ status: cycle[inv.status] || 'pending' }).eq('id', inv.id)
    await load()
  }

  function openEdit(inv) {
    setForm({
      ...EMPTY,
      ...inv,
      target_user_id: inv.target_user_id || '',
      split_with_warrior: inv.split_with_warrior || false,
    })
    setEditId(inv.id)
    setModal(true)
  }
  function closeModal() { setModal(false); setForm(EMPTY); setEditId(null) }

  // ── Stats calculations ─────────────────────────────────────────────────
  // Gross = full invoice amount regardless of split
  const totalPaid    = invoices.reduce((s, i) => s + (i.status === 'paid' ? parseFloat(i.amount) : 0), 0)
  const totalPending = invoices.reduce((s, i) => s + (i.status !== 'paid' ? parseFloat(i.amount) : 0), 0)

  // Admin PAS breakdown — gross vs your actual take
  const paidInvoices     = invoices.filter(i => i.status === 'paid')
  const grossPas         = paidInvoices.reduce((s, i) => s + parseFloat(i.amount), 0)
  const yourPas          = paidInvoices.reduce((s, i) => {
    const amt = parseFloat(i.amount)
    return s + (i.split_with_warrior ? amt * 0.5 : amt)
  }, 0)
  const warriorPas       = paidInvoices.reduce((s, i) => {
    const amt = parseFloat(i.amount)
    return s + (i.split_with_warrior ? amt * 0.5 : 0)
  }, 0)

  return (
    <div className="max-w-4xl mx-auto animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display font-extrabold text-2xl text-vault-text">Invoices</h1>
          <p className="text-vault-text-dim text-sm font-body mt-0.5">
            {isAdmin ? `${invoices.length} invoice${invoices.length !== 1 ? 's' : ''} issued` : `${invoices.length} invoice${invoices.length !== 1 ? 's' : ''} from your admin`}
          </p>
        </div>
        {isAdmin && (
          <button className="vault-btn-primary" onClick={() => setModal(true)}>
            <Send className="w-4 h-4" /> Issue Invoice
          </button>
        )}
      </div>

      {/* Stats */}
      {isAdmin ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6 stagger">
          <div className="vault-card">
            <p className="vault-label">Gross PAS Collected</p>
            <p className="font-display font-bold text-2xl text-vault-green">£{grossPas.toFixed(2)}</p>
            <p className="text-vault-muted text-xs font-mono mt-1">full invoice amounts paid</p>
          </div>
          <div className="vault-card">
            <p className="vault-label">Your Take</p>
            <p className="font-display font-bold text-2xl text-vault-accent">£{yourPas.toFixed(2)}</p>
            <p className="text-vault-muted text-xs font-mono mt-1">after splits</p>
          </div>
          <div className="vault-card">
            <p className="vault-label">Warrior's Share</p>
            <p className="font-display font-bold text-2xl text-vault-gold">£{warriorPas.toFixed(2)}</p>
            <p className="text-vault-muted text-xs font-mono mt-1">to bank transfer</p>
          </div>
          <div className="vault-card">
            <p className="vault-label">Outstanding</p>
            <p className="font-display font-bold text-2xl text-vault-red">£{totalPending.toFixed(2)}</p>
            <p className="text-vault-muted text-xs font-mono mt-1">unpaid invoices</p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 mb-6 stagger">
          <div className="vault-card">
            <p className="vault-label">Total Paid</p>
            <p className="font-display font-bold text-2xl text-vault-green">£{totalPaid.toFixed(2)}</p>
          </div>
          <div className="vault-card">
            <p className="vault-label">Outstanding</p>
            <p className="font-display font-bold text-2xl text-vault-gold">£{totalPending.toFixed(2)}</p>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16"><div className="w-8 h-8 border-2 border-vault-accent border-t-transparent rounded-full animate-spin" /></div>
      ) : invoices.length === 0 ? (
        <div className="vault-card text-center py-16">
          <FileText className="w-10 h-10 text-vault-muted mx-auto mb-3" />
          <p className="text-vault-text font-display font-semibold">{isAdmin ? 'No invoices issued yet' : 'No invoices yet'}</p>
          <p className="text-vault-text-dim text-sm mt-1">{isAdmin ? 'Issue your first invoice to a user' : 'Your admin will send invoices here when needed'}</p>
        </div>
      ) : (
        <div className="space-y-2 stagger">
          {invoices.map(inv => {
            const s = STATUS[inv.status] || STATUS.pending
            const Icon = s.icon
            const isUnpaid = inv.status !== 'paid'
            return (
              <div key={inv.id} className="vault-card hover:border-vault-accent/30 transition-colors">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-vault-surface border border-vault-border flex items-center justify-center shrink-0">
                    <FileText className="w-5 h-5 text-vault-text-dim" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-display font-semibold text-vault-text truncate">{inv.title}</p>
                      {isAdmin && inv.user_profiles?.username && (
                        <span className="vault-badge bg-vault-accent/10 text-vault-accent border border-vault-accent/20 text-[10px]">→ {inv.user_profiles.username}</span>
                      )}
                      {inv.split_with_warrior && (
                        <span className="vault-badge bg-vault-purple/10 text-vault-purple border border-vault-purple/20 text-[10px]">
                          <ArrowLeftRight className="w-2.5 h-2.5" /> 50/50 Split
                        </span>
                      )}
                    </div>
                    <p className="text-vault-text-dim text-xs font-mono">
                      {inv.due_date ? `Due ${format(new Date(inv.due_date), 'dd MMM yyyy')}` : 'No due date'}{inv.notes ? ` · ${inv.notes}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 ml-auto flex-wrap">
                    <span className={`vault-badge border ${s.color}`}><Icon className="w-3 h-3" />{s.label}</span>
                    <p className="font-display font-bold text-vault-text whitespace-nowrap">{inv.currency} {parseFloat(inv.amount).toFixed(2)}</p>
                    <div className="flex gap-1 items-center">
                      {isAdmin ? (
                        <>
                          <button onClick={() => adminToggleStatus(inv)} className="p-2 text-vault-muted hover:text-vault-green rounded-lg hover:bg-vault-green/10 transition-all" title="Cycle status"><CheckCircle className="w-4 h-4" /></button>
                          <button onClick={() => openEdit(inv)} className="p-2 text-vault-muted hover:text-vault-accent rounded-lg hover:bg-vault-accent/10 transition-all"><Save className="w-4 h-4" /></button>
                          <button onClick={() => del(inv.id)} className="p-2 text-vault-muted hover:text-vault-red rounded-lg hover:bg-vault-red/10 transition-all"><Trash2 className="w-4 h-4" /></button>
                        </>
                      ) : (
                        <>
                          {isUnpaid && (
                            <button onClick={() => setPayModal(inv)} className="vault-btn-primary text-xs px-3 py-2">
                              <ExternalLink className="w-3.5 h-3.5" /> Pay Now
                            </button>
                          )}
                          {!isUnpaid && <span className="vault-badge bg-vault-green/10 text-vault-green border border-vault-green/20"><CheckCircle className="w-3 h-3" /> Paid</span>}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Pay Modal */}
      {payModal && createPortal(
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="vault-card max-w-md w-full flex flex-col animate-fade-in" style={{ maxHeight: '90vh' }}>
            <div className="flex items-center justify-between mb-4 shrink-0">
              <h2 className="font-display font-bold text-xl text-vault-text">Pay Invoice</h2>
              <button onClick={() => setPayModal(null)}><X className="w-5 h-5 text-vault-muted" /></button>
            </div>
            <div className="overflow-y-auto flex-1 pr-1">
              {/* Invoice summary */}
              <div className="bg-vault-bg rounded-xl p-4 mb-4 space-y-2 border border-vault-border">
                <div className="flex justify-between"><span className="text-vault-text-dim text-sm">Invoice</span><span className="text-vault-text font-semibold text-sm">{payModal.title}</span></div>
                <div className="flex justify-between"><span className="text-vault-text-dim text-sm">Amount</span><span className="font-display font-bold text-vault-green">{payModal.currency} {parseFloat(payModal.amount).toFixed(2)}</span></div>
                {payModal.due_date && <div className="flex justify-between"><span className="text-vault-text-dim text-sm">Due</span><span className="text-vault-text text-sm font-mono">{format(new Date(payModal.due_date), 'dd MMM yyyy')}</span></div>}
              </div>

              {/* Payment instructions */}
              {USE_STRIPE && payModal.payment_link ? (
                <p className="text-vault-text-dim text-sm font-body mb-4">
                  Click the payment link to pay, then click <strong className="text-vault-text">"I've Paid"</strong> to mark it as complete.
                </p>
              ) : (
                <div className="space-y-3 mb-4">
                  <p className="text-vault-text text-sm font-body font-medium">Send payment using one of the options below:</p>

                  {/* Bank Transfer */}
                  {PAYMENT_SORT && (
                    <div className="bg-vault-bg rounded-xl p-4 border border-vault-accent/20 space-y-2">
                      <p className="text-[10px] font-mono text-vault-accent uppercase tracking-widest mb-2">Bank Transfer</p>
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div><p className="text-vault-muted text-xs font-mono">Account Name</p><p className="text-vault-text font-medium">{PAYMENT_NAME}</p></div>
                        <div><p className="text-vault-muted text-xs font-mono">Sort Code</p><p className="text-vault-text font-mono">{PAYMENT_SORT}</p></div>
                        <div><p className="text-vault-muted text-xs font-mono">Account Number</p><p className="text-vault-text font-mono">{PAYMENT_ACC}</p></div>
                        <div><p className="text-vault-muted text-xs font-mono">Reference</p><p className="text-vault-gold font-mono font-semibold">{PAYMENT_REF}</p></div>
                      </div>
                    </div>
                  )}

                  {/* PayPal */}
                  {PAYMENT_PAYPAL && (
                    <div className="bg-vault-bg rounded-xl p-4 border border-vault-gold/20 space-y-1">
                      <p className="text-[10px] font-mono text-vault-gold uppercase tracking-widest mb-2">PayPal</p>
                      <p className="text-vault-text font-mono font-semibold">{PAYMENT_PAYPAL}</p>
                      <p className="text-vault-muted text-xs font-mono">Use reference: <span className="text-vault-gold">{PAYMENT_REF}</span></p>
                    </div>
                  )}

                  <p className="text-vault-muted text-xs font-mono">
                    ⚠️ Always include the reference so your payment can be matched to this invoice.
                  </p>
                </div>
              )}
            </div>

            <div className="flex gap-2 pt-4 border-t border-vault-border shrink-0">
              {USE_STRIPE && payModal.payment_link && (
                <a href={payModal.payment_link} target="_blank" rel="noopener noreferrer"
                  className="vault-btn-primary flex-1 justify-center">
                  <ExternalLink className="w-4 h-4" /> Open Payment Link
                </a>
              )}
              <button onClick={() => markPaid(payModal)} className={`vault-btn-ghost ${!USE_STRIPE || !payModal.payment_link ? 'flex-1 justify-center' : ''}`}>
                I've Paid
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Admin Issue Modal */}
      {modal && isAdmin && createPortal(
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="vault-card max-w-md w-full flex flex-col animate-fade-in" style={{ maxHeight: '90vh' }}>
            <div className="flex items-center justify-between mb-5 shrink-0">
              <h2 className="font-display font-bold text-xl text-vault-text">{editId ? 'Edit Invoice' : 'Issue Invoice'}</h2>
              <button onClick={closeModal}><X className="w-5 h-5 text-vault-muted" /></button>
            </div>
            <div className="overflow-y-auto overflow-x-hidden flex-1 pr-1 space-y-3">
              <div>
                <label className="vault-label">Issue To</label>
                <select className="vault-input" value={form.target_user_id} onChange={e => setForm(f => ({ ...f, target_user_id: e.target.value }))}>
                  <option value="">— Select user —</option>
                  {users.map(u => <option key={u.id} value={u.id}>{u.username}</option>)}
                </select>
              </div>
              <div><label className="vault-label">Title</label><input className="vault-input" placeholder="e.g. Chaos Rising PAS" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="vault-label">Amount</label><input className="vault-input" type="number" step="0.01" placeholder="0.00" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} /></div>
                <div><label className="vault-label">Currency</label>
                  <select className="vault-input" value={form.currency} onChange={e => setForm(f => ({ ...f, currency: e.target.value }))}>
                    {['GBP', 'USD', 'EUR'].map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>
              </div>

              {/* Warrior split toggle */}
              <div className={`rounded-xl p-4 border transition-all ${form.split_with_warrior ? 'bg-vault-purple/5 border-vault-purple/30' : 'bg-vault-bg border-vault-border'}`}>
                <div className="flex items-center gap-3">
                  <button type="button"
                    onClick={() => setForm(f => ({ ...f, split_with_warrior: !f.split_with_warrior, payment_link: '' }))}
                    className={`relative inline-flex w-11 h-6 rounded-full transition-colors duration-200 focus:outline-none shrink-0 ${form.split_with_warrior ? 'bg-vault-purple' : 'bg-vault-border'}`}>
                    <span className={`absolute left-1 top-1 w-4 h-4 bg-white rounded-full shadow transition-transform duration-200 ${form.split_with_warrior ? 'translate-x-5' : 'translate-x-0'}`} />
                  </button>
                  <div>
                    <p className="text-sm font-body text-vault-text font-medium">Split 50/50 with Warrior</p>
                    <p className="text-xs font-mono text-vault-muted">Warrior's runner — auto-splits via Stripe Connect</p>
                  </div>
                  {form.split_with_warrior && form.amount && (
                    <div className="ml-auto text-right shrink-0">
                      <p className="text-[10px] font-mono text-vault-purple">You keep</p>
                      <p className="font-display text-vault-purple text-sm">£{(parseFloat(form.amount || 0) / 2).toFixed(2)}</p>
                    </div>
                  )}
                </div>
                {form.split_with_warrior && (
                  <div className="mt-3 pt-3 border-t border-vault-purple/20 grid grid-cols-2 gap-2 text-[11px] font-mono">
                    <div className="text-center bg-vault-bg rounded-lg p-2">
                      <p className="text-vault-muted">Your cut</p>
                      <p className="text-vault-accent font-semibold">£{(parseFloat(form.amount || 0) / 2).toFixed(2)}</p>
                    </div>
                    <div className="text-center bg-vault-bg rounded-lg p-2">
                      <p className="text-vault-muted">Warrior's cut</p>
                      <p className="text-vault-gold font-semibold">£{(parseFloat(form.amount || 0) / 2).toFixed(2)}</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Payment link — auto or manual */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="vault-label mb-0">Payment Link</label>
                  <span className="text-[10px] font-mono text-vault-muted">
                    {form.payment_link ? '✓ Manual link set' : form.amount ? '⚡ Will auto-generate on save' : 'Enter amount to auto-generate'}
                  </span>
                </div>
                <input className="vault-input" placeholder="Leave blank to auto-generate from Stripe, or paste manually"
                  value={form.payment_link} onChange={e => setForm(f => ({ ...f, payment_link: e.target.value }))} />
              </div>

              <div><label className="vault-label">Due Date</label><input className="vault-input" type="date" value={form.due_date} onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} /></div>
              <div><label className="vault-label">Notes</label><input className="vault-input" placeholder="Optional message to user" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} /></div>
              <div><label className="vault-label">Status</label>
                <select className="vault-input" value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                  {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5 pt-4 border-t border-vault-border shrink-0">
              <button className="vault-btn-ghost" onClick={closeModal}>Cancel</button>
              <button className="vault-btn-primary" onClick={save} disabled={saving || generatingLink}>
                {saving || generatingLink
                  ? <><RefreshCw className="w-4 h-4 animate-spin" />{generatingLink ? 'Generating Stripe link...' : 'Saving...'}</>
                  : <><Send className="w-4 h-4" />{editId ? 'Save Changes' : 'Issue Invoice'}</>}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}

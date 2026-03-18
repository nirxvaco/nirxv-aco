import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import {
  Package, Plus, X, Save, Trash2, ChevronDown, ChevronUp,
  Users, Download, ExternalLink, RefreshCw, BookOpen,
  CheckCircle, Clock, AlertCircle, Pencil
} from 'lucide-react'
import { format } from 'date-fns'
import Papa from 'papaparse'

const SITES = ['Pokemon Center', 'Topps', 'Argos', 'John Lewis', 'Game', 'Warhammer', 'Very', 'Other']
const STATUSES = {
  open:      { label: 'Open',      color: 'text-vault-green  bg-vault-green/10  border-vault-green/20' },
  restock:   { label: '24/7 Restock', color: 'text-vault-accent bg-vault-accent/10 border-vault-accent/20' },
  upcoming:  { label: 'Upcoming',  color: 'text-vault-gold   bg-vault-gold/10   border-vault-gold/20' },
  closed:    { label: 'Closed',    color: 'text-vault-red    bg-vault-red/10    border-vault-red/20' },
  completed: { label: 'Completed', color: 'text-vault-muted  bg-vault-border    border-vault-border' },
}

const EMPTY_DROP = {
  name: '', site: 'Pokemon Center', status: 'open',
  drop_date: '', guide_hor: '', guide_lunar: '', guide_rv: '', notes: '', items: [],
}

export default function DropManagerPage() {
  const { user } = useAuth()
  const [drops, setDrops]               = useState([])
  const [submissions, setSubmissions]   = useState({}) // { [dropId]: [...] }
  const [users, setUsers]               = useState({}) // { [userId]: username }
  const [loading, setLoading]           = useState(true)
  const [expandedDrop, setExpandedDrop] = useState(null)
  const [loadingSubs, setLoadingSubs]   = useState({})

  // Drop modal
  const [dropModal, setDropModal]       = useState(false)
  const [dropForm, setDropForm]         = useState(EMPTY_DROP)
  const [editDropId, setEditDropId]     = useState(null)
  const [savingDrop, setSavingDrop]     = useState(false)

  // Item builder inside form
  const [newItemKey, setNewItemKey]     = useState('')
  const [newItemName, setNewItemName]   = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('drops')
      .select('*')
      .order('created_at', { ascending: false })
    setDrops(data || [])

    // Load usernames
    const { data: profiles } = await supabase
      .from('user_profiles')
      .select('id, username')
    const map = {}
    ;(profiles || []).forEach(p => { map[p.id] = p.username })
    setUsers(map)

    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function loadSubmissions(dropId) {
    setLoadingSubs(s => ({ ...s, [dropId]: true }))
    const { data } = await supabase
      .from('drop_submissions')
      .select('*')
      .eq('drop_id', dropId)
      .order('submitted_at', { ascending: false })
    setSubmissions(s => ({ ...s, [dropId]: data || [] }))
    setLoadingSubs(s => ({ ...s, [dropId]: false }))
  }

  function toggleDrop(dropId) {
    if (expandedDrop === dropId) { setExpandedDrop(null); return }
    setExpandedDrop(dropId)
    if (!submissions[dropId]) loadSubmissions(dropId)
  }

  // ── Drop CRUD ──────────────────────────────────────────────────────────
  async function saveDrop() {
    if (!dropForm.name.trim()) return
    setSavingDrop(true)
    const payload = {
      ...dropForm,
      created_by: user.id,
      drop_date: dropForm.drop_date || null,
    }
    if (editDropId) await supabase.from('drops').update(payload).eq('id', editDropId)
    else            await supabase.from('drops').insert(payload)
    await load(); closeDropModal(); setSavingDrop(false)
  }

  async function deleteDrop(id) {
    await supabase.from('drops').delete().eq('id', id)
    await load()
  }

  async function updateStatus(dropId, status) {
    await supabase.from('drops').update({ status }).eq('id', dropId)
    await load()
  }

  function openEdit(drop) {
    setDropForm({
      name: drop.name, site: drop.site, status: drop.status,
      drop_date: drop.drop_date || '',
      guide_hor:   drop.guide_hor   || '',
      guide_lunar: drop.guide_lunar || '',
      guide_rv:    drop.guide_rv    || '',
      notes: drop.notes || '', items: drop.items || [],
    })
    setEditDropId(drop.id); setDropModal(true)
  }

  function closeDropModal() {
    setDropModal(false); setDropForm(EMPTY_DROP)
    setEditDropId(null); setNewItemKey(''); setNewItemName('')
  }

  function addItem() {
    if (!newItemKey.trim()) return
    setDropForm(f => ({
      ...f,
      items: [...(f.items || []), { key: newItemKey.trim().toUpperCase(), name: newItemName.trim() }]
    }))
    setNewItemKey(''); setNewItemName('')
  }

  function removeItem(i) {
    setDropForm(f => ({ ...f, items: f.items.filter((_, idx) => idx !== i) }))
  }

  // ── Export submissions for a drop ──────────────────────────────────────
  function exportSubmissions(drop) {
    const subs = submissions[drop.id] || []
    const rows = subs.map(s => {
      const profileNames = JSON.parse(s.profile_names || '[]').join(', ')
      const items        = JSON.parse(s.selected_items || '[]').join(', ')
      return {
        Username:       users[s.user_id] || s.user_id,
        Profiles:       profileNames,
        'Items Selected': items || 'All',
        Notes:          s.notes || '',
        'Submitted At': format(new Date(s.submitted_at), 'dd MMM yyyy HH:mm'),
      }
    })
    const csv  = Papa.unparse(rows)
    const blob = new Blob([csv], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url; a.download = `${drop.name.replace(/\s+/g, '_')}_submissions.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="max-w-5xl mx-auto animate-fade-in" style={{ fontFamily: "'Outfit', sans-serif" }}>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-3xl text-vault-gold neon-gold">DROP MANAGER</h1>
          <p className="text-vault-text-dim text-sm font-body mt-0.5">Create drops, add guides, view submissions</p>
        </div>
        <button className="vault-btn-primary" onClick={() => setDropModal(true)}>
          <Plus className="w-4 h-4" /> New Drop
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-2 border-vault-accent border-t-transparent rounded-full animate-spin" />
        </div>
      ) : drops.length === 0 ? (
        <div className="vault-card text-center py-16">
          <Package className="w-10 h-10 text-vault-muted mx-auto mb-3" />
          <p className="text-vault-text font-display">No drops yet</p>
          <p className="text-vault-text-dim text-sm mt-1">Create your first drop to get started</p>
        </div>
      ) : (
        <div className="space-y-3 stagger">
          {drops.map(drop => {
            const s          = STATUSES[drop.status] || STATUSES.closed
            const isExpanded = expandedDrop === drop.id
            const subs       = submissions[drop.id] || []
            const items      = drop.items || []

            return (
              <div key={drop.id} className="vault-card">
                {/* Drop header */}
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-display text-vault-text text-lg">{drop.name}</p>
                      <span className="vault-badge border text-[10px] text-vault-accent bg-vault-accent/10 border-vault-accent/20">
                        {drop.site}
                      </span>
                      <span className={`vault-badge border text-[10px] ${s.color}`}>{s.label}</span>
                      {items.length > 0 && (
                        <span className="vault-badge border text-[10px] text-vault-muted border-vault-border">
                          {items.length} item{items.length !== 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                    <div className="flex gap-3 mt-0.5 flex-wrap">
                      {drop.drop_date && (
                        <p className="text-vault-muted text-[11px] font-mono">
                          <Clock className="w-3 h-3 inline mr-1" />
                          {format(new Date(drop.drop_date), 'dd MMM yyyy')}
                        </p>
                      )}
                      {drop.guide_hor && (
                        <a href={drop.guide_hor} target="_blank" rel="noopener noreferrer"
                          className="text-vault-gold text-[11px] font-mono hover:underline flex items-center gap-1">
                          <BookOpen className="w-3 h-3" />HoR Guide
                        </a>
                      )}
                      {drop.guide_lunar && (
                        <a href={drop.guide_lunar} target="_blank" rel="noopener noreferrer"
                          className="text-vault-purple text-[11px] font-mono hover:underline flex items-center gap-1">
                          <BookOpen className="w-3 h-3" />Lunar Guide
                        </a>
                      )}
                      {drop.guide_rv && (
                        <a href={drop.guide_rv} target="_blank" rel="noopener noreferrer"
                          className="text-vault-accent text-[11px] font-mono hover:underline flex items-center gap-1">
                          <BookOpen className="w-3 h-3" />RV Guide
                        </a>
                      )}
                    </div>
                  </div>

                  {/* Controls */}
                  <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
                    <select className="vault-input text-xs py-1.5 px-2 w-28"
                      value={drop.status}
                      onChange={e => updateStatus(drop.id, e.target.value)}>
                      {Object.entries(STATUSES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                    </select>
                    <button onClick={() => openEdit(drop)}
                      className="p-1.5 text-vault-muted hover:text-vault-accent rounded hover:bg-vault-accent/10 transition-all">
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button onClick={() => deleteDrop(drop.id)}
                      className="p-1.5 text-vault-muted hover:text-vault-red rounded hover:bg-vault-red/10 transition-all">
                      <Trash2 className="w-4 h-4" />
                    </button>
                    <button onClick={() => toggleDrop(drop.id)}
                      className="p-1.5 text-vault-muted hover:text-vault-text rounded hover:bg-vault-border transition-all">
                      {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Expanded — submissions */}
                {isExpanded && (
                  <div className="mt-4 pt-4 border-t border-vault-border animate-fade-in">
                    {/* Notes preview */}
                    {drop.notes && (
                      <div className="mb-3 p-3 bg-vault-gold/5 border border-vault-gold/20 rounded-xl">
                        <p className="text-[10px] font-mono text-vault-gold uppercase tracking-widest mb-1">Admin Notes</p>
                        <p className="text-vault-text text-sm font-body">{drop.notes}</p>
                      </div>
                    )}

                    {/* Submission toolbar */}
                    <div className="flex items-center gap-2 mb-3">
                      <p className="text-xs font-mono text-vault-muted flex-1">
                        {loadingSubs[drop.id] ? 'Loading...' : `${subs.length} submission${subs.length !== 1 ? 's' : ''}`}
                      </p>
                      <button onClick={() => loadSubmissions(drop.id)}
                        className="vault-btn-ghost text-xs px-2.5 py-1.5">
                        <RefreshCw className="w-3 h-3" /> Refresh
                      </button>
                      {subs.length > 0 && (
                        <button onClick={() => exportSubmissions(drop)}
                          className="vault-btn-ghost text-xs px-2.5 py-1.5">
                          <Download className="w-3 h-3" /> Export CSV
                        </button>
                      )}
                    </div>

                    {loadingSubs[drop.id] ? (
                      <div className="flex justify-center py-6">
                        <div className="w-5 h-5 border-2 border-vault-accent border-t-transparent rounded-full animate-spin" />
                      </div>
                    ) : subs.length === 0 ? (
                      <p className="text-vault-muted text-xs font-mono text-center py-6">No submissions yet</p>
                    ) : (
                      <div className="space-y-2">
                        {subs.map(sub => {
                          const profileNames  = JSON.parse(sub.profile_names || '[]')
                          const selectedItems = JSON.parse(sub.selected_items || '[]')
                          return (
                            <div key={sub.id} className="bg-vault-bg rounded-xl px-3 py-2.5 border border-vault-border">
                              <div className="flex items-center gap-3 flex-wrap">
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-display text-vault-text">
                                    {users[sub.user_id] || sub.user_id}
                                  </p>
                                  <p className="text-xs font-mono text-vault-text-dim mt-0.5">
                                    {profileNames.length > 0
                                      ? profileNames.join(', ')
                                      : 'No profiles named'}
                                  </p>
                                  {selectedItems.length > 0 && (
                                    <p className="text-xs font-mono text-vault-accent mt-0.5">
                                      Items: {selectedItems.join(', ')}
                                    </p>
                                  )}
                                  {sub.notes && (
                                    <p className="text-xs font-mono text-vault-gold mt-0.5">
                                      Note: {sub.notes}
                                    </p>
                                  )}
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  <span className="vault-badge border text-[10px] text-vault-green border-vault-green/20 bg-vault-green/10">
                                    {profileNames.length} profile{profileNames.length !== 1 ? 's' : ''}
                                  </span>
                                  <p className="text-[10px] font-mono text-vault-muted">
                                    {format(new Date(sub.submitted_at), 'dd MMM HH:mm')}
                                  </p>
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ── DROP MODAL ── */}
      {dropModal && createPortal(
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="vault-card max-w-lg w-full flex flex-col animate-fade-in" style={{ maxHeight: '90vh' }}>
            <div className="flex items-center justify-between mb-5 shrink-0">
              <h2 className="font-display text-2xl text-vault-gold neon-gold">
                {editDropId ? 'EDIT DROP' : 'NEW DROP'}
              </h2>
              <button onClick={closeDropModal}><X className="w-5 h-5 text-vault-muted" /></button>
            </div>

            <div className="overflow-y-auto flex-1 pr-1 space-y-4">
              {/* Basic info */}
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="vault-label">Drop Name *</label>
                  <input className="vault-input" placeholder="e.g. Chaos Rising Preorder"
                    value={dropForm.name} onChange={e => setDropForm(f => ({ ...f, name: e.target.value }))} />
                </div>
                <div>
                  <label className="vault-label">Site</label>
                  <select className="vault-input" value={dropForm.site}
                    onChange={e => setDropForm(f => ({ ...f, site: e.target.value }))}>
                    {SITES.map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="vault-label">Drop Date</label>
                  <input className="vault-input" type="date" value={dropForm.drop_date}
                    onChange={e => setDropForm(f => ({ ...f, drop_date: e.target.value }))} />
                </div>
              </div>

              {/* Guide URLs — per cookgroup */}
              <div className="space-y-2">
                <label className="vault-label">Cookgroup Guide Links</label>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-vault-gold w-24 shrink-0">House of Resell</span>
                  <input className="vault-input text-sm" placeholder="https://..."
                    value={dropForm.guide_hor || ''}
                    onChange={e => setDropForm(f => ({ ...f, guide_hor: e.target.value }))} />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-vault-purple w-24 shrink-0">LunarFBA</span>
                  <input className="vault-input text-sm" placeholder="https://..."
                    value={dropForm.guide_lunar || ''}
                    onChange={e => setDropForm(f => ({ ...f, guide_lunar: e.target.value }))} />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-vault-accent w-24 shrink-0">ResellVault</span>
                  <input className="vault-input text-sm" placeholder="https://..."
                    value={dropForm.guide_rv || ''}
                    onChange={e => setDropForm(f => ({ ...f, guide_rv: e.target.value }))} />
                </div>
                <p className="text-vault-muted text-xs font-mono">Leave blank for any groups that don't have a guide for this drop</p>
              </div>

              {/* Admin notes */}
              <div>
                <label className="vault-label">Admin Notes</label>
                <textarea className="vault-input min-h-[80px] resize-none" rows={3}
                  placeholder="Instructions for members e.g. 'No URL change needed if postcode has a space'"
                  value={dropForm.notes}
                  onChange={e => setDropForm(f => ({ ...f, notes: e.target.value }))} />
                <p className="text-vault-muted text-xs font-mono mt-1">
                  Members see this prominently before submitting — use it for important instructions
                </p>
              </div>

              {/* Items builder */}
              <div>
                <label className="vault-label">Items <span className="text-vault-muted">(optional — for multi-item drops)</span></label>
                <div className="space-y-1.5 mb-2">
                  {(dropForm.items || []).map((item, i) => (
                    <div key={i} className="flex items-center gap-2 bg-vault-bg rounded-lg px-3 py-2 border border-vault-border">
                      <span className="font-mono text-vault-accent text-sm font-bold">{item.key}</span>
                      {item.name && <span className="text-vault-text-dim text-sm">— {item.name}</span>}
                      <button onClick={() => removeItem(i)}
                        className="ml-auto text-vault-muted hover:text-vault-red transition-colors">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input className="vault-input w-20 font-mono uppercase text-center"
                    placeholder="A"
                    value={newItemKey}
                    maxLength={3}
                    onChange={e => setNewItemKey(e.target.value.toUpperCase())} />
                  <input className="vault-input flex-1"
                    placeholder="Item name (optional)"
                    value={newItemName}
                    onChange={e => setNewItemName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addItem()} />
                  <button type="button" onClick={addItem} className="vault-btn-ghost px-3">
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Status */}
              <div>
                <label className="vault-label">Status</label>
                <select className="vault-input" value={dropForm.status}
                  onChange={e => setDropForm(f => ({ ...f, status: e.target.value }))}>
                  {Object.entries(STATUSES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-5 pt-4 border-t border-vault-border shrink-0">
              <button className="vault-btn-ghost" onClick={closeDropModal}>Cancel</button>
              <button className="vault-btn-primary" onClick={saveDrop} disabled={savingDrop}>
                <Save className="w-4 h-4" />{savingDrop ? 'Saving...' : editDropId ? 'Save Changes' : 'Create Drop'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}

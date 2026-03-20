import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { decryptProfile } from '../lib/crypto'
import {
  Package, Plus, X, Save, Trash2, ChevronDown, ChevronUp,
  Download, RefreshCw, BookOpen, Users,
  Clock, Pencil, Copy, Check, UserX, FileDown, UserCheck, Sword
} from 'lucide-react'
import { format } from 'date-fns'
import Papa from 'papaparse'

const SITES = ['Pokemon Center', 'Topps', 'Argos', 'John Lewis', 'Game', 'Warhammer', 'Very', 'Other']
const STATUSES = {
  open:      { label: 'Open',         color: 'text-vault-green  bg-vault-green/10  border-vault-green/20' },
  restock:   { label: '24/7 Restock', color: 'text-vault-accent bg-vault-accent/10 border-vault-accent/20' },
  upcoming:  { label: 'Upcoming',     color: 'text-vault-gold   bg-vault-gold/10   border-vault-gold/20' },
  closed:    { label: 'Closed',       color: 'text-vault-red    bg-vault-red/10    border-vault-red/20' },
  completed: { label: 'Completed',    color: 'text-vault-muted  bg-vault-border    border-vault-border' },
}

const RUNNERS = [
  { key: 'nirxv',   label: 'Nirxv',   colour: '#00c8ff' },
  { key: 'warrior', label: 'Warrior', colour: '#ffe600' },
]

const EMPTY_DROP = {
  name: '', site: 'Pokemon Center', status: 'open',
  drop_date: '', guide_hor: '', guide_lunar: '', guide_rv: '', notes: '', items: [],
}

function profileToCSVRow(p) {
  return {
    PROFILE_NAME:             p.profile_name || '',
    EMAIL:                    p.email || '',
    PHONE:                    p.phone || '',
    SHIPPING_FIRST_NAME:      p.shipping_first_name || '',
    SHIPPING_LAST_NAME:       p.shipping_last_name || '',
    SHIPPING_ADDRESS:         p.shipping_address || '',
    SHIPPING_ADDRESS_2:       p.shipping_address_2 || '',
    SHIPPING_CITY:            p.shipping_city || '',
    SHIPPING_ZIP:             p.shipping_zip || '',
    SHIPPING_STATE:           p.shipping_state || '',
    SHIPPING_COUNTRY:         p.shipping_country || '',
    BILLING_FIRST_NAME:       p.billing_same_as_shipping ? p.shipping_first_name  : p.billing_first_name  || '',
    BILLING_LAST_NAME:        p.billing_same_as_shipping ? p.shipping_last_name   : p.billing_last_name   || '',
    BILLING_ADDRESS:          p.billing_same_as_shipping ? p.shipping_address     : p.billing_address     || '',
    BILLING_ADDRESS_2:        p.billing_same_as_shipping ? p.shipping_address_2   : p.billing_address_2   || '',
    BILLING_CITY:             p.billing_same_as_shipping ? p.shipping_city        : p.billing_city        || '',
    BILLING_ZIP:              p.billing_same_as_shipping ? p.shipping_zip         : p.billing_zip         || '',
    BILLING_STATE:            p.billing_same_as_shipping ? p.shipping_state       : p.billing_state       || '',
    BILLING_COUNTRY:          p.billing_same_as_shipping ? p.shipping_country     : p.billing_country     || '',
    BILLING_SAME_AS_SHIPPING: p.billing_same_as_shipping ? 'TRUE' : 'FALSE',
    CARD_HOLDER_NAME:         p.card_holder_name || '',
    CARD_TYPE:                p.card_type || '',
    CARD_NUMBER:              p.card_number || '',
    CARD_MONTH:               p.card_month || '',
    CARD_YEAR:                p.card_year || '',
    CARD_CVV:                 p.card_cvv || '',
    ONE_CHECKOUT_PER_PROFILE: p.one_checkout_per_profile ? 'TRUE' : 'FALSE',
  }
}

function downloadCSV(rows, filename) {
  const csv  = Papa.unparse(rows)
  const blob = new Blob([csv], { type: 'text/csv' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

export default function DropManagerPage() {
  const { user } = useAuth()
  const [drops, setDrops]             = useState([])
  const [submissions, setSubmissions] = useState({})
  const [users, setUsers]             = useState({})
  const [loading, setLoading]         = useState(true)
  const [expandedDrop, setExpandedDrop] = useState(null)
  const [loadingSubs, setLoadingSubs] = useState({})
  const [copied, setCopied]           = useState(null)
  const [exportModal, setExportModal] = useState(null)
  const [exportLoading, setExportLoading] = useState(false)

  // Runner assignment
  const [assignModal, setAssignModal] = useState(null) // { drop, sub }
  const [runs, setRuns]               = useState({})   // { dropId: { profileId: { runner, run_id } } }
  const [savingRun, setSavingRun]     = useState(null) // profileId being saved

  const [dropModal, setDropModal]     = useState(false)
  const [dropForm, setDropForm]       = useState(EMPTY_DROP)
  const [editDropId, setEditDropId]   = useState(null)
  const [savingDrop, setSavingDrop]   = useState(false)
  const [newItemKey, setNewItemKey]   = useState('')
  const [newItemName, setNewItemName] = useState('')
  const [newItemPid, setNewItemPid]   = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.from('drops').select('*').order('created_at', { ascending: false })
    setDrops(data || [])
    const { data: profiles } = await supabase.from('user_profiles').select('id, username')
    const map = {}
    ;(profiles || []).forEach(p => { map[p.id] = p.username })
    setUsers(map)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // Load runs for a drop
  async function loadRuns(dropId) {
    const { data } = await supabase.from('profile_runs').select('*').eq('drop_id', dropId)
    const map = {}
    ;(data || []).forEach(r => { map[r.profile_id] = { runner: r.runner, run_id: r.id } })
    setRuns(prev => ({ ...prev, [dropId]: map }))
  }

  async function loadSubmissions(dropId) {
    setLoadingSubs(s => ({ ...s, [dropId]: true }))
    const { data } = await supabase.from('drop_submissions').select('*').eq('drop_id', dropId).order('submitted_at', { ascending: false })
    if (data && data.length > 0) {
      const userIds = [...new Set(data.map(s => s.user_id))]
      const { data: profiles } = await supabase.from('user_profiles').select('id, username').in('id', userIds)
      if (profiles) setUsers(prev => { const next = { ...prev }; profiles.forEach(p => { next[p.id] = p.username }); return next })
    }
    setSubmissions(s => ({ ...s, [dropId]: data || [] }))
    setLoadingSubs(s => ({ ...s, [dropId]: false }))
    await loadRuns(dropId)
  }

  async function adminRemoveSubmission(dropId, submissionId, username) {
    if (!window.confirm(`Remove ${username}'s submission from this drop?`)) return
    await supabase.from('drop_submissions').delete().eq('id', submissionId)
    await loadSubmissions(dropId)
  }

  function toggleDrop(dropId) {
    if (expandedDrop === dropId) { setExpandedDrop(null); return }
    setExpandedDrop(dropId)
    if (!submissions[dropId]) loadSubmissions(dropId)
  }

  // ── Assign runner to a profile ────────────────────────────────────────
  async function assignRunner(drop, sub, profileId, profileName, runner) {
    setSavingRun(profileId)
    const dropRuns = runs[drop.id] || {}
    const existing = dropRuns[profileId]

    if (existing) {
      // Update existing run
      await supabase.from('profile_runs').update({ runner }).eq('id', existing.run_id)
    } else {
      // Insert new run
      await supabase.from('profile_runs').insert({
        drop_id:      drop.id,
        user_id:      sub.user_id,
        profile_id:   profileId,
        profile_name: profileName,
        runner,
        site:         drop.site,
        drop_name:    drop.name,
      })
    }
    await loadRuns(drop.id)
    setSavingRun(null)
  }

  async function removeRunner(drop, profileId) {
    const dropRuns = runs[drop.id] || {}
    const existing = dropRuns[profileId]
    if (!existing) return
    setSavingRun(profileId)
    await supabase.from('profile_runs').delete().eq('id', existing.run_id)
    await loadRuns(drop.id)
    setSavingRun(null)
  }

  // ── Profile map helpers ───────────────────────────────────────────────
  async function fetchProfileMap(dropId) {
    const subs = submissions[dropId] || []
    const allIds = [...new Set(subs.flatMap(s => JSON.parse(s.profile_ids || '[]')))]
    if (!allIds.length) return {}
    const { data: raw } = await supabase.from('profiles').select('*').in('id', allIds)
    const dec = await Promise.all((raw || []).map(decryptProfile))
    const pm = {}
    dec.forEach(p => { pm[p.id] = p })
    return pm
  }

  function buildComboMap(drop) {
    const subs = submissions[drop.id] || []
    const dropItems = drop.items || []
    const comboMap = {}
    for (const sub of subs) {
      const profileIds    = JSON.parse(sub.profile_ids    || '[]')
      const selectedItems = JSON.parse(sub.selected_items || '[]')
      const itemsForSub   = selectedItems.length > 0 ? selectedItems : dropItems.map(i => i.key)
      const comboKey      = [...itemsForSub].sort().join('+') || 'ALL'
      if (!comboMap[comboKey]) {
        const itemDetails = itemsForSub.map(k => { const item = dropItems.find(i => i.key === k); return { key: k, name: item?.name || '' } })
        comboMap[comboKey] = { itemDetails, profileCount: 0 }
      }
      comboMap[comboKey].profileCount += profileIds.length
    }
    return comboMap
  }

  async function downloadSingleCombo(drop, comboKey) {
    const pm = await fetchProfileMap(drop.id)
    const subs = submissions[drop.id] || []
    const dropItems = drop.items || []
    const dropName = drop.name.replace(/\s+/g, '_')
    const rows = []
    for (const sub of subs) {
      const pids = JSON.parse(sub.profile_ids || '[]')
      const selItems = JSON.parse(sub.selected_items || '[]')
      const itemsForSub = selItems.length > 0 ? selItems : dropItems.map(i => i.key)
      const key = [...itemsForSub].sort().join('+') || 'ALL'
      if (key !== comboKey) continue
      for (const pid of pids) { if (pm[pid]) rows.push(profileToCSVRow(pm[pid])) }
    }
    downloadCSV(rows, `${dropName}_${comboKey}.csv`)
  }

  async function downloadCombined(drop) {
    const pm = await fetchProfileMap(drop.id)
    const subs = submissions[drop.id] || []
    const dropItems = drop.items || []
    const dropName = drop.name.replace(/\s+/g, '_')
    const rows = []
    for (const sub of subs) {
      const pids = JSON.parse(sub.profile_ids || '[]')
      const selItems = JSON.parse(sub.selected_items || '[]')
      const itemLabel = selItems.length > 0 ? selItems.join('+') : 'ALL'
      for (const pid of pids) {
        if (pm[pid]) rows.push({ ITEMS: itemLabel, USERNAME: users[sub.user_id] || '', ...profileToCSVRow(pm[pid]) })
      }
    }
    downloadCSV(rows, `${dropName}_COMBINED.csv`)
  }

  async function exportDropCSVs(drop) {
    setExportLoading(true)
    const pm = await fetchProfileMap(drop.id)
    const subs = submissions[drop.id] || []
    const dropItems = drop.items || []
    const dropName = drop.name.replace(/\s+/g, '_')
    const comboMap = buildComboMap(drop)
    const combos = Object.entries(comboMap)

    for (let i = 0; i < combos.length; i++) {
      const [comboKey] = combos[i]
      const rows = []
      for (const sub of subs) {
        const pids = JSON.parse(sub.profile_ids || '[]')
        const selItems = JSON.parse(sub.selected_items || '[]')
        const itemsForSub = selItems.length > 0 ? selItems : dropItems.map(i => i.key)
        const key = [...itemsForSub].sort().join('+') || 'ALL'
        if (key !== comboKey) continue
        for (const pid of pids) { if (pm[pid]) rows.push(profileToCSVRow(pm[pid])) }
      }
      setTimeout(() => downloadCSV(rows, `${dropName}_${comboKey}.csv`), i * 400)
    }

    const combinedRows = []
    for (const sub of subs) {
      const pids = JSON.parse(sub.profile_ids || '[]')
      const selItems = JSON.parse(sub.selected_items || '[]')
      const itemLabel = selItems.length > 0 ? selItems.join('+') : 'ALL'
      for (const pid of pids) {
        if (pm[pid]) combinedRows.push({ ITEMS: itemLabel, USERNAME: users[sub.user_id] || '', ...profileToCSVRow(pm[pid]) })
      }
    }
    setTimeout(() => {
      downloadCSV(combinedRows, `${dropName}_COMBINED.csv`)
      setExportLoading(false)
      setExportModal(null)
    }, combos.length * 400 + 200)
  }

  async function openExportModal(drop) {
    if (!submissions[drop.id]) await loadSubmissions(drop.id)
    setExportModal(drop)
  }

  async function saveDrop() {
    if (!dropForm.name.trim()) return
    setSavingDrop(true)
    const payload = { ...dropForm, created_by: user.id, drop_date: dropForm.drop_date || null }
    if (editDropId) await supabase.from('drops').update(payload).eq('id', editDropId)
    else            await supabase.from('drops').insert(payload)
    await load(); closeDropModal(); setSavingDrop(false)
  }

  async function deleteDrop(id) {
    if (!window.confirm('Delete this drop and all its submissions?')) return
    await supabase.from('drop_submissions').delete().eq('drop_id', id)
    await supabase.from('profile_runs').delete().eq('drop_id', id)
    await supabase.from('drops').delete().eq('id', id)
    await load()
  }

  async function updateStatus(dropId, status) {
    await supabase.from('drops').update({ status }).eq('id', dropId)
    await load()
  }

  function openEdit(drop) {
    setDropForm({ name: drop.name, site: drop.site, status: drop.status, drop_date: drop.drop_date || '', guide_hor: drop.guide_hor || '', guide_lunar: drop.guide_lunar || '', guide_rv: drop.guide_rv || '', notes: drop.notes || '', items: drop.items || [] })
    setEditDropId(drop.id); setDropModal(true)
  }

  function closeDropModal() { setDropModal(false); setDropForm(EMPTY_DROP); setEditDropId(null); setNewItemKey(''); setNewItemName('') }

  function addItem() {
    if (!newItemKey.trim()) return
    setDropForm(f => ({ ...f, items: [...(f.items || []), { key: newItemKey.trim().toUpperCase(), name: newItemName.trim(), pid: newItemPid.trim() }] }))
    setNewItemKey(''); setNewItemName(''); setNewItemPid('')
  }

  function removeItem(i) { setDropForm(f => ({ ...f, items: f.items.filter((_, idx) => idx !== i) })) }

  function exportSubmissionsSummary(drop) {
    const subs = submissions[drop.id] || []
    const rows = subs.map(s => ({ Username: users[s.user_id] || s.user_id, Profiles: JSON.parse(s.profile_names || '[]').join(', '), 'Items Selected': JSON.parse(s.selected_items || '[]').join(', ') || 'All', Notes: s.notes || '', 'Submitted At': format(new Date(s.submitted_at), 'dd MMM yyyy HH:mm') }))
    downloadCSV(rows, `${drop.name.replace(/\s+/g, '_')}_summary.csv`)
  }

  return (
    <div className="max-w-5xl mx-auto animate-fade-in" style={{ fontFamily: "'Outfit', sans-serif" }}>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-3xl text-vault-gold neon-gold">DROP MANAGER</h1>
          <p className="text-vault-text-dim text-sm font-body mt-0.5">Create drops, add guides, view submissions</p>
        </div>
        <button className="vault-btn-primary" onClick={() => setDropModal(true)}><Plus className="w-4 h-4" /> New Drop</button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><div className="w-8 h-8 border-2 border-vault-accent border-t-transparent rounded-full animate-spin" /></div>
      ) : drops.length === 0 ? (
        <div className="vault-card text-center py-16"><Package className="w-10 h-10 text-vault-muted mx-auto mb-3" /><p className="text-vault-text font-display">No drops yet</p></div>
      ) : (
        <div className="space-y-3 stagger">
          {drops.map(drop => {
            const s = STATUSES[drop.status] || STATUSES.closed
            const isExpanded = expandedDrop === drop.id
            const subs = submissions[drop.id] || []
            const items = drop.items || []
            const dropRuns = runs[drop.id] || {}

            return (
              <div key={drop.id} className="vault-card">
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-display text-vault-text text-lg">{drop.name}</p>
                      <span className="vault-badge border text-[10px] text-vault-accent bg-vault-accent/10 border-vault-accent/20">{drop.site}</span>
                      <span className={`vault-badge border text-[10px] ${s.color}`}>{s.label}</span>
                      {items.length > 0 && <span className="vault-badge border text-[10px] text-vault-muted border-vault-border">{items.length} item{items.length !== 1 ? 's' : ''}</span>}
                    </div>
                    <div className="flex gap-3 mt-0.5 flex-wrap">
                      {drop.drop_date && <p className="text-vault-muted text-[11px] font-mono"><Clock className="w-3 h-3 inline mr-1" />{format(new Date(drop.drop_date), 'dd MMM yyyy')}</p>}
                      {drop.guide_hor && <a href={drop.guide_hor} target="_blank" rel="noopener noreferrer" className="text-vault-gold text-[11px] font-mono hover:underline flex items-center gap-1"><BookOpen className="w-3 h-3" />HoR</a>}
                      {drop.guide_lunar && <a href={drop.guide_lunar} target="_blank" rel="noopener noreferrer" className="text-vault-purple text-[11px] font-mono hover:underline flex items-center gap-1"><BookOpen className="w-3 h-3" />Lunar</a>}
                      {drop.guide_rv && <a href={drop.guide_rv} target="_blank" rel="noopener noreferrer" className="text-vault-accent text-[11px] font-mono hover:underline flex items-center gap-1"><BookOpen className="w-3 h-3" />RV</a>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
                    <button onClick={() => openExportModal(drop)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                      style={{ background: 'rgba(255,230,0,0.1)', color: '#ffe600', border: '1px solid rgba(255,230,0,0.3)' }}>
                      <FileDown className="w-3.5 h-3.5" /> Export CSVs
                    </button>
                    <select className="vault-input text-xs py-1.5 px-2 w-28" value={drop.status} onChange={e => updateStatus(drop.id, e.target.value)}>
                      {Object.entries(STATUSES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                    </select>
                    <button onClick={() => openEdit(drop)} className="p-1.5 text-vault-muted hover:text-vault-accent rounded hover:bg-vault-accent/10 transition-all"><Pencil className="w-4 h-4" /></button>
                    <button onClick={() => deleteDrop(drop.id)} className="p-1.5 text-vault-muted hover:text-vault-red rounded hover:bg-vault-red/10 transition-all"><Trash2 className="w-4 h-4" /></button>
                    <button onClick={() => toggleDrop(drop.id)} className="p-1.5 text-vault-muted hover:text-vault-text rounded hover:bg-vault-border transition-all">
                      {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {isExpanded && (
                  <div className="mt-4 pt-4 border-t border-vault-border animate-fade-in">
                    {drop.notes && <div className="mb-3 p-3 bg-vault-gold/5 border border-vault-gold/20 rounded-xl"><p className="text-[10px] font-mono text-vault-gold uppercase tracking-widest mb-1">Admin Notes</p><p className="text-vault-text text-sm font-body">{drop.notes}</p></div>}

                    <div className="flex items-center gap-2 mb-3 flex-wrap">
                      <p className="text-xs font-mono text-vault-muted flex-1">{loadingSubs[drop.id] ? 'Loading...' : `${subs.length} submission${subs.length !== 1 ? 's' : ''}`}</p>
                      <button onClick={() => loadSubmissions(drop.id)} className="vault-btn-ghost text-xs px-2.5 py-1.5"><RefreshCw className="w-3 h-3" /> Refresh</button>
                      {subs.length > 0 && (() => {
                        const allLines = subs.flatMap(sub => {
                          const profileNames = JSON.parse(sub.profile_names || '[]')
                          const selectedItems = JSON.parse(sub.selected_items || '[]')
                          const relevantItems = selectedItems.length > 0 ? (drop.items || []).filter(item => selectedItems.includes(item.key)) : (drop.items || [])
                          const pids = relevantItems.map(item => item.pid).filter(Boolean)
                          const pidString = pids.join(',')
                          const username = users[sub.user_id] || sub.user_id
                          return profileNames.map(pn => pidString ? `${username} — ${pn} — ${pidString}` : `${username} — ${pn}`)
                        })
                        return (
                          <>
                            {allLines.some(l => l.includes('—')) && (
                              <button onClick={() => { navigator.clipboard.writeText(allLines.join('\n')); setCopied(`all-${drop.id}`); setTimeout(() => setCopied(null), 2000) }}
                                className="vault-btn-ghost text-xs px-2.5 py-1.5 text-vault-gold border-vault-gold/30 hover:bg-vault-gold/10">
                                {copied === `all-${drop.id}` ? <><Check className="w-3 h-3 text-vault-green" />Copied!</> : <><Copy className="w-3 h-3" />Copy All PIDs</>}
                              </button>
                            )}
                            <button onClick={() => exportSubmissionsSummary(drop)} className="vault-btn-ghost text-xs px-2.5 py-1.5"><Download className="w-3 h-3" /> Summary</button>
                          </>
                        )
                      })()}
                    </div>

                    {loadingSubs[drop.id] ? (
                      <div className="flex justify-center py-6"><div className="w-5 h-5 border-2 border-vault-accent border-t-transparent rounded-full animate-spin" /></div>
                    ) : subs.length === 0 ? (
                      <p className="text-vault-muted text-xs font-mono text-center py-6">No submissions yet</p>
                    ) : (
                      <div className="space-y-3">
                        {subs.map(sub => {
                          const profileNames  = JSON.parse(sub.profile_names || '[]')
                          const profileIds    = JSON.parse(sub.profile_ids   || '[]')
                          const selectedItems = JSON.parse(sub.selected_items || '[]')
                          const relevantItems = selectedItems.length > 0 ? (drop.items || []).filter(item => selectedItems.includes(item.key)) : (drop.items || [])
                          const pids      = relevantItems.map(item => item.pid).filter(Boolean)
                          const pidString = pids.join(',')
                          const username  = users[sub.user_id] || sub.user_id
                          const copyLines = profileNames.map(pn => pidString ? `${username} — ${pn} — ${pidString}` : `${username} — ${pn}`).join('\n')

                          return (
                            <div key={sub.id} className="bg-vault-bg rounded-xl border border-vault-border overflow-hidden">
                              {/* Submission header */}
                              <div className="flex items-start gap-3 flex-wrap px-3 pt-2.5 pb-2">
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-display text-vault-text">{username}</p>
                                  {selectedItems.length > 0 && <p className="text-xs font-mono text-vault-accent mt-0.5">Items: {selectedItems.join(', ')}</p>}
                                  {sub.notes && <p className="text-xs font-mono text-vault-gold mt-0.5">Note: {sub.notes}</p>}
                                  {pids.length > 0 && (
                                    <div className="mt-1.5 p-2 bg-vault-surface rounded-lg border border-vault-gold/20">
                                      <div className="flex items-center justify-between gap-2 mb-1">
                                        <p className="text-[10px] font-mono text-vault-gold uppercase tracking-widest">PIDs</p>
                                        <button onClick={() => { navigator.clipboard.writeText(copyLines); setCopied(sub.id); setTimeout(() => setCopied(null), 2000) }}
                                          className="flex items-center gap-1 text-[10px] font-mono text-vault-gold hover:text-vault-text transition-colors">
                                          {copied === sub.id ? <><Check className="w-3 h-3 text-vault-green" /><span className="text-vault-green">Copied!</span></> : <><Copy className="w-3 h-3" />Copy</>}
                                        </button>
                                      </div>
                                      <p className="font-mono text-[11px] text-vault-text-dim break-all">{pidString}</p>
                                    </div>
                                  )}
                                </div>
                                <div className="flex flex-col items-end gap-1.5 shrink-0">
                                  <div className="flex items-center gap-2">
                                    <span className="vault-badge border text-[10px] text-vault-green border-vault-green/20 bg-vault-green/10">{profileNames.length} profile{profileNames.length !== 1 ? 's' : ''}</span>
                                    <p className="text-[10px] font-mono text-vault-muted">{format(new Date(sub.submitted_at), 'dd MMM HH:mm')}</p>
                                  </div>
                                  <button onClick={() => adminRemoveSubmission(drop.id, sub.id, username)}
                                    className="flex items-center gap-1 text-[10px] font-mono text-vault-muted hover:text-vault-red transition-colors">
                                    <UserX className="w-3 h-3" /> Remove
                                  </button>
                                </div>
                              </div>

                              {/* ── Per-profile runner assignment ── */}
                              <div className="border-t border-vault-border/50 px-3 py-2 space-y-1.5">
                                <p className="text-[10px] font-mono text-vault-muted uppercase tracking-widest mb-2">Assign Runners</p>
                                {profileNames.map((pName, idx) => {
                                  const pid = profileIds[idx]
                                  const existing = dropRuns[pid]
                                  const isSaving = savingRun === pid

                                  return (
                                    <div key={pid || idx} className="flex items-center gap-2 flex-wrap">
                                      {/* Profile name */}
                                      <p className="text-xs font-mono text-vault-text flex-1 min-w-0 truncate">{pName}</p>

                                      {/* Runner pills */}
                                      {RUNNERS.map(r => {
                                        const isAssigned = existing?.runner === r.key
                                        return (
                                          <button
                                            key={r.key}
                                            onClick={() => assignRunner(drop, sub, pid, pName, r.key)}
                                            disabled={isSaving}
                                            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-mono font-semibold transition-all disabled:opacity-50"
                                            style={isAssigned
                                              ? { background: r.colour + '20', color: r.colour, border: `1px solid ${r.colour}50` }
                                              : { background: 'transparent', color: '#5a5a7a', border: '1px solid #1a1a2e' }}>
                                            {r.key === 'nirxv' ? <UserCheck className="w-3 h-3" /> : <Sword className="w-3 h-3" />}
                                            {r.label}
                                          </button>
                                        )
                                      })}

                                      {/* Remove button — only shown when assigned */}
                                      {existing && (
                                        <button
                                          onClick={() => removeRunner(drop, pid)}
                                          disabled={isSaving}
                                          className="p-1 text-vault-muted hover:text-vault-red transition-colors disabled:opacity-50"
                                          title="Remove runner">
                                          <X className="w-3.5 h-3.5" />
                                        </button>
                                      )}

                                      {/* Saving spinner */}
                                      {isSaving && <div className="w-3 h-3 border border-vault-accent border-t-transparent rounded-full animate-spin" />}
                                    </div>
                                  )
                                })}
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

      {/* ── Export CSVs modal ── */}
      {exportModal && createPortal(
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="vault-card max-w-lg w-full animate-fade-in flex flex-col" style={{ maxHeight: '90vh' }}>
            <div className="flex items-center justify-between mb-5 shrink-0">
              <div><h2 className="font-display text-xl text-vault-gold neon-gold">EXPORT PROFILE CSVs</h2><p className="text-vault-text-dim text-xs font-mono mt-0.5">{exportModal.name}</p></div>
              <button onClick={() => setExportModal(null)}><X className="w-5 h-5 text-vault-muted" /></button>
            </div>
            <div className="overflow-y-auto flex-1 space-y-3 pr-1">
              {(() => {
                const subs = submissions[exportModal.id] || []
                if (!subs.length) return <p className="text-vault-muted text-sm text-center py-8">No submissions yet</p>
                const comboMap = buildComboMap(exportModal)
                const dropName = exportModal.name.replace(/\s+/g, '_')
                return (
                  <>
                    <p className="text-[10px] font-mono text-vault-muted uppercase tracking-widest">Per-item files</p>
                    {Object.entries(comboMap).map(([comboKey, { itemDetails, profileCount }]) => (
                      <div key={comboKey} className="rounded-xl border border-vault-border bg-vault-bg p-3">
                        <div className="flex items-start justify-between gap-3 mb-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <FileDown className="w-4 h-4 text-vault-gold shrink-0 mt-0.5" />
                            <p className="text-sm font-mono text-vault-text truncate">{dropName}_{comboKey}.csv</p>
                          </div>
                          <span className="text-[10px] font-mono text-vault-accent shrink-0 mt-0.5">{profileCount} profile{profileCount !== 1 ? 's' : ''}</span>
                        </div>
                        <div className="ml-6 mb-3 space-y-0.5">
                          {itemDetails.map(({ key, name }) => (
                            <div key={key} className="flex items-center gap-2">
                              <span className="w-1.5 h-1.5 rounded-full bg-vault-gold shrink-0" />
                              <span className="text-xs font-mono"><span className="text-vault-accent font-bold">{key}</span>{name && <span className="text-vault-text-dim ml-1.5">— {name}</span>}</span>
                            </div>
                          ))}
                        </div>
                        <button onClick={() => downloadSingleCombo(exportModal, comboKey)}
                          className="w-full flex items-center justify-center gap-2 py-1.5 rounded-lg text-xs font-semibold transition-all"
                          style={{ background: 'rgba(255,230,0,0.08)', color: '#ffe600', border: '1px solid rgba(255,230,0,0.25)' }}>
                          <Download className="w-3.5 h-3.5" /> Download this file
                        </button>
                      </div>
                    ))}
                    <div className="rounded-xl border border-vault-accent/30 bg-vault-accent/5 p-3">
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <div className="flex items-center gap-2 min-w-0"><FileDown className="w-4 h-4 text-vault-accent shrink-0 mt-0.5" /><p className="text-sm font-mono text-vault-accent truncate">{dropName}_COMBINED.csv</p></div>
                        <span className="text-[10px] font-mono text-vault-accent shrink-0 mt-0.5">all profiles</span>
                      </div>
                      <p className="text-xs font-mono text-vault-muted ml-6 mb-3">All profiles in one file with an ITEMS column</p>
                      <button onClick={() => downloadCombined(exportModal)}
                        className="w-full flex items-center justify-center gap-2 py-1.5 rounded-lg text-xs font-semibold transition-all"
                        style={{ background: 'rgba(0,200,255,0.08)', color: '#00c8ff', border: '1px solid rgba(0,200,255,0.25)' }}>
                        <Download className="w-3.5 h-3.5" /> Download combined
                      </button>
                    </div>
                  </>
                )
              })()}
            </div>
            <div className="flex gap-2 justify-end mt-5 pt-4 border-t border-vault-border shrink-0">
              <button className="vault-btn-ghost" onClick={() => setExportModal(null)}>Close</button>
              <button className="vault-btn-primary" onClick={() => exportDropCSVs(exportModal)} disabled={exportLoading || !(submissions[exportModal.id]?.length)}>
                {exportLoading ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />Exporting all...</> : <><FileDown className="w-4 h-4" />Download All</>}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ── DROP MODAL ── */}
      {dropModal && createPortal(
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="vault-card max-w-lg w-full flex flex-col animate-fade-in" style={{ maxHeight: '90vh' }}>
            <div className="flex items-center justify-between mb-5 shrink-0">
              <h2 className="font-display text-2xl text-vault-gold neon-gold">{editDropId ? 'EDIT DROP' : 'NEW DROP'}</h2>
              <button onClick={closeDropModal}><X className="w-5 h-5 text-vault-muted" /></button>
            </div>
            <div className="overflow-y-auto flex-1 pr-1 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2"><label className="vault-label">Drop Name *</label><input className="vault-input" placeholder="e.g. Chaos Rising Preorder" value={dropForm.name} onChange={e => setDropForm(f => ({ ...f, name: e.target.value }))} /></div>
                <div><label className="vault-label">Site</label><select className="vault-input" value={dropForm.site} onChange={e => setDropForm(f => ({ ...f, site: e.target.value }))}>{SITES.map(s => <option key={s}>{s}</option>)}</select></div>
                <div><label className="vault-label">Drop Date</label><input className="vault-input" type="date" value={dropForm.drop_date} onChange={e => setDropForm(f => ({ ...f, drop_date: e.target.value }))} /></div>
              </div>
              <div className="space-y-2">
                <label className="vault-label">Cookgroup Guide Links</label>
                <div className="flex items-center gap-2"><span className="text-xs font-mono text-vault-gold w-24 shrink-0">House of Resell</span><input className="vault-input text-sm" placeholder="https://..." value={dropForm.guide_hor || ''} onChange={e => setDropForm(f => ({ ...f, guide_hor: e.target.value }))} /></div>
                <div className="flex items-center gap-2"><span className="text-xs font-mono text-vault-purple w-24 shrink-0">LunarFBA</span><input className="vault-input text-sm" placeholder="https://..." value={dropForm.guide_lunar || ''} onChange={e => setDropForm(f => ({ ...f, guide_lunar: e.target.value }))} /></div>
                <div className="flex items-center gap-2"><span className="text-xs font-mono text-vault-accent w-24 shrink-0">ResellVault</span><input className="vault-input text-sm" placeholder="https://..." value={dropForm.guide_rv || ''} onChange={e => setDropForm(f => ({ ...f, guide_rv: e.target.value }))} /></div>
              </div>
              <div><label className="vault-label">Admin Notes</label><textarea className="vault-input min-h-[80px] resize-none" rows={3} placeholder="Instructions for members..." value={dropForm.notes} onChange={e => setDropForm(f => ({ ...f, notes: e.target.value }))} /></div>
              <div>
                <label className="vault-label">Items <span className="text-vault-muted">(optional)</span></label>
                <div className="space-y-1.5 mb-2">
                  {(dropForm.items || []).map((item, i) => (
                  <div key={i} className="bg-vault-bg rounded-lg px-3 py-2 border border-vault-border space-y-1.5">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-vault-accent text-sm font-bold shrink-0">{item.key}</span>
                      {item.name && <span className="text-vault-text-dim text-sm">{item.name}</span>}
                      <button onClick={() => removeItem(i)} className="ml-auto text-vault-muted hover:text-vault-red transition-colors shrink-0"><X className="w-3.5 h-3.5" /></button>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono text-vault-gold w-8 shrink-0">PID</span>
                      <input
                        className="vault-input text-xs font-mono text-vault-gold py-1 flex-1"
                        placeholder="Enter PID when live..."
                        value={item.pid || ''}
                        onChange={e => setDropForm(f => ({
                          ...f,
                          items: f.items.map((it, idx) => idx === i ? { ...it, pid: e.target.value } : it)
                        }))}
                      />
                    </div>
                  </div>
                ))}
                                  
                </div>
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <input className="vault-input w-16 font-mono uppercase text-center text-sm" placeholder="A" value={newItemKey} maxLength={3} onChange={e => setNewItemKey(e.target.value.toUpperCase())} />
                    <input className="vault-input flex-1 text-sm" placeholder="Item name (e.g. ETB)" value={newItemName} onChange={e => setNewItemName(e.target.value)} />
                  </div>
                  <div className="flex gap-2">
                    <input className="vault-input flex-1 font-mono text-sm text-vault-gold" placeholder="PID — admin only" value={newItemPid} onChange={e => setNewItemPid(e.target.value)} onKeyDown={e => e.key === 'Enter' && addItem()} />
                    <button type="button" onClick={addItem} className="vault-btn-ghost px-3 shrink-0"><Plus className="w-4 h-4" /></button>
                  </div>
                </div>
              </div>
              <div><label className="vault-label">Status</label><select className="vault-input" value={dropForm.status} onChange={e => setDropForm(f => ({ ...f, status: e.target.value }))}>{Object.entries(STATUSES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></div>
            </div>
            <div className="flex justify-end gap-2 mt-5 pt-4 border-t border-vault-border shrink-0">
              <button className="vault-btn-ghost" onClick={closeDropModal}>Cancel</button>
              <button className="vault-btn-primary" onClick={saveDrop} disabled={savingDrop}><Save className="w-4 h-4" />{savingDrop ? 'Saving...' : editDropId ? 'Save Changes' : 'Create Drop'}</button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}

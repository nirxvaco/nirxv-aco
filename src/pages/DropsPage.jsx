import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { decryptProfile } from '../lib/crypto'
import {
  Package, ExternalLink, CheckCircle, Clock, X, Send,
  ChevronDown, ChevronUp, BookOpen, AlertCircle, Check
} from 'lucide-react'
import { notifyDiscord } from '../lib/notify'
import { format } from 'date-fns'

const SITE_COLOURS = {
  'Pokemon Center': 'text-vault-gold   bg-vault-gold/10   border-vault-gold/30',
  'Topps':          'text-vault-purple bg-vault-purple/10 border-vault-purple/30',
  'Argos':          'text-vault-red    bg-vault-red/10    border-vault-red/30',
  'John Lewis':     'text-vault-green  bg-vault-green/10  border-vault-green/30',
  'Other':          'text-vault-accent bg-vault-accent/10 border-vault-accent/30',
}
function siteColour(site) {
  return SITE_COLOURS[site] || SITE_COLOURS['Other']
}

export default function DropsPage() {
  const { user } = useAuth()
  const [drops, setDrops]               = useState([])
  const [submissions, setSubmissions]   = useState({}) // { [dropId]: submission }
  const [myProfiles, setMyProfiles]     = useState([])
  const [loading, setLoading]           = useState(true)
  const [expandedDrop, setExpandedDrop] = useState(null)

  // Submit modal state
  const [submitModal, setSubmitModal]   = useState(null) // drop object
  const [selectedProfiles, setSelectedProfiles] = useState([])
  const [selectedItems, setSelectedItems]       = useState([])
  const [submissionNote, setSubmissionNote]     = useState('')
  const [submitting, setSubmitting]             = useState(false)
  const [submitted, setSubmitted]               = useState(false)

  const load = useCallback(async () => {
    setLoading(true)

    // Load open drops
    const { data: dropData } = await supabase
      .from('drops')
      .select('*')
      .in('status', ['open'])
      .order('created_at', { ascending: false })

    setDrops(dropData || [])

    // Load my submissions
    const { data: subData } = await supabase
      .from('drop_submissions')
      .select('*')
      .eq('user_id', user.id)

    const subMap = {}
    ;(subData || []).forEach(s => { subMap[s.drop_id] = s })
    setSubmissions(subMap)

    // Load my profiles (decrypted) for the picker
    const { data: profileData } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })

    if (profileData) {
      const decrypted = await Promise.all(profileData.map(decryptProfile))
      setMyProfiles(decrypted)
    }

    setLoading(false)
  }, [user.id])

  useEffect(() => { load() }, [load])

  // ── Submit modal ──────────────────────────────────────────────────────
  function openSubmit(drop) {
    const existing = submissions[drop.id]

    // Filter saved profile IDs against currently existing profiles
    // so deleted profiles don't show as selected
    const existingProfileIds = existing ? JSON.parse(existing.profile_ids || '[]') : []
    const validProfileIds = existingProfileIds.filter(id =>
      myProfiles.some(p => p.id === id)
    )

    // If profiles were deleted, clear the submitted state so they have to resubmit
    const hadDeletions = existingProfileIds.length > validProfileIds.length

    setSelectedProfiles(validProfileIds)
    setSelectedItems(existing ? JSON.parse(existing.selected_items || '[]') : [])
    setSubmissionNote(existing ? existing.notes || '' : '')
    setSubmitted(existing && !hadDeletions)
    setSubmitModal(drop)
  }

  function toggleProfile(id) {
    setSubmitted(false)
    setSelectedProfiles(prev =>
      prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]
    )
  }

  function toggleItem(key) {
    setSubmitted(false)
    setSelectedItems(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    )
  }

  async function handleSubmit() {
    if (!selectedProfiles.length) return
    setSubmitting(true)

    const selectedProfileObjs = myProfiles.filter(p => selectedProfiles.includes(p.id))
    const profileNames = selectedProfileObjs.map(p => p.profile_name)

    const payload = {
      drop_id:        submitModal.id,
      user_id:        user.id,
      profile_ids:    JSON.stringify(selectedProfiles),
      profile_names:  JSON.stringify(profileNames),
      selected_items: JSON.stringify(selectedItems),
      notes:          submissionNote,
      submitted_at:   new Date().toISOString(),
    }

    await supabase
      .from('drop_submissions')
      .upsert(payload, { onConflict: 'drop_id,user_id' })

    notifyDiscord('drop_signup', {
      drop_name:     submitModal.name,
      profile_count: selectedProfiles.length,
      profile_names: selectedProfileObjs.map(p => p.profile_name),
    })

    await load()
    setSubmitted(true)
    setSubmitting(false)
  }

  const items = submitModal?.items || []

  return (
    <div className="max-w-4xl mx-auto animate-fade-in font-drops-body" style={{ fontFamily: "'Outfit', sans-serif" }}>
      <div className="mb-6">
        <h1 className="font-display text-3xl text-vault-accent neon-cyan">DROPS</h1>
        <p className="text-vault-text-dim text-sm font-body mt-0.5">
          Sign up your profiles for open drops
        </p>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-2 border-vault-accent border-t-transparent rounded-full animate-spin" />
        </div>
      ) : drops.length === 0 ? (
        <div className="vault-card text-center py-16">
          <Package className="w-10 h-10 text-vault-muted mx-auto mb-3" />
          <p className="text-vault-text font-display">No drops open right now</p>
          <p className="text-vault-text-dim text-sm mt-1">Check back soon — your admin will post new drops here</p>
        </div>
      ) : (
        <div className="space-y-4 stagger">
          {drops.map(drop => {
            const submission    = submissions[drop.id]
            const isSubmitted   = !!submission
            const isExpanded    = expandedDrop === drop.id
            const dropItems     = drop.items || []
            const submittedProfiles = isSubmitted ? JSON.parse(submission.profile_names || '[]') : []
            const submittedItems    = isSubmitted ? JSON.parse(submission.selected_items || '[]') : []

            return (
              <div key={drop.id} className={`vault-card transition-all ${isSubmitted ? 'border-vault-green/30' : ''}`}>
                {/* Drop header */}
                <div className="flex items-start gap-3 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <h2 className="font-display text-vault-text text-lg">{drop.name}</h2>
                      <span className={`vault-badge border text-[10px] ${siteColour(drop.site)}`}>
                        {drop.site}
                      </span>
                      {isSubmitted && (
                        <span className="vault-badge border text-[10px] text-vault-green bg-vault-green/10 border-vault-green/20">
                          <CheckCircle className="w-2.5 h-2.5" /> Submitted
                        </span>
                      )}
                    </div>
                    {drop.drop_date && (
                      <p className="text-vault-muted text-xs font-mono">
                        <Clock className="w-3 h-3 inline mr-1" />
                        {format(new Date(drop.drop_date), 'dd MMM yyyy')}
                      </p>
                    )}
                  </div>

                  <div className="flex gap-2 shrink-0 flex-wrap">
                    {drop.guide_hor && (
                      <a href={drop.guide_hor} target="_blank" rel="noopener noreferrer"
                        className="vault-btn-ghost text-xs px-3 py-1.5 border-vault-gold/30 text-vault-gold hover:bg-vault-gold/10">
                        <BookOpen className="w-3.5 h-3.5" /> HoR
                      </a>
                    )}
                    {drop.guide_lunar && (
                      <a href={drop.guide_lunar} target="_blank" rel="noopener noreferrer"
                        className="vault-btn-ghost text-xs px-3 py-1.5 border-vault-purple/30 text-vault-purple hover:bg-vault-purple/10">
                        <BookOpen className="w-3.5 h-3.5" /> Lunar
                      </a>
                    )}
                    {drop.guide_rv && (
                      <a href={drop.guide_rv} target="_blank" rel="noopener noreferrer"
                        className="vault-btn-ghost text-xs px-3 py-1.5 border-vault-accent/30 text-vault-accent hover:bg-vault-accent/10">
                        <BookOpen className="w-3.5 h-3.5" /> RV
                      </a>
                    )}
                    <button onClick={() => setExpandedDrop(isExpanded ? null : drop.id)}
                      className="vault-btn-ghost text-xs px-3 py-1.5">
                      {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      Details
                    </button>
                    <button onClick={() => openSubmit(drop)}
                      className={`flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold transition-all shadow-lg
                        ${isSubmitted
                          ? 'text-vault-green border-2 border-vault-green/40 bg-vault-green/10 hover:bg-vault-green/20'
                          : 'text-vault-bg border-2 border-vault-accent hover:brightness-110 active:scale-95'}`}
                      style={!isSubmitted ? {
                        background: 'linear-gradient(135deg, #00c8ff 0%, #0099cc 100%)',
                        boxShadow: '0 0 20px rgba(0,200,255,0.4), 0 4px 12px rgba(0,0,0,0.4)',
                        fontFamily: "'Outfit', sans-serif",
                      } : { fontFamily: "'Outfit', sans-serif" }}>
                      {isSubmitted
                        ? <><CheckCircle className="w-4 h-4" /> Update</>
                        : <><Send className="w-4 h-4" /> Sign Up</>}
                    </button>
                  </div>
                </div>

                {/* Expanded details */}
                {isExpanded && (
                  <div className="mt-4 pt-4 border-t border-vault-border animate-fade-in space-y-3">
                    {/* Admin notes */}
                    {drop.notes && (
                      <div className="bg-vault-gold/5 border border-vault-gold/20 rounded-xl p-3">
                        <p className="text-[10px] font-mono text-vault-gold uppercase tracking-widest mb-1.5">
                          <AlertCircle className="w-3 h-3 inline mr-1" />Admin Notes
                        </p>
                        <p className="text-vault-text text-sm font-body whitespace-pre-wrap">{drop.notes}</p>
                      </div>
                    )}

                    {/* Items */}
                    {dropItems.length > 0 && (
                      <div>
                        <p className="text-[10px] font-mono text-vault-muted uppercase tracking-widest mb-2">Items in this drop</p>
                        <div className="flex gap-2 flex-wrap">
                          {dropItems.map((item, i) => (
                            <div key={i} className="vault-badge border border-vault-border text-vault-text text-xs px-3 py-1.5 font-mono">
                              <span className="text-vault-accent font-bold">{item.key}</span>
                              {item.name && <span className="ml-1.5 text-vault-text-dim">— {item.name}</span>}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Your submission summary */}
                    {isSubmitted && (
                      <div className="bg-vault-green/5 border border-vault-green/20 rounded-xl p-3">
                        <p className="text-[10px] font-mono text-vault-green uppercase tracking-widest mb-2">Your Submission</p>
                        <p className="text-sm font-body text-vault-text">
                          <span className="text-vault-text-dim">Profiles: </span>
                          {submittedProfiles.join(', ') || '—'}
                        </p>
                        {submittedItems.length > 0 && (
                          <p className="text-sm font-body text-vault-text mt-0.5">
                            <span className="text-vault-text-dim">Items: </span>
                            {submittedItems.join(', ')}
                          </p>
                        )}
                        {submission.notes && (
                          <p className="text-sm font-body text-vault-text mt-0.5">
                            <span className="text-vault-text-dim">Note: </span>
                            {submission.notes}
                          </p>
                        )}
                        <p className="text-[10px] font-mono text-vault-muted mt-1.5">
                          Submitted {format(new Date(submission.submitted_at), 'dd MMM yyyy HH:mm')}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ── SUBMIT MODAL ── */}
      {submitModal && createPortal(
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" style={{ backdropFilter: 'blur(4px)' }}>
          <div className="w-full max-w-lg flex flex-col animate-fade-in rounded-2xl overflow-hidden border border-vault-border"
            style={{ maxHeight: '90vh', background: '#0e0e1a' }}>

            {/* ── Coloured header banner ── */}
            <div className="relative shrink-0 px-6 pt-6 pb-5"
              style={{ background: 'linear-gradient(135deg, rgba(0,200,255,0.12) 0%, rgba(180,79,255,0.08) 100%)', borderBottom: '1px solid rgba(0,200,255,0.15)' }}>
              {/* Close */}
              <button onClick={() => setSubmitModal(null)}
                className="absolute top-4 right-4 w-8 h-8 rounded-lg bg-vault-bg/60 flex items-center justify-center text-vault-muted hover:text-vault-text hover:bg-vault-bg transition-all">
                <X className="w-4 h-4" />
              </button>

              {/* Site badge + drop name */}
              <div className="flex items-center gap-2 mb-2">
                <span className={`vault-badge border text-[10px] ${siteColour(submitModal.site)}`}>
                  {submitModal.site}
                </span>
                {submitModal.drop_date && (
                  <span className="text-[10px] font-mono text-vault-muted flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {format(new Date(submitModal.drop_date), 'dd MMM yyyy')}
                  </span>
                )}
              </div>
              <h2 className="text-xl font-semibold text-vault-text leading-tight pr-8" style={{ fontFamily: "'Outfit', sans-serif" }}>
                {submitModal.name}
              </h2>
              <p className="text-xs text-vault-accent font-mono mt-1 tracking-wider uppercase">Sign Up</p>

              {/* Guide buttons inline in header */}
              {(submitModal.guide_hor || submitModal.guide_lunar || submitModal.guide_rv) && (
                <div className="flex gap-2 mt-3 flex-wrap">
                  {submitModal.guide_hor && (
                    <a href={submitModal.guide_hor} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                      style={{ background: 'rgba(255,230,0,0.1)', color: '#ffe600', border: '1px solid rgba(255,230,0,0.25)' }}>
                      <BookOpen className="w-3 h-3" /> House of Resell <ExternalLink className="w-3 h-3 opacity-60" />
                    </a>
                  )}
                  {submitModal.guide_lunar && (
                    <a href={submitModal.guide_lunar} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                      style={{ background: 'rgba(180,79,255,0.1)', color: '#b44fff', border: '1px solid rgba(180,79,255,0.25)' }}>
                      <BookOpen className="w-3 h-3" /> LunarFBA <ExternalLink className="w-3 h-3 opacity-60" />
                    </a>
                  )}
                  {submitModal.guide_rv && (
                    <a href={submitModal.guide_rv} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                      style={{ background: 'rgba(0,200,255,0.08)', color: '#00c8ff', border: '1px solid rgba(0,200,255,0.2)' }}>
                      <BookOpen className="w-3 h-3" /> ResellVault <ExternalLink className="w-3 h-3 opacity-60" />
                    </a>
                  )}
                </div>
              )}
            </div>

            {/* ── Scrollable body ── */}
            <div className="overflow-y-auto flex-1 px-6 py-5 space-y-5">

              {/* Admin notes */}
              {submitModal.notes && (
                <div className="rounded-xl p-4 flex gap-3"
                  style={{ background: 'rgba(255,230,0,0.05)', border: '1px solid rgba(255,230,0,0.2)' }}>
                  <AlertCircle className="w-4 h-4 text-vault-gold shrink-0 mt-0.5" />
                  <div>
                    <p className="text-[10px] font-mono text-vault-gold uppercase tracking-widest mb-1.5">Admin Notes</p>
                    <p className="text-vault-text text-sm whitespace-pre-wrap leading-relaxed" style={{ fontFamily: "'Outfit', sans-serif" }}>
                      {submitModal.notes}
                    </p>
                  </div>
                </div>
              )}

              {/* Items selector */}
              {items.length > 1 && (
                <div>
                  <p className="text-[11px] font-mono text-vault-muted uppercase tracking-widest mb-2.5">
                    Select Items <span className="normal-case text-vault-muted/60">(leave blank = all)</span>
                  </p>
                  <div className="flex gap-2 flex-wrap">
                    {items.map((item, i) => {
                      const key = item.key || item.item_key || `${i}`
                      const isSelected = selectedItems.includes(key)
                      return (
                        <button key={i} type="button" onClick={() => toggleItem(key)}
                          className="flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm font-mono transition-all"
                          style={isSelected
                            ? { background: 'rgba(0,200,255,0.1)', color: '#00c8ff', borderColor: 'rgba(0,200,255,0.4)' }
                            : { background: 'transparent', color: '#7a7a9a', borderColor: '#1a1a2e' }}>
                          {isSelected && <Check className="w-3 h-3" />}
                          {key}{item.name ? ` — ${item.name}` : ''}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Profile selector */}
              <div>
                <div className="flex items-center justify-between mb-2.5">
                  <p className="text-[11px] font-mono text-vault-muted uppercase tracking-widest">
                    Select Profiles <span className="text-vault-red ml-1">*</span>
                  </p>
                  {selectedProfiles.length > 0 && (
                    <span className="text-[11px] font-mono text-vault-accent">
                      {selectedProfiles.length} selected
                    </span>
                  )}
                </div>
                {myProfiles.length === 0 ? (
                  <div className="p-5 rounded-xl border border-vault-border text-center">
                    <p className="text-vault-text-dim text-sm">No profiles yet</p>
                    <p className="text-vault-muted text-xs font-mono mt-1">Add profiles on the Profiles page first</p>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {myProfiles.map(p => {
                      const isSelected = selectedProfiles.includes(p.id)
                      return (
                        <button key={p.id} type="button" onClick={() => toggleProfile(p.id)}
                          className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-all"
                          style={isSelected
                            ? { background: 'rgba(0,200,255,0.06)', borderColor: 'rgba(0,200,255,0.35)' }
                            : { background: '#08080f', borderColor: '#1a1a2e' }}>
                          {/* Checkbox */}
                          <div className="w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-all"
                            style={isSelected
                              ? { background: '#00c8ff', borderColor: '#00c8ff' }
                              : { borderColor: '#3a3a5a', background: 'transparent' }}>
                            {isSelected && <Check className="w-2.5 h-2.5" style={{ color: '#08080f' }} />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-vault-text" style={{ fontFamily: "'Outfit', sans-serif" }}>
                              {p.profile_name}
                            </p>
                            <p className="text-xs font-mono text-vault-muted truncate mt-0.5">
                              {p.shipping_zip} · {p.card_type} ···· {p.card_number?.slice(-4) || '????'}
                            </p>
                          </div>
                          {isSelected && (
                            <div className="w-1.5 h-1.5 rounded-full bg-vault-accent shrink-0" />
                          )}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Note to admin */}
              <div>
                <label className="text-[11px] font-mono text-vault-muted uppercase tracking-widest block mb-2">
                  Note to Admin <span className="normal-case text-vault-muted/60">(optional)</span>
                </label>
                <input className="vault-input text-sm" placeholder="e.g. Profile 3 card may be virtual..."
                  value={submissionNote}
                  onChange={e => { setSubmissionNote(e.target.value); setSubmitted(false) }} />
              </div>
            </div>

            {/* ── Footer ── */}
            <div className="shrink-0 px-6 py-4 flex gap-3" style={{ borderTop: '1px solid #1a1a2e', background: '#08080f' }}>
              <button onClick={() => setSubmitModal(null)}
                className="px-4 py-2.5 rounded-lg text-sm text-vault-text-dim hover:text-vault-text hover:bg-vault-border transition-all"
                style={{ fontFamily: "'Outfit', sans-serif" }}>
                Cancel
              </button>
              <button onClick={handleSubmit}
                disabled={!selectedProfiles.length || submitting || submitted}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                style={{
                  fontFamily: "'Outfit', sans-serif",
                  background: submitted ? 'rgba(0,227,150,0.1)' : '#00c8ff',
                  color: submitted ? '#00e396' : '#08080f',
                  border: submitted ? '1px solid rgba(0,227,150,0.3)' : 'none',
                }}>
                {submitting
                  ? <><div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />Submitting...</>
                  : submitted
                  ? <><CheckCircle className="w-4 h-4" />Submitted!</>
                  : <><Send className="w-4 h-4" />Submit {selectedProfiles.length > 0 ? `${selectedProfiles.length} Profile${selectedProfiles.length > 1 ? 's' : ''}` : ''}</>}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}

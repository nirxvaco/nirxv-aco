import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { encryptProfile, decryptProfile, maskCard } from '../lib/crypto'
import Papa from 'papaparse'
import {
  ShieldCheck, Users, KeyRound, Plus, Copy, Trash2, Download,
  ChevronDown, ChevronUp, RefreshCw, Check, Pencil, Save, X,
  Eye, EyeOff, UserCheck, UserX, ArrowLeftRight, CheckSquare, Square,
  AlertTriangle
} from 'lucide-react'
import { format, addDays } from 'date-fns'

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const seg = () => Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
  return `${seg()}-${seg()}`
}

const CARD_TYPES = ['Visa', 'Mastercard', 'Amex', 'Discover', 'Other']
const COUNTRIES  = ['GB', 'US', 'CA', 'AU', 'DE', 'FR', 'IT', 'ES', 'NL', 'Other']
const EMPTY_PROFILE = {
  profile_name: '', email: '', phone: '',
  shipping_first_name: '', shipping_last_name: '', shipping_address: '',
  shipping_address_2: '', shipping_city: '', shipping_zip: '',
  shipping_state: '', shipping_country: 'GB',
  billing_same_as_shipping: true,
  billing_first_name: '', billing_last_name: '', billing_address: '',
  billing_address_2: '', billing_city: '', billing_zip: '',
  billing_state: '', billing_country: 'GB',
  card_holder_name: '', card_type: 'Visa', card_number: '',
  card_month: '', card_year: '', card_cvv: '',
  one_checkout_per_profile: false,
}

function PField({ label, name, type = 'text', options, placeholder, form, setForm, required }) {
  return (
    <div>
      <label className="vault-label">{label}{required && <span className="text-vault-red ml-1">*</span>}</label>
      {options ? (
        <select className="vault-input" value={form[name] || ''}
          onChange={e => setForm(f => ({ ...f, [name]: e.target.value }))}>
          {options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : (
        <input className="vault-input" type={type} placeholder={placeholder}
          value={form[name] || ''}
          onChange={e => setForm(f => ({ ...f, [name]: e.target.value }))} />
      )}
    </div>
  )
}

export default function AdminPage() {
  const { user } = useAuth()
  const [tab, setTab]                       = useState('my-members')
  const [users, setUsers]                   = useState([])
  const [admins, setAdmins]                 = useState([])
  const [invites, setInvites]               = useState([])
  const [loading, setLoading]               = useState(true)
  const [expandedUser, setExpandedUser]     = useState(null)
  const [userProfiles, setUserProfiles]     = useState({})
  const [loadingProfiles, setLoadingProfiles] = useState({})
  const [revealedCards, setRevealedCards]   = useState(new Set())
  const [copied, setCopied]                 = useState(null)
  const [expiryDays, setExpiryDays]         = useState(7)
  const [maxUses, setMaxUses]               = useState(1)
  const [deletingUser, setDeletingUser]     = useState(null)
  const [confirmDelete, setConfirmDelete]   = useState(null)
  const [myMembersSearch, setMyMembersSearch] = useState('')
  const [collapsedUsers, setCollapsedUsers] = useState(new Set())
  const [savingTier, setSavingTier]         = useState({})

  // Multi-select state: { [userId]: Set of selected profile ids }
  const [selectedProfiles, setSelectedProfiles] = useState({})
  const [assigningFor, setAssigningFor]     = useState(null) // userId currently being bulk-assigned
  const [savingAssign, setSavingAssign]     = useState(false)

  // Profile edit modal
  const [editModal, setEditModal]           = useState(false)
  const [editForm, setEditForm]             = useState(EMPTY_PROFILE)
  const [editProfileId, setEditProfileId]   = useState(null)
  const [editUserId, setEditUserId]         = useState(null)
  const [savingProfile, setSavingProfile]   = useState(false)

  // ── loaders ────────────────────────────────────────────────────────────
  const loadUsers = useCallback(async () => {
    setLoading(true)
    // FIX (Security Fix 2): Changed select('*') to explicit safe fields only.
    // Avoids over-fetching sensitive fields like pkc_opt_out, aco_tier etc
    // that are not needed for the admin user list view.
    const { data } = await supabase.from('user_profiles').select('id, username, role, created_at').order('created_at', { ascending: false })
    setUsers(data || [])
    setAdmins((data || []).filter(u => u.role === 'admin'))
    setLoading(false)
  }, [])

  const loadInvites = useCallback(async () => {
    const { data } = await supabase.from('invite_codes').select('*').order('created_at', { ascending: false })
    setInvites(data || [])
  }, [])

  useEffect(() => { loadUsers(); loadInvites() }, [loadUsers, loadInvites])

  async function loadUserProfiles(userId) {
    setLoadingProfiles(p => ({ ...p, [userId]: true }))
    // FIX (Security Fix 7): Removed .eq('user_id', userId) — admin RLS policy on
    // profiles table already allows reading all profiles. The filter was redundant
    // and exposed the filter param in the request URL.
    const { data } = await supabase.from('profiles').select('*').eq('user_id', userId).order('created_at', { ascending: false })
    if (data) {
      const decrypted = await Promise.all(data.map(decryptProfile))
      setUserProfiles(p => ({ ...p, [userId]: decrypted }))
    }
    setLoadingProfiles(p => ({ ...p, [userId]: false }))
  }

  function toggleUser(userId) {
    if (expandedUser === userId) { setExpandedUser(null); return }
    setExpandedUser(userId)
    if (!userProfiles[userId]) loadUserProfiles(userId)
  }

  function toggleReveal(key) {
    setRevealedCards(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n })
  }

  // ── ACO helpers ────────────────────────────────────────────────────────
  function acoRate(u) {
    const isNew = u.aco_tier === 'new'
    const hasTag = u.tag_equipped !== false
    if (isNew) return hasTag ? 18 : 20
    return hasTag ? 15 : 17
  }

  async function updateUserField(userId, field, value) {
    setSavingTier(s => ({ ...s, [userId]: true }))
    await supabase.from('user_profiles').update({ [field]: value }).eq('id', userId)
    await loadUsers()
    setSavingTier(s => ({ ...s, [userId]: false }))
  }

  // ── Profile selection ──────────────────────────────────────────────────
  function toggleProfileSelect(userId, profileId) {
    setSelectedProfiles(prev => {
      const current = new Set(prev[userId] || [])
      current.has(profileId) ? current.delete(profileId) : current.add(profileId)
      return { ...prev, [userId]: current }
    })
  }

  function selectAll(userId) {
    const allIds = (userProfiles[userId] || []).map(p => p.id)
    setSelectedProfiles(prev => ({ ...prev, [userId]: new Set(allIds) }))
  }

  function selectNone(userId) {
    setSelectedProfiles(prev => ({ ...prev, [userId]: new Set() }))
  }

  function getSelected(userId) {
    return selectedProfiles[userId] || new Set()
  }

  // ── Bulk assign selected profiles ──────────────────────────────────────
  async function assignSelectedProfiles(userId, adminId) {
    const selected = getSelected(userId)
    if (!selected.size) return
    setSavingAssign(true)
    setAssigningFor(userId)

    await supabase.from('profiles')
      .update({ assigned_admin: adminId || null })
      .in('id', [...selected])

    await loadUserProfiles(userId)
    selectNone(userId)
    setSavingAssign(false)
    setAssigningFor(null)
  }

  // ── Profile editing ────────────────────────────────────────────────────
  function openEditProfile(profile, userId) {
    setEditForm({ ...EMPTY_PROFILE, ...profile })
    setEditProfileId(profile.id)
    setEditUserId(userId)
    setEditModal(true)
  }

  async function saveEditProfile() {
    setSavingProfile(true)
    const encrypted = await encryptProfile({ ...editForm, user_id: editUserId })
    await supabase.from('profiles').update(encrypted).eq('id', editProfileId)
    await loadUserProfiles(editUserId)
    setEditModal(false)
    setSavingProfile(false)
  }

  // ── CSV export ─────────────────────────────────────────────────────────
  function exportCSV(profilesArr, filename) {
    const rows = profilesArr.map(p => ({
      PROFILE_NAME: p.profile_name, EMAIL: p.email, PHONE: p.phone,
      SHIPPING_FIRST_NAME: p.shipping_first_name, SHIPPING_LAST_NAME: p.shipping_last_name,
      SHIPPING_ADDRESS: p.shipping_address, SHIPPING_ADDRESS_2: p.shipping_address_2,
      SHIPPING_CITY: p.shipping_city, SHIPPING_ZIP: p.shipping_zip,
      SHIPPING_STATE: p.shipping_state, SHIPPING_COUNTRY: p.shipping_country,
      BILLING_FIRST_NAME: p.billing_same_as_shipping ? p.shipping_first_name : p.billing_first_name,
      BILLING_LAST_NAME: p.billing_same_as_shipping ? p.shipping_last_name : p.billing_last_name,
      BILLING_ADDRESS: p.billing_same_as_shipping ? p.shipping_address : p.billing_address,
      BILLING_ADDRESS_2: p.billing_same_as_shipping ? p.shipping_address_2 : p.billing_address_2,
      BILLING_CITY: p.billing_same_as_shipping ? p.shipping_city : p.billing_city,
      BILLING_ZIP: p.billing_same_as_shipping ? p.shipping_zip : p.billing_zip,
      BILLING_STATE: p.billing_same_as_shipping ? p.shipping_state : p.billing_state,
      BILLING_COUNTRY: p.billing_same_as_shipping ? p.shipping_country : p.billing_country,
      BILLING_SAME_AS_SHIPPING: p.billing_same_as_shipping ? 'TRUE' : 'FALSE',
      CARD_HOLDER_NAME: p.card_holder_name, CARD_TYPE: p.card_type,
      CARD_NUMBER: p.card_number, CARD_MONTH: p.card_month,
      CARD_YEAR: p.card_year, CARD_CVV: p.card_cvv,
      ONE_CHECKOUT_PER_PROFILE: p.one_checkout_per_profile ? 'TRUE' : 'FALSE',
    }))
    const csv = Papa.unparse(rows)
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = filename; a.click()
    URL.revokeObjectURL(url)
  }

  async function exportAllProfiles() {
    // FIX (Security Fix 2): Changed join from user_profiles to selecting only username
    // via explicit field — avoids exposing full user_profiles row in join response.
    const { data } = await supabase.from('profiles').select('*, user_profiles(username)')
    if (!data) return
    const decrypted = await Promise.all(data.map(decryptProfile))
    exportCSV(decrypted, `all_profiles_${format(new Date(), 'yyyy-MM-dd')}.csv`)
  }

  // ── Cybersole CSV export ───────────────────────────────────────────────
  function countryName(code) {
    // Map common short codes to full names Cybersole expects
    if (!code) return ''
    if (code.toUpperCase() === 'GB') return 'United Kingdom'
    if (code.toUpperCase() === 'US') return 'United States'
    if (code.toUpperCase() === 'DE') return 'Germany'
    if (code.toUpperCase() === 'FR') return 'France'
    if (code.toUpperCase() === 'IT') return 'Italy'
    if (code.toUpperCase() === 'ES') return 'Spain'
    if (code.toUpperCase() === 'NL') return 'Netherlands'
    if (code.toUpperCase() === 'CA') return 'Canada'
    if (code.toUpperCase() === 'AU') return 'Australia'
    return code // leave anything else as-is
  }

  function exportCybersoleCSV(profilesArr, filename) {
    const rows = profilesArr.map(p => {
      const billingSame = p.billing_same_as_shipping
      const deliveryCountry = countryName(p.shipping_country)
      const billingCountry  = countryName(billingSame ? p.shipping_country : p.billing_country)

      return {
        'Profile Name':       p.profile_name,
        'Email':              p.email,
        'Phone':              p.phone,
        'Card Number':        p.card_number,
        'Card Exp Month':     p.card_month,
        'Card Exp Year':      p.card_year,
        'Card CVV':           p.card_cvv,
        'Delivery First Name': p.shipping_first_name,
        'Delivery Last Name':  p.shipping_last_name,
        'Delivery Address 1':  p.shipping_address,
        'Delivery Address 2':  p.shipping_address_2 || '',
        'Delivery City':       p.shipping_city,
        'Delivery ZIP':        p.shipping_zip,
        'Delivery Country':    deliveryCountry,
        'Delivery State':      p.shipping_state || '',
        'Different Billing':   billingSame ? 'false' : 'true',
        'Billing First Name':  billingSame ? p.shipping_first_name : p.billing_first_name,
        'Billing Last Name':   billingSame ? p.shipping_last_name  : p.billing_last_name,
        'Billing Address 1':   billingSame ? p.shipping_address    : p.billing_address,
        'Billing Address 2':   billingSame ? (p.shipping_address_2 || '') : (p.billing_address_2 || ''),
        'Billing City':        billingSame ? p.shipping_city       : p.billing_city,
        'Billing Zip':         billingSame ? p.shipping_zip        : p.billing_zip,
        'Billing Country':     billingCountry,
        'Billing State':       billingSame ? (p.shipping_state || '') : (p.billing_state || ''),
        'Passport / ID Number': '',  // not needed — left blank
      }
    })
    const csv  = Papa.unparse(rows)
    const blob = new Blob([csv], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url; a.download = filename; a.click()
    URL.revokeObjectURL(url)
  }

  async function exportAllCybersole() {
    // FIX (Security Fix 2): Join only fetches username field, not full user_profiles row.
    const { data } = await supabase.from('profiles').select('*, user_profiles(username)')
    if (!data) return
    const decrypted = await Promise.all(data.map(decryptProfile))
    exportCybersoleCSV(decrypted, `cybersole_all_${format(new Date(), 'yyyy-MM-dd')}.csv`)
  }

  // ── Invites ────────────────────────────────────────────────────────────
  async function createInvite() {
    const code = generateCode()
    const expires_at = addDays(new Date(), expiryDays).toISOString()
    await supabase.from('invite_codes').insert({
      code,
      created_by: user.id,
      expires_at,
      used: false,
      max_uses: maxUses,
      use_count: 0,
    })
    await loadInvites()
  }

  async function deleteInvite(id) {
    await supabase.from('invite_codes').delete().eq('id', id)
    await loadInvites()
  }

  function copyCode(code) {
    navigator.clipboard.writeText(code)
    setCopied(code)
    setTimeout(() => setCopied(null), 2000)
  }

  // ── User deletion ──────────────────────────────────────────────────────
  async function deleteUser(userId) {
    setDeletingUser(userId)
    // Call the secure deletion function which removes from auth.users
    await supabase.rpc('delete_user', { user_id: userId })
    setConfirmDelete(null)
    setDeletingUser(null)
    await loadUsers()
  }

  // ── Derived ────────────────────────────────────────────────────────────
  const regularUsers = users.filter(u => u.role !== 'admin')

  // My Members: users who have at least one profile assigned to me
  // We track this via the userProfiles cache — but for the tab we just show all regular users
  // and let the profile-level assignment speak for itself

  // ── Profile list inside a user card ───────────────────────────────────
  function ProfileList({ u }) {
    const profiles = userProfiles[u.id] || []
    const selected = getSelected(u.id)
    const allSelected = profiles.length > 0 && selected.size === profiles.length
    const someSelected = selected.size > 0 && !allSelected
    const isBusy = savingAssign && assigningFor === u.id

    // Group profiles by assigned admin
    const mine = profiles.filter(p => p.assigned_admin === user.id)
    const theirs = profiles.filter(p => p.assigned_admin && p.assigned_admin !== user.id)
    const unassigned = profiles.filter(p => !p.assigned_admin)

    return (
      <div className="mt-4 pt-4 border-t border-vault-border animate-fade-in">
        {loadingProfiles[u.id] ? (
          <div className="flex justify-center py-4">
            <div className="w-5 h-5 border-2 border-vault-accent border-t-transparent rounded-full animate-spin" />
          </div>
        ) : profiles.length === 0 ? (
          <p className="text-vault-muted text-sm font-body text-center py-4">No profiles yet</p>
        ) : (
          <div>
            {/* Toolbar */}
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              <p className="text-xs font-mono text-vault-muted">{profiles.length} profile{profiles.length !== 1 ? 's' : ''}</p>

              {/* Select all / none */}
              <button onClick={() => allSelected ? selectNone(u.id) : selectAll(u.id)}
                className="flex items-center gap-1.5 text-xs font-body text-vault-text-dim hover:text-vault-text transition-colors px-2 py-1 rounded hover:bg-vault-border">
                {allSelected ? <CheckSquare className="w-3.5 h-3.5 text-vault-accent" /> : <Square className="w-3.5 h-3.5" />}
                {allSelected ? 'Deselect all' : 'Select all'}
              </button>

              {/* Bulk assign bar — only shows when profiles are selected */}
              {selected.size > 0 && (
                <div className="flex items-center gap-2 ml-auto flex-wrap">
                  <span className="text-xs font-mono text-vault-accent">{selected.size} selected</span>
                  <span className="text-xs font-mono text-vault-muted">→ assign to:</span>
                  {admins.map(a => (
                    <button key={a.id}
                      onClick={() => assignSelectedProfiles(u.id, a.id)}
                      disabled={isBusy}
                      className={`text-xs font-body px-3 py-1.5 rounded-lg border transition-all
                        ${a.id === user.id
                          ? 'bg-vault-accent/10 text-vault-accent border-vault-accent/30 hover:bg-vault-accent/20'
                          : 'bg-vault-border text-vault-text-dim border-vault-border hover:text-vault-text'}`}>
                      {isBusy ? <RefreshCw className="w-3 h-3 animate-spin inline mr-1" /> : null}
                      {a.id === user.id ? `Me (${a.username})` : a.username}
                    </button>
                  ))}
                  <button onClick={() => assignSelectedProfiles(u.id, null)} disabled={isBusy}
                    className="text-xs font-body px-3 py-1.5 rounded-lg border border-vault-border text-vault-muted hover:text-vault-text hover:bg-vault-border transition-all">
                    Unassign
                  </button>
                </div>
              )}

              {/* Export */}
              {selected.size === 0 && (
                <div className="flex gap-1.5 ml-auto">
                  <button className="vault-btn-ghost text-xs px-3 py-1.5"
                    onClick={() => exportCybersoleCSV(profiles, `cybersole_${u.username}.csv`)}>
                    <Download className="w-3.5 h-3.5" /> Cybersole
                  </button>
                  <button className="vault-btn-ghost text-xs px-3 py-1.5"
                    onClick={() => exportCSV(profiles, `${u.username}_profiles.csv`)}>
                    <Download className="w-3.5 h-3.5" /> Export CSV
                  </button>
                </div>
              )}
            </div>

            {/* Export selected */}
            {selected.size > 0 && (
              <div className="flex gap-1.5 mb-3">
                <button className="vault-btn-ghost text-xs px-3 py-1.5 flex-1 justify-center"
                  onClick={() => exportCybersoleCSV(profiles.filter(p => selected.has(p.id)), `cybersole_${u.username}_selected.csv`)}>
                  <Download className="w-3.5 h-3.5" /> Cybersole ({selected.size})
                </button>
                <button className="vault-btn-ghost text-xs px-3 py-1.5 flex-1 justify-center"
                  onClick={() => exportCSV(profiles.filter(p => selected.has(p.id)), `${u.username}_selected.csv`)}>
                  <Download className="w-3.5 h-3.5" /> Export {selected.size} selected
                </button>
              </div>
            )}

            {/* Profile rows */}
            <div className="space-y-1.5">
              {profiles.map(p => {
                const cardKey = `${u.id}-${p.id}`
                const revealed = revealedCards.has(cardKey)
                const isSelected = selected.has(p.id)
                const assignedAdmin = admins.find(a => a.id === p.assigned_admin)

                return (
                  <div key={p.id}
                    onClick={() => toggleProfileSelect(u.id, p.id)}
                    className={`flex items-center gap-3 rounded-lg px-3 py-2.5 cursor-pointer transition-all
                      ${isSelected
                        ? 'bg-vault-accent/10 border border-vault-accent/30'
                        : 'bg-vault-bg border border-transparent hover:border-vault-border'}`}>

                    {/* Checkbox */}
                    <div className="shrink-0" onClick={e => e.stopPropagation()}>
                      <button onClick={() => toggleProfileSelect(u.id, p.id)}
                        className={`w-4 h-4 rounded border flex items-center justify-center transition-all
                          ${isSelected ? 'bg-vault-accent border-vault-accent' : 'border-vault-muted bg-transparent hover:border-vault-accent'}`}>
                        {isSelected && <Check className="w-2.5 h-2.5 text-vault-bg" />}
                      </button>
                    </div>

                    {/* Profile info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-display text-vault-text">{p.profile_name}</p>
                        {/* Assignment badge */}
                        {assignedAdmin && (
                          <span className={`vault-badge border text-[10px]
                            ${assignedAdmin.id === user.id
                              ? 'text-vault-accent bg-vault-accent/10 border-vault-accent/20'
                              : 'text-vault-gold bg-vault-gold/10 border-vault-gold/20'}`}>
                            {assignedAdmin.id === user.id ? `Mine` : assignedAdmin.username}
                          </span>
                        )}
                        {!p.assigned_admin && (
                          <span className="vault-badge border text-[10px] text-vault-muted bg-vault-border border-vault-border">
                            Unassigned
                          </span>
                        )}
                      </div>
                      <p className="text-xs font-mono text-vault-text-dim truncate">
                        {p.email} · {p.card_type} ···· {revealed ? p.card_number : (p.card_number?.slice(-4) || '????')}
                      </p>
                    </div>

                    <p className="text-xs font-mono text-vault-muted shrink-0">{p.shipping_country}</p>

                    {/* Row actions — stop propagation so clicks don't toggle checkbox */}
                    <div className="flex gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                      <button onClick={() => toggleReveal(cardKey)}
                        className="p-1 text-vault-muted hover:text-vault-text-dim transition-colors">
                        {revealed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                      <button onClick={() => openEditProfile(p, u.id)}
                        className="p-1 text-vault-muted hover:text-vault-accent transition-colors">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Summary of assignment split */}
            {(mine.length > 0 || theirs.length > 0) && (
              <div className="flex gap-3 mt-3 pt-3 border-t border-vault-border flex-wrap">
                {mine.length > 0 && (
                  <p className="text-[10px] font-mono text-vault-accent">
                    {mine.length} assigned to me
                  </p>
                )}
                {theirs.length > 0 && (
                  <p className="text-[10px] font-mono text-vault-gold">
                    {theirs.length} assigned to partner
                  </p>
                )}
                {unassigned.length > 0 && (
                  <p className="text-[10px] font-mono text-vault-muted">
                    {unassigned.length} unassigned
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  // ── User card ─────────────────────────────────────────────────────────
  function UserCard({ u }) {
    const isExpanded = expandedUser === u.id
    return (
      <div className="vault-card">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="w-9 h-9 rounded-full bg-vault-accent/10 border border-vault-accent/20 flex items-center justify-center text-vault-accent font-display text-sm shrink-0">
            {(u.username || '?')[0].toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-display text-vault-text">{u.username}</p>
              <span className={`vault-badge border text-[10px] ${u.aco_tier === 'new' ? 'text-vault-purple bg-vault-purple/10 border-vault-purple/20' : 'text-vault-accent bg-vault-accent/10 border-vault-accent/20'}`}>
                {u.aco_tier === 'new' ? 'New Member' : 'Existing'}
              </span>
              <span className={`vault-badge border text-[10px] ${u.tag_equipped !== false ? 'text-vault-green bg-vault-green/10 border-vault-green/20' : 'text-vault-red bg-vault-red/10 border-vault-red/20'}`}>
                {u.tag_equipped !== false ? '🏷️ Tag On' : 'No Tag'}
              </span>
              <span className="vault-badge border text-[10px] text-vault-gold bg-vault-gold/10 border-vault-gold/20">
                {acoRate(u)}% PAS
              </span>
            </div>
            <p className="text-vault-muted text-xs font-mono">Joined {u.created_at ? format(new Date(u.created_at), 'dd MMM yyyy') : '?'}</p>
          </div>

          {/* ACO controls */}
          <div className="flex items-center gap-2 shrink-0">
            <select className="vault-input text-xs py-1.5 px-2 w-28"
              value={u.aco_tier || 'existing'}
              onChange={e => updateUserField(u.id, 'aco_tier', e.target.value)}
              disabled={savingTier[u.id]}>
              <option value="existing">Existing</option>
              <option value="new">New Member</option>
            </select>
            <button onClick={() => updateUserField(u.id, 'tag_equipped', !(u.tag_equipped !== false))}
              disabled={savingTier[u.id]}
              title={u.tag_equipped !== false ? 'Tag on' : 'No tag'}
              className={`relative inline-flex w-10 h-5 rounded-full transition-colors duration-200 focus:outline-none shrink-0 ${u.tag_equipped !== false ? 'bg-vault-green' : 'bg-vault-border'}`}>
              <span className={`absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform duration-200 ${u.tag_equipped !== false ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
            <button onClick={() => toggleUser(u.id)} className="vault-btn-ghost text-xs px-3 py-1.5">
              {loadingProfiles[u.id] ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              Profiles
            </button>
            {/* Delete user */}
            <button onClick={() => setConfirmDelete(u)}
              className="p-1.5 text-vault-muted hover:text-vault-red rounded-lg hover:bg-vault-red/10 transition-all"
              title="Remove user from platform">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        {isExpanded && <ProfileList u={u} />}
      </div>
    )
  }

  // ── My Members tab — derived from profile-level assignments ───────────
  // Gather all users who have at least one profile assigned to current admin
  const usersWithMyProfiles = regularUsers.filter(u => {
    const profiles = userProfiles[u.id] || []
    return profiles.some(p => p.assigned_admin === user.id)
  })
  // Users whose profiles are all loaded and none assigned to me
  const usersWithNoMyProfiles = regularUsers.filter(u => {
    const profiles = userProfiles[u.id]
    if (!profiles) return false // not loaded yet
    return !profiles.some(p => p.assigned_admin === user.id)
  })

  return (
    <div className="max-w-4xl mx-auto animate-fade-in">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-vault-gold/10 border border-vault-gold/30 flex items-center justify-center glow-gold">
          <ShieldCheck className="w-5 h-5 text-vault-gold" />
        </div>
        <div>
          <h1 className="font-display text-3xl text-vault-gold tracking-wide neon-gold">ADMIN PANEL</h1>
          <p className="text-vault-text-dim text-sm font-body mt-0.5">Manage users, invites and data</p>
        </div>
        <div className="flex gap-2 ml-auto">
          <button className="vault-btn-ghost" onClick={exportAllCybersole}>
            <Download className="w-4 h-4" /> Cybersole
          </button>
          <button className="vault-btn-ghost" onClick={exportAllProfiles}>
            <Download className="w-4 h-4" /> Export All
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex bg-vault-surface border border-vault-border rounded-xl p-1 mb-6 gap-1 flex-wrap">
        {[
          ['my-members',  UserCheck, 'My Members'],
          ['all-members', Users,     'All Members'],
          ['invites',     KeyRound,  'Invite Codes'],
        ].map(([t, Icon, label]) => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-display tracking-wide transition-all
              ${tab === t ? 'bg-vault-accent text-vault-bg' : 'text-vault-text-dim hover:text-vault-text'}`}>
            <Icon className="w-4 h-4" />{label}
            {t === 'all-members' && <span className="font-mono text-[10px] opacity-70">{regularUsers.length}</span>}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-2 border-vault-accent border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {/* MY MEMBERS */}
          {tab === 'my-members' && (
            <div className="space-y-3">
              {/* Tip */}
              <div className="vault-card bg-vault-accent/5 border-vault-accent/20 py-3">
                <p className="text-xs font-mono text-vault-accent">
                  💡 Go to <strong>All Members</strong>, expand a user, select profiles using the checkboxes, then click <strong>Me</strong> to assign them to your list.
                </p>
              </div>

              {regularUsers.length === 0 ? (
                <div className="vault-card text-center py-12">
                  <Users className="w-8 h-8 text-vault-muted mx-auto mb-2" />
                  <p className="text-vault-text-dim text-sm">No members yet</p>
                </div>
              ) : (() => {
                // Auto-load all user profiles for this tab
                regularUsers.forEach(u => {
                  if (!userProfiles[u.id] && !loadingProfiles[u.id]) loadUserProfiles(u.id)
                })

                // Only show users who have profiles assigned to me
                const usersWithMine = regularUsers.filter(u =>
                  (userProfiles[u.id] || []).some(p => p.assigned_admin === user.id)
                )

                if (usersWithMine.length === 0) {
                  return (
                    <div className="vault-card text-center py-12">
                      <UserCheck className="w-8 h-8 text-vault-muted mx-auto mb-2" />
                      <p className="text-vault-text-dim text-sm">No profiles assigned to you yet</p>
                    </div>
                  )
                }

                // Total my profiles count
                const totalMyProfiles = usersWithMine.reduce((s, u) =>
                  s + (userProfiles[u.id] || []).filter(p => p.assigned_admin === user.id).length, 0)

                return (
                  <div>
                    {/* Search bar + summary */}
                    <div className="flex items-center gap-3 mb-4">
                      <div className="relative flex-1">
                        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-vault-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
                        <input
                          className="vault-input pl-9 text-sm"
                          placeholder="Search profiles by name or email..."
                          value={myMembersSearch}
                          onChange={e => setMyMembersSearch(e.target.value)}
                        />
                      </div>
                      <span className="text-xs font-mono text-vault-muted whitespace-nowrap">
                        {totalMyProfiles} profile{totalMyProfiles !== 1 ? 's' : ''} across {usersWithMine.length} user{usersWithMine.length !== 1 ? 's' : ''}
                      </span>
                    </div>

                    {/* Per-user collapsible groups */}
                    <div className="space-y-2">
                      {usersWithMine.map(u => {
                        const allMyProfiles = (userProfiles[u.id] || []).filter(p => p.assigned_admin === user.id)
                        // Filter by search
                        const filtered = myMembersSearch.trim()
                          ? allMyProfiles.filter(p =>
                              p.profile_name?.toLowerCase().includes(myMembersSearch.toLowerCase()) ||
                              p.email?.toLowerCase().includes(myMembersSearch.toLowerCase())
                            )
                          : allMyProfiles

                        if (filtered.length === 0 && myMembersSearch.trim()) return null

                        const isCollapsed = collapsedUsers.has(u.id)

                        function toggleCollapse() {
                          setCollapsedUsers(prev => {
                            const next = new Set(prev)
                            next.has(u.id) ? next.delete(u.id) : next.add(u.id)
                            return next
                          })
                        }

                        return (
                          <div key={u.id} className="vault-card">
                            {/* User header row */}
                            <div className="flex items-center gap-3">
                              <div className="w-9 h-9 rounded-full bg-vault-accent/10 border border-vault-accent/20 flex items-center justify-center text-vault-accent font-display text-sm shrink-0">
                                {(u.username || '?')[0].toUpperCase()}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="font-display text-vault-text">{u.username}</p>
                                <p className="text-vault-muted text-xs font-mono">
                                  {filtered.length}{myMembersSearch ? ` matching` : ''} of {allMyProfiles.length} profile{allMyProfiles.length !== 1 ? 's' : ''} assigned to you
                                </p>
                              </div>

                              {/* Actions */}
                              <div className="flex items-center gap-2 shrink-0">
                                {/* Cybersole export */}
                                <button
                                  onClick={() => exportCybersoleCSV(allMyProfiles, `cybersole_${u.username}.csv`)}
                                  className="vault-btn-ghost text-xs px-3 py-1.5"
                                  title="Export in Cybersole format">
                                  <Download className="w-3.5 h-3.5" /> Cybersole
                                </button>
                                {/* Standard export */}
                                <button
                                  onClick={() => exportCSV(allMyProfiles, `${u.username}_my_profiles.csv`)}
                                  className="vault-btn-ghost text-xs px-3 py-1.5"
                                  title="Export my assigned profiles for this user">
                                  <Download className="w-3.5 h-3.5" /> Export
                                </button>
                                {/* Manage → goes to All Members */}
                                <button onClick={() => {
                                  setTab('all-members')
                                  setTimeout(() => { setExpandedUser(u.id) }, 50)
                                }} className="vault-btn-ghost text-xs px-3 py-1.5">
                                  Manage →
                                </button>
                                {/* Collapse/expand toggle */}
                                <button onClick={toggleCollapse}
                                  className="p-1.5 text-vault-muted hover:text-vault-text rounded-lg hover:bg-vault-border transition-all">
                                  {isCollapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
                                </button>
                              </div>
                            </div>

                            {/* Profile list — collapses */}
                            {!isCollapsed && (
                              <div className="mt-3 pt-3 border-t border-vault-border space-y-1.5 animate-fade-in">
                                {filtered.length === 0 ? (
                                  <p className="text-vault-muted text-xs font-mono text-center py-2">No profiles match your search</p>
                                ) : filtered.map(p => (
                                  <div key={p.id} className="flex items-center gap-3 bg-vault-bg rounded-lg px-3 py-2.5 border border-vault-accent/10">
                                    <div className="flex-1 min-w-0">
                                      <p className="text-sm font-display text-vault-text">{p.profile_name}</p>
                                      <p className="text-xs font-mono text-vault-text-dim truncate">
                                        {p.email} · {p.card_type} ···· {p.card_number?.slice(-4) || '????'}
                                      </p>
                                    </div>
                                    <span className="text-xs font-mono text-vault-muted shrink-0">{p.shipping_country}</span>
                                    <button onClick={() => openEditProfile(p, u.id)}
                                      className="p-1 text-vault-muted hover:text-vault-accent transition-colors shrink-0">
                                      <Pencil className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })()}
            </div>
          )}

          {/* ALL MEMBERS */}
          {tab === 'all-members' && (
            <div className="space-y-2 stagger">
              {regularUsers.length === 0 ? (
                <div className="vault-card text-center py-12">
                  <Users className="w-10 h-10 text-vault-muted mx-auto mb-3" />
                  <p className="text-vault-text font-display">No members yet</p>
                </div>
              ) : regularUsers.map(u => <UserCard key={u.id} u={u} />)}
            </div>
          )}

          {/* INVITES */}
          {tab === 'invites' && (
            <div>
              <div className="vault-card mb-4">
                <p className="vault-label mb-3">Generate New Invite Code</p>
                <div className="grid grid-cols-3 gap-3 items-end">
                  <div>
                    <label className="vault-label">Expires in (days)</label>
                    <input className="vault-input" type="number" min="1" max="365"
                      value={expiryDays} onChange={e => setExpiryDays(+e.target.value)} />
                  </div>
                  <div>
                    <label className="vault-label">Max Uses</label>
                    <input className="vault-input" type="number" min="1" max="100"
                      value={maxUses} onChange={e => setMaxUses(+e.target.value)} />
                  </div>
                  <button className="vault-btn-primary" onClick={createInvite}>
                    <Plus className="w-4 h-4" /> Generate
                  </button>
                </div>
                <p className="text-vault-muted text-xs font-mono mt-2">
                  Set Max Uses &gt; 1 to let multiple people use the same code — useful for group onboarding
                </p>
              </div>
              <div className="space-y-2 stagger">
                {invites.length === 0 ? (
                  <div className="vault-card text-center py-10">
                    <KeyRound className="w-8 h-8 text-vault-muted mx-auto mb-2" />
                    <p className="text-vault-text font-display text-sm">No invite codes</p>
                  </div>
                ) : invites.map(inv => {
                  const expired = inv.expires_at && new Date(inv.expires_at) < new Date()
                  const useCount = inv.use_count || 0
                  const maxU = inv.max_uses || 1
                  const fullyUsed = inv.used || useCount >= maxU
                  const isMultiUse = maxU > 1
                  return (
                    <div key={inv.id} className={`vault-card flex items-center gap-3 ${fullyUsed || expired ? 'opacity-50' : ''}`}>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-mono font-semibold text-vault-text tracking-widest text-sm">{inv.code}</p>
                          {fullyUsed && <span className="vault-badge bg-vault-green/10 text-vault-green border border-vault-green/20 text-[10px]">used up</span>}
                          {expired && !fullyUsed && <span className="vault-badge bg-vault-red/10 text-vault-red border border-vault-red/20 text-[10px]">expired</span>}
                          {!fullyUsed && !expired && <span className="vault-badge bg-vault-accent/10 text-vault-accent border border-vault-accent/20 text-[10px]">active</span>}
                          {isMultiUse && (
                            <span className="vault-badge bg-vault-gold/10 text-vault-gold border border-vault-gold/20 text-[10px]">
                              {useCount}/{maxU} uses
                            </span>
                          )}
                        </div>
                        <p className="text-vault-muted text-xs font-mono mt-0.5">
                          Expires {inv.expires_at ? format(new Date(inv.expires_at), 'dd MMM yyyy') : 'never'}
                          {isMultiUse && ` · ${maxU - useCount} use${maxU - useCount !== 1 ? 's' : ''} remaining`}
                        </p>
                      </div>
                      {!fullyUsed && !expired && (
                        <button onClick={() => copyCode(inv.code)} className="vault-btn-ghost text-xs px-3 py-2">
                          {copied === inv.code ? <><Check className="w-3.5 h-3.5 text-vault-green" />Copied</> : <><Copy className="w-3.5 h-3.5" />Copy</>}
                        </button>
                      )}
                      <button onClick={() => deleteInvite(inv.id)}
                        className="p-2 text-vault-muted hover:text-vault-red rounded-lg hover:bg-vault-red/10 transition-all">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </>
      )}

      {/* PROFILE EDIT MODAL */}
      {editModal && createPortal(
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="vault-card w-full max-w-2xl flex flex-col animate-fade-in" style={{ maxHeight: '90vh' }}>
            <div className="flex items-center justify-between mb-5 shrink-0">
              <h2 className="font-display text-2xl text-vault-accent neon-cyan">EDIT PROFILE</h2>
              <button onClick={() => setEditModal(false)}><X className="w-5 h-5 text-vault-muted" /></button>
            </div>
            <div className="overflow-y-auto flex-1 pr-1 space-y-5">
              <section>
                <p className="text-[10px] font-mono text-vault-muted uppercase tracking-widest mb-3">Basic Info</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <PField label="Profile Name" name="profile_name" required form={editForm} setForm={setEditForm} />
                  <PField label="Email" name="email" type="email" form={editForm} setForm={setEditForm} />
                  <PField label="Phone" name="phone" form={editForm} setForm={setEditForm} />
                </div>
              </section>
              <section>
                <p className="text-[10px] font-mono text-vault-muted uppercase tracking-widest mb-3">Shipping</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <PField label="First Name" name="shipping_first_name" form={editForm} setForm={setEditForm} />
                  <PField label="Last Name" name="shipping_last_name" form={editForm} setForm={setEditForm} />
                  <div className="sm:col-span-2"><PField label="Address" name="shipping_address" form={editForm} setForm={setEditForm} /></div>
                  <PField label="Address 2" name="shipping_address_2" form={editForm} setForm={setEditForm} />
                  <PField label="City" name="shipping_city" form={editForm} setForm={setEditForm} />
                  <PField label="ZIP / Postcode" name="shipping_zip" form={editForm} setForm={setEditForm} />
                  <PField label="State / County" name="shipping_state" form={editForm} setForm={setEditForm} />
                  <PField label="Country" name="shipping_country" options={COUNTRIES} form={editForm} setForm={setEditForm} />
                </div>
              </section>
              <section>
                <div className="flex items-center gap-3 mb-3">
                  <button type="button" onClick={() => setEditForm(f => ({ ...f, billing_same_as_shipping: !f.billing_same_as_shipping }))}
                    className={`relative inline-flex w-11 h-6 rounded-full transition-colors duration-200 focus:outline-none ${editForm.billing_same_as_shipping ? 'bg-vault-accent' : 'bg-vault-border'}`}>
                    <span className={`absolute left-1 top-1 w-4 h-4 bg-white rounded-full shadow transition-transform duration-200 ${editForm.billing_same_as_shipping ? 'translate-x-5' : 'translate-x-0'}`} />
                  </button>
                  <span className="text-sm font-body text-vault-text-dim">Billing same as shipping</span>
                </div>
                {!editForm.billing_same_as_shipping && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <PField label="Billing First Name" name="billing_first_name" form={editForm} setForm={setEditForm} />
                    <PField label="Billing Last Name" name="billing_last_name" form={editForm} setForm={setEditForm} />
                    <div className="sm:col-span-2"><PField label="Billing Address" name="billing_address" form={editForm} setForm={setEditForm} /></div>
                    <PField label="Billing City" name="billing_city" form={editForm} setForm={setEditForm} />
                    <PField label="Billing ZIP" name="billing_zip" form={editForm} setForm={setEditForm} />
                    <PField label="Billing State" name="billing_state" form={editForm} setForm={setEditForm} />
                    <PField label="Billing Country" name="billing_country" options={COUNTRIES} form={editForm} setForm={setEditForm} />
                  </div>
                )}
              </section>
              <section>
                <p className="text-[10px] font-mono text-vault-muted uppercase tracking-widest mb-3">Card Details</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <PField label="Card Holder Name" name="card_holder_name" form={editForm} setForm={setEditForm} />
                  <PField label="Card Type" name="card_type" options={CARD_TYPES} form={editForm} setForm={setEditForm} />
                  <div className="sm:col-span-2"><PField label="Card Number" name="card_number" placeholder="4111 1111 1111 1111" form={editForm} setForm={setEditForm} /></div>
                  <PField label="Expiry Month (MM)" name="card_month" placeholder="01" form={editForm} setForm={setEditForm} />
                  <PField label="Expiry Year (YY)" name="card_year" placeholder="28" form={editForm} setForm={setEditForm} />
                  <PField label="CVV" name="card_cvv" placeholder="123" form={editForm} setForm={setEditForm} />
                </div>
              </section>
              <section>
                <div className="flex items-center gap-3">
                  <button type="button" onClick={() => setEditForm(f => ({ ...f, one_checkout_per_profile: !f.one_checkout_per_profile }))}
                    className={`relative inline-flex w-11 h-6 rounded-full transition-colors duration-200 focus:outline-none ${editForm.one_checkout_per_profile ? 'bg-vault-accent' : 'bg-vault-border'}`}>
                    <span className={`absolute left-1 top-1 w-4 h-4 bg-white rounded-full shadow transition-transform duration-200 ${editForm.one_checkout_per_profile ? 'translate-x-5' : 'translate-x-0'}`} />
                  </button>
                  <span className="text-sm font-body text-vault-text-dim">One checkout per profile</span>
                </div>
              </section>
            </div>
            <div className="flex justify-end gap-2 mt-5 pt-4 border-t border-vault-border shrink-0">
              <button className="vault-btn-ghost" onClick={() => setEditModal(false)}>Cancel</button>
              <button className="vault-btn-primary" onClick={saveEditProfile} disabled={savingProfile}>
                {savingProfile
                  ? <><div className="w-4 h-4 border-2 border-vault-bg border-t-transparent rounded-full animate-spin" />Saving...</>
                  : <><Save className="w-4 h-4" />Save Changes</>}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* CONFIRM DELETE USER MODAL */}
      {confirmDelete && createPortal(
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
          <div className="vault-card max-w-md w-full animate-fade-in border-vault-red/30">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-vault-red/10 border border-vault-red/30 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5 text-vault-red" />
              </div>
              <div>
                <h3 className="font-display text-xl text-vault-red">REMOVE USER</h3>
                <p className="text-vault-text-dim text-xs font-mono">This cannot be undone</p>
              </div>
            </div>

            <div className="bg-vault-bg rounded-xl p-4 mb-5 space-y-2 border border-vault-border">
              <div className="flex justify-between">
                <span className="text-vault-text-dim text-sm">Username</span>
                <span className="text-vault-text font-semibold text-sm">{confirmDelete.username}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-vault-text-dim text-sm">Joined</span>
                <span className="text-vault-text text-sm font-mono">{confirmDelete.created_at ? format(new Date(confirmDelete.created_at), 'dd MMM yyyy') : '?'}</span>
              </div>
            </div>

            <p className="text-vault-text-dim text-sm font-body mb-2">
              This will permanently delete their account from the platform. They will <strong className="text-vault-text">not</strong> be able to log back in with these credentials.
            </p>
            <p className="text-vault-muted text-xs font-mono mb-5">
              All their profiles, invoices, profit entries and expenses will also be deleted.
            </p>

            <div className="flex gap-2 justify-end">
              <button className="vault-btn-ghost" onClick={() => setConfirmDelete(null)}>Cancel</button>
              <button
                className="vault-btn-danger"
                onClick={() => deleteUser(confirmDelete.id)}
                disabled={deletingUser === confirmDelete.id}>
                {deletingUser === confirmDelete.id
                  ? <><div className="w-4 h-4 border-2 border-vault-red border-t-transparent rounded-full animate-spin" />Deleting...</>
                  : <><Trash2 className="w-4 h-4" />Remove User</>}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}

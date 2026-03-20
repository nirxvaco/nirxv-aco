import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { encryptProfile, decryptProfile, maskCard } from '../lib/crypto'
import { notifyDiscord } from '../lib/notify'
import Papa from 'papaparse'
import {
  Plus, Upload, Download, Pencil, Trash2, Eye, EyeOff,
  Search, CreditCard, ChevronDown, ChevronUp, X, Save, AlertTriangle,
  Shuffle, ChevronLeft, ChevronRight, Copy, Check, RefreshCw, Zap,
  LayoutList, Table2, Folder, FolderPlus, Send, CheckSquare, Square,
  Tag, Edit3
} from 'lucide-react'

// ── Address Jig Engine ────────────────────────────────────────────────────────
const PREFIXES = ['XC','ZD','KT','PL','NX','RV','BM','XQ','WP','LG','MR','JS','HV','TW','QR','YF','Ssc','Rvc']
const SUFFIXES = ['Xac','Wbt','Kpl','Znr','Qvx','Jmf']
const LINE2_OPTIONS = ['Lot A','Lot B','Lot C','Lot D','Lot E','Unit A','Unit B','Unit C','Apt 2','Apt 3','Apt 4','Suite 4','Suite 5','C2','C3','C4']
const LEET_MAP = { a:['4','@'], e:['3'], i:['1'], o:['0'], s:['5'], t:['7'] }
const SPECIAL_CHARS = ['#','!','.','@','$']
const JIG_COUNT = 5

function rnd(arr) { return arr[Math.floor(Math.random() * arr.length)] }
function insertAt(s, idx, ch) { return s.slice(0, idx) + ch + s.slice(idx) }
function parseAddress(address) {
  const parts = address.trim().split(' ')
  const num = parts[0]; const street = parts.slice(1).join(' ')
  if (!street) throw new Error('Address must start with a house number, e.g. 42 High Street')
  return [num, street]
}
function jigLight(house, street) {
  const prefix = rnd(PREFIXES); const words = street.split(' '); let jigged = house
  if (house.length >= 2 && Math.random() > 0.4) jigged = insertAt(house, Math.floor(Math.random()*(house.length-1))+1, '.')
  const jWords = words.map(w => { let m = w.toUpperCase(); if (w.length >= 3 && Math.random() > 0.3) m = insertAt(m, Math.floor(Math.random()*(w.length-1))+1, '.'); return m })
  return [`${prefix} ${jigged} ${jWords.join(' ')}`, rnd(LINE2_OPTIONS)]
}
function jigHeavy(house, street) {
  const prefix = rnd(PREFIXES)
  const transform = w => w.split('').map(ch => { const lc = ch.toLowerCase(); if (LEET_MAP[lc] && Math.random() > 0.3) return rnd(LEET_MAP[lc]); return ch.toUpperCase() }).join('')
  return [`${prefix} ${house} ${street.split(' ').map(transform).join(' ')}`, rnd(LINE2_OPTIONS)]
}
function jigSpecial(house, street) {
  const words = street.split(' ')
  const jWords = words.map(w => { const mod = w.split(''); const count = Math.min(2, w.length-1); const positions = [...Array(w.length-1).keys()].map(i=>i+1).sort(()=>Math.random()-0.5).slice(0,count); positions.sort((a,b)=>b-a).forEach(pos=>mod.splice(pos,0,rnd(SPECIAL_CHARS))); return mod.join('') })
  return [`${house} ${jWords.join(' ')} ${rnd(SUFFIXES)}`, rnd(LINE2_OPTIONS)]
}
function jigReversed(house, street) {
  const lot = rnd(LINE2_OPTIONS); const words = street.split(' ')
  if (words.length > 0) { const idx = Math.floor(Math.random()*words.length); const w = words[idx]; if (w.length>=3) { const dup=Math.floor(Math.random()*(w.length-1))+1; words[idx]=w.slice(0,dup)+w[dup]+w.slice(dup) } }
  const suffix = Math.random()>0.5?` ${rnd(SUFFIXES)}`:''
  return [`${lot} ${house} ${words.join(' ')}${suffix}`, null]
}
const JIG_FNS = { light: jigLight, heavy: jigHeavy, special: jigSpecial, reversed: jigReversed }
function generateVariants(address, style, count=JIG_COUNT) {
  const [house, street] = parseAddress(address); const fn = JIG_FNS[style]
  const results=[], seen=new Set(); let attempts=0
  while (results.length<count && attempts<count*15) { attempts++; const [l1,l2]=fn(house,street); const combined=l2?`${l1}\n${l2}`:l1; if(!seen.has(combined)){seen.add(combined);results.push({line1:l1,line2:l2})} }
  return results
}
const JIG_STYLES = {
  light:    { label: '🔅 Light',    desc: 'Prefix + decimal insertions. Clean and subtle.' },
  heavy:    { label: '🔆 Heavy',    desc: 'Leet number substitutions + LOT/APT line 2.' },
  special:  { label: '⚡ Special',  desc: 'Punctuation injected mid-word + suffix.' },
  reversed: { label: '🔀 Reversed', desc: 'LOT prefix before house number.' },
}

const GROUP_COLOURS = [
  '#00c8ff','#00e396','#ffe600','#ff4b4b','#b44fff',
  '#ff9500','#ff6bcb','#7a8aff','#00d4aa','#ff6b35',
]

// ── All editable fields for bulk edit ────────────────────────────────────────
const BULK_EDIT_FIELDS = [
  { key: 'profile_name',        label: 'Profile Name',       type: 'text' },
  { key: 'email',               label: 'Email',              type: 'email' },
  { key: 'phone',               label: 'Phone',              type: 'text' },
  { key: 'shipping_first_name', label: 'Shipping First Name',type: 'text' },
  { key: 'shipping_last_name',  label: 'Shipping Last Name', type: 'text' },
  { key: 'shipping_address',    label: 'Shipping Address',   type: 'text' },
  { key: 'shipping_address_2',  label: 'Shipping Address 2', type: 'text' },
  { key: 'shipping_city',       label: 'Shipping City',      type: 'text' },
  { key: 'shipping_zip',        label: 'Shipping ZIP',       type: 'text' },
  { key: 'shipping_state',      label: 'Shipping State',     type: 'text' },
  { key: 'card_holder_name',    label: 'Card Holder Name',   type: 'text' },
  { key: 'card_type',           label: 'Card Type',          type: 'select', options: ['Visa','Mastercard','Amex','Discover','Other'] },
  { key: 'card_number',         label: 'Card Number',        type: 'text' },
  { key: 'card_month',          label: 'Expiry Month (MM)',  type: 'text' },
  { key: 'card_year',           label: 'Expiry Year (YY)',   type: 'text' },
  { key: 'card_cvv',            label: 'CVV',                type: 'text' },
  { key: 'billing_first_name',  label: 'Billing First Name', type: 'text' },
  { key: 'billing_last_name',   label: 'Billing Last Name',  type: 'text' },
  { key: 'billing_address',     label: 'Billing Address',    type: 'text' },
  { key: 'billing_city',        label: 'Billing City',       type: 'text' },
  { key: 'billing_zip',         label: 'Billing ZIP',        type: 'text' },
  { key: 'billing_state',       label: 'Billing State',      type: 'text' },
]

function JigTool({ currentAddress, onApply }) {
  const [open,setOpen]=useState(false); const [style,setStyle]=useState('light'); const [variants,setVariants]=useState([]); const [page,setPage]=useState(0); const [copied,setCopied]=useState(false); const [error,setError]=useState('')
  function generate(s=style,addr=currentAddress) { setError(''); try { setVariants(generateVariants(addr,s)); setPage(0) } catch(e) { setError(e.message) } }
  function switchStyle(s) { setStyle(s); if(variants.length>0) generate(s) }
  function applyVariant(v) { onApply(v.line1,v.line2||''); setOpen(false) }
  function copyVariant(v) { const text=v.line2?`${v.line1}\n${v.line2}`:v.line1; navigator.clipboard.writeText(text); setCopied(true); setTimeout(()=>setCopied(false),2000) }
  const current=variants[page]
  if (!open) return (<button type="button" onClick={()=>{setOpen(true);generate(style,currentAddress)}} className="flex items-center gap-1.5 text-xs font-body font-medium text-vault-purple hover:text-vault-purple/80 transition-colors mt-1"><Shuffle className="w-3.5 h-3.5"/>Jig this address</button>)
  return (
    <div className="mt-2 rounded-xl border border-vault-purple/30 bg-vault-purple/5 p-4 animate-fade-in">
      <div className="flex items-center justify-between mb-3"><div className="flex items-center gap-2"><Shuffle className="w-4 h-4 text-vault-purple"/><p className="text-sm font-display text-vault-purple tracking-wide">ADDRESS JIG</p></div><button onClick={()=>setOpen(false)} className="text-vault-muted hover:text-vault-text transition-colors"><X className="w-4 h-4"/></button></div>
      <div className="flex gap-1 mb-3 flex-wrap">{Object.entries(JIG_STYLES).map(([k,v])=>(<button key={k} type="button" onClick={()=>switchStyle(k)} className={`text-xs font-body px-2.5 py-1 rounded-lg border transition-all ${style===k?'bg-vault-purple/20 text-vault-purple border-vault-purple/40':'text-vault-text-dim border-vault-border hover:text-vault-text hover:bg-vault-border'}`}>{v.label}</button>))}</div>
      {error&&<p className="text-vault-red text-xs font-mono mb-3">{error}</p>}
      {variants.length>0&&current&&(<><div className="bg-vault-bg rounded-lg p-3 border border-vault-border mb-3"><p className="font-mono text-vault-text text-sm">{current.line1}</p>{current.line2&&<p className="font-mono text-vault-text-dim text-sm">{current.line2}</p>}<p className="text-[10px] font-mono text-vault-muted mt-1">{JIG_STYLES[style].desc}</p></div><div className="flex items-center gap-2 flex-wrap"><button type="button" onClick={()=>setPage(p=>Math.max(0,p-1))} disabled={page===0} className="p-1.5 text-vault-muted hover:text-vault-text disabled:opacity-30 rounded hover:bg-vault-border transition-all"><ChevronLeft className="w-4 h-4"/></button><span className="text-xs font-mono text-vault-muted">{page+1}/{variants.length}</span><button type="button" onClick={()=>setPage(p=>Math.min(variants.length-1,p+1))} disabled={page===variants.length-1} className="p-1.5 text-vault-muted hover:text-vault-text disabled:opacity-30 rounded hover:bg-vault-border transition-all"><ChevronRight className="w-4 h-4"/></button><button type="button" onClick={()=>generate()} className="vault-btn-ghost text-xs px-2.5 py-1.5 ml-1"><RefreshCw className="w-3 h-3"/> Regenerate</button><button type="button" onClick={()=>copyVariant(current)} className="vault-btn-ghost text-xs px-2.5 py-1.5">{copied?<><Check className="w-3 h-3 text-vault-green"/> Copied</>:<><Copy className="w-3 h-3"/> Copy</>}</button><button type="button" onClick={()=>applyVariant(current)} className="vault-btn-primary text-xs px-3 py-1.5 ml-auto"><Zap className="w-3 h-3"/> Apply to form</button></div><div className="mt-3 pt-3 border-t border-vault-border/50 space-y-1">{variants.map((v,i)=>(<button key={i} type="button" onClick={()=>setPage(i)} className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-mono transition-all ${i===page?'bg-vault-purple/10 text-vault-purple border border-vault-purple/20':'text-vault-text-dim hover:bg-vault-border hover:text-vault-text'}`}>{i+1}. {v.line1}{v.line2?` / ${v.line2}`:''}</button>))}</div></>)}
    </div>
  )
}

function Field({ label, name, type='text', required, options, placeholder, form, errors, setForm }) {
  const err = errors[name]
  return (
    <div>
      <label className="vault-label">{label}{required&&<span className="text-vault-red ml-1">*</span>}</label>
      {options?(<select className="vault-input" value={form[name]} onChange={e=>setForm(f=>({...f,[name]:e.target.value}))}>{options.map(o=><option key={o} value={o}>{o}</option>)}</select>):(<input className={`vault-input ${err?'border-vault-red':''}`} type={type} placeholder={placeholder} value={form[name]} onChange={e=>setForm(f=>({...f,[name]:e.target.value}))}/>)}
      {err&&<p className="text-vault-red text-xs mt-1 font-mono">{err}</p>}
    </div>
  )
}

const EMPTY_PROFILE = {
  profile_name:'',email:'',phone:'',
  shipping_first_name:'',shipping_last_name:'',shipping_address:'',
  shipping_address_2:'',shipping_city:'',shipping_zip:'',
  shipping_state:'',shipping_country:'GB',
  billing_same_as_shipping:true,
  billing_first_name:'',billing_last_name:'',billing_address:'',
  billing_address_2:'',billing_city:'',billing_zip:'',
  billing_state:'',billing_country:'GB',
  card_holder_name:'',card_type:'Visa',card_number:'',
  card_month:'',card_year:'',card_cvv:'',
  one_checkout_per_profile:true,is_virtual_card:false,group_id:null,
}
const CARD_TYPES = ['Visa','Mastercard','Amex','Discover','Other']

function EditableCell({ value, onSave, type='text', options, masked=false, revealed=false }) {
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState(value || '')
  function commit() { setEditing(false); if (val !== value) onSave(val) }
  if (masked && !revealed) return (<div onClick={() => setEditing(true)} className="px-2 py-1 rounded cursor-pointer hover:bg-vault-border/50 font-mono text-xs text-vault-text-dim">{value ? '•••• •••• •••• ' + String(value).slice(-4) : '—'}</div>)
  if (editing) {
    if (options) return (<select autoFocus className="w-full bg-vault-bg border border-vault-accent rounded px-2 py-1 text-xs text-vault-text font-mono focus:outline-none" value={val} onChange={e=>setVal(e.target.value)} onBlur={commit}>{options.map(o=><option key={o} value={o}>{o}</option>)}</select>)
    return (<input autoFocus type={type} className="w-full bg-vault-bg border border-vault-accent rounded px-2 py-1 text-xs text-vault-text font-mono focus:outline-none" value={val} onChange={e=>setVal(e.target.value)} onBlur={commit} onKeyDown={e=>{if(e.key==='Enter')commit();if(e.key==='Escape'){setVal(value||'');setEditing(false)}}}/>)
  }
  return (<div onClick={()=>setEditing(true)} className="px-2 py-1 rounded cursor-pointer hover:bg-vault-border/50 text-xs text-vault-text font-mono truncate min-w-[60px]" title={value}>{value||<span className="text-vault-muted">—</span>}</div>)
}

export default function ProfilesPage() {
  const { user, profile: userProfile } = useAuth()
  const [profiles, setProfiles] = useState([])
  const [groups, setGroups] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [view, setView] = useState('list')
  const [selectedGroup, setSelectedGroup] = useState(null)
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(EMPTY_PROFILE)
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const [revealedCards, setRevealedCards] = useState(new Set())
  const [expandedId, setExpandedId] = useState(null)
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false)
  const [importLoading, setImportLoading] = useState(false)

  // Group modal
  const [groupModal, setGroupModal] = useState(false)
  const [groupForm, setGroupForm] = useState({ name: '', colour: '#00c8ff' })
  const [editingGroupId, setEditingGroupId] = useState(null)
  const [savingGroup, setSavingGroup] = useState(false)

  // Bulk assign group modal
  const [assignGroupModal, setAssignGroupModal] = useState(false)
  const [assigningGroupId, setAssigningGroupId] = useState(null)

  // Bulk submit to drop modal
  const [dropModal, setDropModal] = useState(false)
  const [openDrops, setOpenDrops] = useState([])
  const [selectedDropId, setSelectedDropId] = useState(null)
  const [submittingDrop, setSubmittingDrop] = useState(false)

  // ── Bulk edit modal ───────────────────────────────────────────────────────
  const [bulkEditModal, setBulkEditModal] = useState(false)
  const [bulkEditField, setBulkEditField] = useState(BULK_EDIT_FIELDS[0].key)
  const [bulkEditValue, setBulkEditValue] = useState('')
  const [bulkEditing, setBulkEditing] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: profileData }, { data: groupData }] = await Promise.all([
      supabase.from('profiles').select('*').eq('user_id', user.id).order('created_at', { ascending: false }),
      supabase.from('profile_groups').select('*').eq('user_id', user.id).order('created_at', { ascending: true }),
    ])
    if (profileData) {
      const decrypted = await Promise.all(profileData.map(decryptProfile))
      setProfiles(decrypted)
    }
    setGroups(groupData || [])
    setLoading(false)
  }, [user.id])

  useEffect(() => { load() }, [load])

  // ── Groups CRUD ───────────────────────────────────────────────────────────
  async function saveGroup() {
    if (!groupForm.name.trim()) return
    setSavingGroup(true)
    if (editingGroupId) {
      await supabase.from('profile_groups').update({ name: groupForm.name, colour: groupForm.colour }).eq('id', editingGroupId)
    } else {
      await supabase.from('profile_groups').insert({ name: groupForm.name, colour: groupForm.colour, user_id: user.id })
    }
    await load()
    setGroupModal(false); setGroupForm({ name: '', colour: '#00c8ff' }); setEditingGroupId(null); setSavingGroup(false)
  }

  async function deleteGroup(id) {
    await supabase.from('profiles').update({ group_id: null }).eq('group_id', id)
    await supabase.from('profile_groups').delete().eq('id', id)
    if (selectedGroup === id) setSelectedGroup(null)
    await load()
  }

  function openEditGroup(g) { setGroupForm({ name: g.name, colour: g.colour }); setEditingGroupId(g.id); setGroupModal(true) }

  // ── Bulk actions ──────────────────────────────────────────────────────────
  function toggleSelect(id) { setSelectedIds(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next }) }

  function toggleSelectAll() {
    if (selectedIds.size === filtered.length) setSelectedIds(new Set())
    else setSelectedIds(new Set(filtered.map(p => p.id)))
  }

  async function bulkDelete() {
    for (const id of selectedIds) await supabase.from('profiles').delete().eq('id', id)
    setSelectedIds(new Set()); setBulkDeleteConfirm(false); await load()
  }

  async function bulkAssignGroup() {
    for (const id of selectedIds) await supabase.from('profiles').update({ group_id: assigningGroupId }).eq('id', id)
    setSelectedIds(new Set()); setAssignGroupModal(false); setAssigningGroupId(null); await load()
  }

  function bulkExport() { exportCSV(profiles.filter(p => selectedIds.has(p.id))) }

  async function loadOpenDrops() {
    const { data } = await supabase.from('drops').select('id, name, site').in('status', ['open', 'restock']).order('created_at', { ascending: false })
    setOpenDrops(data || []); setDropModal(true)
  }

  async function bulkSubmitToDrop() {
    if (!selectedDropId) return
    setSubmittingDrop(true)
    const selectedProfileObjs = profiles.filter(p => selectedIds.has(p.id))
    const profileIds = selectedProfileObjs.map(p => p.id)
    const profileNames = selectedProfileObjs.map(p => p.profile_name)
    const payload = { drop_id: selectedDropId, user_id: user.id, profile_ids: JSON.stringify(profileIds), profile_names: JSON.stringify(profileNames), selected_items: JSON.stringify([]), notes: '', submitted_at: new Date().toISOString() }
    await supabase.from('drop_submissions').upsert(payload, { onConflict: 'drop_id,user_id' })
    const drop = openDrops.find(d => d.id === selectedDropId)
    notifyDiscord('drop_signup', { drop_name: drop?.name, profile_count: profileIds.length, profile_names: profileNames }, userProfile?.username)
    setDropModal(false); setSelectedDropId(null); setSelectedIds(new Set()); setSubmittingDrop(false)
  }

  // ── Bulk edit ─────────────────────────────────────────────────────────────
  async function handleBulkEdit() {
    if (!bulkEditValue.trim() && bulkEditValue !== '') return
    setBulkEditing(true)
    const selectedProfiles = profiles.filter(p => selectedIds.has(p.id))
    for (const p of selectedProfiles) {
      const updated = { ...p, [bulkEditField]: bulkEditValue }
      const encrypted = await encryptProfile({ ...updated, user_id: user.id })
      await supabase.from('profiles').update(encrypted).eq('id', p.id)
    }
    await load()
    setBulkEditModal(false)
    setBulkEditValue('')
    setBulkEditing(false)
  }

  const selectedFieldDef = BULK_EDIT_FIELDS.find(f => f.key === bulkEditField)

  // ── Duplicate profile ─────────────────────────────────────────────────────
  async function duplicateProfile(p) {
    const duplicate = {
      ...p,
      profile_name: `${p.profile_name} (Copy)`,
      user_id: user.id,
    }
    delete duplicate.id
    delete duplicate.created_at
    const encrypted = await encryptProfile(duplicate)
    await supabase.from('profiles').insert(encrypted)
    await load()
  }

  // ── Spreadsheet inline save ───────────────────────────────────────────────
  async function saveCell(profileId, field, value) {
    const p = profiles.find(x => x.id === profileId)
    if (!p) return
    const updated = { ...p, [field]: value }
    const encrypted = await encryptProfile({ ...updated, user_id: user.id })
    await supabase.from('profiles').update(encrypted).eq('id', profileId)
    setProfiles(prev => prev.map(x => x.id === profileId ? { ...x, [field]: value } : x))
  }

  // ── Validation ────────────────────────────────────────────────────────────
  function validate(f) {
    const e = {}; const now = new Date(); const cleanCard = f.card_number.replace(/\s/g,'')
    if (!f.profile_name.trim()) e.profile_name = 'Required'
    if (!f.shipping_first_name.trim()) e.shipping_first_name = 'Required'
    if (!f.shipping_last_name.trim()) e.shipping_last_name = 'Required'
    if (!f.shipping_address.trim()) e.shipping_address = 'Required'
    if (!f.shipping_city.trim()) e.shipping_city = 'Required'
    if (!f.shipping_zip.trim()) e.shipping_zip = 'Required'
    if (!f.card_holder_name.trim()) e.card_holder_name = 'Required'
    if (!f.email.trim()||!/\S+@\S+\.\S+/.test(f.email)) e.email='Valid email required'
    const cleanPhone=f.phone.replace(/\s/g,'')
    if (!cleanPhone) e.phone='Phone number required'
    else if (!/^07\d{9}$/.test(cleanPhone)) e.phone='Must be 11 digits starting with 07'
    if (!cleanCard||cleanCard.length<13) e.card_number='Invalid card number'
    if (f.card_type==='Visa'&&cleanCard&&cleanCard[0]!=='4') e.card_number='Visa card numbers must start with 4'
    if (f.card_type==='Mastercard'&&cleanCard&&cleanCard[0]!=='5') e.card_number='Mastercard numbers must start with 5'
    const month=parseInt(f.card_month,10)
    if (!f.card_month||isNaN(month)||month<1||month>12) e.card_month='Enter month 01–12'
    const yearStr=f.card_year?.trim()
    if (!yearStr||yearStr.length<2) e.card_year='Enter expiry year (e.g. 28)'
    else { const fullYear=yearStr.length===2?2000+parseInt(yearStr,10):parseInt(yearStr,10); const expiry=new Date(fullYear,month-1,1); const firstOfThisMonth=new Date(now.getFullYear(),now.getMonth(),1); if(expiry<firstOfThisMonth){e.card_year='This card has expired';if(!e.card_month)e.card_month='Card expired'} }
    if (!f.card_cvv||f.card_cvv.length<3||f.card_cvv.length>4) e.card_cvv='3 or 4 digits'
    return e
  }

  async function crossValidate(f) {
    const e = {}; const cleanCard=f.card_number.replace(/\s/g,''); const cleanPhone=f.phone.replace(/\s/g,'')
    const others=profiles.filter(p=>p.id!==editingId)
    const dupEmail=others.find(p=>p.email?.trim().toLowerCase()===f.email.trim().toLowerCase())
    if (dupEmail) e.email=`This email is already used on "${dupEmail.profile_name}"`
    const dupPhone=others.find(p=>p.phone?.replace(/\s/g,'')===cleanPhone)
    if (dupPhone) e.phone=`This number is already used on "${dupPhone.profile_name}"`
    const dupCard=others.find(p=>p.card_number?.replace(/\s/g,'')===cleanCard)
    if (dupCard) e.card_number=`This card is already used on "${dupCard.profile_name}"`
    const firstName=f.shipping_first_name.trim().toLowerCase(); const lastName=f.shipping_last_name.trim().toLowerCase()
    const dupName=others.find(p=>p.shipping_first_name?.trim().toLowerCase()===firstName&&p.shipping_last_name?.trim().toLowerCase()===lastName)
    if (dupName) e.shipping_first_name=`Name "${f.shipping_first_name} ${f.shipping_last_name}" already used on "${dupName.profile_name}"`
    return e
  }

  async function handleSave() {
    const formatErrors = validate(form)
    if (Object.keys(formatErrors).length) { setErrors(formatErrors); return }
    setSaving(true)
    const crossErrors = await crossValidate(form)
    if (Object.keys(crossErrors).length) { setErrors(crossErrors); setSaving(false); return }
    const encrypted = await encryptProfile({ ...form, user_id: user.id })
    if (editingId) {
      await supabase.from('profiles').update(encrypted).eq('id', editingId)
      notifyDiscord('profile_edited', { profile_name: form.profile_name, fields_changed: [] }, userProfile?.username)
    } else {
      await supabase.from('profiles').insert(encrypted)
      notifyDiscord('profile_added', { profile_name: form.profile_name, email: form.email, postcode: form.shipping_zip }, userProfile?.username)
    }
    await load(); closeModal(); setSaving(false)
  }

  function openNew() { setForm(EMPTY_PROFILE); setEditingId(null); setErrors({}); setModalOpen(true) }
  function openEdit(p) { setForm(p); setEditingId(p.id); setErrors({}); setModalOpen(true) }
  function closeModal() { setModalOpen(false); setEditingId(null); setForm(EMPTY_PROFILE); setErrors({}) }

  async function handleDelete(id) { await supabase.from('profiles').delete().eq('id', id); setDeleteConfirm(null); await load() }

  function toggleReveal(id) { setRevealedCards(prev => { const next=new Set(prev); next.has(id)?next.delete(id):next.add(id); return next }) }

  function exportCSV(profilesArr) {
    const rows = profilesArr.map(p => ({
      PROFILE_NAME:p.profile_name,EMAIL:p.email,PHONE:p.phone,
      SHIPPING_FIRST_NAME:p.shipping_first_name,SHIPPING_LAST_NAME:p.shipping_last_name,
      SHIPPING_ADDRESS:p.shipping_address,SHIPPING_ADDRESS_2:p.shipping_address_2,
      SHIPPING_CITY:p.shipping_city,SHIPPING_ZIP:p.shipping_zip,
      SHIPPING_STATE:p.shipping_state,SHIPPING_COUNTRY:p.shipping_country,
      BILLING_FIRST_NAME:p.billing_same_as_shipping?p.shipping_first_name:p.billing_first_name,
      BILLING_LAST_NAME:p.billing_same_as_shipping?p.shipping_last_name:p.billing_last_name,
      BILLING_ADDRESS:p.billing_same_as_shipping?p.shipping_address:p.billing_address,
      BILLING_ADDRESS_2:p.billing_same_as_shipping?p.shipping_address_2:p.billing_address_2,
      BILLING_CITY:p.billing_same_as_shipping?p.shipping_city:p.billing_city,
      BILLING_ZIP:p.billing_same_as_shipping?p.shipping_zip:p.billing_zip,
      BILLING_STATE:p.billing_same_as_shipping?p.shipping_state:p.billing_state,
      BILLING_COUNTRY:p.billing_same_as_shipping?p.shipping_country:p.billing_country,
      BILLING_SAME_AS_SHIPPING:p.billing_same_as_shipping?'TRUE':'FALSE',
      CARD_HOLDER_NAME:p.card_holder_name,CARD_TYPE:p.card_type,CARD_NUMBER:p.card_number,
      CARD_MONTH:p.card_month,CARD_YEAR:p.card_year,CARD_CVV:p.card_cvv,
      ONE_CHECKOUT_PER_PROFILE:p.one_checkout_per_profile?'TRUE':'FALSE',
    }))
    const csv=Papa.unparse(rows); const blob=new Blob([csv],{type:'text/csv'}); const url=URL.createObjectURL(blob)
    const a=document.createElement('a'); a.href=url; a.download='nirxv-aco_profiles.csv'; a.click(); URL.revokeObjectURL(url)
  }

  function handleImport(e) {
    const file=e.target.files[0]; if(!file) return; setImportLoading(true)
    Papa.parse(file,{header:true,skipEmptyLines:true,complete:async({data})=>{
      for (const row of data) {
        const p={profile_name:row.PROFILE_NAME||'',email:row.EMAIL||'',phone:row.PHONE||'',shipping_first_name:row.SHIPPING_FIRST_NAME||'',shipping_last_name:row.SHIPPING_LAST_NAME||'',shipping_address:row.SHIPPING_ADDRESS||'',shipping_address_2:row.SHIPPING_ADDRESS_2||'',shipping_city:row.SHIPPING_CITY||'',shipping_zip:row.SHIPPING_ZIP||'',shipping_state:row.SHIPPING_STATE||'',shipping_country:row.SHIPPING_COUNTRY||'',billing_same_as_shipping:row.BILLING_SAME_AS_SHIPPING==='TRUE',billing_first_name:row.BILLING_FIRST_NAME||'',billing_last_name:row.BILLING_LAST_NAME||'',billing_address:row.BILLING_ADDRESS||'',billing_address_2:row.BILLING_ADDRESS_2||'',billing_city:row.BILLING_CITY||'',billing_zip:row.BILLING_ZIP||'',billing_state:row.BILLING_STATE||'',billing_country:row.BILLING_COUNTRY||'',card_holder_name:row.CARD_HOLDER_NAME||'',card_type:row.CARD_TYPE||'Visa',card_number:row.CARD_NUMBER||'',card_month:row.CARD_MONTH||'',card_year:row.CARD_YEAR||'',card_cvv:row.CARD_CVV||'',one_checkout_per_profile:row.ONE_CHECKOUT_PER_PROFILE==='TRUE',user_id:user.id}
        if(p.profile_name){const encrypted=await encryptProfile(p);await supabase.from('profiles').insert(encrypted)}
      }
      await load(); setImportLoading(false)
    }})
    e.target.value=''
  }

  const filtered = profiles.filter(p => {
    const matchSearch = p.profile_name?.toLowerCase().includes(search.toLowerCase()) || p.email?.toLowerCase().includes(search.toLowerCase())
    const matchGroup = selectedGroup === null ? true : selectedGroup === 'ungrouped' ? !p.group_id : p.group_id === selectedGroup
    return matchSearch && matchGroup
  })

  const allSelected = filtered.length > 0 && selectedIds.size === filtered.length
  const someSelected = selectedIds.size > 0

  const SPREADSHEET_COLS = [
    { key: 'profile_name',        label: 'Name',      width: 120 },
    { key: 'email',               label: 'Email',     width: 160 },
    { key: 'phone',               label: 'Phone',     width: 110 },
    { key: 'shipping_first_name', label: 'First',     width: 80  },
    { key: 'shipping_last_name',  label: 'Last',      width: 80  },
    { key: 'shipping_address',    label: 'Address',   width: 160 },
    { key: 'shipping_city',       label: 'City',      width: 90  },
    { key: 'shipping_zip',        label: 'ZIP',       width: 80  },
    { key: 'card_type',           label: 'Card Type', width: 90, options: CARD_TYPES },
    { key: 'card_number',         label: 'Card #',    width: 150, masked: true },
    { key: 'card_month',          label: 'MM',        width: 50  },
    { key: 'card_year',           label: 'YY',        width: 50  },
    { key: 'card_cvv',            label: 'CVV',       width: 60, masked: true },
  ]

  return (
    <div className="max-w-7xl mx-auto animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 mb-4">
        <div>
          <h1 className="font-display text-3xl text-vault-accent neon-cyan">PROFILES</h1>
          <p className="text-vault-text-dim text-sm font-body mt-0.5">{profiles.length} profile{profiles.length!==1?'s':''} stored</p>
        </div>
        <div className="sm:ml-auto flex gap-2 flex-wrap items-center">
          <div className="flex rounded-lg border border-vault-border overflow-hidden">
            <button onClick={()=>setView('list')} className={`p-2 transition-all ${view==='list'?'bg-vault-accent/20 text-vault-accent':'text-vault-muted hover:text-vault-text'}`} title="List view"><LayoutList className="w-4 h-4"/></button>
            <button onClick={()=>setView('spreadsheet')} className={`p-2 transition-all ${view==='spreadsheet'?'bg-vault-accent/20 text-vault-accent':'text-vault-muted hover:text-vault-text'}`} title="Spreadsheet view"><Table2 className="w-4 h-4"/></button>
          </div>
          <label className={`vault-btn-ghost cursor-pointer ${importLoading?'opacity-50':''}`}>
            <Upload className="w-4 h-4"/>{importLoading?'Importing...':'Import CSV'}
            <input type="file" accept=".csv" className="hidden" onChange={handleImport} disabled={importLoading}/>
          </label>
          <button className="vault-btn-ghost" onClick={()=>exportCSV(profiles)} disabled={!profiles.length}><Download className="w-4 h-4"/> Export CSV</button>
          <button className="vault-btn-ghost" onClick={()=>setGroupModal(true)}><FolderPlus className="w-4 h-4"/> New Group</button>
          <button className="vault-btn-primary" onClick={openNew}><Plus className="w-4 h-4"/> New Profile</button>
        </div>
      </div>

      <div className="flex gap-4">
        {/* Groups sidebar */}
        <div className="w-44 shrink-0 space-y-1">
          <p className="text-[10px] font-mono text-vault-muted uppercase tracking-widest mb-2 px-1">Groups</p>
          <button onClick={()=>setSelectedGroup(null)} className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-body transition-all ${selectedGroup===null?'bg-vault-accent/10 text-vault-accent border border-vault-accent/30':'text-vault-text-dim hover:bg-vault-border hover:text-vault-text'}`}>
            <CreditCard className="w-3.5 h-3.5 shrink-0"/><span className="truncate">All Profiles</span><span className="ml-auto text-[10px] font-mono opacity-60">{profiles.length}</span>
          </button>
          <button onClick={()=>setSelectedGroup('ungrouped')} className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-body transition-all ${selectedGroup==='ungrouped'?'bg-vault-accent/10 text-vault-accent border border-vault-accent/30':'text-vault-text-dim hover:bg-vault-border hover:text-vault-text'}`}>
            <Folder className="w-3.5 h-3.5 shrink-0"/><span className="truncate">Ungrouped</span><span className="ml-auto text-[10px] font-mono opacity-60">{profiles.filter(p=>!p.group_id).length}</span>
          </button>
          {groups.map(g => (
            <div key={g.id} className="group relative">
              <button onClick={()=>setSelectedGroup(g.id)} className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-body transition-all ${selectedGroup===g.id?'bg-vault-accent/10 text-vault-accent border border-vault-accent/30':'text-vault-text-dim hover:bg-vault-border hover:text-vault-text'}`}>
                <div className="w-3 h-3 rounded-full shrink-0" style={{ background: g.colour }}/>
                <span className="truncate flex-1 text-left">{g.name}</span>
                <span className="text-[10px] font-mono opacity-60">{profiles.filter(p=>p.group_id===g.id).length}</span>
              </button>
              <div className="absolute right-1 top-1 hidden group-hover:flex gap-0.5">
                <button onClick={()=>openEditGroup(g)} className="p-1 rounded text-vault-muted hover:text-vault-accent hover:bg-vault-accent/10 transition-all"><Pencil className="w-3 h-3"/></button>
                <button onClick={()=>deleteGroup(g.id)} className="p-1 rounded text-vault-muted hover:text-vault-red hover:bg-vault-red/10 transition-all"><Trash2 className="w-3 h-3"/></button>
              </div>
            </div>
          ))}
        </div>

        {/* Main content */}
        <div className="flex-1 min-w-0">
          {/* Search + bulk actions bar */}
          <div className="flex gap-2 mb-3 flex-wrap items-center">
            <div className="relative flex-1 min-w-[180px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-vault-muted"/>
              <input className="vault-input pl-9" placeholder="Search profiles..." value={search} onChange={e=>setSearch(e.target.value)}/>
            </div>
            {someSelected && (
              <div className="flex gap-2 flex-wrap animate-fade-in">
                <span className="text-xs font-mono text-vault-accent self-center">{selectedIds.size} selected</span>
                <button onClick={()=>{ setBulkEditField(BULK_EDIT_FIELDS[0].key); setBulkEditValue(''); setBulkEditModal(true) }} className="vault-btn-ghost text-xs px-2.5 py-1.5"><Edit3 className="w-3 h-3"/> Edit Field</button>
                <button onClick={()=>setAssignGroupModal(true)} className="vault-btn-ghost text-xs px-2.5 py-1.5"><Tag className="w-3 h-3"/> Assign Group</button>
                <button onClick={bulkExport} className="vault-btn-ghost text-xs px-2.5 py-1.5"><Download className="w-3 h-3"/> Export</button>
                <button onClick={loadOpenDrops} className="vault-btn-ghost text-xs px-2.5 py-1.5"><Send className="w-3 h-3"/> Submit to Drop</button>
                <button onClick={()=>setBulkDeleteConfirm(true)} className="vault-btn-ghost text-xs px-2.5 py-1.5 text-vault-red border-vault-red/30 hover:bg-vault-red/10"><Trash2 className="w-3 h-3"/> Delete</button>
              </div>
            )}
          </div>

          {loading ? (
            <div className="flex justify-center py-16"><div className="w-8 h-8 border-2 border-vault-accent border-t-transparent rounded-full animate-spin"/></div>
          ) : filtered.length === 0 ? (
            <div className="vault-card text-center py-16">
              <CreditCard className="w-10 h-10 text-vault-muted mx-auto mb-3"/>
              <p className="text-vault-text font-display font-semibold">No profiles yet</p>
              <p className="text-vault-text-dim text-sm mt-1">Create your first profile or import a CSV</p>
            </div>
          ) : view === 'spreadsheet' ? (
            <div className="vault-card p-0 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-vault-border bg-vault-bg">
                      <th className="w-8 px-3 py-2">
                        <button onClick={toggleSelectAll} className="text-vault-muted hover:text-vault-accent transition-colors">
                          {allSelected ? <CheckSquare className="w-4 h-4 text-vault-accent"/> : <Square className="w-4 h-4"/>}
                        </button>
                      </th>
                      <th className="px-2 py-2 text-left font-mono text-vault-muted uppercase tracking-wider text-[10px] w-8">Grp</th>
                      {SPREADSHEET_COLS.map(col => (
                        <th key={col.key} className="px-2 py-2 text-left font-mono text-vault-muted uppercase tracking-wider text-[10px] whitespace-nowrap" style={{ minWidth: col.width }}>{col.label}</th>
                      ))}
                      <th className="px-2 py-2 text-left font-mono text-vault-muted uppercase tracking-wider text-[10px]">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((p, i) => {
                      const grp = groups.find(g => g.id === p.group_id)
                      const isSel = selectedIds.has(p.id)
                      return (
                        <tr key={p.id} className={`border-b border-vault-border/50 transition-colors ${isSel ? 'bg-vault-accent/5' : i%2===0 ? 'bg-vault-surface' : 'bg-vault-bg'} hover:bg-vault-accent/5`}>
                          <td className="px-3 py-1"><button onClick={()=>toggleSelect(p.id)} className="text-vault-muted hover:text-vault-accent transition-colors">{isSel ? <CheckSquare className="w-4 h-4 text-vault-accent"/> : <Square className="w-4 h-4"/>}</button></td>
                          <td className="px-2 py-1">{grp ? <div className="w-2.5 h-2.5 rounded-full mx-auto" style={{ background: grp.colour }} title={grp.name}/> : <div className="w-2.5 h-2.5 rounded-full mx-auto bg-vault-border"/>}</td>
                          {SPREADSHEET_COLS.map(col => (
                            <td key={col.key} className="py-1" style={{ minWidth: col.width }}>
                              <EditableCell value={p[col.key]} masked={col.masked} revealed={revealedCards.has(p.id)} options={col.options} onSave={val => saveCell(p.id, col.key, val)}/>
                            </td>
                          ))}
                          <td className="px-2 py-1">
                            <div className="flex items-center gap-1">
                              <button onClick={()=>toggleReveal(p.id)} className="p-1 text-vault-muted hover:text-vault-accent rounded transition-all">{revealedCards.has(p.id)?<EyeOff className="w-3.5 h-3.5"/>:<Eye className="w-3.5 h-3.5"/>}</button>
                              <button onClick={()=>openEdit(p)} className="p-1 text-vault-muted hover:text-vault-accent rounded transition-all"><Pencil className="w-3.5 h-3.5"/></button>
                              <button onClick={()=>duplicateProfile(p)} className="p-1 text-vault-muted hover:text-vault-green rounded transition-all" title="Duplicate"><Copy className="w-3.5 h-3.5"/></button>
                              <button onClick={()=>setDeleteConfirm(p.id)} className="p-1 text-vault-muted hover:text-vault-red rounded transition-all"><Trash2 className="w-3.5 h-3.5"/></button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <div className="px-4 py-2 border-t border-vault-border bg-vault-bg">
                <p className="text-[10px] font-mono text-vault-muted">Click any cell to edit inline · Changes save automatically</p>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-2 px-1">
                <button onClick={toggleSelectAll} className="flex items-center gap-2 text-xs font-mono text-vault-muted hover:text-vault-text transition-colors">
                  {allSelected ? <CheckSquare className="w-4 h-4 text-vault-accent"/> : <Square className="w-4 h-4"/>}
                  {allSelected ? 'Deselect all' : 'Select all'}
                </button>
              </div>
              {filtered.map(p => {
                const grp = groups.find(g => g.id === p.group_id)
                const isSel = selectedIds.has(p.id)
                return (
                  <div key={p.id} className={`vault-card hover:border-vault-accent/30 transition-colors ${isSel ? 'border-vault-accent/40 bg-vault-accent/5' : ''}`}>
                    <div className="flex items-center gap-3">
                      <button onClick={()=>toggleSelect(p.id)} className="text-vault-muted hover:text-vault-accent transition-colors shrink-0">
                        {isSel ? <CheckSquare className="w-4 h-4 text-vault-accent"/> : <Square className="w-4 h-4"/>}
                      </button>
                      <div className="w-10 h-10 rounded-xl bg-vault-accent/10 border border-vault-accent/20 flex items-center justify-center shrink-0" style={grp ? { borderColor: grp.colour + '40', background: grp.colour + '15' } : {}}>
                        <CreditCard className="w-5 h-5" style={grp ? { color: grp.colour } : { color: 'var(--vault-accent)' }}/>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-display font-semibold text-vault-text truncate">{p.profile_name}</p>
                          {grp && <span className="text-[10px] font-mono px-2 py-0.5 rounded-full border" style={{ color: grp.colour, borderColor: grp.colour + '40', background: grp.colour + '15' }}>{grp.name}</span>}
                        </div>
                        <p className="text-vault-text-dim text-xs font-mono truncate">{p.email}</p>
                      </div>
                      <div className="hidden sm:flex items-center gap-2">
                        <span className="font-mono text-sm text-vault-text-dim">{revealedCards.has(p.id) ? p.card_number : maskCard(p.card_number)}</span>
                        <button onClick={()=>toggleReveal(p.id)} className="text-vault-muted hover:text-vault-text-dim transition-colors">
                          {revealedCards.has(p.id) ? <EyeOff className="w-4 h-4"/> : <Eye className="w-4 h-4"/>}
                        </button>
                      </div>
                      <div className="flex items-center gap-1 ml-2">
                        <button onClick={()=>setExpandedId(expandedId===p.id?null:p.id)} className="p-2 text-vault-muted hover:text-vault-text rounded-lg hover:bg-vault-border transition-all">
                          {expandedId===p.id ? <ChevronUp className="w-4 h-4"/> : <ChevronDown className="w-4 h-4"/>}
                        </button>
                        <button onClick={()=>openEdit(p)} className="p-2 text-vault-muted hover:text-vault-accent rounded-lg hover:bg-vault-accent/10 transition-all"><Pencil className="w-4 h-4"/></button>
                        <button onClick={()=>duplicateProfile(p)} className="p-2 text-vault-muted hover:text-vault-green rounded-lg hover:bg-vault-green/10 transition-all" title="Duplicate profile"><Copy className="w-4 h-4"/></button>
                        <button onClick={()=>exportCSV([p])} className="p-2 text-vault-muted hover:text-vault-green rounded-lg hover:bg-vault-green/10 transition-all"><Download className="w-4 h-4"/></button>
                        <button onClick={()=>setDeleteConfirm(p.id)} className="p-2 text-vault-muted hover:text-vault-red rounded-lg hover:bg-vault-red/10 transition-all"><Trash2 className="w-4 h-4"/></button>
                      </div>
                    </div>
                    {expandedId===p.id && (
                      <div className="mt-4 pt-4 border-t border-vault-border grid grid-cols-2 sm:grid-cols-3 gap-3 animate-fade-in">
                        {[['Phone',p.phone],['Ship To',`${p.shipping_first_name} ${p.shipping_last_name}`],['Address',`${p.shipping_address}, ${p.shipping_city}`],['ZIP',p.shipping_zip],['Country',p.shipping_country],['Card Type',p.card_type],['Card #',revealedCards.has(p.id)?p.card_number:maskCard(p.card_number)],['Expiry',`${p.card_month}/${p.card_year}`],['CVV',revealedCards.has(p.id)?p.card_cvv:'•••']].map(([k,v])=>(
                          <div key={k}><p className="text-[10px] font-mono text-vault-muted uppercase tracking-widest">{k}</p><p className="text-sm font-body text-vault-text mt-0.5">{v||'—'}</p></div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Bulk edit modal ── */}
      {bulkEditModal && createPortal(
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="vault-card max-w-sm w-full animate-fade-in">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-display font-bold text-vault-text">Bulk Edit Field</h3>
                <p className="text-vault-text-dim text-xs font-mono mt-0.5">{selectedIds.size} profile{selectedIds.size!==1?'s':''} will be updated</p>
              </div>
              <button onClick={()=>setBulkEditModal(false)}><X className="w-5 h-5 text-vault-muted"/></button>
            </div>
            <div className="space-y-4 mb-5">
              <div>
                <label className="vault-label">Field to edit</label>
                <select className="vault-input" value={bulkEditField} onChange={e=>{ setBulkEditField(e.target.value); setBulkEditValue('') }}>
                  {BULK_EDIT_FIELDS.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
                </select>
              </div>
              <div>
                <label className="vault-label">New value</label>
                {selectedFieldDef?.type === 'select' ? (
                  <select className="vault-input" value={bulkEditValue} onChange={e=>setBulkEditValue(e.target.value)}>
                    <option value="">— Select —</option>
                    {selectedFieldDef.options.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : (
                  <input className="vault-input" type={selectedFieldDef?.type || 'text'} placeholder={`New ${selectedFieldDef?.label || 'value'}...`} value={bulkEditValue} onChange={e=>setBulkEditValue(e.target.value)}/>
                )}
                <p className="text-vault-muted text-xs font-mono mt-1">This value will overwrite the existing value on all {selectedIds.size} selected profiles</p>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button className="vault-btn-ghost" onClick={()=>setBulkEditModal(false)}>Cancel</button>
              <button className="vault-btn-primary" onClick={handleBulkEdit} disabled={bulkEditing || !bulkEditValue}>
                {bulkEditing ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"/>Saving...</> : <><Save className="w-4 h-4"/>Apply to {selectedIds.size} profiles</>}
              </button>
            </div>
          </div>
        </div>, document.body
      )}

      {/* ── Delete single confirm ── */}
      {deleteConfirm && createPortal(
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="vault-card max-w-sm w-full animate-fade-in">
            <div className="flex items-center gap-3 mb-3"><AlertTriangle className="w-5 h-5 text-vault-red shrink-0"/><h3 className="font-display font-bold text-vault-text">Delete Profile?</h3></div>
            <p className="text-vault-text-dim text-sm font-body mb-5">This cannot be undone.</p>
            <div className="flex gap-2 justify-end">
              <button className="vault-btn-ghost" onClick={()=>setDeleteConfirm(null)}>Cancel</button>
              <button className="vault-btn-danger" onClick={()=>handleDelete(deleteConfirm)}><Trash2 className="w-4 h-4"/> Delete</button>
            </div>
          </div>
        </div>, document.body
      )}

      {/* ── Bulk delete confirm ── */}
      {bulkDeleteConfirm && createPortal(
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="vault-card max-w-sm w-full animate-fade-in">
            <div className="flex items-center gap-3 mb-3"><AlertTriangle className="w-5 h-5 text-vault-red shrink-0"/><h3 className="font-display font-bold text-vault-text">Delete {selectedIds.size} Profiles?</h3></div>
            <p className="text-vault-text-dim text-sm font-body mb-5">This cannot be undone. All selected profiles will be permanently removed.</p>
            <div className="flex gap-2 justify-end">
              <button className="vault-btn-ghost" onClick={()=>setBulkDeleteConfirm(false)}>Cancel</button>
              <button className="vault-btn-danger" onClick={bulkDelete}><Trash2 className="w-4 h-4"/> Delete {selectedIds.size}</button>
            </div>
          </div>
        </div>, document.body
      )}

      {/* ── Assign group modal ── */}
      {assignGroupModal && createPortal(
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="vault-card max-w-sm w-full animate-fade-in">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-display font-bold text-vault-text">Assign to Group</h3>
              <button onClick={()=>setAssignGroupModal(false)}><X className="w-5 h-5 text-vault-muted"/></button>
            </div>
            <p className="text-vault-text-dim text-xs font-mono mb-4">{selectedIds.size} profile{selectedIds.size!==1?'s':''} selected</p>
            <div className="space-y-2 mb-4">
              <button onClick={()=>setAssigningGroupId(null)} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-sm font-body transition-all ${assigningGroupId===null?'bg-vault-accent/10 border-vault-accent/40 text-vault-accent':'border-vault-border text-vault-text-dim hover:bg-vault-border'}`}>
                <Folder className="w-4 h-4"/> No Group (remove from group)
              </button>
              {groups.map(g => (
                <button key={g.id} onClick={()=>setAssigningGroupId(g.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-sm font-body transition-all ${assigningGroupId===g.id?'border-opacity-100':'border-vault-border text-vault-text-dim hover:bg-vault-border'}`}
                  style={assigningGroupId===g.id?{borderColor:g.colour,background:g.colour+'15',color:g.colour}:{}}>
                  <div className="w-3 h-3 rounded-full shrink-0" style={{background:g.colour}}/>{g.name}
                  <span className="ml-auto text-[10px] font-mono opacity-60">{profiles.filter(p=>p.group_id===g.id).length} profiles</span>
                </button>
              ))}
            </div>
            <div className="flex gap-2 justify-end">
              <button className="vault-btn-ghost" onClick={()=>setAssignGroupModal(false)}>Cancel</button>
              <button className="vault-btn-primary" onClick={bulkAssignGroup}><Check className="w-4 h-4"/> Assign</button>
            </div>
          </div>
        </div>, document.body
      )}

      {/* ── Submit to drop modal ── */}
      {dropModal && createPortal(
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="vault-card max-w-sm w-full animate-fade-in">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-display font-bold text-vault-text">Submit to Drop</h3>
              <button onClick={()=>setDropModal(false)}><X className="w-5 h-5 text-vault-muted"/></button>
            </div>
            <p className="text-vault-text-dim text-xs font-mono mb-4">{selectedIds.size} profile{selectedIds.size!==1?'s':''} will be submitted</p>
            {openDrops.length === 0 ? (
              <p className="text-vault-muted text-sm text-center py-4">No open drops right now</p>
            ) : (
              <div className="space-y-2 mb-4">
                {openDrops.map(d => (
                  <button key={d.id} onClick={()=>setSelectedDropId(d.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-sm font-body transition-all ${selectedDropId===d.id?'bg-vault-accent/10 border-vault-accent/40 text-vault-accent':'border-vault-border text-vault-text-dim hover:bg-vault-border'}`}>
                    <Send className="w-4 h-4 shrink-0"/><span className="flex-1 text-left">{d.name}</span><span className="text-[10px] font-mono opacity-60">{d.site}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="flex gap-2 justify-end">
              <button className="vault-btn-ghost" onClick={()=>setDropModal(false)}>Cancel</button>
              <button className="vault-btn-primary" onClick={bulkSubmitToDrop} disabled={!selectedDropId||submittingDrop}>
                {submittingDrop?<div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"/>:<Send className="w-4 h-4"/>}
                {submittingDrop?'Submitting...':'Submit'}
              </button>
            </div>
          </div>
        </div>, document.body
      )}

      {/* ── Group create/edit modal ── */}
      {groupModal && createPortal(
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="vault-card max-w-sm w-full animate-fade-in">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-display font-bold text-vault-text">{editingGroupId?'Edit Group':'New Group'}</h3>
              <button onClick={()=>{setGroupModal(false);setGroupForm({name:'',colour:'#00c8ff'});setEditingGroupId(null)}}><X className="w-5 h-5 text-vault-muted"/></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="vault-label">Group Name</label>
                <input className="vault-input" placeholder="e.g. PKC Profiles" value={groupForm.name} onChange={e=>setGroupForm(f=>({...f,name:e.target.value}))}/>
              </div>
              <div>
                <label className="vault-label">Colour</label>
                <div className="flex gap-2 flex-wrap mt-1">
                  {GROUP_COLOURS.map(c => (
                    <button key={c} type="button" onClick={()=>setGroupForm(f=>({...f,colour:c}))}
                      className="w-7 h-7 rounded-full border-2 transition-all"
                      style={{background:c, borderColor:groupForm.colour===c?'white':'transparent', transform:groupForm.colour===c?'scale(1.2)':'scale(1)'}}/>
                  ))}
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <label className="text-xs font-mono text-vault-muted">Custom:</label>
                  <input type="color" value={groupForm.colour} onChange={e=>setGroupForm(f=>({...f,colour:e.target.value}))} className="w-8 h-8 rounded cursor-pointer bg-transparent border-0"/>
                  <span className="font-mono text-xs text-vault-muted">{groupForm.colour}</span>
                </div>
              </div>
            </div>
            <div className="flex gap-2 justify-end mt-5">
              <button className="vault-btn-ghost" onClick={()=>{setGroupModal(false);setGroupForm({name:'',colour:'#00c8ff'});setEditingGroupId(null)}}>Cancel</button>
              <button className="vault-btn-primary" onClick={saveGroup} disabled={savingGroup||!groupForm.name.trim()}>
                <Save className="w-4 h-4"/>{savingGroup?'Saving...':editingGroupId?'Save Changes':'Create Group'}
              </button>
            </div>
          </div>
        </div>, document.body
      )}

      {/* ── Create/Edit profile modal ── */}
      {modalOpen && createPortal(
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="vault-card w-full max-w-2xl flex flex-col animate-fade-in" style={{ maxHeight: '90vh' }}>
            <div className="flex items-center justify-between mb-6 shrink-0">
              <h2 className="font-display font-bold text-xl text-vault-text">{editingId?'Edit Profile':'New Profile'}</h2>
              <button onClick={closeModal} className="text-vault-muted hover:text-vault-text transition-colors"><X className="w-5 h-5"/></button>
            </div>
            <div className="overflow-y-auto flex-1 pr-1 space-y-6">
              <section>
                <p className="text-[10px] font-mono text-vault-muted uppercase tracking-widest mb-3">Group</p>
                <div className="flex gap-2 flex-wrap">
                  <button type="button" onClick={()=>setForm(f=>({...f,group_id:null}))}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-body transition-all ${!form.group_id?'bg-vault-accent/10 text-vault-accent border-vault-accent/40':'text-vault-text-dim border-vault-border hover:bg-vault-border'}`}>
                    <Folder className="w-3 h-3"/> No Group
                  </button>
                  {groups.map(g=>(
                    <button key={g.id} type="button" onClick={()=>setForm(f=>({...f,group_id:g.id}))}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-body transition-all"
                      style={form.group_id===g.id?{borderColor:g.colour,background:g.colour+'15',color:g.colour}:{borderColor:'var(--vault-border)',color:'var(--vault-text-dim)'}}>
                      <div className="w-2.5 h-2.5 rounded-full" style={{background:g.colour}}/>{g.name}
                    </button>
                  ))}
                </div>
              </section>
              <section>
                <p className="text-[10px] font-mono text-vault-muted uppercase tracking-widest mb-3">Basic Info</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="Profile Name" name="profile_name" required placeholder="Main Profile" form={form} errors={errors} setForm={setForm}/>
                  <Field label="Email" name="email" type="email" required placeholder="you@example.com" form={form} errors={errors} setForm={setForm}/>
                  <div>
                    <label className="vault-label">Phone <span className="text-vault-red ml-1">*</span></label>
                    <input className={`vault-input ${errors.phone?'border-vault-red':''}`} placeholder="07911123456" value={form.phone} onChange={e=>setForm(f=>({...f,phone:e.target.value}))}/>
                    {errors.phone?<p className="text-vault-red text-xs mt-1 font-mono">{errors.phone}</p>:<p className="text-vault-muted text-xs mt-1 font-mono">11 digits, must start with 07</p>}
                  </div>
                </div>
              </section>
              <section>
                <p className="text-[10px] font-mono text-vault-muted uppercase tracking-widest mb-3">Shipping</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="First Name" name="shipping_first_name" required form={form} errors={errors} setForm={setForm}/>
                  <Field label="Last Name" name="shipping_last_name" required form={form} errors={errors} setForm={setForm}/>
                  <div className="sm:col-span-2">
                    <label className="vault-label">Address <span className="text-vault-red ml-1">*</span></label>
                    <input className={`vault-input ${errors.shipping_address?'border-vault-red':''}`} placeholder="123 High Street" value={form.shipping_address} onChange={e=>setForm(f=>({...f,shipping_address:e.target.value}))}/>
                    {errors.shipping_address&&<p className="text-vault-red text-xs mt-1 font-mono">{errors.shipping_address}</p>}
                    {form.shipping_address.trim()&&/^\d/.test(form.shipping_address.trim())&&(<JigTool currentAddress={form.shipping_address} onApply={(line1,line2)=>setForm(f=>({...f,shipping_address:line1,shipping_address_2:line2||f.shipping_address_2}))}/>)}
                  </div>
                  <Field label="Address 2" name="shipping_address_2" placeholder="Apt, suite..." form={form} errors={errors} setForm={setForm}/>
                  <Field label="City" name="shipping_city" required form={form} errors={errors} setForm={setForm}/>
                  <div>
                    <label className="vault-label mb-0">ZIP / Postcode <span className="text-vault-red ml-1">*</span></label>
                    <input className={`vault-input ${errors.shipping_zip?'border-vault-red':''}`} placeholder="NW7 3EX" value={form.shipping_zip} onChange={e=>setForm(f=>({...f,shipping_zip:e.target.value}))}/>
                    {errors.shipping_zip&&<p className="text-vault-red text-xs mt-1 font-mono">{errors.shipping_zip}</p>}
                  </div>
                  <Field label="State / County" name="shipping_state" form={form} errors={errors} setForm={setForm}/>
                  <div><label className="vault-label">Country</label><div className="vault-input bg-vault-border/50 text-vault-text-dim cursor-not-allowed flex items-center"><span className="text-vault-text font-mono">🇬🇧 GB — United Kingdom</span></div></div>
                </div>
              </section>
              <section>
                <div className="flex items-center gap-3 mb-3">
                  <button type="button" onClick={()=>!form.is_virtual_card&&setForm(f=>({...f,billing_same_as_shipping:!f.billing_same_as_shipping}))} disabled={form.is_virtual_card} className={`relative inline-flex w-11 h-6 rounded-full transition-colors duration-200 focus:outline-none ${form.billing_same_as_shipping?'bg-vault-accent':'bg-vault-border'} ${form.is_virtual_card?'opacity-60 cursor-not-allowed':''}`}><span className={`absolute left-1 top-1 w-4 h-4 bg-white rounded-full shadow transition-transform duration-200 ${form.billing_same_as_shipping?'translate-x-5':'translate-x-0'}`}/></button>
                  <div><span className="text-sm font-body text-vault-text-dim">Billing same as shipping</span>{form.is_virtual_card&&<p className="text-xs font-mono text-vault-accent mt-0.5">Locked — virtual card</p>}</div>
                </div>
                {!form.billing_same_as_shipping&&!form.is_virtual_card&&(
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Field label="Billing First Name" name="billing_first_name" form={form} errors={errors} setForm={setForm}/>
                    <Field label="Billing Last Name" name="billing_last_name" form={form} errors={errors} setForm={setForm}/>
                    <div className="sm:col-span-2"><Field label="Billing Address" name="billing_address" form={form} errors={errors} setForm={setForm}/></div>
                    <Field label="Billing City" name="billing_city" form={form} errors={errors} setForm={setForm}/>
                    <Field label="Billing ZIP" name="billing_zip" form={form} errors={errors} setForm={setForm}/>
                    <Field label="Billing State" name="billing_state" form={form} errors={errors} setForm={setForm}/>
                    <div><label className="vault-label">Billing Country</label><div className="vault-input bg-vault-border/50 text-vault-text-dim cursor-not-allowed flex items-center"><span className="text-vault-text font-mono">🇬🇧 GB — United Kingdom</span></div></div>
                  </div>
                )}
              </section>
              <section>
                <p className="text-[10px] font-mono text-vault-muted uppercase tracking-widest mb-3">Card Details</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="Card Holder Name" name="card_holder_name" required form={form} errors={errors} setForm={setForm}/>
                  <Field label="Card Type" name="card_type" options={CARD_TYPES} form={form} errors={errors} setForm={setForm}/>
                  <div className="sm:col-span-2">
                    <label className="vault-label">Card Number <span className="text-vault-red ml-1">*</span></label>
                    <input className={`vault-input ${errors.card_number?'border-vault-red':''}`} placeholder={form.card_type==='Visa'?'4xxx xxxx xxxx xxxx':form.card_type==='Mastercard'?'5xxx xxxx xxxx xxxx':'4111 1111 1111 1111'} value={form.card_number} onChange={e=>setForm(f=>({...f,card_number:e.target.value}))}/>
                    {form.card_number&&!errors.card_number&&(<p className="text-vault-green text-xs mt-1 font-mono">{form.card_type==='Visa'&&form.card_number.replace(/\s/g,'')[0]==='4'&&'✓ Valid Visa prefix'}{form.card_type==='Mastercard'&&form.card_number.replace(/\s/g,'')[0]==='5'&&'✓ Valid Mastercard prefix'}</p>)}
                    {errors.card_number&&<p className="text-vault-red text-xs mt-1 font-mono">{errors.card_number}</p>}
                    {!form.card_number&&(<p className="text-vault-muted text-xs mt-1 font-mono">{form.card_type==='Visa'&&'Visa cards must start with 4'}{form.card_type==='Mastercard'&&'Mastercard numbers must start with 5'}</p>)}
                  </div>
                  <Field label="Expiry Month (MM)" name="card_month" required placeholder="01" form={form} errors={errors} setForm={setForm}/>
                  <Field label="Expiry Year (YY)" name="card_year" required placeholder="28" form={form} errors={errors} setForm={setForm}/>
                  <Field label="CVV" name="card_cvv" required placeholder="123" form={form} errors={errors} setForm={setForm}/>
                </div>
              </section>
              <section className="space-y-3">
                <div className={`rounded-xl p-3 border transition-all ${form.is_virtual_card?'bg-vault-accent/5 border-vault-accent/30':'bg-vault-bg border-vault-border'}`}>
                  <div className="flex items-center gap-3">
                    <button type="button" onClick={()=>setForm(f=>({...f,is_virtual_card:!f.is_virtual_card,billing_same_as_shipping:!f.is_virtual_card?true:f.billing_same_as_shipping}))} className={`relative inline-flex w-11 h-6 rounded-full transition-colors duration-200 focus:outline-none shrink-0 ${form.is_virtual_card?'bg-vault-accent':'bg-vault-border'}`}><span className={`absolute left-1 top-1 w-4 h-4 bg-white rounded-full shadow transition-transform duration-200 ${form.is_virtual_card?'translate-x-5':'translate-x-0'}`}/></button>
                    <div><p className="text-sm font-body text-vault-text">Virtual card</p><p className="text-xs font-mono text-vault-muted">{form.is_virtual_card?'✓ Billing address automatically set to match shipping':'Toggle on if this is a virtual/prepaid card'}</p></div>
                  </div>
                </div>
                <div className="flex items-center gap-3 px-1">
                  <div className="relative inline-flex w-11 h-6 rounded-full bg-vault-accent shrink-0 opacity-60 cursor-not-allowed"><span className="absolute left-1 top-1 w-4 h-4 bg-white rounded-full shadow translate-x-5"/></div>
                  <div><p className="text-sm font-body text-vault-text-dim">One checkout per profile</p><p className="text-xs font-mono text-vault-muted">Always enabled — required for safe botting</p></div>
                </div>
              </section>
            </div>
            <div className="flex justify-end gap-2 mt-6 pt-5 border-t border-vault-border shrink-0">
              <button className="vault-btn-ghost" onClick={closeModal}>Cancel</button>
              <button className="vault-btn-primary" onClick={handleSave} disabled={saving}>
                {saving?<div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"/>:<Save className="w-4 h-4"/>}
                {saving?'Saving...':editingId?'Save Changes':'Create Profile'}
              </button>
            </div>
          </div>
        </div>, document.body
      )}
    </div>
  )
}

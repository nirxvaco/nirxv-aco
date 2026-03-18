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
  Shuffle, ChevronLeft, ChevronRight, Copy, Check, RefreshCw, Zap
} from 'lucide-react'

// ── Address Jig Engine (ported from Discord bot) ──────────────────────────────

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
  const num = parts[0]
  const street = parts.slice(1).join(' ')
  if (!street) throw new Error('Address must start with a house number, e.g. 42 High Street')
  return [num, street]
}

function jigLight(house, street) {
  const prefix = rnd(PREFIXES)
  const words = street.split(' ')
  let jigged = house
  if (house.length >= 2 && Math.random() > 0.4) jigged = insertAt(house, Math.floor(Math.random()*(house.length-1))+1, '.')
  const jWords = words.map(w => {
    let m = w.toUpperCase()
    if (w.length >= 3 && Math.random() > 0.3) m = insertAt(m, Math.floor(Math.random()*(w.length-1))+1, '.')
    return m
  })
  return [`${prefix} ${jigged} ${jWords.join(' ')}`, rnd(LINE2_OPTIONS)]
}

function jigHeavy(house, street) {
  const prefix = rnd(PREFIXES)
  const transform = w => w.split('').map(ch => {
    const lc = ch.toLowerCase()
    if (LEET_MAP[lc] && Math.random() > 0.3) return rnd(LEET_MAP[lc])
    return ch.toUpperCase()
  }).join('')
  return [`${prefix} ${house} ${street.split(' ').map(transform).join(' ')}`, rnd(LINE2_OPTIONS)]
}

function jigSpecial(house, street) {
  const words = street.split(' ')
  const jWords = words.map(w => {
    const mod = w.split('')
    const count = Math.min(2, w.length - 1)
    const positions = [...Array(w.length-1).keys()].map(i=>i+1).sort(()=>Math.random()-0.5).slice(0, count)
    positions.sort((a,b)=>b-a).forEach(pos => mod.splice(pos, 0, rnd(SPECIAL_CHARS)))
    return mod.join('')
  })
  return [`${house} ${jWords.join(' ')} ${rnd(SUFFIXES)}`, rnd(LINE2_OPTIONS)]
}

function jigReversed(house, street) {
  const lot = rnd(LINE2_OPTIONS)
  const words = street.split(' ')
  if (words.length > 0) {
    const idx = Math.floor(Math.random() * words.length)
    const w = words[idx]
    if (w.length >= 3) {
      const dup = Math.floor(Math.random()*(w.length-1))+1
      words[idx] = w.slice(0,dup) + w[dup] + w.slice(dup)
    }
  }
  const suffix = Math.random() > 0.5 ? ` ${rnd(SUFFIXES)}` : ''
  return [`${lot} ${house} ${words.join(' ')}${suffix}`, null]
}

const JIG_FNS = { light: jigLight, heavy: jigHeavy, special: jigSpecial, reversed: jigReversed }

function generateVariants(address, style, count = JIG_COUNT) {
  const [house, street] = parseAddress(address)
  const fn = JIG_FNS[style]
  const results = [], seen = new Set()
  let attempts = 0
  while (results.length < count && attempts < count * 15) {
    attempts++
    const [l1, l2] = fn(house, street)
    const combined = l2 ? `${l1}\n${l2}` : l1
    if (!seen.has(combined)) { seen.add(combined); results.push({ line1: l1, line2: l2 }) }
  }
  return results
}

const JIG_STYLES = {
  light:    { label: '🔅 Light',    desc: 'Prefix + decimal insertions. Clean and subtle.' },
  heavy:    { label: '🔆 Heavy',    desc: 'Leet number substitutions + LOT/APT line 2.' },
  special:  { label: '⚡ Special',  desc: 'Punctuation injected mid-word + suffix.' },
  reversed: { label: '🔀 Reversed', desc: 'LOT prefix before house number.' },
}

// ── JigTool component — displayed inside the profile form ────────────────────
function JigTool({ currentAddress, onApply }) {
  const [open, setOpen]         = useState(false)
  const [style, setStyle]       = useState('light')
  const [variants, setVariants] = useState([])
  const [page, setPage]         = useState(0)
  const [copied, setCopied]     = useState(false)
  const [error, setError]       = useState('')

  function generate(s = style, addr = currentAddress) {
    setError('')
    try {
      setVariants(generateVariants(addr, s))
      setPage(0)
    } catch (e) {
      setError(e.message)
    }
  }

  function switchStyle(s) {
    setStyle(s)
    if (variants.length > 0) generate(s)
  }

  function applyVariant(v) {
    onApply(v.line1, v.line2 || '')
    setOpen(false)
  }

  function copyVariant(v) {
    const text = v.line2 ? `${v.line1}\n${v.line2}` : v.line1
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const current = variants[page]

  if (!open) {
    return (
      <button type="button" onClick={() => { setOpen(true); generate(style, currentAddress) }}
        className="flex items-center gap-1.5 text-xs font-body font-medium text-vault-purple hover:text-vault-purple/80 transition-colors mt-1">
        <Shuffle className="w-3.5 h-3.5" />
        Jig this address
      </button>
    )
  }

  return (
    <div className="mt-2 rounded-xl border border-vault-purple/30 bg-vault-purple/5 p-4 animate-fade-in">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Shuffle className="w-4 h-4 text-vault-purple" />
          <p className="text-sm font-display text-vault-purple tracking-wide">ADDRESS JIG</p>
        </div>
        <button onClick={() => setOpen(false)} className="text-vault-muted hover:text-vault-text transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Style tabs */}
      <div className="flex gap-1 mb-3 flex-wrap">
        {Object.entries(JIG_STYLES).map(([k, v]) => (
          <button key={k} type="button" onClick={() => switchStyle(k)}
            className={`text-xs font-body px-2.5 py-1 rounded-lg border transition-all
              ${style === k
                ? 'bg-vault-purple/20 text-vault-purple border-vault-purple/40'
                : 'text-vault-text-dim border-vault-border hover:text-vault-text hover:bg-vault-border'}`}>
            {v.label}
          </button>
        ))}
      </div>

      {error && <p className="text-vault-red text-xs font-mono mb-3">{error}</p>}

      {variants.length > 0 && current && (
        <>
          {/* Current variant display */}
          <div className="bg-vault-bg rounded-lg p-3 border border-vault-border mb-3">
            <p className="font-mono text-vault-text text-sm">{current.line1}</p>
            {current.line2 && <p className="font-mono text-vault-text-dim text-sm">{current.line2}</p>}
            <p className="text-[10px] font-mono text-vault-muted mt-1">{JIG_STYLES[style].desc}</p>
          </div>

          {/* Navigation + actions */}
          <div className="flex items-center gap-2 flex-wrap">
            <button type="button" onClick={() => setPage(p => Math.max(0, p-1))} disabled={page === 0}
              className="p-1.5 text-vault-muted hover:text-vault-text disabled:opacity-30 rounded hover:bg-vault-border transition-all">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-xs font-mono text-vault-muted">{page+1}/{variants.length}</span>
            <button type="button" onClick={() => setPage(p => Math.min(variants.length-1, p+1))} disabled={page === variants.length-1}
              className="p-1.5 text-vault-muted hover:text-vault-text disabled:opacity-30 rounded hover:bg-vault-border transition-all">
              <ChevronRight className="w-4 h-4" />
            </button>

            <button type="button" onClick={() => generate()}
              className="vault-btn-ghost text-xs px-2.5 py-1.5 ml-1">
              <RefreshCw className="w-3 h-3" /> Regenerate
            </button>

            <button type="button" onClick={() => copyVariant(current)}
              className="vault-btn-ghost text-xs px-2.5 py-1.5">
              {copied ? <><Check className="w-3 h-3 text-vault-green" /> Copied</> : <><Copy className="w-3 h-3" /> Copy</>}
            </button>

            <button type="button" onClick={() => applyVariant(current)}
              className="vault-btn-primary text-xs px-3 py-1.5 ml-auto">
              <Zap className="w-3 h-3" /> Apply to form
            </button>
          </div>

          {/* All variants mini list */}
          <div className="mt-3 pt-3 border-t border-vault-border/50 space-y-1">
            {variants.map((v, i) => (
              <button key={i} type="button" onClick={() => setPage(i)}
                className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-mono transition-all
                  ${i === page
                    ? 'bg-vault-purple/10 text-vault-purple border border-vault-purple/20'
                    : 'text-vault-text-dim hover:bg-vault-border hover:text-vault-text'}`}>
                {i+1}. {v.line1}{v.line2 ? ` / ${v.line2}` : ''}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// Defined OUTSIDE the main component so it never gets recreated on re-render
function Field({ label, name, type = 'text', required, options, placeholder, form, errors, setForm }) {
  const err = errors[name]
  return (
    <div>
      <label className="vault-label">{label}{required && <span className="text-vault-red ml-1">*</span>}</label>
      {options ? (
        <select className="vault-input" value={form[name]} onChange={e => setForm(f => ({ ...f, [name]: e.target.value }))}>
          {options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : (
        <input
          className={`vault-input ${err ? 'border-vault-red' : ''}`}
          type={type}
          placeholder={placeholder}
          value={form[name]}
          onChange={e => setForm(f => ({ ...f, [name]: e.target.value }))}
        />
      )}
      {err && <p className="text-vault-red text-xs mt-1 font-mono">{err}</p>}
    </div>
  )
}

const EMPTY_PROFILE = {
  profile_name: '', email: '', phone: '',
  shipping_first_name: '', shipping_last_name: '', shipping_address: '',
  shipping_address_2: '', shipping_city: '', shipping_zip: '',
  shipping_state: '', shipping_country: '',
  billing_same_as_shipping: true,
  billing_first_name: '', billing_last_name: '', billing_address: '',
  billing_address_2: '', billing_city: '', billing_zip: '',
  billing_state: '', billing_country: '',
  card_holder_name: '', card_type: 'Visa', card_number: '',
  card_month: '', card_year: '', card_cvv: '',
  one_checkout_per_profile: true,  // always true by default
  is_virtual_card: false,
}

const CARD_TYPES = ['Visa', 'Mastercard', 'Amex', 'Discover', 'Other']
const COUNTRIES = ['GB', 'US', 'CA', 'AU', 'DE', 'FR', 'IT', 'ES', 'NL', 'Other']

export default function ProfilesPage() {
  const { user } = useAuth()
  const [profiles, setProfiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(EMPTY_PROFILE)
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const [revealedCards, setRevealedCards] = useState(new Set())
  const [expandedId, setExpandedId] = useState(null)
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [importLoading, setImportLoading] = useState(false)

const load = useCallback(async () => {
  setLoading(true)
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
    
    if (error) throw error
    
    if (data) {
      const decrypted = await Promise.all(data.map(decryptProfile))
      setProfiles(decrypted)
    }
  } catch (err) {
    console.error('Load failed:', err)
  }
  setLoading(false)
}, [user.id])

  useEffect(() => { load() }, [load])

  function validate(f) {
    const e = {}
    const now = new Date()
    const cleanCard = f.card_number.replace(/\s/g, '')

    // ── Basic required ────────────────────────────────────────────────────
    if (!f.profile_name.trim()) e.profile_name = 'Required'
    if (!f.shipping_first_name.trim()) e.shipping_first_name = 'Required'
    if (!f.shipping_last_name.trim()) e.shipping_last_name = 'Required'
    if (!f.shipping_address.trim()) e.shipping_address = 'Required'
    if (!f.shipping_city.trim()) e.shipping_city = 'Required'
    if (!f.shipping_zip.trim()) e.shipping_zip = 'Required'
    if (!f.shipping_country.trim()) e.shipping_country = 'Required'
    if (!f.card_holder_name.trim()) e.card_holder_name = 'Required'

    // ── Email ─────────────────────────────────────────────────────────────
    if (!f.email.trim() || !/\S+@\S+\.\S+/.test(f.email)) {
      e.email = 'Valid email required'
    }

    // ── Phone — must be 11 digits starting with 07 ────────────────────────
    const cleanPhone = f.phone.replace(/\s/g, '')
    if (!cleanPhone) {
      e.phone = 'Phone number required'
    } else if (!/^07\d{9}$/.test(cleanPhone)) {
      e.phone = 'Must be 11 digits starting with 07 (e.g. 07911123456)'
    }

    // ── Card number length ────────────────────────────────────────────────
    if (!cleanCard || cleanCard.length < 13) {
      e.card_number = 'Invalid card number'
    }

    // ── Visa must start with 4 ────────────────────────────────────────────
    if (f.card_type === 'Visa' && cleanCard && cleanCard[0] !== '4') {
      e.card_number = 'Visa card numbers must start with 4'
    }

    // ── Mastercard must start with 5 ──────────────────────────────────────
    if (f.card_type === 'Mastercard' && cleanCard && cleanCard[0] !== '5') {
      e.card_number = 'Mastercard numbers must start with 5'
    }

    // ── Expiry month ──────────────────────────────────────────────────────
    const month = parseInt(f.card_month, 10)
    if (!f.card_month || isNaN(month) || month < 1 || month > 12) {
      e.card_month = 'Enter month 01–12'
    }

    // ── Expiry year — must be 2 or 4 digits and not in the past ──────────
    const yearStr = f.card_year?.trim()
    if (!yearStr || yearStr.length < 2) {
      e.card_year = 'Enter expiry year (e.g. 28)'
    } else {
      const fullYear = yearStr.length === 2 ? 2000 + parseInt(yearStr, 10) : parseInt(yearStr, 10)
      const expiry = new Date(fullYear, month - 1, 1) // first day of expiry month
      const firstOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1)
      if (expiry < firstOfThisMonth) {
        e.card_year = 'This card has expired'
        if (!e.card_month) e.card_month = 'Card expired'
      }
    }

    // ── CVV ───────────────────────────────────────────────────────────────
    if (!f.card_cvv || f.card_cvv.length < 3 || f.card_cvv.length > 4) {
      e.card_cvv = '3 or 4 digits'
    }

    return e
  }

  // Cross-profile uniqueness checks (run against existing profiles)
  async function crossValidate(f) {
    const e = {}
    const cleanCard  = f.card_number.replace(/\s/g, '')
    const cleanPhone = f.phone.replace(/\s/g, '')
    const cleanZip   = f.shipping_zip.trim().toUpperCase()

    // Exclude the profile being edited from duplicate checks
    const others = profiles.filter(p => p.id !== editingId)

    // ── Same email ────────────────────────────────────────────────────────
    const dupEmail = others.find(p =>
      p.email?.trim().toLowerCase() === f.email.trim().toLowerCase()
    )
    if (dupEmail) {
      e.email = `This email is already used on "${dupEmail.profile_name}"`
    }

    // ── Same phone ────────────────────────────────────────────────────────
    const dupPhone = others.find(p =>
      p.phone?.replace(/\s/g, '') === cleanPhone
    )
    if (dupPhone) {
      e.phone = `This number is already used on "${dupPhone.profile_name}"`
    }

    // ── Same card number ──────────────────────────────────────────────────
    const dupCard = others.find(p =>
      p.card_number?.replace(/\s/g, '') === cleanCard
    )
    if (dupCard) {
      e.card_number = `This card is already used on "${dupCard.profile_name}"`
    }

    // ── Name too similar — first + last must not match any other profile ──
    const firstName = f.shipping_first_name.trim().toLowerCase()
    const lastName  = f.shipping_last_name.trim().toLowerCase()
    const dupName = others.find(p =>
      p.shipping_first_name?.trim().toLowerCase() === firstName &&
      p.shipping_last_name?.trim().toLowerCase() === lastName
    )
    if (dupName) {
      e.shipping_first_name = `Name "${f.shipping_first_name} ${f.shipping_last_name}" already used on "${dupName.profile_name}"`
    }

    // ── Max 3 profiles per postcode ───────────────────────────────────────
    const sameZip = others.filter(p =>
      p.shipping_zip?.trim().toUpperCase() === cleanZip
    )
    if (sameZip.length >= 3) {
      e.shipping_zip = `Max 3 profiles allowed per postcode — ${cleanZip} already has ${sameZip.length}`
    }

    // ── Same full address ─────────────────────────────────────────────────
    const cleanAddr = f.shipping_address.trim().toLowerCase()
    const dupAddr = others.find(p =>
      p.shipping_address?.trim().toLowerCase() === cleanAddr &&
      p.shipping_zip?.trim().toUpperCase() === cleanZip
    )
    if (dupAddr) {
      e.shipping_address = `This address is already used on "${dupAddr.profile_name}" — use the Jig Address tool to create a variation`
    }

    return e
  }

  async function handleSave() {
  // Run format validation first (fast, no async)
  const formatErrors = validate(form)
  if (Object.keys(formatErrors).length) {
    setErrors(formatErrors)
    return
  }

  // Run cross-profile uniqueness checks
  setSaving(true)
  try {
    const crossErrors = await crossValidate(form)
    if (Object.keys(crossErrors).length) {
      setErrors(crossErrors)
      setSaving(false)
      return
    }

    const encrypted = await encryptProfile({ ...form, user_id: user.id })

    if (editingId) {
      const { error } = await supabase.from('profiles').update(encrypted).eq('id', editingId)
      if (error) throw error
      notifyDiscord('profile_edited', { profile_name: form.profile_name, fields_changed: [] })
    } else {
      const { error } = await supabase.from('profiles').insert(encrypted)
      if (error) throw error
      notifyDiscord('profile_added', {
        profile_name: form.profile_name,
        email: form.email,
        postcode: form.shipping_zip,
      })
    }

    await load()
    closeModal()
  } catch (err) {
    console.error('Save failed:', err)
    setErrors({ profile_name: `Save failed: ${err.message || 'Unknown error — check console'}` })
  } finally {
    setSaving(false)
  }
}

  // CSV Export
  function exportCSV(profilesArr) {
    const rows = profilesArr.map(p => ({
      PROFILE_NAME: p.profile_name,
      EMAIL: p.email,
      PHONE: p.phone,
      SHIPPING_FIRST_NAME: p.shipping_first_name,
      SHIPPING_LAST_NAME: p.shipping_last_name,
      SHIPPING_ADDRESS: p.shipping_address,
      SHIPPING_ADDRESS_2: p.shipping_address_2,
      SHIPPING_CITY: p.shipping_city,
      SHIPPING_ZIP: p.shipping_zip,
      SHIPPING_STATE: p.shipping_state,
      SHIPPING_COUNTRY: p.shipping_country,
      BILLING_FIRST_NAME: p.billing_same_as_shipping ? p.shipping_first_name : p.billing_first_name,
      BILLING_LAST_NAME: p.billing_same_as_shipping ? p.shipping_last_name : p.billing_last_name,
      BILLING_ADDRESS: p.billing_same_as_shipping ? p.shipping_address : p.billing_address,
      BILLING_ADDRESS_2: p.billing_same_as_shipping ? p.shipping_address_2 : p.billing_address_2,
      BILLING_CITY: p.billing_same_as_shipping ? p.shipping_city : p.billing_city,
      BILLING_ZIP: p.billing_same_as_shipping ? p.shipping_zip : p.billing_zip,
      BILLING_STATE: p.billing_same_as_shipping ? p.shipping_state : p.billing_state,
      BILLING_COUNTRY: p.billing_same_as_shipping ? p.shipping_country : p.billing_country,
      BILLING_SAME_AS_SHIPPING: p.billing_same_as_shipping ? 'TRUE' : 'FALSE',
      CARD_HOLDER_NAME: p.card_holder_name,
      CARD_TYPE: p.card_type,
      CARD_NUMBER: p.card_number,
      CARD_MONTH: p.card_month,
      CARD_YEAR: p.card_year,
      CARD_CVV: p.card_cvv,
      ONE_CHECKOUT_PER_PROFILE: p.one_checkout_per_profile ? 'TRUE' : 'FALSE',
    }))
    const csv = Papa.unparse(rows)
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'nirxv-aco_profiles.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  // CSV Import
  function handleImport(e) {
    const file = e.target.files[0]
    if (!file) return
    setImportLoading(true)
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async ({ data }) => {
        for (const row of data) {
          const p = {
            profile_name: row.PROFILE_NAME || '',
            email: row.EMAIL || '',
            phone: row.PHONE || '',
            shipping_first_name: row.SHIPPING_FIRST_NAME || '',
            shipping_last_name: row.SHIPPING_LAST_NAME || '',
            shipping_address: row.SHIPPING_ADDRESS || '',
            shipping_address_2: row.SHIPPING_ADDRESS_2 || '',
            shipping_city: row.SHIPPING_CITY || '',
            shipping_zip: row.SHIPPING_ZIP || '',
            shipping_state: row.SHIPPING_STATE || '',
            shipping_country: row.SHIPPING_COUNTRY || '',
            billing_same_as_shipping: row.BILLING_SAME_AS_SHIPPING === 'TRUE',
            billing_first_name: row.BILLING_FIRST_NAME || '',
            billing_last_name: row.BILLING_LAST_NAME || '',
            billing_address: row.BILLING_ADDRESS || '',
            billing_address_2: row.BILLING_ADDRESS_2 || '',
            billing_city: row.BILLING_CITY || '',
            billing_zip: row.BILLING_ZIP || '',
            billing_state: row.BILLING_STATE || '',
            billing_country: row.BILLING_COUNTRY || '',
            card_holder_name: row.CARD_HOLDER_NAME || '',
            card_type: row.CARD_TYPE || 'Visa',
            card_number: row.CARD_NUMBER || '',
            card_month: row.CARD_MONTH || '',
            card_year: row.CARD_YEAR || '',
            card_cvv: row.CARD_CVV || '',
            one_checkout_per_profile: row.ONE_CHECKOUT_PER_PROFILE === 'TRUE',
            user_id: user.id,
          }
          if (p.profile_name) {
            const encrypted = await encryptProfile(p)
            await supabase.from('profiles').insert(encrypted)
          }
        }
        await load()
        setImportLoading(false)
      }
    })
    e.target.value = ''
  }

  const filtered = profiles.filter(p =>
    p.profile_name?.toLowerCase().includes(search.toLowerCase()) ||
    p.email?.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="max-w-6xl mx-auto animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 mb-6">
        <div>
          <h1 className="font-display font-extrabold text-2xl text-vault-text">Profiles</h1>
          <p className="text-vault-text-dim text-sm font-body mt-0.5">{profiles.length} profile{profiles.length !== 1 ? 's' : ''} stored</p>
        </div>
        <div className="sm:ml-auto flex gap-2 flex-wrap">
          <label className={`vault-btn-ghost cursor-pointer ${importLoading ? 'opacity-50' : ''}`}>
            <Upload className="w-4 h-4" />
            {importLoading ? 'Importing...' : 'Import CSV'}
            <input type="file" accept=".csv" className="hidden" onChange={handleImport} disabled={importLoading} />
          </label>
          <button className="vault-btn-ghost" onClick={() => exportCSV(profiles)} disabled={!profiles.length}>
            <Download className="w-4 h-4" /> Export CSV
          </button>
          <button className="vault-btn-primary" onClick={openNew}>
            <Plus className="w-4 h-4" /> New Profile
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-vault-muted" />
        <input className="vault-input pl-9" placeholder="Search profiles..." value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {/* List */}
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-2 border-vault-accent border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="vault-card text-center py-16">
          <CreditCard className="w-10 h-10 text-vault-muted mx-auto mb-3" />
          <p className="text-vault-text font-display font-semibold">No profiles yet</p>
          <p className="text-vault-text-dim text-sm mt-1">Create your first profile or import a CSV</p>
        </div>
      ) : (
        <div className="space-y-2 stagger">
          {filtered.map(p => (
            <div key={p.id} className="vault-card hover:border-vault-accent/30 transition-colors">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-vault-accent/10 border border-vault-accent/20 flex items-center justify-center shrink-0">
                  <CreditCard className="w-5 h-5 text-vault-accent" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-display font-semibold text-vault-text truncate">{p.profile_name}</p>
                  <p className="text-vault-text-dim text-xs font-mono truncate">{p.email}</p>
                </div>
                {/* Card masked/revealed */}
                <div className="hidden sm:flex items-center gap-2">
                  <span className="font-mono text-sm text-vault-text-dim">
                    {revealedCards.has(p.id) ? p.card_number : maskCard(p.card_number)}
                  </span>
                  <button onClick={() => toggleReveal(p.id)} className="text-vault-muted hover:text-vault-text-dim transition-colors">
                    {revealedCards.has(p.id) ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {/* Actions */}
                <div className="flex items-center gap-1 ml-2">
                  <button onClick={() => setExpandedId(expandedId === p.id ? null : p.id)} className="p-2 text-vault-muted hover:text-vault-text rounded-lg hover:bg-vault-border transition-all">
                    {expandedId === p.id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                  <button onClick={() => openEdit(p)} className="p-2 text-vault-muted hover:text-vault-accent rounded-lg hover:bg-vault-accent/10 transition-all">
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button onClick={() => exportCSV([p])} className="p-2 text-vault-muted hover:text-vault-green rounded-lg hover:bg-vault-green/10 transition-all">
                    <Download className="w-4 h-4" />
                  </button>
                  <button onClick={() => setDeleteConfirm(p.id)} className="p-2 text-vault-muted hover:text-vault-red rounded-lg hover:bg-vault-red/10 transition-all">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Expanded details */}
              {expandedId === p.id && (
                <div className="mt-4 pt-4 border-t border-vault-border grid grid-cols-2 sm:grid-cols-3 gap-3 animate-fade-in">
                  {[
                    ['Phone', p.phone],
                    ['Ship To', `${p.shipping_first_name} ${p.shipping_last_name}`],
                    ['Address', `${p.shipping_address}, ${p.shipping_city}`],
                    ['ZIP', p.shipping_zip],
                    ['Country', p.shipping_country],
                    ['Card Type', p.card_type],
                    ['Card #', revealedCards.has(p.id) ? p.card_number : maskCard(p.card_number)],
                    ['Expiry', `${p.card_month}/${p.card_year}`],
                    ['CVV', revealedCards.has(p.id) ? p.card_cvv : '•••'],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <p className="text-[10px] font-mono text-vault-muted uppercase tracking-widest">{k}</p>
                      <p className="text-sm font-body text-vault-text mt-0.5">{v || '—'}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Delete Confirm Modal */}
      {deleteConfirm && createPortal(
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="vault-card max-w-sm w-full animate-fade-in">
            <div className="flex items-center gap-3 mb-3">
              <AlertTriangle className="w-5 h-5 text-vault-red shrink-0" />
              <h3 className="font-display font-bold text-vault-text">Delete Profile?</h3>
            </div>
            <p className="text-vault-text-dim text-sm font-body mb-5">This cannot be undone. The profile and all its data will be permanently removed.</p>
            <div className="flex gap-2 justify-end">
              <button className="vault-btn-ghost" onClick={() => setDeleteConfirm(null)}>Cancel</button>
              <button className="vault-btn-danger" onClick={() => handleDelete(deleteConfirm)}>
                <Trash2 className="w-4 h-4" /> Delete
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Create/Edit Modal */}
      {modalOpen && createPortal(
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="vault-card w-full max-w-2xl flex flex-col animate-fade-in" style={{ maxHeight: '90vh' }}>

            {/* Fixed header */}
            <div className="flex items-center justify-between mb-6 shrink-0">
              <h2 className="font-display font-bold text-xl text-vault-text">{editingId ? 'Edit Profile' : 'New Profile'}</h2>
              <button onClick={closeModal} className="text-vault-muted hover:text-vault-text transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Scrollable content */}
            <div className="overflow-y-auto flex-1 pr-1 space-y-6">
              {/* Basic */}
              <section>
                <p className="text-[10px] font-mono text-vault-muted uppercase tracking-widest mb-3">Basic Info</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="Profile Name" name="profile_name" required placeholder="Main Profile"  form={form} errors={errors} setForm={setForm} />
                  <Field label="Email" name="email" type="email" required placeholder="you@example.com" form={form} errors={errors} setForm={setForm} />
                  <div>
                    <label className="vault-label">Phone <span className="text-vault-red ml-1">*</span></label>
                    <input
                      className={`vault-input ${errors.phone ? 'border-vault-red' : ''}`}
                      placeholder="07911123456"
                      value={form.phone}
                      onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                    />
                    {errors.phone
                      ? <p className="text-vault-red text-xs mt-1 font-mono">{errors.phone}</p>
                      : <p className="text-vault-muted text-xs mt-1 font-mono">11 digits, must start with 07</p>
                    }
                  </div>
                </div>
              </section>

              {/* Shipping */}
              <section>
                <p className="text-[10px] font-mono text-vault-muted uppercase tracking-widest mb-3">Shipping</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="First Name" name="shipping_first_name" required form={form} errors={errors} setForm={setForm} />
                  <Field label="Last Name" name="shipping_last_name" required form={form} errors={errors} setForm={setForm} />
                  {/* Address with jig tool */}
                  <div className="sm:col-span-2">
                    <label className="vault-label">Address <span className="text-vault-red ml-1">*</span></label>
                    <input
                      className={`vault-input ${errors.shipping_address ? 'border-vault-red' : ''}`}
                      placeholder="123 High Street"
                      value={form.shipping_address}
                      onChange={e => setForm(f => ({ ...f, shipping_address: e.target.value }))}
                    />
                    {errors.shipping_address && (
                      <p className="text-vault-red text-xs mt-1 font-mono">{errors.shipping_address}</p>
                    )}
                    {/* Jig tool — shows when address has a house number */}
                    {form.shipping_address.trim() && /^\d/.test(form.shipping_address.trim()) && (
                      <JigTool
                        currentAddress={form.shipping_address}
                        onApply={(line1, line2) => setForm(f => ({
                          ...f,
                          shipping_address: line1,
                          shipping_address_2: line2 || f.shipping_address_2,
                        }))}
                      />
                    )}
                  </div>
                  <Field label="Address 2" name="shipping_address_2" placeholder="Apt, suite..." form={form} errors={errors} setForm={setForm} />
                  <Field label="City" name="shipping_city" required form={form} errors={errors} setForm={setForm} />
                  {/* Postcode with live count */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="vault-label mb-0">ZIP / Postcode <span className="text-vault-red ml-1">*</span></label>
                      {form.shipping_zip.trim() && (() => {
                        const zip = form.shipping_zip.trim().toUpperCase()
                        const count = profiles.filter(p =>
                          p.id !== editingId &&
                          p.shipping_zip?.trim().toUpperCase() === zip
                        ).length
                        const remaining = 3 - count
                        return (
                          <span className={`text-[10px] font-mono ${remaining <= 0 ? 'text-vault-red' : remaining === 1 ? 'text-vault-gold' : 'text-vault-muted'}`}>
                            {count}/3 profiles at this postcode
                            {remaining <= 0 ? ' — FULL' : remaining === 1 ? ' — 1 left' : ''}
                          </span>
                        )
                      })()}
                    </div>
                    <input
                      className={`vault-input ${errors.shipping_zip ? 'border-vault-red' : ''}`}
                      placeholder="NW7 3EX"
                      value={form.shipping_zip}
                      onChange={e => setForm(f => ({ ...f, shipping_zip: e.target.value }))}
                    />
                    {errors.shipping_zip && <p className="text-vault-red text-xs mt-1 font-mono">{errors.shipping_zip}</p>}
                  </div>
                  <Field label="State / County" name="shipping_state" form={form} errors={errors} setForm={setForm} />
                  <Field label="Country" name="shipping_country" required options={COUNTRIES} form={form} errors={errors} setForm={setForm} />
                </div>
              </section>

              {/* Billing toggle */}
              <section>
                <div className="flex items-center gap-3 mb-3">
                  <button type="button"
                    onClick={() => !form.is_virtual_card && setForm(f => ({ ...f, billing_same_as_shipping: !f.billing_same_as_shipping }))}
                    disabled={form.is_virtual_card}
                    className={`relative inline-flex w-11 h-6 rounded-full transition-colors duration-200 focus:outline-none
                      ${form.billing_same_as_shipping ? 'bg-vault-accent' : 'bg-vault-border'}
                      ${form.is_virtual_card ? 'opacity-60 cursor-not-allowed' : ''}`}>
                    <span className={`absolute left-1 top-1 w-4 h-4 bg-white rounded-full shadow transition-transform duration-200 ${form.billing_same_as_shipping ? 'translate-x-5' : 'translate-x-0'}`} />
                  </button>
                  <div>
                    <span className="text-sm font-body text-vault-text-dim">Billing same as shipping</span>
                    {form.is_virtual_card && (
                      <p className="text-xs font-mono text-vault-accent mt-0.5">Locked — virtual card</p>
                    )}
                  </div>
                </div>
                {!form.billing_same_as_shipping && !form.is_virtual_card && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Field label="Billing First Name" name="billing_first_name" form={form} errors={errors} setForm={setForm} />
                    <Field label="Billing Last Name" name="billing_last_name" form={form} errors={errors} setForm={setForm} />
                    <div className="sm:col-span-2"><Field label="Billing Address" name="billing_address" form={form} errors={errors} setForm={setForm} /></div>
                    <Field label="Billing City" name="billing_city" form={form} errors={errors} setForm={setForm} />
                    <Field label="Billing ZIP" name="billing_zip" form={form} errors={errors} setForm={setForm} />
                    <Field label="Billing State" name="billing_state" form={form} errors={errors} setForm={setForm} />
                    <Field label="Billing Country" name="billing_country" options={COUNTRIES} form={form} errors={errors} setForm={setForm} />
                  </div>
                )}
              </section>

              {/* Card */}
              <section>
                <p className="text-[10px] font-mono text-vault-muted uppercase tracking-widest mb-3">Card Details</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="Card Holder Name" name="card_holder_name" required form={form} errors={errors} setForm={setForm} />
                  <Field label="Card Type" name="card_type" options={CARD_TYPES} form={form} errors={errors} setForm={setForm} />
                  <div className="sm:col-span-2">
                    <label className="vault-label">Card Number <span className="text-vault-red ml-1">*</span></label>
                    <input
                      className={`vault-input ${errors.card_number ? 'border-vault-red' : ''}`}
                      placeholder={
                        form.card_type === 'Visa' ? '4xxx xxxx xxxx xxxx' :
                        form.card_type === 'Mastercard' ? '5xxx xxxx xxxx xxxx' :
                        '4111 1111 1111 1111'
                      }
                      value={form.card_number}
                      onChange={e => setForm(f => ({ ...f, card_number: e.target.value }))}
                    />
                    {/* Live prefix hint */}
                    {form.card_number && !errors.card_number && (
                      <p className="text-vault-green text-xs mt-1 font-mono">
                        {form.card_type === 'Visa' && form.card_number.replace(/\s/g,'')[0] === '4' && '✓ Valid Visa prefix'}
                        {form.card_type === 'Mastercard' && form.card_number.replace(/\s/g,'')[0] === '5' && '✓ Valid Mastercard prefix'}
                      </p>
                    )}
                    {errors.card_number && <p className="text-vault-red text-xs mt-1 font-mono">{errors.card_number}</p>}
                    {/* Hint when card type is selected but no number yet */}
                    {!form.card_number && (
                      <p className="text-vault-muted text-xs mt-1 font-mono">
                        {form.card_type === 'Visa' && 'Visa cards must start with 4'}
                        {form.card_type === 'Mastercard' && 'Mastercard numbers must start with 5'}
                      </p>
                    )}
                  </div>
                  <Field label="Expiry Month (MM)" name="card_month" required placeholder="01" form={form} errors={errors} setForm={setForm} />
                  <Field label="Expiry Year (YY)" name="card_year" required placeholder="28" form={form} errors={errors} setForm={setForm} />
                  <Field label="CVV" name="card_cvv" required placeholder="123" form={form} errors={errors} setForm={setForm} />
                </div>
              </section>

              {/* Settings */}
              <section className="space-y-3">
                {/* Virtual card toggle — forces billing = shipping */}
                <div className={`rounded-xl p-3 border transition-all ${form.is_virtual_card ? 'bg-vault-accent/5 border-vault-accent/30' : 'bg-vault-bg border-vault-border'}`}>
                  <div className="flex items-center gap-3">
                    <button type="button"
                      onClick={() => setForm(f => ({
                        ...f,
                        is_virtual_card: !f.is_virtual_card,
                        // Virtual card always forces billing = shipping
                        billing_same_as_shipping: !f.is_virtual_card ? true : f.billing_same_as_shipping,
                      }))}
                      className={`relative inline-flex w-11 h-6 rounded-full transition-colors duration-200 focus:outline-none shrink-0 ${form.is_virtual_card ? 'bg-vault-accent' : 'bg-vault-border'}`}>
                      <span className={`absolute left-1 top-1 w-4 h-4 bg-white rounded-full shadow transition-transform duration-200 ${form.is_virtual_card ? 'translate-x-5' : 'translate-x-0'}`} />
                    </button>
                    <div>
                      <p className="text-sm font-body text-vault-text">Virtual card</p>
                      <p className="text-xs font-mono text-vault-muted">
                        {form.is_virtual_card
                          ? '✓ Billing address automatically set to match shipping'
                          : 'Toggle on if this is a virtual/prepaid card'}
                      </p>
                    </div>
                  </div>
                </div>

                {/* One checkout per profile — always on, not editable */}
                <div className="flex items-center gap-3 px-1">
                  <div className="relative inline-flex w-11 h-6 rounded-full bg-vault-accent shrink-0 opacity-60 cursor-not-allowed">
                    <span className="absolute left-1 top-1 w-4 h-4 bg-white rounded-full shadow translate-x-5" />
                  </div>
                  <div>
                    <p className="text-sm font-body text-vault-text-dim">One checkout per profile</p>
                    <p className="text-xs font-mono text-vault-muted">Always enabled — required for safe botting</p>
                  </div>
                </div>
              </section>
            </div>

            {/* Fixed footer */}
            <div className="flex justify-end gap-2 mt-6 pt-5 border-t border-vault-border shrink-0">
              <button className="vault-btn-ghost" onClick={closeModal}>Cancel</button>
              <button className="vault-btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Save className="w-4 h-4" />}
                {saving ? 'Saving...' : editingId ? 'Save Changes' : 'Create Profile'}
              </button>
            </div>
          </div>
        </div>,
        document.body
       )}
    </div>
  )
}


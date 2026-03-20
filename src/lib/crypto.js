// src/lib/crypto.js
// 
// SECURITY: Encryption still happens in the browser (safe — we WANT to encrypt before sending)
// SECURITY: Decryption now happens via Edge Function — the key never lives in the browser bundle.
//
// The VITE_ENCRYPTION_KEY env var is ONLY used for encryption (writing data).
// Reading/decrypting goes through the decrypt-profile Edge Function.

import { supabase } from './supabase'

const ENCRYPTION_KEY = import.meta.env.VITE_ENCRYPTION_KEY || 'fallback-dev-key-change-in-prod!!'
const SUPABASE_URL   = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON  = import.meta.env.VITE_SUPABASE_ANON_KEY

async function getKey() {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(ENCRYPTION_KEY.padEnd(32, '0').slice(0, 32)),
    { name: 'AES-GCM' },
    false,
    ['encrypt']  // encrypt only — no decrypt permission in browser
  )
  return keyMaterial
}

// Encrypt stays in the browser — this is safe, we want data encrypted before it hits the DB
export async function encrypt(plaintext) {
  if (!plaintext) return ''
  try {
    const key = await getKey()
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const encoded = new TextEncoder().encode(String(plaintext))
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded)
    const combined = new Uint8Array(iv.byteLength + ciphertext.byteLength)
    combined.set(iv, 0)
    combined.set(new Uint8Array(ciphertext), iv.byteLength)
    return btoa(String.fromCharCode(...combined))
  } catch (e) {
    console.error('Encryption failed', e)
    return ''
  }
}

// Decrypt goes via Edge Function — key never touches the browser
export async function decryptProfiles(profiles) {
  if (!profiles || profiles.length === 0) return []
  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) throw new Error('No session')

    const res = await fetch(`${SUPABASE_URL}/functions/v1/decrypt-profile`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
        'apikey': SUPABASE_ANON,
      },
      body: JSON.stringify({ profiles }),
    })

    if (!res.ok) {
      const err = await res.text()
      console.error('Decrypt edge function error:', err)
      return profiles.map(p => ({ ...p, card_number: '[error]', card_cvv: '[error]' }))
    }

    const data = await res.json()
    return data.profiles
  } catch (e) {
    console.error('Decryption failed', e)
    return profiles.map(p => ({ ...p, card_number: '[error]', card_cvv: '[error]' }))
  }
}

// Single profile decrypt helper (wraps the batch function)
export async function decryptProfile(profile) {
  const results = await decryptProfiles([profile])
  return results[0]
}

export function maskCard(cardNumber) {
  if (!cardNumber) return '•••• •••• •••• ••••'
  const clean = cardNumber.replace(/\s/g, '')
  if (clean.length < 4) return '•••• •••• •••• ••••'
  return `•••• •••• •••• ${clean.slice(-4)}`
}

export const ENCRYPTED_FIELDS = [
  'card_number', 'card_cvv', 'card_holder_name',
  'card_month', 'card_year', 'card_type',
  'billing_first_name', 'billing_last_name',
  'billing_address', 'billing_address_2',
  'billing_city', 'billing_zip', 'billing_state', 'billing_country',
  'shipping_first_name', 'shipping_last_name',
  'shipping_address', 'shipping_address_2',
  'shipping_city', 'shipping_zip', 'shipping_state',
  'phone', 'email',
]

export async function encryptProfile(profile) {
  const result = { ...profile }
  for (const field of ENCRYPTED_FIELDS) {
    if (result[field] !== undefined && result[field] !== null) {
      result[field] = await encrypt(String(result[field]))
    }
  }
  return result
}

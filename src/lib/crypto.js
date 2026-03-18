// AES-256-GCM encryption using the browser's native Web Crypto API
// The encryption key is derived from VITE_ENCRYPTION_KEY env var

const ENCRYPTION_KEY = import.meta.env.VITE_ENCRYPTION_KEY || 'fallback-dev-key-change-in-prod!!'

async function getKey() {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(ENCRYPTION_KEY.padEnd(32, '0').slice(0, 32)),
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  )
  return keyMaterial
}

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

export async function decrypt(ciphertext) {
  if (!ciphertext) return ''
  try {
    const key = await getKey()
    const combined = Uint8Array.from(atob(ciphertext), c => c.charCodeAt(0))
    const iv = combined.slice(0, 12)
    const data = combined.slice(12)
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data)
    return new TextDecoder().decode(decrypted)
  } catch (e) {
    console.error('Decryption failed', e)
    return '[decryption error]'
  }
}

export function maskCard(cardNumber) {
  if (!cardNumber) return '•••• •••• •••• ••••'
  const clean = cardNumber.replace(/\s/g, '')
  if (clean.length < 4) return '•••• •••• •••• ••••'
  return `•••• •••• •••• ${clean.slice(-4)}`
}

// Fields that must be encrypted before storing
export const ENCRYPTED_FIELDS = [
  'card_number', 'card_cvv', 'card_holder_name',
  'card_month', 'card_year', 'card_type',
  'billing_address', 'billing_address_2',
  'billing_first_name', 'billing_last_name',
  'billing_city', 'billing_zip', 'billing_state', 'billing_country',
  'phone', 'email'
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

export async function decryptProfile(profile) {
  const result = { ...profile }
  for (const field of ENCRYPTED_FIELDS) {
    if (result[field] !== undefined && result[field] !== null && result[field] !== '') {
      result[field] = await decrypt(result[field])
    }
  }
  return result
}

// Supabase Edge Function: decrypt-profile
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ENCRYPTION_KEY = Deno.env.get('ENCRYPTION_KEY')!
const SUPABASE_URL   = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON  = Deno.env.get('SUPABASE_ANON_KEY')!

const ALLOWED_ORIGINS = ['https://nirxvaco.com', 'https://www.nirxvaco.com']

function getCorsHeaders(req: Request) {
  const origin = req.headers.get('origin') || ''
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
}

async function getKey(): Promise<CryptoKey> {
  const raw = new TextEncoder().encode(ENCRYPTION_KEY.padEnd(32, '0').slice(0, 32))
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['decrypt'])
}

async function decryptField(ciphertext: string): Promise<string> {
  if (!ciphertext) return ''
  try {
    const key = await getKey()
    const combined = Uint8Array.from(atob(ciphertext), c => c.charCodeAt(0))
    const iv   = combined.slice(0, 12)
    const data = combined.slice(12)
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data)
    return new TextDecoder().decode(decrypted)
  } catch {
    return '[decryption error]'
  }
}

const ENCRYPTED_FIELDS = [
  'card_number', 'card_cvv', 'card_holder_name', 'card_month', 'card_year', 'card_type',
  'billing_first_name', 'billing_last_name', 'billing_address', 'billing_address_2',
  'billing_city', 'billing_zip', 'billing_state', 'billing_country',
  'shipping_first_name', 'shipping_last_name', 'shipping_address', 'shipping_address_2',
  'shipping_city', 'shipping_zip', 'shipping_state',
  'phone', 'email',
]

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req)

  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders })
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'Invalid or expired token' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  try {
    const { profiles } = await req.json()

    if (!Array.isArray(profiles)) {
      return new Response(JSON.stringify({ error: 'profiles must be an array' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const decrypted = await Promise.all(profiles.map(async (profile: Record<string, string>) => {
      const result = { ...profile }
      for (const field of ENCRYPTED_FIELDS) {
        if (result[field]) {
          result[field] = await decryptField(result[field])
        }
      }
      return result
    }))

    return new Response(JSON.stringify({ profiles: decrypted }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
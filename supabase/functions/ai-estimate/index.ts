// Supabase Edge Function: ai-estimate
// Proxies requests to Anthropic API so the API key never touches the browser.
//
// Deploy: supabase functions deploy ai-estimate
// Secret: supabase secrets set ANTHROPIC_API_KEY=sk-ant-your-key-here

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!
const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON     = Deno.env.get('SUPABASE_ANON_KEY')!

const corsHeaders = {
  'Access-Control-Allow-Origin': request.headers.get('origin') === 'https://www.nirxvaco.com' 
  ? 'https://www.nirxvaco.com' 
  : 'https://nirxvaco.com',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  // Require a valid authenticated session
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
    const { item_name, buy_price } = await req.json()

    if (!item_name || !buy_price) {
      return new Response(JSON.stringify({ error: 'item_name and buy_price are required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 50,
        messages: [{
          role: 'user',
          content: `I bought "${item_name}" for £${buy_price}. What is a realistic resale price in GBP on the secondary market today? Reply with ONLY a number, no currency symbol, no explanation. Just the number.`
        }]
      })
    })

    const data = await res.json()
    const text = data.content?.[0]?.text?.trim().replace(/[^0-9.]/g, '')

    if (!text || isNaN(parseFloat(text))) {
      return new Response(JSON.stringify({ error: 'Could not estimate price' }), {
        status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ estimate: parseFloat(text).toFixed(2) }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})

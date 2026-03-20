// Supabase Edge Function: discord-notify
// Called from the frontend whenever a notable action happens.
// Set DISCORD_WEBHOOK_URL as a Supabase secret.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const WEBHOOK_URL   = Deno.env.get('DISCORD_WEBHOOK_URL')!
const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON = Deno.env.get('SUPABASE_ANON_KEY')!

// FIX (Security): Locked CORS to nirxvaco.com only.
// Previously '*' which allowed any origin to call this function.
const corsHeaders = {
  'Access-Control-Allow-Origin': request.headers.get('origin') === 'https://www.nirxvaco.com' 
  ? 'https://www.nirxvaco.com' 
  : 'https://nirxvaco.com',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const COLOURS = {
  profile_added:  0x00c8ff,
  profile_edited: 0x7a8aff,
  invoice_paid:   0x00e396,
  drop_signup:    0xffe600,
  pkc_opt_out:    0xff3355,
  pkc_opt_in:     0x00e396,
  drop_opt_out:   0xff6b35,
}

const ICONS = {
  profile_added:  '👤',
  profile_edited: '✏️',
  invoice_paid:   '💰',
  drop_signup:    '📦',
  pkc_opt_out:    '❌',
  pkc_opt_in:     '✅',
  drop_opt_out:   '🚫',
}

const TITLES = {
  profile_added:  'New Profile Added',
  profile_edited: 'Profile Edited',
  invoice_paid:   'Invoice Marked as Paid',
  drop_signup:    'Drop Sign Up',
  pkc_opt_out:    'PKC Opt Out',
  pkc_opt_in:     'PKC Opt Back In',
  drop_opt_out:   'Cleared Profiles for Drop',
}

const DESCRIPTIONS = {
  profile_added:  (u: string) => `**${u}** added a new profile`,
  profile_edited: (u: string) => `**${u}** edited a profile`,
  invoice_paid:   (u: string) => `**${u}** marked an invoice as paid`,
  drop_signup:    (u: string) => `**${u}** signed up for a drop`,
  pkc_opt_out:    (u: string) => `**${u}** has opted out of PKC`,
  pkc_opt_in:     (u: string) => `**${u}** has opted back into PKC`,
  drop_opt_out:   (u: string) => `**${u}** cleared their profiles for a drop`,
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  // FIX (Security): Verify the request comes from a real authenticated user.
  // Previously the public anon key was used as the Authorization token —
  // it's visible in browser source and provides zero authentication guarantee.
  // Now we require a valid JWT session token and verify it server-side.
  const authHeader = req.headers.get('Authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Verify the JWT is a real active Supabase session
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'Invalid or expired token' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  try {
    const { event, username, details } = await req.json()

    const colour = COLOURS[event as keyof typeof COLOURS] ?? 0x7a7a9a
    const icon   = ICONS[event as keyof typeof ICONS]     ?? '🔔'
    const title  = TITLES[event as keyof typeof TITLES]   ?? 'Notification'
    const descFn = DESCRIPTIONS[event as keyof typeof DESCRIPTIONS] ?? ((u: string) => `**${u}** performed an action`)

    const fields: { name: string; value: string; inline: boolean }[] = []

    if (event === 'profile_added') {
      if (details.profile_name) fields.push({ name: 'Profile', value: `\`${details.profile_name}\``, inline: true })
      // email and postcode intentionally excluded — PII
    }

    if (event === 'profile_edited') {
      if (details.profile_name) fields.push({ name: 'Profile', value: `\`${details.profile_name}\``, inline: true })
      if (details.fields_changed?.length) {
        fields.push({ name: 'Fields changed', value: details.fields_changed.join(', '), inline: false })
      }
    }

    if (event === 'invoice_paid') {
      if (details.title)  fields.push({ name: 'Invoice', value: `\`${details.title}\``,                          inline: true })
      if (details.amount) fields.push({ name: 'Amount',  value: `**£${parseFloat(details.amount).toFixed(2)}**`, inline: true })
    }

    if (event === 'drop_signup') {
      if (details.drop_name)     fields.push({ name: 'Drop',     value: `\`${details.drop_name}\``,     inline: true })
      if (details.profile_count) fields.push({ name: 'Profiles', value: `**${details.profile_count}**`, inline: true })
      if (details.profile_names?.length) {
        fields.push({ name: 'Profile Names', value: details.profile_names.join(', '), inline: false })
      }
    }

    if (event === 'drop_opt_out') {
      if (details.drop_name) fields.push({ name: 'Drop', value: `\`${details.drop_name}\``, inline: true })
    }

    if (event === 'pkc_opt_out' || event === 'pkc_opt_in') {
      if (details.status) fields.push({ name: 'Status', value: details.status, inline: true })
    }

    const embed = {
      title:       `${icon} ${title}`,
      color:       colour,
      description: descFn(username),
      fields,
      footer:      { text: 'Nirxv ACO' },
      timestamp:   new Date().toISOString(),
    }

    const res = await fetch(WEBHOOK_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ embeds: [embed] }),
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Discord webhook failed: ${res.status} ${text}`)
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (err) {
    console.error('discord-notify error:', err)
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})

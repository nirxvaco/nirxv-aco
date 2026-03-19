// Supabase Edge Function: discord-notify
// Called from the frontend whenever a notable action happens.
// Set DISCORD_WEBHOOK_URL as a Supabase secret.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const WEBHOOK_URL = Deno.env.get('DISCORD_WEBHOOK_URL')!

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// Colours per event type (Discord embed colour as decimal)
const COLOURS = {
  profile_added:   0x00c8ff,
  profile_edited:  0x7a8aff,
  invoice_paid:    0x00e396,
  drop_signup:     0xffe600,
  pkc_opt_out:     0xff3355,
  pkc_opt_in:      0x00e396,
}

const ICONS = {
  profile_added:   '👤',
  profile_edited:  '✏️',
  invoice_paid:    '💰',
  drop_signup:     '📦',
  pkc_opt_out:     '❌',
  pkc_opt_in:      '✅',
}

const TITLES = {
  profile_added:   'New Profile Added',
  profile_edited:  'Profile Edited',
  invoice_paid:    'Invoice Marked as Paid',
  drop_signup:     'Drop Sign Up',
  pkc_opt_out:     'PKC Opt Out',
  pkc_opt_in:      'PKC Opt Back In',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { event, username, details } = await req.json()
    // event: 'profile_added' | 'profile_edited' | 'invoice_paid' | 'drop_signup'
    // username: the member's display name
    // details: object with relevant fields

    const colour = COLOURS[event] ?? 0x7a7a9a
    const icon   = ICONS[event]   ?? '🔔'
    const title  = TITLES[event]  ?? 'Notification'

    // Build fields based on event
    const fields = []

    if (event === 'profile_added') {
      if (details.profile_name) fields.push({ name: 'Profile', value: `\`${details.profile_name}\``, inline: true })
      if (details.email)        fields.push({ name: 'Email',   value: `\`${details.email}\``,        inline: true })
      if (details.postcode)     fields.push({ name: 'Postcode',value: `\`${details.postcode}\``,     inline: true })
    }

    if (event === 'profile_edited') {
      if (details.profile_name) fields.push({ name: 'Profile', value: `\`${details.profile_name}\``, inline: true })
      if (details.fields_changed?.length) {
        fields.push({ name: 'Fields changed', value: details.fields_changed.join(', '), inline: false })
      }
    }

    if (event === 'invoice_paid') {
      if (details.title)  fields.push({ name: 'Invoice', value: `\`${details.title}\``,              inline: true })
      if (details.amount) fields.push({ name: 'Amount',  value: `**£${parseFloat(details.amount).toFixed(2)}**`, inline: true })
    }

    if (event === 'drop_signup') {
      if (details.drop_name)     fields.push({ name: 'Drop',     value: `\`${details.drop_name}\``,                          inline: true })
      if (details.profile_count) fields.push({ name: 'Profiles', value: `**${details.profile_count}**`,                      inline: true })
      if (details.profile_names?.length) {
        fields.push({ name: 'Profile Names', value: details.profile_names.join(', '), inline: false })
      }
    }

    const embed = {
      title:       `${icon} ${title}`,
      color:       colour,
      description: `**${username}** just ${TITLES[event]?.toLowerCase() ?? 'did something'}`,
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
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (err) {
    console.error('discord-notify error:', err)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})

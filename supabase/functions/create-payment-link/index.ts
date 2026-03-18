// Supabase Edge Function: create-payment-link
// Deployed to: supabase/functions/create-payment-link/index.ts
// This runs server-side so your Stripe secret key is never exposed

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY')!
const WARRIOR_ACCOUNT_ID = Deno.env.get('WARRIOR_STRIPE_ACCOUNT_ID')! // acct_xxxxx

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { amount, currency, description, split_with_warrior, invoice_id } = await req.json()

    // Amount must be in pence (Stripe uses smallest currency unit)
    const amountPence = Math.round(parseFloat(amount) * 100)

    let paymentLinkUrl: string

    if (split_with_warrior && WARRIOR_ACCOUNT_ID) {
      // ── SPLIT PAYMENT (Warrior's runners) ──────────────────────────────
      // Uses Stripe Connect transfer_data to route 50% to Warrior automatically
      // You keep 50%, Warrior gets 50% sent directly to his Express account

      const warriorShare = Math.floor(amountPence * 0.5) // 50% to Warrior

      // Create a Payment Link with Connect
      const response = await fetch('https://api.stripe.com/v1/payment_links', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${STRIPE_SECRET_KEY}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          'line_items[0][price_data][currency]': currency || 'gbp',
          'line_items[0][price_data][unit_amount]': amountPence.toString(),
          'line_items[0][price_data][product_data][name]': description || 'ACO Payment',
          'line_items[0][quantity]': '1',
          // Route Warrior's share to his Express account
          'payment_intent_data[transfer_data][destination]': WARRIOR_ACCOUNT_ID,
          'payment_intent_data[transfer_data][amount]': warriorShare.toString(),
          'metadata[invoice_id]': invoice_id || '',
          'metadata[split_type]': 'warrior_50_50',
          'metadata[warrior_share]': warriorShare.toString(),
          'metadata[your_share]': (amountPence - warriorShare).toString(),
        }),
      })

      const paymentLink = await response.json()
      if (!response.ok) throw new Error(paymentLink.error?.message || 'Stripe error')
      paymentLinkUrl = paymentLink.url

    } else {
      // ── STANDARD PAYMENT (your runners - 100% to you) ──────────────────
      const response = await fetch('https://api.stripe.com/v1/payment_links', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${STRIPE_SECRET_KEY}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          'line_items[0][price_data][currency]': currency || 'gbp',
          'line_items[0][price_data][unit_amount]': amountPence.toString(),
          'line_items[0][price_data][product_data][name]': description || 'ACO Payment',
          'line_items[0][quantity]': '1',
          'metadata[invoice_id]': invoice_id || '',
          'metadata[split_type]': 'full',
        }),
      })

      const paymentLink = await response.json()
      if (!response.ok) throw new Error(paymentLink.error?.message || 'Stripe error')
      paymentLinkUrl = paymentLink.url
    }

    return new Response(
      JSON.stringify({ url: paymentLinkUrl }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

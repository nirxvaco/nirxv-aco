// src/lib/notify.js
import { supabase } from './supabase'

export async function notifyDiscord(event, details = {}) {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      console.warn('[notify] No session found')
      return
    }

    // Get username from user_profiles table
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('username')
      .eq('id', session.user.id)
      .single()

    const username = profile?.username
      || session.user?.email?.split('@')[0]
      || 'Unknown'

    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

    const res = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/discord-notify`,
      {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${anonKey}`,
          'apikey':        anonKey,
        },
        body: JSON.stringify({ event, username, details }),
      }
    )

    if (!res.ok) {
      const text = await res.text()
      console.warn('[notify] Edge function error:', res.status, text)
    } else {
      console.log('[notify] Sent:', event, username)
    }
  } catch (err) {
    console.warn('[notify] Failed:', err)
  }
}

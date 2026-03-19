// src/lib/notify.js
import { supabase } from './supabase'

// Pass username directly from useAuth().profile.username
// This avoids RLS issues with re-querying user_profiles
export async function notifyDiscord(event, details = {}, username = 'Unknown') {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return

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
      console.log('[notify] Sent:', event, 'as', username)
    }
  } catch (err) {
    console.warn('[notify] Failed:', err)
  }
}

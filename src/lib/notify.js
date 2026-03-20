// src/lib/notify.js
import { supabase } from './supabase'

// Pass username directly from useAuth().profile.username
// This avoids RLS issues with re-querying user_profiles
export async function notifyDiscord(event, details = {}, username = 'Unknown') {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return

    const res = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/discord-notify`,
      {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          // FIX (Security): Use the user's JWT session token, not the public anon key.
          // The anon key is visible in browser source code and provides zero
          // authentication — anyone could call the edge function with it.
          // session.access_token is a short-lived signed JWT proving the user
          // is genuinely authenticated. It expires automatically.
          'Authorization': `Bearer ${session.access_token}`,
          // apikey still uses anon key — required by Supabase for routing, this is correct.
          'apikey':        import.meta.env.VITE_SUPABASE_ANON_KEY,
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

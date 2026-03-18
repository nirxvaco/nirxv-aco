// src/lib/notify.js
import { supabase } from './supabase'

export async function notifyDiscord(event, details = {}) {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return

    // Use the user's own session token to query user_profiles (RLS allows this)
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('username')
      .eq('id', session.user.id)
      .single()

    // Strictly use the username they typed on signup — never fall back to email
    const username = profile?.username || 'Unknown'

    console.log('[notify] username resolved:', username, '| profile:', profile)

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

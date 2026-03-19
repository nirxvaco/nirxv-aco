import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      if (session?.user) fetchProfile(session.user)
      else setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      if (session?.user) fetchProfile(session.user)
      else { setProfile(null); setLoading(false) }
    })

    return () => subscription.unsubscribe()
  }, [])

  async function fetchProfile(user) {
    const { data } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', user.id)
      .single()

    if (data) {
      setProfile(data)
    } else {
      // No profile exists yet — auto-create one for Discord OAuth users
      const discordUsername =
        user.user_metadata?.custom_claims?.global_name ||
        user.user_metadata?.full_name ||
        user.user_metadata?.name ||
        user.email?.split('@')[0] ||
        'User'

      const { data: newProfile } = await supabase
        .from('user_profiles')
        .insert({ id: user.id, username: discordUsername, role: 'user' })
        .select()
        .single()

      setProfile(newProfile)
    }

    setLoading(false)
  }

  const isAdmin = profile?.role === 'admin'

  return (
    <AuthContext.Provider value={{ user, profile, loading, isAdmin, refreshProfile: () => fetchProfile(user) }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)

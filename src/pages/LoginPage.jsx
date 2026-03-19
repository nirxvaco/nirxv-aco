import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { Lock, Mail, KeyRound, Eye, EyeOff } from 'lucide-react'

function DiscordIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057c.003.022.015.043.03.056a19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
    </svg>
  )
}

export default function LoginPage() {
  const [mode, setMode]             = useState('login')
  const [email, setEmail]           = useState('')
  const [password, setPassword]     = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [username, setUsername]     = useState('')
  const [showPass, setShowPass]     = useState(false)
  const [loading, setLoading]       = useState(false)
  const [discordLoading, setDiscordLoading] = useState(false)
  const [error, setError]           = useState('')
  const [success, setSuccess]       = useState('')

  async function handleLogin(e) {
    e.preventDefault(); setLoading(true); setError('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError(error.message)
    setLoading(false)
  }

  async function handleSignup(e) {
    e.preventDefault(); setLoading(true); setError('')
    const { data: invite, error: inviteErr } = await supabase
      .from('invite_codes').select('*')
      .eq('code', inviteCode.trim().toUpperCase())
      .eq('used', false)
      .single()
    if (inviteErr || !invite) { setError('Invalid or already used invite code.'); setLoading(false); return }
    if (invite.expires_at && new Date(invite.expires_at) < new Date()) { setError('This invite code has expired.'); setLoading(false); return }
    const useCount = invite.use_count || 0
    const maxUses = invite.max_uses || 1
    if (useCount >= maxUses) { setError('This invite code has reached its maximum uses.'); setLoading(false); return }

    const { data, error: signupErr } = await supabase.auth.signUp({ email, password })
    if (signupErr) { setError(signupErr.message); setLoading(false); return }

    const newUseCount = useCount + 1
    await supabase.from('invite_codes').update({
      use_count: newUseCount,
      used: newUseCount >= maxUses,
      used_by: data.user.id,
      used_at: new Date().toISOString(),
    }).eq('id', invite.id)

    await supabase.from('user_profiles').insert({ id: data.user.id, username: username || email.split('@')[0], role: 'user' })
    setSuccess('Account created! Check your email to confirm, then log in.')
    setMode('login'); setLoading(false)
  }

  async function handleDiscordLogin() {
    setDiscordLoading(true); setError('')
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'discord',
      options: {
        redirectTo: `${window.location.origin}/profiles`,
        scopes: 'identify email',
      },
    })
    if (error) { setError(error.message); setDiscordLoading(false) }
    // If no error, browser redirects to Discord — no need to setLoading(false)
  }

  return (
    <div className="min-h-screen bg-vault-bg grid-bg flex items-center justify-center p-4 relative overflow-hidden">
      {/* Background glows */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[500px] h-[500px] rounded-full pointer-events-none"
        style={{ background: 'radial-gradient(ellipse, rgba(0,200,255,0.06) 0%, transparent 70%)' }} />
      <div className="absolute bottom-1/4 left-1/4 w-64 h-64 rounded-full pointer-events-none"
        style={{ background: 'radial-gradient(ellipse, rgba(180,79,255,0.06) 0%, transparent 70%)' }} />
      <div className="absolute top-1/3 right-1/4 w-48 h-48 rounded-full pointer-events-none"
        style={{ background: 'radial-gradient(ellipse, rgba(255,230,0,0.04) 0%, transparent 70%)' }} />

      <div className="w-full max-w-md animate-fade-in relative z-10">
        {/* Logo */}
        <div className="text-center mb-10">
          <h1 className="font-display text-5xl tracking-widest neon-cyan text-vault-accent">NIRXV</h1>
          <p className="font-display text-2xl tracking-[0.3em] neon-gold text-vault-gold mt-1">ACO</p>
          <p className="text-vault-text-dim font-body text-sm mt-3">Secure profile management for serious droppers</p>
        </div>

        {/* Card */}
        <div className="vault-card shadow-2xl shadow-black/60 border-vault-border">
          {/* Tabs */}
          <div className="flex bg-vault-bg rounded-lg p-1 mb-6">
            {[['login', 'Sign In'], ['signup', 'Join']].map(([m, label]) => (
              <button key={m} onClick={() => { setMode(m); setError('') }}
                className={`flex-1 py-2 rounded-md text-sm font-body font-semibold transition-all duration-200
                  ${mode === m
                    ? 'bg-vault-accent text-vault-bg'
                    : 'text-vault-text-dim hover:text-vault-text'}`}>
                {label}
              </button>
            ))}
          </div>

          {error && (
            <div className="bg-vault-red/10 border border-vault-red/30 rounded-lg px-4 py-3 mb-4 text-vault-red text-sm font-body">
              {error}
            </div>
          )}
          {success && (
            <div className="bg-vault-green/10 border border-vault-green/30 rounded-lg px-4 py-3 mb-4 text-vault-green text-sm font-body">
              {success}
            </div>
          )}

          {/* Discord login button */}
          <button
            type="button"
            onClick={handleDiscordLogin}
            disabled={discordLoading || loading}
            className="w-full flex items-center justify-center gap-3 py-2.5 px-4 rounded-lg font-body font-semibold text-sm transition-all duration-200 mb-4 border"
            style={{
              backgroundColor: discordLoading ? 'rgba(88,101,242,0.5)' : 'rgba(88,101,242,0.15)',
              borderColor: 'rgba(88,101,242,0.4)',
              color: discordLoading ? 'rgba(255,255,255,0.5)' : '#7289da',
            }}>
            {discordLoading
              ? <><div className="w-4 h-4 border-2 border-[#7289da] border-t-transparent rounded-full animate-spin" /> Redirecting...</>
              : <><DiscordIcon /> Continue with Discord</>}
          </button>

          {/* Divider */}
          <div className="flex items-center gap-3 mb-4">
            <div className="flex-1 h-px bg-vault-border" />
            <span className="text-vault-muted text-xs font-mono">or</span>
            <div className="flex-1 h-px bg-vault-border" />
          </div>

          <form onSubmit={mode === 'login' ? handleLogin : handleSignup} className="space-y-4">
            {mode === 'signup' && (
              <div>
                <label className="vault-label">Username</label>
                <input className="vault-input" placeholder="Same as your Discord username"
                  value={username} onChange={e => setUsername(e.target.value)} />
                <p className="text-vault-muted text-xs font-mono mt-1">
                  Use your exact Discord username so we can identify you
                </p>
              </div>
            )}
            <div>
              <label className="vault-label">Email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-vault-muted" />
                <input className="vault-input pl-9" type="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} required />
              </div>
            </div>
            <div>
              <label className="vault-label">Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-vault-muted" />
                <input className="vault-input pl-9 pr-10" type={showPass ? 'text' : 'password'} placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} required minLength={8} />
                <button type="button" onClick={() => setShowPass(!showPass)} className="absolute right-3 top-1/2 -translate-y-1/2 text-vault-muted hover:text-vault-text-dim">
                  {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            {mode === 'signup' && (
              <div>
                <label className="vault-label">Invite Code</label>
                <div className="relative">
                  <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-vault-muted" />
                  <input className="vault-input pl-9 font-mono uppercase tracking-widest" placeholder="XXXX-XXXX" value={inviteCode} onChange={e => setInviteCode(e.target.value)} required />
                </div>
              </div>
            )}
            <button type="submit" disabled={loading || discordLoading} className="vault-btn-primary w-full justify-center mt-2 font-display tracking-widest text-base">
              {loading
                ? <><div className="w-4 h-4 border-2 border-vault-bg border-t-transparent rounded-full animate-spin" /> Loading...</>
                : mode === 'login' ? 'SIGN IN' : 'CREATE ACCOUNT'}
            </button>
          </form>
        </div>

        <p className="text-center text-vault-muted text-xs mt-6 font-mono">
          All data encrypted · Nirxv ACO © 2026
        </p>
      </div>
    </div>
  )
}

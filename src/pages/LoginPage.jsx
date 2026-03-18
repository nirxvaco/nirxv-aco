import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { Lock, Mail, KeyRound, Eye, EyeOff } from 'lucide-react'

export default function LoginPage() {
  const [mode, setMode]             = useState('login')
  const [email, setEmail]           = useState('')
  const [password, setPassword]     = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [username, setUsername]     = useState('')
  const [showPass, setShowPass]     = useState(false)
  const [loading, setLoading]       = useState(false)
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
    // Check multi-use: if use_count >= max_uses, code is exhausted
    const useCount = invite.use_count || 0
    const maxUses = invite.max_uses || 1
    if (useCount >= maxUses) { setError('This invite code has reached its maximum uses.'); setLoading(false); return }

    const { data, error: signupErr } = await supabase.auth.signUp({ email, password })
    if (signupErr) { setError(signupErr.message); setLoading(false); return }

    const newUseCount = useCount + 1
    // Mark fully used if at limit, otherwise just increment count
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

          <form onSubmit={mode === 'login' ? handleLogin : handleSignup} className="space-y-4">
            {mode === 'signup' && (
              <div>
                <label className="vault-label">Username</label>
                <input className="vault-input" placeholder="your_handle" value={username} onChange={e => setUsername(e.target.value)} />
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
            <button type="submit" disabled={loading} className="vault-btn-primary w-full justify-center mt-2 font-display tracking-widest text-base">
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

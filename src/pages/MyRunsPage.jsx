import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { Activity, UserCheck, Sword, Package, RefreshCw } from 'lucide-react'

const RUNNER_STYLES = {
  nirxv:   { label: 'Nirxv',   colour: '#00c8ff', bg: 'rgba(0,200,255,0.1)',   border: 'rgba(0,200,255,0.3)',   icon: UserCheck },
  warrior: { label: 'Warrior', colour: '#ffe600', bg: 'rgba(255,230,0,0.1)',   border: 'rgba(255,230,0,0.3)',   icon: Sword },
}

export default function MyRunsPage() {
  const { user } = useAuth()
  const [runs, setRuns]       = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('profile_runs')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
    setRuns(data || [])
    setLoading(false)
  }, [user.id])

  useEffect(() => { load() }, [load])

  // Group by drop_name + site
  const grouped = {}
  for (const run of runs) {
    const key = `${run.drop_name}|||${run.site}`
    if (!grouped[key]) grouped[key] = { drop_name: run.drop_name, site: run.site, profiles: [] }
    grouped[key].profiles.push(run)
  }

  const groups = Object.values(grouped)

  // Split by runner for summary
  const nirxvCount   = runs.filter(r => r.runner === 'nirxv').length
  const warriorCount = runs.filter(r => r.runner === 'warrior').length

  return (
    <div className="max-w-3xl mx-auto animate-fade-in" style={{ fontFamily: "'Outfit', sans-serif" }}>
      {/* Header */}
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-3xl text-vault-accent neon-cyan">MY RUNS</h1>
          <p className="text-vault-text-dim text-sm font-body mt-0.5">See which of your profiles are being run and by who</p>
        </div>
        <button onClick={load} className="vault-btn-ghost text-xs px-3 py-2"><RefreshCw className="w-3.5 h-3.5" /> Refresh</button>
      </div>

      {/* Summary cards */}
      {runs.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
          <div className="vault-card py-3 text-center">
            <p className="text-2xl font-display text-vault-text">{runs.length}</p>
            <p className="text-xs font-mono text-vault-muted mt-0.5">Total profiles running</p>
          </div>
          <div className="vault-card py-3 text-center" style={{ borderColor: 'rgba(0,200,255,0.2)', background: 'rgba(0,200,255,0.03)' }}>
            <p className="text-2xl font-display" style={{ color: '#00c8ff' }}>{nirxvCount}</p>
            <p className="text-xs font-mono text-vault-muted mt-0.5">Run by Nirxv</p>
          </div>
          <div className="vault-card py-3 text-center" style={{ borderColor: 'rgba(255,230,0,0.2)', background: 'rgba(255,230,0,0.03)' }}>
            <p className="text-2xl font-display" style={{ color: '#ffe600' }}>{warriorCount}</p>
            <p className="text-xs font-mono text-vault-muted mt-0.5">Run by Warrior</p>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-2 border-vault-accent border-t-transparent rounded-full animate-spin" />
        </div>
      ) : runs.length === 0 ? (
        <div className="vault-card text-center py-16">
          <Activity className="w-10 h-10 text-vault-muted mx-auto mb-3" />
          <p className="text-vault-text font-display font-semibold">No active runs</p>
          <p className="text-vault-text-dim text-sm mt-1 font-body">Your profiles haven't been assigned to any drops yet</p>
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map(group => (
            <div key={`${group.drop_name}-${group.site}`} className="vault-card">
              {/* Drop header */}
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-vault-accent/10 border border-vault-accent/20 flex items-center justify-center shrink-0">
                  <Package className="w-5 h-5 text-vault-accent" />
                </div>
                <div>
                  <p className="font-display font-semibold text-vault-text">{group.drop_name}</p>
                  <p className="text-xs font-mono text-vault-muted">{group.site}</p>
                </div>
                <span className="ml-auto text-[10px] font-mono text-vault-muted">{group.profiles.length} profile{group.profiles.length !== 1 ? 's' : ''}</span>
              </div>

              {/* Profile rows */}
              <div className="space-y-2">
                {group.profiles.map(run => {
                  const rs = RUNNER_STYLES[run.runner]
                  const RunnerIcon = rs?.icon || UserCheck

                  return (
                    <div key={run.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-vault-border bg-vault-bg">
                      {/* Profile name */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-mono text-vault-text truncate">{run.profile_name}</p>
                      </div>

                      {/* Runner badge */}
                      <div
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-semibold shrink-0"
                        style={{ background: rs?.bg, color: rs?.colour, border: `1px solid ${rs?.border}` }}>
                        <RunnerIcon className="w-3.5 h-3.5" />
                        {rs?.label || run.runner}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

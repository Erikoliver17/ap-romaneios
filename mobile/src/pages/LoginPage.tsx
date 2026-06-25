import { useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate, Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { Truck } from 'lucide-react'

export default function LoginPage() {
  const { signIn, user } = useAuth()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // Redirect if already logged in
  if (user) {
    return <Navigate to="/" replace />
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const { data: email, error: rpcError } = await supabase.rpc('get_email_by_username', { p_username: username.trim() })
      if (rpcError || !email) {
        setError('Usuário não encontrado.')
        setLoading(false)
        return
      }

      const { error: signInError } = await signIn(email, password)
      if (signInError) {
        setError('Usuário ou senha incorretos.')
      } else {
        navigate('/')
      }
    } catch (err: any) {
      setError('Erro ao tentar logar.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex-center" style={{ minHeight: '100vh', padding: '24px', flexDirection: 'column', background: 'var(--bg)' }}>
      <div className="card no-active" style={{ width: '100%', maxWidth: '380px', padding: '32px 24px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' }}>
        
        {/* Logo */}
        <div className="text-center" style={{ marginBottom: '32px' }}>
          <div className="flex-center" style={{ margin: '0 auto 12px', width: '64px', height: '64px', borderRadius: '50%', background: 'rgba(37, 99, 235, 0.1)', color: 'var(--primary)' }}>
            <Truck size={32} />
          </div>
          <h2 style={{ fontSize: '22px', fontWeight: 800, color: 'var(--text)' }}>Romaneios</h2>
          <p className="text-muted" style={{ fontSize: '13px', marginTop: '4px' }}>Sistema de Controle de Cargas</p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div className="form-group">
            <label htmlFor="username">Usuário</label>
            <input
              id="username"
              type="text"
              className="input"
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder="Digite seu usuário"
              required
              autoCapitalize="none"
              autoFocus
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">Senha</label>
            <input
              id="password"
              type="password"
              className="input"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>

          {error && (
            <div className="text-danger font-bold text-center" style={{ fontSize: '13px', background: 'rgba(239, 68, 68, 0.1)', padding: '10px', borderRadius: '8px' }}>
              {error}
            </div>
          )}

          <button type="submit" className="btn btn-primary" disabled={loading} style={{ marginTop: '8px' }}>
            {loading ? 'Entrando...' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  )
}

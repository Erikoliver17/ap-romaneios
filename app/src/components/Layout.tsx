import { useState, useEffect } from 'react'
import type { ReactNode } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import toast from 'react-hot-toast'
import { FileText, PlusCircle, Settings, LogOut, Truck, Building2, Trash2, Sun, Moon } from 'lucide-react'

export default function Layout({ children }: { children: ReactNode }) {
  const { perfil, signOut, isMaster } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [changingPass, setChangingPass] = useState(false)
  const [passError, setPassError] = useState('')

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault()
    setPassError('')
    if (newPassword.length < 6) {
      setPassError('A senha deve ter pelo menos 6 caracteres.')
      return
    }
    if (newPassword !== confirmPassword) {
      setPassError('As senhas não coincidem.')
      return
    }
    setChangingPass(true)
    try {
      const { error: authErr } = await supabase.auth.updateUser({ password: newPassword })
      if (authErr) throw authErr
      
      const { error: dbErr } = await supabase
        .from('perfis')
        .update({ senha_alterada: true, senha_temporaria: null })
        .eq('id', perfil?.id)
      if (dbErr) throw dbErr
      
      toast.success('Senha atualizada com sucesso!')
      window.location.reload()
    } catch (err: any) {
      setPassError(err.message || 'Erro ao atualizar senha.')
    } finally {
      setChangingPass(false)
    }
  }

  const [darkMode, setDarkMode] = useState(() => {
    return localStorage.getItem('theme') === 'dark' ||
      (!localStorage.getItem('theme') && window.matchMedia('(prefers-color-scheme: dark)').matches)
  })

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark')
      localStorage.setItem('theme', 'dark')
    } else {
      document.documentElement.classList.remove('dark')
      localStorage.setItem('theme', 'light')
    }
  }, [darkMode])

  const toggleDarkMode = () => setDarkMode(!darkMode)

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  const navItem = (to: string, icon: ReactNode, label: string) => (
    <Link
      to={to}
      className={`nav-item ${location.pathname === to || location.pathname.startsWith(to + '/') ? 'active' : ''}`}
    >
      {icon}
      <span>{label}</span>
    </Link>
  )

  if (perfil && perfil.senha_alterada === false) {
    return (
      <div className="login-screen">
        <div className="login-card" style={{ maxWidth: 400 }}>
          <div className="login-logo">
            <Truck size={36} color="#2563eb" />
            <h1>Primeiro Acesso</h1>
            <p>Crie sua senha pessoal de acesso para continuar</p>
          </div>
          <form onSubmit={handleChangePassword} className="login-form">
            <div className="field">
              <label>Nova Senha *</label>
              <input
                type="password"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                placeholder="Mínimo 6 caracteres"
                required
                autoFocus
              />
            </div>
            <div className="field">
              <label>Confirmar Nova Senha *</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                placeholder="Repita a senha"
                required
              />
            </div>
            {passError && <div className="error-msg">{passError}</div>}
            <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
              <button type="button" className="btn-secondary" onClick={handleSignOut} style={{ flex: 1 }}>
                Sair
              </button>
              <button type="submit" className="btn-primary" disabled={changingPass} style={{ flex: 2 }}>
                {changingPass ? 'Salvando...' : 'Salvar Senha'}
              </button>
            </div>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <Truck size={24} />
          <span>Romaneios</span>
        </div>

        <nav className="sidebar-nav">
          {navItem('/', <FileText size={18} />, 'Romaneios')}
          {navItem('/romaneios/novo', <PlusCircle size={18} />, 'Novo Romaneio')}
          {isMaster && navItem('/transportadoras', <Building2 size={18} />, 'Transportadoras')}
          {isMaster && navItem('/lixeira', <Trash2 size={18} />, 'Lixeira')}
          {isMaster && navItem('/configuracoes', <Settings size={18} />, 'Configurações')}
        </nav>

        <div className="sidebar-footer">
          <div className="user-info">
            <span className="user-name">{perfil?.nome}</span>
            <span className={`role-badge ${perfil?.role}`}>
              {perfil?.role === 'master' ? 'Master' : perfil?.role === 'colaborador' ? 'Colaborador' : perfil?.role}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <button className="btn-icon" onClick={toggleDarkMode} title={darkMode ? "Modo Claro" : "Modo Escuro"}>
              {darkMode ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <button className="btn-icon" onClick={handleSignOut} title="Sair">
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </aside>

      <main className="main-content">
        {children}
      </main>
    </div>
  )
}

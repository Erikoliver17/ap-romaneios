import type { ReactNode } from 'react'
import { useState } from 'react'
import { useLocation, useNavigate, Link } from 'react-router-dom'
import { Menu, ArrowLeft, Home, PlusCircle, Settings, LogOut, Building2, Trash2, Truck } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import toast from 'react-hot-toast'

export default function MobileLayout({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { signOut, perfil, isMaster } = useAuth()
  const [drawerOpen, setDrawerOpen] = useState(false)

  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [changingPass, setChangingPass] = useState(false)
  const [passError, setPassError] = useState('')

  const isHome = pathname === '/'
  const showBack = !isHome && pathname !== '/login'

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

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  // Map route to page title for inner headers
  let pageTitle = 'Menu'
  if (pathname === '/configuracoes') {
    pageTitle = 'Configurações'
  } else if (pathname.startsWith('/romaneios/')) {
    if (pathname.endsWith('/bipar')) {
      pageTitle = 'Conferir Carga'
    } else if (pathname.endsWith('/editar')) {
      pageTitle = 'Editar Romaneio'
    } else if (pathname.endsWith('/novo')) {
      pageTitle = 'Novo Romaneio'
    } else {
      pageTitle = 'Detalhes'
    }
  }

  const handleLinkClick = () => {
    setDrawerOpen(false)
  }

  const handleLogout = async () => {
    setDrawerOpen(false)
    await signOut()
  }

  if (perfil && perfil.senha_alterada === false) {
    return (
      <div className="flex-center" style={{ minHeight: '100vh', padding: '24px', flexDirection: 'column', background: 'var(--bg)' }}>
        <div className="card no-active" style={{ width: '100%', maxWidth: '380px', padding: '32px 24px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' }}>
          
          <div className="text-center" style={{ marginBottom: '32px' }}>
            <div className="flex-center" style={{ margin: '0 auto 12px', width: '64px', height: '64px', borderRadius: '50%', background: 'rgba(37, 99, 235, 0.1)', color: 'var(--primary)' }}>
              <Truck size={32} />
            </div>
            <h2 style={{ fontSize: '22px', fontWeight: 800, color: 'var(--text)' }}>Primeiro Acesso</h2>
            <p className="text-muted" style={{ fontSize: '13px', marginTop: '4px' }}>Crie sua senha pessoal de acesso para continuar</p>
          </div>

          <form onSubmit={handleChangePassword} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div className="form-group">
              <label>Nova Senha *</label>
              <input
                type="password"
                className="input"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                placeholder="Mínimo 6 caracteres"
                required
                autoFocus
              />
            </div>

            <div className="form-group">
              <label>Confirmar Nova Senha *</label>
              <input
                type="password"
                className="input"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                placeholder="Repita a senha"
                required
              />
            </div>

            {passError && (
              <div className="text-danger font-bold text-center" style={{ fontSize: '13px', background: 'rgba(239, 68, 68, 0.1)', padding: '10px', borderRadius: '8px' }}>
                {passError}
              </div>
            )}

            <div style={{ display: 'flex', gap: 12, marginTop: '8px' }}>
              <button type="button" className="btn btn-secondary" onClick={handleSignOut} style={{ flex: 1 }}>
                Sair
              </button>
              <button type="submit" className="btn btn-primary" disabled={changingPass} style={{ flex: 2 }}>
                {changingPass ? 'Salvando...' : 'Salvar Senha'}
              </button>
            </div>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div className="mobile-app">
      {/* Top Header */}
      <header className="mobile-header">
        <div className="header-title-container">
          {isHome ? (
            <button className="header-btn" onClick={() => setDrawerOpen(true)} aria-label="Abrir Menu">
              <Menu size={24} />
            </button>
          ) : (
            showBack && (
              <button className="header-btn" onClick={() => navigate(-1)} aria-label="Voltar">
                <ArrowLeft size={24} />
              </button>
            )
          )}
          
          <h1>
            {isHome ? (
              <>
                <span className="logo-romaneio">Romaneio</span>
                <span className="logo-entregas">Entregas</span>
              </>
            ) : (
              <span>{pageTitle}</span>
            )}
          </h1>
        </div>
        
        {/* User initials or avatar icon on the right side of header */}
        {perfil && isHome && (
          <div className="flex-center" style={{
            width: '32px',
            height: '32px',
            borderRadius: '50%',
            background: 'var(--bg-highlight)',
            color: 'var(--primary)',
            fontSize: '12px',
            fontWeight: 800
          }}>
            {perfil.nome.charAt(0).toUpperCase()}
          </div>
        )}
      </header>

      {/* Magalu Rainbow Line under the header */}
      <div className="rainbow-bar" />

      {/* Main Content Area */}
      <main className="content">
        {children}
      </main>

      {/* Slide-out Navigation Drawer (Sidebar) */}
      <div
        className={`drawer-overlay ${drawerOpen ? 'open' : ''}`}
        onClick={() => setDrawerOpen(false)}
      />
      
      <aside className={`drawer ${drawerOpen ? 'open' : ''}`}>
        {/* Drawer Header with user info */}
        <div className="drawer-header">
          {perfil ? (
            <>
              <div className="drawer-profile-name">{perfil.nome}</div>
              <div className="drawer-profile-sub">Perfil: {perfil.role === 'master' ? 'Gestor' : 'Colaborador'}</div>
              <div className="drawer-profile-sub" style={{ fontSize: '11px' }}>{perfil.email}</div>
            </>
          ) : (
            <div className="drawer-profile-name">Carregando...</div>
          )}
        </div>

        {/* Drawer Navigation Links */}
        <nav className="drawer-nav">
          <Link to="/" className={`drawer-item ${pathname === '/' ? 'active' : ''}`} onClick={handleLinkClick}>
            <Home />
            <span>Dashboard</span>
          </Link>
          <Link to="/romaneios/novo" className={`drawer-item ${pathname === '/romaneios/novo' ? 'active' : ''}`} onClick={handleLinkClick}>
            <PlusCircle />
            <span>Criar Romaneio</span>
          </Link>
          {isMaster && (
            <>
              <Link to="/transportadoras" className={`drawer-item ${pathname === '/transportadoras' ? 'active' : ''}`} onClick={handleLinkClick}>
                <Building2 />
                <span>Transportadoras</span>
              </Link>
              <Link to="/lixeira" className={`drawer-item ${pathname === '/lixeira' ? 'active' : ''}`} onClick={handleLinkClick}>
                <Trash2 />
                <span>Lixeira</span>
              </Link>
            </>
          )}
          <Link to="/configuracoes" className={`drawer-item ${pathname === '/configuracoes' ? 'active' : ''}`} onClick={handleLinkClick}>
            <Settings />
            <span>Configurações</span>
          </Link>
          <button
            onClick={handleLogout}
            className="drawer-item"
            style={{ width: '100%', background: 'transparent', border: 'none', textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit' }}
          >
            <LogOut />
            <span>Sair</span>
          </button>
        </nav>

        {/* Drawer Footer showing system version */}
        <div className="drawer-footer">
          Versão 1.0.0
        </div>
      </aside>
    </div>
  )
}

import type { ReactNode } from 'react'
import { useState } from 'react'
import { useLocation, useNavigate, Link } from 'react-router-dom'
import { Menu, ArrowLeft, Home, PlusCircle, Settings, LogOut, Building2, Trash2 } from 'lucide-react'
import { useAuth } from '../context/AuthContext'

export default function MobileLayout({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { signOut, perfil, isMaster } = useAuth()
  const [drawerOpen, setDrawerOpen] = useState(false)

  const isHome = pathname === '/'
  const showBack = !isHome && pathname !== '/login'

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

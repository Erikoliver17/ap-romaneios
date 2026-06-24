import type { ReactNode } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { FileText, PlusCircle, Settings, LogOut, Truck, Building2, Trash2 } from 'lucide-react'

export default function Layout({ children }: { children: ReactNode }) {
  const { perfil, signOut, isMaster } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

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
          <button className="btn-icon" onClick={handleSignOut} title="Sair">
            <LogOut size={18} />
          </button>
        </div>
      </aside>

      <main className="main-content">
        {children}
      </main>
    </div>
  )
}

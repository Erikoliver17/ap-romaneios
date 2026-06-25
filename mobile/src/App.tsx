import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { AuthProvider } from './context/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import NovoRomaneioPage from './pages/NovoRomaneioPage'
import RomaneioDetalhePage from './pages/RomaneioDetalhePage'
import BipadorPage from './pages/BipadorPage'
import ColetaPublicaPage from './pages/ColetaPublicaPage'
import LixeiraPage from './pages/LixeiraPage'
import TransportadorasPage from './pages/TransportadorasPage'
import ConfiguracoesPage from './pages/ConfiguracoesPage'

export default function App() {
  return (
    <AuthProvider>
      <Toaster position="top-center" toastOptions={{ duration: 3000 }} />
      <BrowserRouter>
        <Routes>
          {/* Public driver coleta form */}
          <Route path="/coleta/:token" element={<ColetaPublicaPage />} />
          
          {/* Public login */}
          <Route path="/login" element={<LoginPage />} />
          
          {/* Protected routes */}
          <Route path="/" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
          <Route path="/romaneios/novo" element={<ProtectedRoute><NovoRomaneioPage /></ProtectedRoute>} />
          <Route path="/romaneios/:id" element={<ProtectedRoute><RomaneioDetalhePage /></ProtectedRoute>} />
          <Route path="/romaneios/:id/bipar" element={<ProtectedRoute><BipadorPage /></ProtectedRoute>} />
          <Route path="/transportadoras" element={<ProtectedRoute masterOnly><TransportadorasPage /></ProtectedRoute>} />
          <Route path="/lixeira" element={<ProtectedRoute masterOnly><LixeiraPage /></ProtectedRoute>} />
          <Route path="/configuracoes" element={<ProtectedRoute><ConfiguracoesPage /></ProtectedRoute>} />
          
          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}

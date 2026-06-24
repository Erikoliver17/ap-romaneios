import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { AuthProvider } from './context/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import NovoRomaneioPage from './pages/NovoRomaneioPage'
import RomaneioDetalhePage from './pages/RomaneioDetalhePage'
import ImpressaoPage from './pages/ImpressaoPage'
import ColetaPublicaPage from './pages/ColetaPublicaPage'
import ConfiguracoesPage from './pages/ConfiguracoesPage'
import TransportadorasPage from './pages/TransportadorasPage'
import BipadorPage from './pages/BipadorPage'
import LixeiraPage from './pages/LixeiraPage'
import EditarRomaneioPage from './pages/EditarRomaneioPage'

export default function App() {
  return (
    <AuthProvider>
      <Toaster position="top-right" toastOptions={{ duration: 3000 }} />
      <BrowserRouter>
        <Routes>
          <Route path="/coleta/:token" element={<ColetaPublicaPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
          <Route path="/romaneios/novo" element={<ProtectedRoute><NovoRomaneioPage /></ProtectedRoute>} />
          <Route path="/romaneios/:id" element={<ProtectedRoute><RomaneioDetalhePage /></ProtectedRoute>} />
          <Route path="/romaneios/:id/imprimir" element={<ProtectedRoute><ImpressaoPage /></ProtectedRoute>} />
          <Route path="/romaneios/:id/bipar" element={<ProtectedRoute><BipadorPage /></ProtectedRoute>} />
          <Route path="/romaneios/:id/editar" element={<ProtectedRoute masterOnly><EditarRomaneioPage /></ProtectedRoute>} />
          <Route path="/lixeira" element={<ProtectedRoute masterOnly><LixeiraPage /></ProtectedRoute>} />
          <Route path="/transportadoras" element={<ProtectedRoute masterOnly><TransportadorasPage /></ProtectedRoute>} />
          <Route path="/configuracoes" element={<ProtectedRoute masterOnly><ConfiguracoesPage /></ProtectedRoute>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}

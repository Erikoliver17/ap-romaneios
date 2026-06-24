import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import Layout from './Layout'

export default function ProtectedRoute({ children, masterOnly = false }: {
  children: ReactNode
  masterOnly?: boolean
}) {
  const { user, perfil, loading } = useAuth()

  if (loading) return <div className="loading-screen"><div className="spinner" /></div>
  if (!user) return <Navigate to="/login" replace />
  if (masterOnly && perfil?.role !== 'master') return <Navigate to="/" replace />

  return <Layout>{children}</Layout>
}

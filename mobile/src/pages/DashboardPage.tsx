import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import type { Romaneio, RomaneioStatus } from '../types'
import { Plus, Search, Truck, Calendar, User, ClipboardList, AlertTriangle, ArrowRight } from 'lucide-react'

export default function DashboardPage() {
  const navigate = useNavigate()
  const [romaneios, setRomaneios] = useState<Romaneio[]>([])
  const [loading, setLoading] = useState(true)
  const [filtroStatus, setFiltroStatus] = useState<RomaneioStatus | ''>('')
  const [busca, setBusca] = useState('')
  const [counts, setCounts] = useState({ Pendente: 0, Preenchido: 0, Liberado: 0, Cancelado: 0 })

  // Load status counts
  const loadCounts = async () => {
    try {
      const getCount = (status: string) =>
        supabase
          .from('romaneios')
          .select('*', { count: 'exact', head: true })
          .eq('status', status)
          .is('excluido_em', null)

      const [p, pr, l, c] = await Promise.all([
        getCount('Pendente'),
        getCount('Preenchido'),
        getCount('Liberado'),
        getCount('Cancelado')
      ])

      setCounts({
        Pendente: p.count || 0,
        Preenchido: pr.count || 0,
        Liberado: l.count || 0,
        Cancelado: c.count || 0
      })
    } catch (e) {
      console.error('Erro ao buscar contagens de status:', e)
    }
  }

  // Load romaneios list
  const loadRomaneios = useCallback(async (status: RomaneioStatus | '', search: string) => {
    setLoading(true)
    try {
      let nfeIds: string[] = []
      if (search.trim()) {
        const { data: nfeMatches } = await supabase
          .from('romaneio_itens')
          .select('romaneio_id')
          .ilike('numero_nfe', `%${search.trim()}%`)
        nfeIds = [...new Set((nfeMatches || []).map(m => m.romaneio_id))]
      }

      let q = supabase
        .from('romaneios')
        .select('*')
        .is('excluido_em', null)
        .order('data_criacao', { ascending: false })

      if (status) {
        q = q.eq('status', status)
      }

      if (search.trim()) {
        const s = search.trim()
        let orFilter = `transportadora_nome.ilike.%${s}%,motorista_nome.ilike.%${s}%,veiculo_placa.ilike.%${s}%`
        if (nfeIds.length > 0) {
          orFilter += `,id.in.(${nfeIds.join(',')})`
        }
        q = q.or(orFilter)
      }

      const { data, error } = await q.limit(20) // Limit to top 20 on mobile
      if (error) throw error
      setRomaneios(data || [])
    } catch (error) {
      console.error(error)
      toast.error('Erro ao carregar romaneios.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadCounts()
    loadRomaneios(filtroStatus, busca)
  }, [filtroStatus, loadRomaneios])

  // Debounced search
  useEffect(() => {
    const t = setTimeout(() => {
      loadRomaneios(filtroStatus, busca)
    }, 300)
    return () => clearTimeout(t)
  }, [busca, filtroStatus, loadRomaneios])

  // Realtime subscription
  useEffect(() => {
    const channel = supabase
      .channel('dashboard-redesign-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'romaneios' }, (payload: any) => {
        loadCounts()
        loadRomaneios(filtroStatus, busca)

        const { eventType, new: newRow, old: oldRow } = payload

        if (eventType === 'INSERT') {
          const transportadora = newRow.transportadora_nome || 'Sem Transportadora'
          toast.success(`Novo romaneio criado (${transportadora})!`, { id: `realtime-insert-${newRow.id}` })
        } else if (eventType === 'UPDATE') {
          if (oldRow && oldRow.status !== newRow.status) {
            const transportadora = newRow.transportadora_nome || 'Sem Transportadora'
            toast.success(`Romaneio (${transportadora}) → ${newRow.status}`, { id: `realtime-status-${newRow.id}` })
          } else if (oldRow && !oldRow.excluido_em && newRow.excluido_em) {
            toast.error(`Romaneio de ${newRow.transportadora_nome || 'Sem Transportadora'} movido para lixeira.`, { id: `realtime-delete-${newRow.id}` })
          }
        } else if (eventType === 'DELETE') {
          toast.error('Romaneio excluído do banco de dados.', { id: `realtime-db-delete-${oldRow?.id || 'id'}` })
        }
      })
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [filtroStatus, busca, loadRomaneios])

  const formatDate = (isoString: string) => {
    const date = new Date(isoString)
    return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
  }

  const activeCount = counts.Pendente + counts.Preenchido
  const liberadoCount = counts.Liberado

  return (
    <div style={{ paddingBottom: '32px' }}>
      
      {/* 1. Metrics Dual Column Grid Row */}
      <div className="metrics-row">
        <div className="metric-col-card" onClick={() => setFiltroStatus('')}>
          <div className="metric-icon-wrap">
            <ClipboardList size={18} />
          </div>
          <span className="metric-number">{activeCount}</span>
          <span className="metric-label">Romaneios Ativos</span>
        </div>
        <div className="metric-col-card" onClick={() => setFiltroStatus('Liberado')}>
          <div className="metric-icon-wrap" style={{ background: 'rgba(0, 171, 68, 0.08)', color: 'var(--success)' }}>
            <Truck size={18} />
          </div>
          <span className="metric-number" style={{ color: 'var(--success)' }}>{liberadoCount}</span>
          <span className="metric-label">Veículos Liberados</span>
        </div>
      </div>

      {/* 2. Warning Card Alert (Yellow) */}
      {counts.Pendente > 0 && (
        <div
          className="warning-card"
          onClick={() => setFiltroStatus(filtroStatus === 'Pendente' ? '' : 'Pendente')}
          style={{ cursor: 'pointer', borderLeftColor: filtroStatus === 'Pendente' ? 'var(--primary)' : 'var(--warning)' }}
        >
          <div className="warning-card-left">
            <AlertTriangle size={24} />
            <div>
              <div className="warning-title">Romaneios Pendentes</div>
              <div className="warning-desc">Disponibilizar link de cadastro</div>
            </div>
          </div>
          <div className="warning-badge">
            <div className="warning-badge-number">{counts.Pendente}</div>
            <div className="warning-badge-text">romaneios</div>
          </div>
        </div>
      )}

      {/* 3. Section Title "Ações" */}
      <div className="section-badge">Ações</div>

      {/* 4. Action Cards with colored borders (Magalu style) */}
      <div style={{ marginBottom: '24px' }}>
        {/* Action 1: Create Romaneio (Green border) */}
        <button
          onClick={() => navigate('/romaneios/novo')}
          className="action-card green"
          style={{ width: '100%', border: '1px solid var(--border)', textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit' }}
        >
          <div className="action-card-content">
            <Plus size={22} className="action-card-icon" />
            <span className="action-card-text">Criar novo romaneio</span>
          </div>
          <ArrowRight size={18} className="text-muted" />
        </button>

        {/* Action 3: Consult romaneios (Blue border) */}
        <button
          onClick={() => {
            setFiltroStatus('')
            document.getElementById('search-anchor')?.scrollIntoView({ behavior: 'smooth' })
          }}
          className="action-card blue"
          style={{ width: '100%', border: '1px solid var(--border)', textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit' }}
        >
          <div className="action-card-content">
            <Search size={22} className="action-card-icon" />
            <span className="action-card-text">Consultar romaneios</span>
          </div>
          <ArrowRight size={18} className="text-muted" />
        </button>
      </div>

      {/* 5. Romaneios list (Search bar + cards) */}
      <div id="search-anchor" style={{ borderTop: '1px solid var(--border)', paddingTop: '20px' }}>
        <div className="flex-between" style={{ marginBottom: '12px' }}>
          <h3 style={{ fontSize: '15px', fontWeight: 800 }}>
            {filtroStatus ? `Romaneios: ${filtroStatus}` : 'Todos os Romaneios'} ({romaneios.length})
          </h3>
          {filtroStatus && (
            <button
              onClick={() => setFiltroStatus('')}
              style={{ background: 'transparent', border: 'none', color: 'var(--primary)', fontWeight: 700, fontSize: '12px' }}
            >
              Limpar Filtro
            </button>
          )}
        </div>

        {/* Search input field */}
        <div className="search-container">
          <div className="search-input-wrapper">
            <input
              type="text"
              value={busca}
              onChange={e => setBusca(e.target.value)}
              placeholder="Buscar por placa, motorista, NF-e..."
            />
            <Search size={18} className="search-icon" />
          </div>
        </div>

        {/* Romaneios Recentes List */}
        {loading && romaneios.length === 0 ? (
          <div className="flex-center" style={{ padding: '32px 0' }}>
            <div style={{
              width: '24px',
              height: '24px',
              borderRadius: '50%',
              border: '2px solid var(--border)',
              borderTopColor: 'var(--primary)',
              animation: 'spin 1s linear infinite'
            }} />
          </div>
        ) : romaneios.length === 0 ? (
          <div className="text-center text-muted" style={{ padding: '32px 16px', fontSize: '13px' }}>
            Nenhum romaneio encontrado.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '8px' }}>
            {romaneios.map((r) => (
              <div
                key={r.id}
                className="card"
                onClick={() => navigate(`/romaneios/${r.id}`)}
                style={{ padding: '16px', margin: 0, cursor: 'pointer' }}
              >
                <div className="flex-between" style={{ marginBottom: '8px' }}>
                  <span className="badge pendente" style={{ fontSize: '10px', background: 'var(--bg-highlight)', color: 'var(--text)', border: '1px solid var(--border)' }}>
                    #{r.id.slice(0, 8).toUpperCase()}
                  </span>
                  <span className={`badge ${r.status.toLowerCase()}`}>
                    {r.status}
                  </span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px' }}>
                    <Truck size={14} className="text-muted" />
                    <span className="font-bold" style={{ fontSize: '14px' }}>{r.transportadora_nome || 'A definir'}</span>
                  </div>
                  {r.motorista_nome && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--text-muted)' }}>
                      <User size={12} />
                      <span>{r.motorista_nome} ({r.veiculo_placa || 'Sem placa'})</span>
                    </div>
                  )}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px', color: 'var(--text-muted)' }}>
                    <Calendar size={12} />
                    <span>Criado em {formatDate(r.data_criacao)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>



      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}

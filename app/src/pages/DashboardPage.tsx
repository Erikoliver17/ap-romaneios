import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import type { Romaneio, RomaneioStatus } from '../types'
import StatusBadge from '../components/StatusBadge'
import { PlusCircle, Search, Printer, ExternalLink, ChevronLeft, ChevronRight, Clock, AlertCircle, CheckCircle2, XCircle, Trash2 } from 'lucide-react'
import { useAuth } from '../context/AuthContext'

const STATUSES: RomaneioStatus[] = ['Pendente', 'Preenchido', 'Liberado', 'Cancelado']
const PAGE_SIZE = 20

interface Metrics {
  pendentes: number
  preenchidos: number
  liberados: number
  cancelados: number
}

export default function DashboardPage() {
  const navigate = useNavigate()
  const { isMaster } = useAuth()
  const [romaneios, setRomaneios] = useState<Romaneio[]>([])
  const [loading, setLoading] = useState(true)
  const [filtroStatus, setFiltroStatus] = useState<RomaneioStatus | ''>('')
  const [busca, setBusca] = useState('')
  const [dataInicio, setDataInicio] = useState('')
  const [dataFim, setDataFim] = useState('')
  const [page, setPage] = useState(0)
  const [total, setTotal] = useState(0)
  const [metrics, setMetrics] = useState<Metrics | null>(null)

  const totalPages = Math.ceil(total / PAGE_SIZE)

  useEffect(() => {
    loadMetrics()
  }, [])

  async function loadMetrics() {
    const base = (s: string) => supabase.from('romaneios').select('*', { count: 'exact', head: true }).eq('status', s)
    const [p, pr, l, c] = await Promise.all([base('Pendente'), base('Preenchido'), base('Liberado'), base('Cancelado')])
    // Tenta com filtro de lixeira se a coluna existir
    const withFilter = (s: string) => supabase.from('romaneios').select('*', { count: 'exact', head: true }).eq('status', s).is('excluido_em', null)
    const [pf, prf, lf, cf] = await Promise.all([withFilter('Pendente'), withFilter('Preenchido'), withFilter('Liberado'), withFilter('Cancelado')])
    const hasLixeira = !pf.error
    setMetrics({
      pendentes: (hasLixeira ? pf.count : p.count) || 0,
      preenchidos: (hasLixeira ? prf.count : pr.count) || 0,
      liberados: (hasLixeira ? lf.count : l.count) || 0,
      cancelados: (hasLixeira ? cf.count : c.count) || 0,
    })
  }

  const load = useCallback(async (
    currentPage: number,
    status: RomaneioStatus | '',
    search: string,
    inicio: string,
    fim: string,
  ) => {
    setLoading(true)

    // Se há termo de busca, também pesquisa em NF-e
    let nfeIds: string[] = []
    if (search.trim()) {
      const { data: nfeMatches } = await supabase
        .from('romaneio_itens')
        .select('romaneio_id')
        .ilike('numero_nfe', `%${search.trim()}%`)
      nfeIds = [...new Set((nfeMatches || []).map(m => m.romaneio_id))]
    }

    const buildQuery = (withLixeira: boolean) => {
      let q = supabase
        .from('romaneios')
        .select('*', { count: 'exact' })
        .order('data_criacao', { ascending: false })
        .range(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE - 1)
      if (withLixeira) q = q.is('excluido_em', null)
      if (status) q = q.eq('status', status)
      if (inicio) q = q.gte('data_criacao', inicio)
      if (fim) q = q.lte('data_criacao', fim + 'T23:59:59')
      if (search.trim()) {
        const s = search.trim()
        let orFilter = `transportadora_nome.ilike.%${s}%,motorista_nome.ilike.%${s}%,veiculo_placa.ilike.%${s}%`
        if (nfeIds.length > 0) orFilter += `,id.in.(${nfeIds.join(',')})`
        q = q.or(orFilter)
      }
      return q
    }

    let { data, count, error } = await buildQuery(true)
    // Se coluna excluido_em não existe ainda, busca sem o filtro
    if (error?.code === '42703') {
      const res = await buildQuery(false)
      data = res.data; count = res.count; error = res.error
    }
    if (error) {
      toast.error('Erro ao carregar romaneios.')
    } else {
      setRomaneios(data || [])
      setTotal(count || 0)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    setPage(0)
    load(0, filtroStatus, busca, dataInicio, dataFim)
  }, [filtroStatus, dataInicio, dataFim])

  useEffect(() => {
    const t = setTimeout(() => {
      setPage(0)
      load(0, filtroStatus, busca, dataInicio, dataFim)
    }, 300)
    return () => clearTimeout(t)
  }, [busca])

  function goToPage(p: number) {
    setPage(p)
    load(p, filtroStatus, busca, dataInicio, dataFim)
  }

  // Realtime: atualiza automaticamente quando qualquer romaneio muda
  useEffect(() => {
    const channel = supabase
      .channel('dashboard-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'romaneios' }, () => {
        loadMetrics()
        load(page, filtroStatus, busca, dataInicio, dataFim)
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [page, filtroStatus, busca, dataInicio, dataFim, load])

  function linkPublico(token: string) {
    const base = import.meta.env.VITE_APP_URL || window.location.origin
    return `${base}/coleta/${token}`
  }

  async function copiarLink(token: string) {
    await navigator.clipboard.writeText(linkPublico(token))
    toast.success('Link copiado!')
  }

  async function moverParaLixeira(e: React.MouseEvent, id: string) {
    e.stopPropagation()
    if (!confirm('Mover este romaneio para a lixeira?')) return
    const { error } = await supabase
      .from('romaneios')
      .update({ excluido_em: new Date().toISOString() })
      .eq('id', id)
    if (error?.code === '42703') {
      toast.error('Execute a migration 004 no Supabase para habilitar a lixeira.')
      return
    }
    if (error) { toast.error('Erro ao excluir'); return }
    toast.success('Romaneio movido para a lixeira')
    load(page, filtroStatus, busca, dataInicio, dataFim)
    loadMetrics()
  }

  function limparFiltros() {
    setBusca('')
    setFiltroStatus('')
    setDataInicio('')
    setDataFim('')
  }

  const temFiltros = busca || filtroStatus || dataInicio || dataFim

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Romaneios</h1>
          <p className="subtitle">{total} registro{total !== 1 ? 's' : ''}</p>
        </div>
        <button className="btn-primary" onClick={() => navigate('/romaneios/novo')}>
          <PlusCircle size={16} /> Novo Romaneio
        </button>
      </div>

      {/* Métricas */}
      {metrics && (
        <div className="metrics-row">
          <div className="metric-card metric-pendente">
            <Clock size={18} />
            <div>
              <span className="metric-num">{metrics.pendentes}</span>
              <span className="metric-label">Pendentes</span>
            </div>
          </div>
          <div className="metric-card metric-preenchido">
            <AlertCircle size={18} />
            <div>
              <span className="metric-num">{metrics.preenchidos}</span>
              <span className="metric-label">Aguardando liberação</span>
            </div>
          </div>
          <div className="metric-card metric-liberado">
            <CheckCircle2 size={18} />
            <div>
              <span className="metric-num">{metrics.liberados}</span>
              <span className="metric-label">Liberados</span>
            </div>
          </div>
          <div className="metric-card metric-cancelado">
            <XCircle size={18} />
            <div>
              <span className="metric-num">{metrics.cancelados}</span>
              <span className="metric-label">Cancelados</span>
            </div>
          </div>
        </div>
      )}

      <div className="filters">
        <div className="search-box">
          <Search size={16} />
          <input
            placeholder="Buscar por transportadora, motorista, placa ou NF-e..."
            value={busca}
            onChange={e => setBusca(e.target.value)}
          />
        </div>
        <div className="date-filters">
          <input
            type="date"
            className="date-input"
            title="Data inicial"
            value={dataInicio}
            onChange={e => setDataInicio(e.target.value)}
          />
          <span className="date-sep">até</span>
          <input
            type="date"
            className="date-input"
            title="Data final"
            value={dataFim}
            onChange={e => setDataFim(e.target.value)}
          />
        </div>
      </div>

      <div className="status-filters-row">
        <div className="status-filters">
          <button className={`filter-btn ${filtroStatus === '' ? 'active' : ''}`} onClick={() => setFiltroStatus('')}>Todos</button>
          {STATUSES.map(s => (
            <button key={s} className={`filter-btn ${filtroStatus === s ? 'active' : ''}`} onClick={() => setFiltroStatus(s)}>{s}</button>
          ))}
        </div>
        {temFiltros && (
          <button className="btn-ghost" style={{ fontSize: 12 }} onClick={limparFiltros}>Limpar filtros</button>
        )}
      </div>

      {loading ? (
        <div className="loading-center"><div className="spinner" /></div>
      ) : romaneios.length === 0 ? (
        <div className="empty-state">
          <p>Nenhum romaneio encontrado.</p>
          {!temFiltros ? (
            <button className="btn-primary" onClick={() => navigate('/romaneios/novo')}>Criar primeiro romaneio</button>
          ) : (
            <button className="btn-ghost" onClick={limparFiltros}>Limpar filtros</button>
          )}
        </div>
      ) : (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Transportadora</th>
                  <th>Motorista</th>
                  <th>Placa</th>
                  <th>Status</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {romaneios.map(r => (
                  <tr key={r.id} onClick={() => navigate(`/romaneios/${r.id}`)} className="clickable-row">
                    <td>{new Date(r.data_criacao).toLocaleDateString('pt-BR')}</td>
                    <td>{r.transportadora_nome || <span className="muted">—</span>}</td>
                    <td>{r.motorista_nome || <span className="muted">—</span>}</td>
                    <td>{r.veiculo_placa || <span className="muted">—</span>}</td>
                    <td><StatusBadge status={r.status} /></td>
                    <td onClick={e => e.stopPropagation()}>
                      <div className="row-actions">
                        <button className="btn-icon-sm" title="Copiar link da transportadora" onClick={() => copiarLink(r.token_publico)}>
                          <ExternalLink size={14} />
                        </button>
                        <button className="btn-icon-sm" title="Imprimir romaneio" onClick={() => navigate(`/romaneios/${r.id}/imprimir`)}>
                          <Printer size={14} />
                        </button>
                        {isMaster && (
                          <button className="btn-icon-sm danger" title="Mover para lixeira" onClick={e => moverParaLixeira(e, r.id)}>
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="pagination">
              <button className="btn-ghost" onClick={() => goToPage(page - 1)} disabled={page === 0}>
                <ChevronLeft size={16} />
              </button>
              <span className="pagination-info">Página {page + 1} de {totalPages}</span>
              <button className="btn-ghost" onClick={() => goToPage(page + 1)} disabled={page >= totalPages - 1}>
                <ChevronRight size={16} />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

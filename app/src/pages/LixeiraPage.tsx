import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import type { Romaneio } from '../types'
import StatusBadge from '../components/StatusBadge'
import { ArrowLeft, RotateCcw, Trash2 } from 'lucide-react'

export default function LixeiraPage() {
  const navigate = useNavigate()
  const [romaneios, setRomaneios] = useState<Romaneio[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data, error } = await supabase
      .from('romaneios')
      .select('*')
      .not('excluido_em', 'is', null)
      .order('excluido_em', { ascending: false })
    if (error) toast.error('Erro ao carregar lixeira')
    setRomaneios(data || [])
    setLoading(false)
  }

  async function restaurar(id: string) {
    const { error } = await supabase
      .from('romaneios')
      .update({ excluido_em: null, excluido_por: null })
      .eq('id', id)
    if (error) { toast.error('Erro ao restaurar'); return }
    toast.success('Romaneio restaurado!')
    setRomaneios(prev => prev.filter(r => r.id !== id))
  }

  async function excluirDefinitivo(id: string) {
    if (!confirm('ATENÇÃO: Excluir permanentemente este romaneio e todos os seus itens? Esta ação não pode ser desfeita.')) return
    const { error } = await supabase.from('romaneios').delete().eq('id', id)
    if (error) { toast.error('Erro ao excluir: ' + error.message); return }
    toast.success('Romaneio excluído permanentemente.')
    setRomaneios(prev => prev.filter(r => r.id !== id))
  }

  return (
    <div className="page">
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="btn-ghost" onClick={() => navigate('/')}><ArrowLeft size={18} /></button>
          <div>
            <h1>Lixeira</h1>
            <p className="subtitle">{romaneios.length} romaneio{romaneios.length !== 1 ? 's' : ''} excluído{romaneios.length !== 1 ? 's' : ''}</p>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="loading-center"><div className="spinner" /></div>
      ) : romaneios.length === 0 ? (
        <div className="empty-state">
          <Trash2 size={40} color="#94a3b8" />
          <p>A lixeira está vazia.</p>
          <button className="btn-ghost" onClick={() => navigate('/')}>Voltar ao dashboard</button>
        </div>
      ) : (
        <>
          <div className="lixeira-aviso">
            Romaneios na lixeira podem ser restaurados ou excluídos permanentemente.
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Data criação</th>
                  <th>Transportadora</th>
                  <th>Motorista</th>
                  <th>Placa</th>
                  <th>Status</th>
                  <th>Excluído em</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {romaneios.map(r => (
                  <tr key={r.id}>
                    <td>{new Date(r.data_criacao).toLocaleDateString('pt-BR')}</td>
                    <td>{r.transportadora_nome || <span className="muted">—</span>}</td>
                    <td>{r.motorista_nome || <span className="muted">—</span>}</td>
                    <td>{r.veiculo_placa || <span className="muted">—</span>}</td>
                    <td><StatusBadge status={r.status} /></td>
                    <td>{r.excluido_em ? new Date(r.excluido_em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                    <td>
                      <div className="row-actions">
                        <button
                          className="btn-icon-sm"
                          title="Restaurar romaneio"
                          onClick={() => restaurar(r.id)}
                        >
                          <RotateCcw size={14} />
                        </button>
                        <button
                          className="btn-icon-sm danger"
                          title="Excluir permanentemente"
                          onClick={() => excluirDefinitivo(r.id)}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

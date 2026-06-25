import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { formatCNPJ, validateCNPJ, formatCPF, formatRG, formatPlaca } from '../lib/validators'
import type { TransportadoraCadastrada, MotoristaCadastrado, VeiculoCadastrado } from '../types'
import toast from 'react-hot-toast'
import { Plus, Trash2, ChevronDown, ChevronUp, Truck, User, CreditCard, ArrowLeft } from 'lucide-react'

type TabType = 'motoristas' | 'veiculos'

interface TransportadoraExpandida extends TransportadoraCadastrada {
  motoristas: MotoristaCadastrado[]
  veiculos: VeiculoCadastrado[]
}

interface MotoristaForm { nome: string; cpf: string; rg: string }
interface VeiculoForm  { modelo: string; placa: string }

const emptyTransp = () => ({ nome: '', cnpj: '', contato_email: '', contato_telefone: '' })
const emptyMotorista = (): MotoristaForm => ({ nome: '', cpf: '', rg: '' })
const emptyVeiculo   = (): VeiculoForm  => ({ modelo: '', placa: '' })

export default function TransportadorasPage() {
  const navigate = useNavigate()
  const [lista, setLista] = useState<TransportadoraExpandida[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<Record<string, TabType>>({})
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyTransp())
  const [saving, setSaving] = useState(false)

  const [motorForm, setMotorForm] = useState<Record<string, MotoristaForm>>({})
  const [veicForm, setVeicForm]   = useState<Record<string, VeiculoForm>>({})

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      const [{ data: transp, error: errT }, { data: motors }, { data: veics }] = await Promise.all([
        supabase.from('transportadoras_cadastradas').select('*').eq('ativo', true).order('nome'),
        supabase.from('motoristas_cadastrados').select('*').eq('ativo', true).order('nome'),
        supabase.from('veiculos_cadastrados').select('*').eq('ativo', true).order('modelo'),
      ])
      if (errT) throw errT

      const expandidas: TransportadoraExpandida[] = (transp ?? []).map(t => ({
        ...t,
        motoristas: (motors ?? []).filter(m => m.transportadora_id === t.id),
        veiculos: (veics ?? []).filter(v => v.transportadora_id === t.id),
      }))
      setLista(expandidas)
    } catch (e: any) {
      toast.error('Erro ao carregar transportadoras.')
    } finally {
      setLoading(false)
    }
  }

  function toggle(id: string) {
    setExpanded(prev => (prev === id ? null : id))
    setActiveTab(prev => ({ ...prev, [id]: prev[id] ?? 'motoristas' }))
  }

  async function salvarTransportadora() {
    if (!form.nome.trim() || !form.cnpj.trim()) {
      toast.error('Nome e CNPJ são obrigatórios')
      return
    }
    if (!validateCNPJ(form.cnpj)) {
      toast.error('CNPJ inválido')
      return
    }
    setSaving(true)
    try {
      const { error } = await supabase.from('transportadoras_cadastradas').insert({
        nome: form.nome.trim(),
        cnpj: form.cnpj,
        contato_email: form.contato_email.trim() || null,
        contato_telefone: form.contato_telefone.trim() || null,
      })
      if (error) throw error
      toast.success('Transportadora cadastrada!')
      setForm(emptyTransp())
      setShowForm(false)
      load()
    } catch (err: any) {
      toast.error('Erro ao salvar: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  async function excluirTransportadora(id: string) {
    if (!confirm('Desativar esta transportadora?')) return
    try {
      const { error } = await supabase
        .from('transportadoras_cadastradas')
        .update({ ativo: false })
        .eq('id', id)
      if (error) throw error
      toast.success('Transportadora desativada')
      if (expanded === id) setExpanded(null)
      load()
    } catch {
      toast.error('Erro ao desativar.')
    }
  }

  async function adicionarMotorista(transportadora_id: string) {
    const f = motorForm[transportadora_id]
    if (!f?.nome?.trim()) { toast.error('Nome do motorista é obrigatório'); return }
    try {
      const { error } = await supabase.from('motoristas_cadastrados').insert({
        transportadora_id,
        nome: f.nome.trim(),
        cpf: f.cpf?.trim() || null,
        rg: f.rg?.trim() || null,
      })
      if (error) throw error
      toast.success('Motorista adicionado')
      setMotorForm(prev => ({ ...prev, [transportadora_id]: emptyMotorista() }))
      load()
    } catch (err: any) {
      toast.error('Erro: ' + err.message)
    }
  }

  async function excluirMotorista(id: string) {
    if (!confirm('Desativar este motorista?')) return
    try {
      await supabase.from('motoristas_cadastrados').update({ ativo: false }).eq('id', id)
      toast.success('Motorista removido')
      load()
    } catch {
      toast.error('Erro ao remover motorista.')
    }
  }

  async function adicionarVeiculo(transportadora_id: string) {
    const f = veicForm[transportadora_id]
    if (!f?.modelo?.trim() || !f?.placa?.trim()) {
      toast.error('Modelo e placa são obrigatórios')
      return
    }
    try {
      const { error } = await supabase.from('veiculos_cadastrados').insert({
        transportadora_id,
        modelo: f.modelo.trim(),
        placa: f.placa.trim().toUpperCase(),
      })
      if (error) throw error
      toast.success('Veículo adicionado')
      setVeicForm(prev => ({ ...prev, [transportadora_id]: emptyVeiculo() }))
      load()
    } catch (err: any) {
      toast.error('Erro: ' + err.message)
    }
  }

  async function excluirVeiculo(id: string) {
    if (!confirm('Desativar este veículo?')) return
    try {
      await supabase.from('veiculos_cadastrados').update({ ativo: false }).eq('id', id)
      toast.success('Veículo removido')
      load()
    } catch {
      toast.error('Erro ao remover veículo.')
    }
  }

  return (
    <div style={{ paddingBottom: '32px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
        <button className="header-btn" onClick={() => navigate('/')} style={{ marginLeft: '-8px' }}>
          <ArrowLeft size={24} />
        </button>
        <div style={{ flex: 1 }}>
          <h2 className="title-large" style={{ margin: 0, fontSize: '18px' }}>Transportadoras</h2>
          <span className="text-muted" style={{ fontSize: '13px' }}>Cadastro de frota e parceiros</span>
        </div>
        <button className="btn btn-secondary" onClick={() => setShowForm(!showForm)} style={{ width: 'auto', height: '36px', padding: '0 12px', fontSize: '12px' }}>
          <Plus size={16} />
          <span>Nova</span>
        </button>
      </div>

      {/* New Transportadora Form Card */}
      {showForm && (
        <div className="card no-active" style={{ border: '1px solid var(--primary)' }}>
          <h3 className="card-title" style={{ color: 'var(--primary)', marginBottom: '12px' }}>Cadastrar Transportadora</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div className="form-group">
              <label>Razão Social *</label>
              <input
                type="text"
                className="input"
                value={form.nome}
                onChange={e => setForm(p => ({ ...p, nome: e.target.value }))}
                placeholder="Ex: Alfa Logística"
              />
            </div>
            <div className="form-group">
              <label>CNPJ *</label>
              <input
                type="text"
                className="input"
                value={form.cnpj}
                onChange={e => setForm(p => ({ ...p, cnpj: formatCNPJ(e.target.value) }))}
                placeholder="00.000.000/0001-00"
                inputMode="numeric"
              />
            </div>
            <div className="form-group">
              <label>E-mail de Contato (Opcional)</label>
              <input
                type="email"
                className="input"
                value={form.contato_email}
                onChange={e => setForm(p => ({ ...p, contato_email: e.target.value }))}
                placeholder="contato@empresa.com"
              />
            </div>
            <div className="form-group">
              <label>Telefone (Opcional)</label>
              <input
                type="tel"
                className="input"
                value={form.contato_telefone}
                onChange={e => setForm(p => ({ ...p, contato_telefone: e.target.value }))}
                placeholder="(00) 00000-0000"
                inputMode="tel"
              />
            </div>

            <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
              <button className="btn btn-secondary" onClick={() => setShowForm(false)} style={{ flex: 1 }}>
                Cancelar
              </button>
              <button className="btn btn-primary" onClick={salvarTransportadora} disabled={saving} style={{ flex: 1 }}>
                {saving ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main list */}
      {loading ? (
        <div className="flex-center" style={{ height: '40vh' }}>
          <div style={{
            width: '28px',
            height: '28px',
            borderRadius: '50%',
            border: '2px solid var(--border)',
            borderTopColor: 'var(--primary)',
            animation: 'spin 1s linear infinite'
          }} />
        </div>
      ) : lista.length === 0 ? (
        <div className="card text-center" style={{ padding: '40px 16px' }}>
          <Truck size={40} className="text-muted" style={{ margin: '0 auto 12px auto' }} />
          <p className="text-muted" style={{ fontSize: '14px' }}>Nenhuma transportadora cadastrada.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {lista.map(t => {
            const isExpanded = expanded === t.id
            const currentTab = activeTab[t.id] ?? 'motoristas'
            const mForm = motorForm[t.id] ?? emptyMotorista()
            const vForm = veicForm[t.id] ?? emptyVeiculo()

            return (
              <div key={t.id} className="card no-active" style={{ padding: 0, overflow: 'hidden' }}>
                {/* Header card click to expand */}
                <div
                  onClick={() => toggle(t.id)}
                  style={{
                    padding: '16px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    cursor: 'pointer',
                    background: isExpanded ? 'var(--bg-highlight)' : 'transparent',
                    borderBottom: isExpanded ? '1px solid var(--border)' : 'none'
                  }}
                >
                  <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                    <Truck size={20} className="text-primary" />
                    <div>
                      <span className="font-bold" style={{ fontSize: '15px', display: 'block' }}>{t.nome}</span>
                      <span className="text-muted" style={{ fontSize: '12px' }}>CNPJ: {t.cnpj}</span>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }} onClick={e => e.stopPropagation()}>
                    <button
                      className="header-btn text-danger"
                      onClick={() => excluirTransportadora(t.id)}
                      style={{ width: '32px', height: '32px' }}
                    >
                      <Trash2 size={14} />
                    </button>
                    <div onClick={() => toggle(t.id)} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                      {isExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                    </div>
                  </div>
                </div>

                {/* Expanded content */}
                {isExpanded && (
                  <div style={{ padding: '16px' }}>
                    {/* Tab Switcher Pills */}
                    <div style={{
                      display: 'flex',
                      background: 'var(--bg-highlight)',
                      padding: '4px',
                      borderRadius: '8px',
                      marginBottom: '16px',
                      border: '1px solid var(--border)'
                    }}>
                      <button
                        onClick={() => setActiveTab(prev => ({ ...prev, [t.id]: 'motoristas' }))}
                        style={{
                          flex: 1,
                          height: '32px',
                          border: 'none',
                          borderRadius: '6px',
                          background: currentTab === 'motoristas' ? '#fff' : 'transparent',
                          color: currentTab === 'motoristas' ? 'var(--primary)' : 'var(--text-muted)',
                          fontWeight: currentTab === 'motoristas' ? 700 : 500,
                          fontSize: '13px',
                          cursor: 'pointer',
                          boxShadow: currentTab === 'motoristas' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none'
                        }}
                      >
                        Motoristas ({t.motoristas.length})
                      </button>
                      <button
                        onClick={() => setActiveTab(prev => ({ ...prev, [t.id]: 'veiculos' }))}
                        style={{
                          flex: 1,
                          height: '32px',
                          border: 'none',
                          borderRadius: '6px',
                          background: currentTab === 'veiculos' ? '#fff' : 'transparent',
                          color: currentTab === 'veiculos' ? 'var(--primary)' : 'var(--text-muted)',
                          fontWeight: currentTab === 'veiculos' ? 700 : 500,
                          fontSize: '13px',
                          cursor: 'pointer',
                          boxShadow: currentTab === 'veiculos' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none'
                        }}
                      >
                        Veículos ({t.veiculos.length})
                      </button>
                    </div>

                    {/* Tab content 1: Motoristas */}
                    {currentTab === 'motoristas' && (
                      <div>
                        {/* Add Driver mini-form */}
                        <div style={{
                          background: 'var(--bg-highlight)',
                          padding: '12px',
                          borderRadius: '8px',
                          border: '1px solid var(--border)',
                          marginBottom: '16px'
                        }}>
                          <span className="font-bold" style={{ fontSize: '13px', display: 'block', marginBottom: '8px' }}>Adicionar Motorista</span>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <input
                              type="text"
                              className="input"
                              placeholder="Nome Completo *"
                              value={mForm.nome}
                              onChange={e => setMotorForm(prev => ({
                                ...prev,
                                [t.id]: { ...(prev[t.id] ?? emptyMotorista()), nome: e.target.value }
                              }))}
                              style={{ height: '36px', fontSize: '13px' }}
                            />
                            <div style={{ display: 'flex', gap: '8px' }}>
                              <input
                                type="text"
                                className="input"
                                placeholder="CPF (opcional)"
                                value={mForm.cpf}
                                onChange={e => setMotorForm(prev => ({
                                  ...prev,
                                  [t.id]: { ...(prev[t.id] ?? emptyMotorista()), cpf: formatCPF(e.target.value) }
                                }))}
                                style={{ height: '36px', fontSize: '13px', flex: 1 }}
                                inputMode="numeric"
                              />
                              <input
                                type="text"
                                className="input"
                                placeholder="RG (opcional)"
                                value={mForm.rg}
                                onChange={e => setMotorForm(prev => ({
                                  ...prev,
                                  [t.id]: { ...(prev[t.id] ?? emptyMotorista()), rg: formatRG(e.target.value) }
                                }))}
                                style={{ height: '36px', fontSize: '13px', flex: 1 }}
                                inputMode="numeric"
                              />
                            </div>
                            <button
                              className="btn btn-secondary flex-center"
                              onClick={() => adicionarMotorista(t.id)}
                              style={{ height: '32px', fontSize: '12px', marginTop: '4px' }}
                            >
                              <Plus size={14} />
                              <span>Adicionar</span>
                            </button>
                          </div>
                        </div>

                        {/* Drivers List */}
                        {t.motoristas.length === 0 ? (
                          <p className="text-muted text-center" style={{ fontSize: '12px', padding: '10px' }}>Nenhum motorista cadastrado.</p>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            {t.motoristas.map(m => (
                              <div key={m.id} className="flex-between" style={{
                                background: '#fff',
                                border: '1px solid var(--border)',
                                borderRadius: '8px',
                                padding: '8px 12px'
                              }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                  <User size={16} className="text-muted" />
                                  <div>
                                    <span className="font-bold" style={{ fontSize: '13px', display: 'block' }}>{m.nome}</span>
                                    <span className="text-muted" style={{ fontSize: '11px' }}>
                                      {m.cpf ? `CPF: ${m.cpf}` : 'Sem CPF'} {m.rg && `· RG: ${m.rg}`}
                                    </span>
                                  </div>
                                </div>
                                <button className="header-btn text-danger" onClick={() => excluirMotorista(m.id)} style={{ width: '28px', height: '28px' }}>
                                  <Trash2 size={12} />
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Tab content 2: Veículos */}
                    {currentTab === 'veiculos' && (
                      <div>
                        {/* Add Vehicle mini-form */}
                        <div style={{
                          background: 'var(--bg-highlight)',
                          padding: '12px',
                          borderRadius: '8px',
                          border: '1px solid var(--border)',
                          marginBottom: '16px'
                        }}>
                          <span className="font-bold" style={{ fontSize: '13px', display: 'block', marginBottom: '8px' }}>Adicionar Veículo</span>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <div style={{ display: 'flex', gap: '8px' }}>
                              <input
                                type="text"
                                className="input"
                                placeholder="Modelo (Ex: Fiorino) *"
                                value={vForm.modelo}
                                onChange={e => setVeicForm(prev => ({
                                  ...prev,
                                  [t.id]: { ...(prev[t.id] ?? emptyVeiculo()), modelo: e.target.value }
                                }))}
                                style={{ height: '36px', fontSize: '13px', flex: 2 }}
                              />
                              <input
                                type="text"
                                className="input"
                                placeholder="Placa *"
                                value={vForm.placa}
                                onChange={e => setVeicForm(prev => ({
                                  ...prev,
                                  [t.id]: { ...(prev[t.id] ?? emptyVeiculo()), placa: formatPlaca(e.target.value) }
                                }))}
                                style={{ height: '36px', fontSize: '13px', flex: 1 }}
                              />
                            </div>
                            <button
                              className="btn btn-secondary flex-center"
                              onClick={() => adicionarVeiculo(t.id)}
                              style={{ height: '32px', fontSize: '12px', marginTop: '4px' }}
                            >
                              <Plus size={14} />
                              <span>Adicionar</span>
                            </button>
                          </div>
                        </div>

                        {/* Vehicles List */}
                        {t.veiculos.length === 0 ? (
                          <p className="text-muted text-center" style={{ fontSize: '12px', padding: '10px' }}>Nenhum veículo cadastrado.</p>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            {t.veiculos.map(v => (
                              <div key={v.id} className="flex-between" style={{
                                background: '#fff',
                                border: '1px solid var(--border)',
                                borderRadius: '8px',
                                padding: '8px 12px'
                              }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                  <CreditCard size={16} className="text-muted" />
                                  <div>
                                    <span className="font-bold" style={{ fontSize: '13px', display: 'block' }}>{v.modelo}</span>
                                    <span className="text-muted" style={{ fontSize: '11px' }}>Placa: {v.placa}</span>
                                  </div>
                                </div>
                                <button className="header-btn text-danger" onClick={() => excluirVeiculo(v.id)} style={{ width: '28px', height: '28px' }}>
                                  <Trash2 size={12} />
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { formatCNPJ, validateCNPJ, formatCPF, formatRG } from '../lib/validators'
import type { TransportadoraCadastrada, MotoristaCadastrado, VeiculoCadastrado } from '../types'
import toast from 'react-hot-toast'
import { PlusCircle, Trash2, ChevronDown, ChevronUp, Truck, User, Car, AlertTriangle } from 'lucide-react'

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
  const [lista, setLista] = useState<TransportadoraExpandida[]>([])
  const [loading, setLoading] = useState(true)
  const [migrationNeeded, setMigrationNeeded] = useState(false)
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
    const [{ data: transp, error: errT }, { data: motors }, { data: veics }] = await Promise.all([
      supabase.from('transportadoras_cadastradas').select('*').eq('ativo', true).order('nome'),
      supabase.from('motoristas_cadastrados').select('*').eq('ativo', true).order('nome'),
      supabase.from('veiculos_cadastrados').select('*').eq('ativo', true).order('modelo'),
    ])
    if (errT?.code === '42P01') { // tabela não existe
      setMigrationNeeded(true)
      setLoading(false)
      return
    }

    const expandidas: TransportadoraExpandida[] = (transp ?? []).map(t => ({
      ...t,
      motoristas: (motors ?? []).filter(m => m.transportadora_id === t.id),
      veiculos: (veics ?? []).filter(v => v.transportadora_id === t.id),
    }))
    setLista(expandidas)
    setLoading(false)
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
    const { error } = await supabase.from('transportadoras_cadastradas').insert({
      nome: form.nome.trim(),
      cnpj: form.cnpj,
      contato_email: form.contato_email.trim() || null,
      contato_telefone: form.contato_telefone.trim() || null,
    })
    setSaving(false)
    if (error) { toast.error('Erro ao salvar: ' + error.message); return }
    toast.success('Transportadora cadastrada!')
    setForm(emptyTransp())
    setShowForm(false)
    load()
  }

  async function excluirTransportadora(id: string) {
    if (!confirm('Desativar esta transportadora?')) return
    const { error } = await supabase
      .from('transportadoras_cadastradas')
      .update({ ativo: false })
      .eq('id', id)
    if (error) { toast.error('Erro ao desativar'); return }
    toast.success('Transportadora desativada')
    load()
  }

  async function adicionarMotorista(transportadora_id: string) {
    const f = motorForm[transportadora_id]
    if (!f?.nome?.trim()) { toast.error('Nome do motorista é obrigatório'); return }
    const { error } = await supabase.from('motoristas_cadastrados').insert({
      transportadora_id,
      nome: f.nome.trim(),
      cpf: f.cpf?.trim() || null,
      rg: f.rg?.trim() || null,
    })
    if (error) { toast.error('Erro: ' + error.message); return }
    toast.success('Motorista adicionado')
    setMotorForm(prev => ({ ...prev, [transportadora_id]: emptyMotorista() }))
    load()
  }

  async function excluirMotorista(id: string) {
    await supabase.from('motoristas_cadastrados').update({ ativo: false }).eq('id', id)
    toast.success('Motorista removido')
    load()
  }

  async function adicionarVeiculo(transportadora_id: string) {
    const f = veicForm[transportadora_id]
    if (!f?.modelo?.trim() || !f?.placa?.trim()) {
      toast.error('Modelo e placa são obrigatórios')
      return
    }
    const { error } = await supabase.from('veiculos_cadastrados').insert({
      transportadora_id,
      modelo: f.modelo.trim(),
      placa: f.placa.trim().toUpperCase(),
    })
    if (error) { toast.error('Erro: ' + error.message); return }
    toast.success('Veículo adicionado')
    setVeicForm(prev => ({ ...prev, [transportadora_id]: emptyVeiculo() }))
    load()
  }

  async function excluirVeiculo(id: string) {
    await supabase.from('veiculos_cadastrados').update({ ativo: false }).eq('id', id)
    toast.success('Veículo removido')
    load()
  }

  return (
    <div className="page">
        <div className="page-header">
          <div>
            <h1>Transportadoras</h1>
            <p className="subtitle">Cadastre transportadoras para pré-preencher romaneios</p>
          </div>
          <button className="btn-primary" onClick={() => setShowForm(!showForm)}>
            <PlusCircle size={16} /> Nova Transportadora
          </button>
        </div>

        {showForm && (
          <div className="form-card" style={{ marginBottom: 20 }}>
            <div className="section-title">Nova Transportadora</div>
            <div className="field-row">
              <div className="field">
                <label>Razão Social *</label>
                <input
                  value={form.nome}
                  onChange={e => setForm(p => ({ ...p, nome: e.target.value }))}
                  placeholder="Nome da empresa"
                />
              </div>
              <div className="field">
                <label>CNPJ *</label>
                <input
                  value={form.cnpj}
                  onChange={e => setForm(p => ({ ...p, cnpj: formatCNPJ(e.target.value) }))}
                  placeholder="00.000.000/0001-00"
                  inputMode="numeric"
                />
              </div>
            </div>
            <div className="field-row" style={{ marginTop: 10 }}>
              <div className="field">
                <label>E-mail de contato</label>
                <input
                  type="email"
                  value={form.contato_email}
                  onChange={e => setForm(p => ({ ...p, contato_email: e.target.value }))}
                  placeholder="contato@transportadora.com.br"
                />
              </div>
              <div className="field">
                <label>Telefone</label>
                <input
                  value={form.contato_telefone}
                  onChange={e => setForm(p => ({ ...p, contato_telefone: e.target.value }))}
                  placeholder="(00) 00000-0000"
                  inputMode="tel"
                />
              </div>
            </div>
            <div className="form-actions" style={{ marginTop: 16 }}>
              <button className="btn-secondary" onClick={() => setShowForm(false)}>Cancelar</button>
              <button className="btn-primary" onClick={salvarTransportadora} disabled={saving}>
                {saving ? 'Salvando...' : 'Salvar Transportadora'}
              </button>
            </div>
          </div>
        )}

        {migrationNeeded && (
          <div className="migration-warning">
            <AlertTriangle size={20} />
            <div>
              <strong>Migration pendente</strong>
              <p>As tabelas de transportadoras ainda não foram criadas. Execute o arquivo <code>004_lixeira_foto_documento.sql</code> no <a href="https://supabase.com/dashboard/project/odanqvpyuycqptqemfat/sql/new" target="_blank" rel="noreferrer">Supabase SQL Editor</a> para habilitar esta funcionalidade.</p>
            </div>
          </div>
        )}

        {loading ? (
          <div className="loading-screen"><div className="spinner" /></div>
        ) : migrationNeeded ? null : lista.length === 0 ? (
          <div className="empty-state">
            <Truck size={40} color="#94a3b8" />
            <p>Nenhuma transportadora cadastrada ainda.</p>
          </div>
        ) : !migrationNeeded ? (
          <div className="transp-list">
            {lista.map(t => (
              <div key={t.id} className="transp-card">
                <div className="transp-header" onClick={() => toggle(t.id)}>
                  <div className="transp-info">
                    <Truck size={18} color="#2563eb" />
                    <div>
                      <div className="transp-nome">{t.nome}</div>
                      <div className="transp-cnpj">{t.cnpj}</div>
                      {t.contato_email && <div className="transp-cnpj">{t.contato_email}</div>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span className="transp-badge">{t.motoristas.length} mot. · {t.veiculos.length} veíc.</span>
                    <button
                      className="btn-icon-sm danger"
                      onClick={e => { e.stopPropagation(); excluirTransportadora(t.id) }}
                      title="Desativar"
                    >
                      <Trash2 size={14} />
                    </button>
                    {expanded === t.id ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                  </div>
                </div>

                {expanded === t.id && (
                  <div className="transp-body">
                    <div className="transp-tabs">
                      <button
                        className={`transp-tab ${activeTab[t.id] !== 'veiculos' ? 'active' : ''}`}
                        onClick={() => setActiveTab(prev => ({ ...prev, [t.id]: 'motoristas' }))}
                      >
                        <User size={14} /> Motoristas
                      </button>
                      <button
                        className={`transp-tab ${activeTab[t.id] === 'veiculos' ? 'active' : ''}`}
                        onClick={() => setActiveTab(prev => ({ ...prev, [t.id]: 'veiculos' }))}
                      >
                        <Car size={14} /> Veículos
                      </button>
                    </div>

                    {activeTab[t.id] !== 'veiculos' ? (
                      <div className="transp-sublist">
                        {t.motoristas.map(m => (
                          <div key={m.id} className="transp-subitem">
                            <div>
                              <strong>{m.nome}</strong>
                              {m.cpf && <span className="muted"> · CPF: {m.cpf}</span>}
                              {m.rg && <span className="muted"> · RG: {m.rg}</span>}
                            </div>
                            <button className="btn-icon-sm danger" onClick={() => excluirMotorista(m.id)}>
                              <Trash2 size={13} />
                            </button>
                          </div>
                        ))}
                        <div className="transp-add-row">
                          <input
                            placeholder="Nome do motorista *"
                            value={motorForm[t.id]?.nome ?? ''}
                            onChange={e => setMotorForm(prev => ({
                              ...prev,
                              [t.id]: { ...(prev[t.id] ?? emptyMotorista()), nome: e.target.value }
                            }))}
                          />
                          <input
                            placeholder="CPF"
                            inputMode="numeric"
                            value={motorForm[t.id]?.cpf ?? ''}
                            onChange={e => setMotorForm(prev => ({
                              ...prev,
                              [t.id]: { ...(prev[t.id] ?? emptyMotorista()), cpf: formatCPF(e.target.value) }
                            }))}
                          />
                          <input
                            placeholder="RG"
                            inputMode="numeric"
                            value={motorForm[t.id]?.rg ?? ''}
                            onChange={e => setMotorForm(prev => ({
                              ...prev,
                              [t.id]: { ...(prev[t.id] ?? emptyMotorista()), rg: formatRG(e.target.value) }
                            }))}
                          />
                          <button className="btn-secondary" onClick={() => adicionarMotorista(t.id)}>
                            <PlusCircle size={14} /> Adicionar
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="transp-sublist">
                        {t.veiculos.map(v => (
                          <div key={v.id} className="transp-subitem">
                            <div>
                              <strong>{v.modelo}</strong>
                              <span className="muted"> · {v.placa}</span>
                            </div>
                            <button className="btn-icon-sm danger" onClick={() => excluirVeiculo(v.id)}>
                              <Trash2 size={13} />
                            </button>
                          </div>
                        ))}
                        <div className="transp-add-row">
                          <input
                            placeholder="Modelo *"
                            value={veicForm[t.id]?.modelo ?? ''}
                            onChange={e => setVeicForm(prev => ({
                              ...prev,
                              [t.id]: { ...(prev[t.id] ?? emptyVeiculo()), modelo: e.target.value }
                            }))}
                          />
                          <input
                            placeholder="Placa *"
                            value={veicForm[t.id]?.placa ?? ''}
                            onChange={e => setVeicForm(prev => ({
                              ...prev,
                              [t.id]: { ...(prev[t.id] ?? emptyVeiculo()), placa: e.target.value }
                            }))}
                            style={{ textTransform: 'uppercase' }}
                          />
                          <button className="btn-secondary" onClick={() => adicionarVeiculo(t.id)}>
                            <PlusCircle size={14} /> Adicionar
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : null}
      </div>
  )
}

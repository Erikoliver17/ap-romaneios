import { useEffect, useState } from 'react'
import type { FormEvent, ChangeEvent } from 'react'
import { supabase } from '../lib/supabase'
import type { ConfigRemetente, Perfil, UserRole } from '../types'
import { Save, UserPlus, Shield } from 'lucide-react'
import ConfirmModal from '../components/ConfirmModal'

export default function ConfiguracoesPage() {
  const [config, setConfig] = useState<Partial<ConfigRemetente>>({})
  const [perfis, setPerfis] = useState<Perfil[]>([])
  const [savingConfig, setSavingConfig] = useState(false)
  const [savedConfig, setSavedConfig] = useState(false)

  const [newEmail, setNewEmail] = useState('')
  const [newNome, setNewNome] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newRole, setNewRole] = useState<UserRole>('colaborador')
  const [creatingUser, setCreatingUser] = useState(false)
  const [userMsg, setUserMsg] = useState('')

  const [confirmRole, setConfirmRole] = useState<{ open: boolean; perfilId: string; nome: string; role: UserRole }>({
    open: false, perfilId: '', nome: '', role: 'colaborador'
  })

  useEffect(() => {
    supabase.from('config_remetente').select('*').limit(1).single().then(({ data }) => {
      if (data) setConfig(data)
    })
    supabase.from('perfis').select('*').order('data_criacao').then(({ data }) => {
      setPerfis(data || [])
    })
  }, [])

  async function salvarConfig(e: FormEvent) {
    e.preventDefault()
    setSavingConfig(true)
    if (config.id) {
      await supabase.from('config_remetente').update(config).eq('id', config.id)
    } else {
      const { data } = await supabase.from('config_remetente').insert(config).select().single()
      if (data) setConfig(data)
    }
    setSavingConfig(false)
    setSavedConfig(true)
    setTimeout(() => setSavedConfig(false), 2000)
  }

  async function criarUsuario(e: FormEvent) {
    e.preventDefault()
    setCreatingUser(true)
    setUserMsg('')
    const { error } = await supabase.auth.signUp({
      email: newEmail,
      password: newPassword,
      options: { data: { nome: newNome, role: newRole } }
    })
    setCreatingUser(false)
    if (error) setUserMsg('Erro: ' + error.message)
    else {
      setUserMsg('Usuário criado! Ele receberá um e-mail de confirmação.')
      setNewEmail(''); setNewNome(''); setNewPassword('')
      supabase.from('perfis').select('*').order('data_criacao').then(({ data }) => setPerfis(data || []))
    }
  }

  function pedirConfirmacaoRole(p: Perfil, novaRole: UserRole) {
    setConfirmRole({ open: true, perfilId: p.id, nome: p.nome, role: novaRole })
  }

  async function confirmarAlterarRole() {
    await supabase.from('perfis').update({ role: confirmRole.role }).eq('id', confirmRole.perfilId)
    setPerfis(prev => prev.map(p => p.id === confirmRole.perfilId ? { ...p, role: confirmRole.role } : p))
    setConfirmRole(c => ({ ...c, open: false }))
  }

  const cf = (field: keyof ConfigRemetente) => ({
    value: (config[field] as string) || '',
    onChange: (e: ChangeEvent<HTMLInputElement>) =>
      setConfig(p => ({ ...p, [field]: e.target.value })),
  })

  return (
    <div className="page">
      <div className="page-header">
        <h1>Configurações</h1>
      </div>

      <div className="settings-grid">
        <div className="card">
          <div className="card-title">Dados do Remetente</div>
          <form onSubmit={salvarConfig} className="settings-form">
            <div className="field">
              <label>Razão Social *</label>
              <input {...cf('nome_empresa')} required placeholder="Nome da empresa" />
            </div>
            <div className="field-row">
              <div className="field">
                <label>CNPJ *</label>
                <input {...cf('cnpj')} required placeholder="00.000.000/0001-00" />
              </div>
              <div className="field">
                <label>CEP *</label>
                <input {...cf('cep')} required placeholder="00000-000" />
              </div>
            </div>
            <div className="field">
              <label>Endereço *</label>
              <input {...cf('endereco')} required placeholder="Rua, número, bairro" />
            </div>
            <div className="field">
              <label>Cidade / UF *</label>
              <input {...cf('cidade_uf')} required placeholder="São Paulo - SP" />
            </div>
            <button type="submit" className="btn-primary" disabled={savingConfig}>
              <Save size={15} /> {savingConfig ? 'Salvando...' : savedConfig ? 'Salvo!' : 'Salvar Configurações'}
            </button>
          </form>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card">
            <div className="card-title">Usuários do Sistema</div>
            <table className="table">
              <thead>
                <tr><th>Nome</th><th>E-mail</th><th>Acesso</th></tr>
              </thead>
              <tbody>
                {perfis.map(p => (
                  <tr key={p.id}>
                    <td>{p.nome}</td>
                    <td className="muted">{p.email}</td>
                    <td>
                      <select
                        value={p.role}
                        onChange={e => pedirConfirmacaoRole(p, e.target.value as UserRole)}
                        className="role-select"
                      >
                        <option value="colaborador">Colaborador</option>
                        <option value="master">Master</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card">
            <div className="card-title"><UserPlus size={16} /> Novo Usuário</div>
            <form onSubmit={criarUsuario} className="settings-form">
              <div className="field-row">
                <div className="field">
                  <label>Nome</label>
                  <input value={newNome} onChange={e => setNewNome(e.target.value)} required placeholder="Nome completo" />
                </div>
                <div className="field">
                  <label>Nível de Acesso</label>
                  <select value={newRole} onChange={e => setNewRole(e.target.value as UserRole)} className="role-select">
                    <option value="colaborador">Colaborador</option>
                    <option value="master">Master</option>
                  </select>
                </div>
              </div>
              <div className="field">
                <label>E-mail</label>
                <input type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} required placeholder="email@empresa.com" />
              </div>
              <div className="field">
                <label>Senha Temporária</label>
                <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} required minLength={6} placeholder="Mínimo 6 caracteres" />
              </div>
              {userMsg && <div className={userMsg.startsWith('Erro') ? 'error-msg' : 'success-msg'}>{userMsg}</div>}
              <button type="submit" className="btn-primary" disabled={creatingUser}>
                <Shield size={15} /> {creatingUser ? 'Criando...' : 'Criar Usuário'}
              </button>
            </form>
          </div>
        </div>
      </div>

      <ConfirmModal
        open={confirmRole.open}
        title="Alterar nível de acesso"
        message={<>Alterar o acesso de <strong>{confirmRole.nome}</strong> para <strong>{confirmRole.role === 'master' ? 'Master' : 'Colaborador'}</strong>?</>}
        confirmLabel="Confirmar"
        variant="primary"
        onConfirm={confirmarAlterarRole}
        onCancel={() => setConfirmRole(c => ({ ...c, open: false }))}
      />
    </div>
  )
}

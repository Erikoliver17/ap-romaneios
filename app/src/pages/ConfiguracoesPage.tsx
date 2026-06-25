import { useEffect, useState } from 'react'
import type { FormEvent, ChangeEvent } from 'react'
import { supabase } from '../lib/supabase'
import type { ConfigRemetente, Perfil, UserRole } from '../types'
import { Save, UserPlus, Shield, Pencil, Trash2 } from 'lucide-react'
import ConfirmModal from '../components/ConfirmModal'
import { useAuth } from '../context/AuthContext'

export default function ConfiguracoesPage() {
  const { user: currentUser } = useAuth()
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


  const [editingUser, setEditingUser] = useState<Perfil | null>(null)
  const [editNome, setEditNome] = useState('')
  const [editEmail, setEditEmail] = useState('')
  const [editRole, setEditRole] = useState<UserRole>('colaborador')
  const [updatingUser, setUpdatingUser] = useState(false)
  const [editError, setEditError] = useState('')

  const [confirmDelete, setConfirmDelete] = useState<{ open: boolean; userId: string; nome: string }>({
    open: false, userId: '', nome: ''
  })
  const [deletingUser, setDeletingUser] = useState(false)

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
      options: {
        data: {
          nome: newNome,
          role: newRole,
          senha_temporaria: newPassword
        }
      }
    })
    setCreatingUser(false)
    if (error) setUserMsg('Erro: ' + error.message)
    else {
      setUserMsg('Usuário criado com sucesso!')
      setNewEmail(''); setNewNome(''); setNewPassword('')
      supabase.from('perfis').select('*').order('data_criacao').then(({ data }) => setPerfis(data || []))
    }
  }

  useEffect(() => {
    if (editingUser) {
      setEditNome(editingUser.nome)
      setEditEmail(editingUser.email)
      setEditRole(editingUser.role)
      setEditError('')
    }
  }, [editingUser])

  async function handleUpdateUser(e: FormEvent) {
    e.preventDefault()
    if (!editingUser) return
    setUpdatingUser(true)
    setEditError('')
    try {
      const { error } = await supabase.rpc('admin_update_user', {
        p_user_id: editingUser.id,
        p_nome: editNome.trim(),
        p_email: editEmail.trim(),
        p_role: editRole
      })
      if (error) throw error

      setEditingUser(null)
      const { data } = await supabase.from('perfis').select('*').order('data_criacao')
      setPerfis(data || [])
    } catch (err: any) {
      setEditError(err.message || 'Erro ao atualizar usuário.')
    } finally {
      setUpdatingUser(false)
    }
  }

  async function handleDeleteUser() {
    setDeletingUser(true)
    try {
      const { error } = await supabase.rpc('admin_delete_user', {
        p_user_id: confirmDelete.userId
      })
      if (error) throw error

      setConfirmDelete({ open: false, userId: '', nome: '' })
      const { data } = await supabase.from('perfis').select('*').order('data_criacao')
      setPerfis(data || [])
    } catch (err: any) {
      alert(err.message || 'Erro ao excluir usuário.')
    } finally {
      setDeletingUser(false)
    }
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
                <tr>
                  <th>Nome</th>
                  <th>E-mail</th>
                  <th>Senha Inicial</th>
                  <th>Acesso</th>
                  <th style={{ textAlign: 'right' }}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {perfis.map(p => (
                  <tr key={p.id}>
                    <td>{p.nome}</td>
                    <td className="muted">{p.email}</td>
                    <td>
                      {p.senha_alterada ? (
                        <span style={{ padding: '2px 8px', borderRadius: '4px', background: '#dcfce7', color: '#15803d', fontSize: '12px', fontWeight: 600 }}>
                          Pessoal
                        </span>
                      ) : (
                        <code style={{ fontSize: '13px', background: 'var(--bg-highlight)', padding: '2px 6px', borderRadius: '4px' }}>
                          {p.senha_temporaria}
                        </code>
                      )}
                    </td>
                    <td>{p.role === 'master' ? 'Master' : 'Colaborador'}</td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                        <button
                          type="button"
                          className="btn-icon"
                          onClick={() => setEditingUser(p)}
                          title="Editar Usuário"
                          style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--text-muted)' }}
                        >
                          <Pencil size={16} />
                        </button>
                        <button
                          type="button"
                          className="btn-icon"
                          onClick={() => setConfirmDelete({ open: true, userId: p.id, nome: p.nome })}
                          disabled={currentUser?.id === p.id}
                          title="Excluir Usuário"
                          style={{
                            background: 'transparent',
                            border: 'none',
                            cursor: currentUser?.id === p.id ? 'not-allowed' : 'pointer',
                            padding: 4,
                            color: currentUser?.id === p.id ? '#ccc' : '#ef4444'
                          }}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
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


      {/* Modal de Editar Usuário */}
      {editingUser && (
        <div className="modal-overlay" onClick={() => setEditingUser(null)}>
          <div className="modal-box" style={{ maxWidth: 400 }} onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">Editar Usuário</h3>
            <form onSubmit={handleUpdateUser} className="settings-form" style={{ marginTop: 16 }}>
              <div className="field" style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', marginBottom: 4 }}>Nome *</label>
                <input
                  type="text"
                  value={editNome}
                  onChange={e => setEditNome(e.target.value)}
                  required
                  placeholder="Nome completo"
                  style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text)' }}
                />
              </div>
              <div className="field" style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', marginBottom: 4 }}>E-mail *</label>
                <input
                  type="email"
                  value={editEmail}
                  onChange={e => setEditEmail(e.target.value)}
                  required
                  placeholder="email@empresa.com"
                  style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text)' }}
                />
              </div>
              <div className="field" style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', marginBottom: 4 }}>Nível de Acesso *</label>
                <select
                  value={editRole}
                  onChange={e => setEditRole(e.target.value as UserRole)}
                  className="role-select"
                  style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text)' }}
                >
                  <option value="colaborador">Colaborador</option>
                  <option value="master">Master</option>
                </select>
              </div>
              {editError && <div className="error-msg" style={{ color: '#ef4444', marginBottom: 12 }}>{editError}</div>}
              <div className="modal-actions" style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 16 }}>
                <button type="button" className="btn-secondary" onClick={() => setEditingUser(null)}>
                  Cancelar
                </button>
                <button type="submit" className="btn-primary" disabled={updatingUser}>
                  {updatingUser ? 'Salvando...' : 'Salvar Alterações'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal de Confirmação de Exclusão */}
      <ConfirmModal
        open={confirmDelete.open}
        title="Excluir Usuário"
        message={<>Tem certeza que deseja excluir o usuário <strong>{confirmDelete.nome}</strong>? Esta ação é irreversível.</>}
        confirmLabel={deletingUser ? 'Excluindo...' : 'Excluir'}
        variant="danger"
        onConfirm={handleDeleteUser}
        onCancel={() => setConfirmDelete({ open: false, userId: '', nome: '' })}
      />
    </div>
  )
}

export type UserRole = 'master' | 'colaborador'
export type RomaneioStatus = 'Pendente' | 'Preenchido' | 'Liberado' | 'Cancelado'

export interface Perfil {
  id: string
  nome: string
  email: string
  role: UserRole
  data_criacao: string
}

export interface ConfigRemetente {
  id: string
  nome_empresa: string
  cnpj: string
  endereco: string
  cidade_uf: string
  cep: string
  atualizado_em: string
}

export interface Romaneio {
  id: string
  token_publico: string
  token_expira_em: string | null
  data_criacao: string
  data_atualizacao: string
  status: RomaneioStatus
  transportadora_nome: string | null
  transportadora_cnpj: string | null
  motorista_nome: string | null
  motorista_rg: string | null
  motorista_cpf: string | null
  veiculo_modelo: string | null
  veiculo_placa: string | null
  criado_por: string | null
  observacoes: string | null
  observacao_transportadora: string | null
  assinatura_motorista: string | null
  email_notificacao: string | null
  excluido_em: string | null
  foto_documento_motorista: string | null
}

export interface RomaneioItem {
  id: string
  romaneio_id: string
  numero_nfe: string
  cliente_destinatario: string
  empresa: string | null
  depositante: string
  qtd_volumes: number
  peso_kg: number | null
  observacao: string | null
  inserido_em: string
  bipado_em: string | null
  bipado_codigo: string | null
}

export interface TransportadoraCadastrada {
  id: string
  nome: string
  cnpj: string
  contato_email: string | null
  contato_telefone: string | null
  ativo: boolean
  criado_em: string
}

export interface MotoristaCadastrado {
  id: string
  transportadora_id: string
  nome: string
  cpf: string | null
  rg: string | null
  ativo: boolean
}

export interface VeiculoCadastrado {
  id: string
  transportadora_id: string
  modelo: string
  placa: string
  ativo: boolean
}

export interface RomaneioCompleto {
  romaneio_id: string
  token_publico: string
  token_expira_em: string | null
  data_emissao: string
  data_ultima_atualizacao: string
  status: RomaneioStatus
  observacoes: string | null
  observacao_transportadora: string | null
  assinatura_motorista: string | null
  remetente_nome: string
  remetente_cnpj: string
  remetente_endereco: string
  remetente_cidade_uf: string
  remetente_cep: string
  transportadora_nome: string | null
  transportadora_cnpj: string | null
  motorista_nome: string | null
  motorista_rg: string | null
  motorista_cpf: string | null
  veiculo_modelo: string | null
  veiculo_placa: string | null
  total_nfes: number
  total_volumes: number
  total_peso_kg: number
  depositantes: string[] | null
  itens: RomaneioItem[]
  criado_por_nome: string | null
  criado_por_email: string | null
}

export interface RomaneioHistorico {
  id: string
  romaneio_id: string
  evento: string
  descricao: string | null
  dados_antes: Record<string, unknown> | null
  dados_depois: Record<string, unknown> | null
  executado_por: string | null
  executado_em: string
}

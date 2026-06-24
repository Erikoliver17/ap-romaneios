import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import type { Romaneio, RomaneioItem, RomaneioStatus, RomaneioHistorico } from '../types'
import { useAuth } from '../context/AuthContext'
import StatusBadge from '../components/StatusBadge'
import ConfirmModal from '../components/ConfirmModal'
import { normalizarNfe, mesmaNfe, ehChaveCompleta } from '../lib/nfe'
import { ArrowLeft, Copy, Printer, CheckCircle, XCircle, PlusCircle, Trash2, Clock, RefreshCw, ChevronDown, ChevronUp, ScanLine, Pencil, Camera, PenLine } from 'lucide-react'
import { formatCNPJ, formatCPF, formatRG, validateCNPJ, validateCPF, validatePlaca } from '../lib/validators'

function SignaturePad({ onCapture }: { onCapture: (data: string | null) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const [hasSig, setHasSig] = useState(false)

  const getPos = (e: MouseEvent | TouchEvent, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect()
    const src = 'touches' in e ? e.touches[0] : e
    return { x: src.clientX - rect.left, y: src.clientY - rect.top }
  }

  const startDraw = useCallback((e: MouseEvent | TouchEvent) => {
    e.preventDefault()
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    const { x, y } = getPos(e, canvas)
    ctx.beginPath()
    ctx.moveTo(x, y)
    drawing.current = true
  }, [])

  const draw = useCallback((e: MouseEvent | TouchEvent) => {
    if (!drawing.current) return
    e.preventDefault()
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    const { x, y } = getPos(e, canvas)
    ctx.lineTo(x, y)
    ctx.strokeStyle = '#1e293b'
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.stroke()
    setHasSig(true)
    onCapture(canvas.toDataURL('image/png'))
  }, [onCapture])

  const stopDraw = useCallback(() => { drawing.current = false }, [])

  useEffect(() => {
    const canvas = canvasRef.current!
    canvas.addEventListener('mousedown', startDraw)
    canvas.addEventListener('mousemove', draw)
    canvas.addEventListener('mouseup', stopDraw)
    canvas.addEventListener('mouseleave', stopDraw)
    canvas.addEventListener('touchstart', startDraw, { passive: false })
    canvas.addEventListener('touchmove', draw, { passive: false })
    canvas.addEventListener('touchend', stopDraw)
    return () => {
      canvas.removeEventListener('mousedown', startDraw)
      canvas.removeEventListener('mousemove', draw)
      canvas.removeEventListener('mouseup', stopDraw)
      canvas.removeEventListener('mouseleave', stopDraw)
      canvas.removeEventListener('touchstart', startDraw)
      canvas.removeEventListener('touchmove', draw)
      canvas.removeEventListener('touchend', stopDraw)
    }
  }, [startDraw, draw, stopDraw])

  function limpar() {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    setHasSig(false)
    onCapture(null)
  }

  return (
    <div className="signature-wrapper">
      <div className="signature-label">
        <PenLine size={14} /> Assinatura do Motorista
      </div>
      <canvas ref={canvasRef} className="signature-canvas" width={600} height={160} />
      {hasSig && (
        <button type="button" className="btn-ghost signature-clear" onClick={limpar}>
          <Trash2 size={14} /> Limpar assinatura
        </button>
      )}
      {!hasSig && <p className="signature-hint">Assine acima com o dedo ou mouse</p>}
    </div>
  )
}

interface ConfirmState {
  open: boolean
  status: RomaneioStatus | null
  title: string
  message: string
  variant: 'danger' | 'success' | 'primary'
  label: string
}

function formatExpiry(dateStr: string | null): { label: string; urgent: boolean } | null {
  if (!dateStr) return null
  const expiry = new Date(dateStr)
  const now = new Date()
  if (expiry < now) return { label: 'Link expirado', urgent: true }
  const msLeft = expiry.getTime() - now.getTime()
  const hours = msLeft / 3600000
  if (hours < 1) return { label: `Link expira em menos de 1h!`, urgent: true }
  if (hours < 24) return { label: `Link expira em ${Math.ceil(hours)}h`, urgent: hours < 4 }
  const days = Math.ceil(hours / 24)
  if (days <= 3) return { label: `Link expira em ${days} dia${days > 1 ? 's' : ''}`, urgent: true }
  return { label: `Link válido por ${days} dias`, urgent: false }
}

export default function RomaneioDetalhePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { isMaster } = useAuth()
  const [romaneio, setRomaneio] = useState<Romaneio | null>(null)
  const [itens, setItens] = useState<RomaneioItem[]>([])
  const [historico, setHistorico] = useState<RomaneioHistorico[]>([])
  const [loading, setLoading] = useState(true)
  const [changingStatus, setChangingStatus] = useState(false)
  const [renewingToken, setRenewingToken] = useState(false)
  const [showHistorico, setShowHistorico] = useState(false)
  const [modal, setModal] = useState<ConfirmState>({
    open: false, status: null, title: '', message: '', variant: 'danger', label: ''
  })

  const [uploadingFoto, setUploadingFoto] = useState(false)
  const fotoInputRef = useRef<HTMLInputElement>(null)

  const [showAddItem, setShowAddItem] = useState(false)
  const [newItem, setNewItem] = useState({ numero_nfe: '', cliente_destinatario: '', empresa: '', depositante: '', qtd_volumes: 1 })
  const [savingItem, setSavingItem] = useState(false)
  const [addItemError, setAddItemError] = useState('')
  const [searchingNfe, setSearchingNfe] = useState(false)

  // Estados para Cadastro de Coleta Local
  const [showColetaForm, setShowColetaForm] = useState(false)
  const [savingColeta, setSavingColeta] = useState(false)
  const [erroColeta, setErroColeta] = useState('')
  const [assinaturaLocal, setAssinaturaLocal] = useState<string | null>(null)
  const [formColeta, setFormColeta] = useState({
    transportadora_nome: '',
    transportadora_cnpj: '',
    motorista_nome: '',
    motorista_rg: '',
    motorista_cpf: '',
    veiculo_modelo: '',
    veiculo_placa: '',
    observacao_transportadora: '',
  })

  useEffect(() => { load() }, [id])

  // Realtime: atualiza status e bipagem em tempo real
  useEffect(() => {
    if (!id) return
    const channel = supabase
      .channel(`romaneio-detalhe-${id}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'romaneios',
        filter: `id=eq.${id}`
      }, ({ new: updated }) => {
        setRomaneio(updated as Romaneio)
      })
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'romaneio_itens',
        filter: `romaneio_id=eq.${id}`
      }, ({ new: updated }) => {
        setItens(prev => prev.map(it => it.id === (updated as RomaneioItem).id ? { ...it, ...(updated as RomaneioItem) } : it))
      })
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'romaneio_itens',
        filter: `romaneio_id=eq.${id}`
      }, ({ new: inserted }) => {
        setItens(prev => [...prev, inserted as RomaneioItem])
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [id])

  async function load() {
    const [{ data: r, error: errR }, { data: its, error: errI }, { data: hist }] = await Promise.all([
      supabase.from('romaneios').select('*').eq('id', id!).single(),
      supabase.from('romaneio_itens').select('*').eq('romaneio_id', id!).order('inserido_em'),
      supabase.from('romaneio_historico').select('*').eq('romaneio_id', id!).order('executado_em', { ascending: false }),
    ])
    if (errR) toast.error('Erro ao carregar romaneio.')
    if (errI) toast.error('Erro ao carregar itens.')
    setRomaneio(r)
    setItens(its || [])
    setHistorico(hist || [])
    setLoading(false)
  }

  function linkPublico() {
    const base = import.meta.env.VITE_APP_URL || window.location.origin
    return `${base}/coleta/${romaneio?.token_publico}`
  }

  async function copiarLink() {
    await navigator.clipboard.writeText(linkPublico())
    toast.success('Link copiado para a área de transferência!')
  }

  async function renovarLink() {
    if (!isMaster || renewingToken) return
    setRenewingToken(true)
    const novaExpiracao = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    const { error } = await supabase.from('romaneios').update({ token_expira_em: novaExpiracao }).eq('id', id!)
    setRenewingToken(false)
    if (error) {
      toast.error('Erro ao renovar link.')
    } else {
      setRomaneio(prev => prev ? { ...prev, token_expira_em: novaExpiracao } : prev)
      toast.success('Link renovado por mais 7 dias!')
    }
  }

  function pedirConfirmacao(status: RomaneioStatus) {
    if (status === 'Liberado') {
      setModal({ open: true, status, title: 'Liberar romaneio', message: 'Confirmar a liberação do veículo? O status será alterado para Liberado.', variant: 'success', label: 'Liberar' })
    } else {
      setModal({ open: true, status, title: 'Cancelar romaneio', message: 'Tem certeza que deseja cancelar este romaneio? Esta ação não pode ser desfeita.', variant: 'danger', label: 'Cancelar Romaneio' })
    }
  }

  async function confirmarMudancaStatus() {
    if (!modal.status || changingStatus) return
    if (modal.status === 'Liberado' && !romaneio?.assinatura_motorista) {
      toast.error('O motorista precisa assinar o romaneio antes da liberação.')
      setModal(c => ({ ...c, open: false }))
      return
    }
    setChangingStatus(true)
    const { error } = await supabase.from('romaneios').update({ status: modal.status }).eq('id', id!)
    setChangingStatus(false)
    if (error) {
      toast.error('Erro ao atualizar status: ' + error.message)
    } else {
      setRomaneio(prev => prev ? { ...prev, status: modal.status! } : prev)
      toast.success(`Romaneio ${modal.status === 'Liberado' ? 'liberado' : 'cancelado'} com sucesso.`)
      const { data: hist } = await supabase.from('romaneio_historico').select('*').eq('romaneio_id', id!).order('executado_em', { ascending: false })
      setHistorico(hist || [])
      // Envia e-mail automaticamente quando Liberado
      if (modal.status === 'Liberado') {
        supabase.functions.invoke('enviar-romaneio', { body: { romaneio_id: id } })
          .then(({ error: errFn }) => {
            if (!errFn) toast.success('E-mail de notificação enviado!', { duration: 2000 })
          })
      }
    }
    setModal(c => ({ ...c, open: false }))
  }

  function abrirColetaForm() {
    setFormColeta({
      transportadora_nome: romaneio?.transportadora_nome || '',
      transportadora_cnpj: romaneio?.transportadora_cnpj || '',
      motorista_nome: romaneio?.motorista_nome || '',
      motorista_rg: romaneio?.motorista_rg || '',
      motorista_cpf: romaneio?.motorista_cpf || '',
      veiculo_modelo: romaneio?.veiculo_modelo || '',
      veiculo_placa: romaneio?.veiculo_placa || '',
      observacao_transportadora: romaneio?.observacao_transportadora || '',
    })
    setAssinaturaLocal(romaneio?.assinatura_motorista || null)
    setErroColeta('')
    setShowColetaForm(true)
  }

  async function salvarColetaLocal() {
    setErroColeta('')
    if (!formColeta.transportadora_nome.trim()) { setErroColeta('Nome da transportadora é obrigatório.'); return }
    if (!validateCNPJ(formColeta.transportadora_cnpj)) { setErroColeta('CNPJ da transportadora inválido.'); return }
    if (!formColeta.motorista_nome.trim()) { setErroColeta('Nome do motorista é obrigatório.'); return }
    if (!validateCPF(formColeta.motorista_cpf)) { setErroColeta('CPF do motorista inválido.'); return }
    if (!formColeta.veiculo_modelo.trim()) { setErroColeta('Modelo do veículo é obrigatório.'); return }
    if (!validatePlaca(formColeta.veiculo_placa)) { setErroColeta('Placa do veículo inválida (formatos: AAA-0000 ou ABC1D23).'); return }
    if (!assinaturaLocal) { setErroColeta('A assinatura do motorista é obrigatória.'); return }

    setSavingColeta(true)
    const { error } = await supabase
      .from('romaneios')
      .update({
        transportadora_nome: formColeta.transportadora_nome.trim(),
        transportadora_cnpj: formColeta.transportadora_cnpj,
        motorista_nome: formColeta.motorista_nome.trim(),
        motorista_rg: formColeta.motorista_rg.trim(),
        motorista_cpf: formColeta.motorista_cpf,
        veiculo_modelo: formColeta.veiculo_modelo.trim(),
        veiculo_placa: formColeta.veiculo_placa.trim().toUpperCase(),
        observacao_transportadora: formColeta.observacao_transportadora.trim() || null,
        assinatura_motorista: assinaturaLocal,
        status: romaneio?.status === 'Pendente' ? 'Preenchido' : romaneio?.status
      })
      .eq('id', id!)

    setSavingColeta(false)
    if (error) {
      setErroColeta('Erro ao salvar no banco: ' + error.message)
    } else {
      toast.success('Cadastro de coleta atualizado com sucesso!')
      setShowColetaForm(false)
      load()
    }
  }

  async function buscarDadosWms(valor: string) {
    const nfeNum = normalizarNfe(valor)
    if (!nfeNum) return

    setSearchingNfe(true)
    setAddItemError('')
    try {
      const { data, error } = await supabase.functions.invoke('buscar-nfe', {
        body: { nfe: nfeNum }
      })
      if (error || data?.error) {
        toast.error(`NF-e ${nfeNum} não encontrada no WMS. Preencha manualmente.`)
      } else {
        setNewItem({
          numero_nfe: data.nfe || nfeNum,
          cliente_destinatario: data.destinatario || '',
          empresa: data.empresa || '',
          depositante: data.depositante || '',
          qtd_volumes: data.volumes ?? 1
        })
        toast.success(`Dados da NF-e ${nfeNum} carregados!`)
      }
    } catch {
      toast.error('Erro ao consultar WMS')
    } finally {
      setSearchingNfe(false)
    }
  }

  async function adicionarItem() {
    if (!newItem.numero_nfe.trim() || !newItem.cliente_destinatario.trim()) return
    setAddItemError('')

    const nfeNorm = normalizarNfe(newItem.numero_nfe)
    if (itens.some(it => mesmaNfe(it.numero_nfe, nfeNorm))) {
      setAddItemError(`NF-e "${nfeNorm}" já existe neste romaneio.`)
      return
    }

    setSavingItem(true)
    const { data, error } = await supabase.from('romaneio_itens').insert({
      romaneio_id: id!,
      numero_nfe: nfeNorm,
      cliente_destinatario: newItem.cliente_destinatario.trim(),
      empresa: newItem.empresa.trim() || null,
      depositante: newItem.depositante.trim() || null,
      qtd_volumes: Number(newItem.qtd_volumes),
    }).select().single()
    setSavingItem(false)

    if (error) { toast.error('Erro ao adicionar item: ' + error.message); return }
    if (data) setItens(prev => [...prev, data])
    setNewItem({ numero_nfe: '', cliente_destinatario: '', empresa: '', depositante: '', qtd_volumes: 1 })
    setShowAddItem(false)
    toast.success('NF-e adicionada.')
  }

  async function removerItem(itemId: string) {
    if (!confirm('Remover esta NF-e?')) return
    const { error } = await supabase.from('romaneio_itens').delete().eq('id', itemId)
    if (error) { toast.error('Erro ao remover item.'); return }
    setItens(prev => prev.filter(it => it.id !== itemId))
  }

  async function moverParaLixeira() {
    if (!confirm('Mover este romaneio para a lixeira? Você pode restaurá-lo depois.')) return
    const { error } = await supabase
      .from('romaneios')
      .update({ excluido_em: new Date().toISOString() })
      .eq('id', id!)
    if (error) { toast.error('Erro ao excluir'); return }
    toast.success('Romaneio movido para a lixeira')
    navigate('/')
  }

  async function capturarFoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setUploadingFoto(true)
    try {
      // Comprime a imagem via canvas antes de salvar
      const img = await new Promise<HTMLImageElement>((res, rej) => {
        const image = new Image()
        image.onload = () => res(image)
        image.onerror = rej
        image.src = URL.createObjectURL(file)
      })
      const MAX = 1200
      const scale = Math.min(1, MAX / Math.max(img.width, img.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.width * scale)
      canvas.height = Math.round(img.height * scale)
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
      const base64 = canvas.toDataURL('image/jpeg', 0.72)

      const { error } = await supabase
        .from('romaneios')
        .update({ foto_documento_motorista: base64 })
        .eq('id', id!)
      if (error) throw error
      setRomaneio(prev => prev ? { ...prev, foto_documento_motorista: base64 } : prev)
      toast.success('Foto do documento salva!')
    } catch {
      toast.error('Erro ao salvar a foto.')
    }
    setUploadingFoto(false)
  }

  async function removerFoto() {
    if (!confirm('Remover a foto do documento?')) return
    await supabase.from('romaneios').update({ foto_documento_motorista: null }).eq('id', id!)
    setRomaneio(prev => prev ? { ...prev, foto_documento_motorista: null } : prev)
    toast.success('Foto removida.')
  }

  const canEdit = romaneio && !['Liberado', 'Cancelado'].includes(romaneio.status)
  const totalVolumes = itens.reduce((s, i) => s + i.qtd_volumes, 0)
  const expiryInfo = romaneio ? formatExpiry(romaneio.token_expira_em) : null
  const itensBipados = itens.filter(i => i.bipado_em).length
  const temBipagem = itens.length > 0
  const temAssinatura = !!romaneio?.assinatura_motorista

  if (loading) return <div className="loading-center"><div className="spinner" /></div>
  if (!romaneio) return <div className="page"><p>Romaneio não encontrado.</p></div>

  return (
    <div className="page">
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="btn-ghost" onClick={() => navigate('/')}><ArrowLeft size={18} /></button>
          <div>
            <h1>Romaneio <span className="muted">#{romaneio.id.slice(0, 8).toUpperCase()}</span></h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
              <StatusBadge status={romaneio.status} />
              <span className="muted">{new Date(romaneio.data_criacao).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
              {expiryInfo && (
                <span className={`expiry-badge ${expiryInfo.urgent ? 'expiry-urgent' : 'expiry-ok'}`}>
                  <Clock size={11} /> {expiryInfo.label}
                </span>
              )}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {canEdit && isMaster && (
            <button className="btn-secondary" onClick={() => navigate(`/romaneios/${id}/editar`)}><Pencil size={15} /> Editar</button>
          )}
          <button className="btn-secondary" onClick={copiarLink}><Copy size={15} /> Link Transportadora</button>
          {isMaster && expiryInfo && (
            <button className="btn-secondary" onClick={renovarLink} disabled={renewingToken} title="Estender link por mais 7 dias">
              <RefreshCw size={15} /> {renewingToken ? 'Renovando...' : 'Renovar link'}
            </button>
          )}
          <button className="btn-secondary" onClick={() => navigate(`/romaneios/${id}/bipar`)}><ScanLine size={15} /> Bipar Saída</button>
          <button className="btn-secondary" onClick={() => navigate(`/romaneios/${id}/imprimir`)}><Printer size={15} /> Imprimir</button>
          {canEdit && isMaster && (
            <>
              <button
                className="btn-success"
                onClick={() => pedirConfirmacao('Liberado')}
                disabled={!temAssinatura}
                title={temAssinatura ? undefined : 'Aguardando assinatura do motorista'}
                style={!temAssinatura ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}
              >
                <CheckCircle size={15} /> Liberar
              </button>
              <button className="btn-danger" onClick={() => pedirConfirmacao('Cancelado')}><XCircle size={15} /> Cancelar</button>
            </>
          )}
          {canEdit && !isMaster && romaneio.status === 'Preenchido' && (
            <button
              className="btn-success"
              onClick={() => pedirConfirmacao('Liberado')}
              disabled={!temAssinatura}
              title={temAssinatura ? undefined : 'Aguardando assinatura do motorista'}
              style={!temAssinatura ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}
            >
              <CheckCircle size={15} /> Liberar
            </button>
          )}
          {isMaster && (
            <button className="btn-danger" onClick={moverParaLixeira} title="Mover para lixeira"><Trash2 size={15} /> Lixeira</button>
          )}
        </div>
      </div>

      <div className="detail-grid">
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div className="card-title" style={{ margin: 0 }}>Transportadora & Motorista</div>
            {canEdit && romaneio.transportadora_nome && (
              <button className="btn-ghost" onClick={abrirColetaForm} style={{ padding: '4px 8px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                <Pencil size={12} /> Editar Coleta
              </button>
            )}
          </div>
          {romaneio.transportadora_nome ? (
            <>
              <dl className="dl">
                <dt>Transportadora</dt><dd>{romaneio.transportadora_nome}</dd>
                <dt>CNPJ</dt><dd>{romaneio.transportadora_cnpj || '—'}</dd>
                <dt>Motorista</dt><dd>{romaneio.motorista_nome || '—'}</dd>
                <dt>RG</dt><dd>{romaneio.motorista_rg || '—'}</dd>
                <dt>CPF</dt><dd>{romaneio.motorista_cpf || '—'}</dd>
                <dt>Veículo</dt><dd>{romaneio.veiculo_modelo || '—'}</dd>
                <dt>Placa</dt><dd>{romaneio.veiculo_placa || '—'}</dd>
              </dl>
              {romaneio.observacao_transportadora && (
                <div style={{ marginTop: 12, padding: '10px 12px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 6 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: '#92400e', marginBottom: 4 }}>Observação da Transportadora</div>
                  <p style={{ fontSize: 13, color: '#78350f', lineHeight: 1.5 }}>{romaneio.observacao_transportadora}</p>
                </div>
              )}
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: '#64748b', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <PenLine size={13} /> Assinatura do Motorista
                  {romaneio.assinatura_motorista
                    ? <span style={{ background: '#d1fae5', color: '#065f46', fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 10, textTransform: 'uppercase', letterSpacing: '.04em' }}>Assinado</span>
                    : <span style={{ background: '#fee2e2', color: '#991b1b', fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 10, textTransform: 'uppercase', letterSpacing: '.04em' }}>Pendente</span>
                  }
                </div>
                {romaneio.assinatura_motorista ? (
                  <img
                     src={romaneio.assinatura_motorista}
                     alt="Assinatura do motorista"
                     style={{ maxWidth: '100%', maxHeight: 100, border: '1px solid #e2e8f0', borderRadius: 6, background: '#fff', padding: 4 }}
                  />
                ) : (
                  <div style={{ padding: '10px 12px', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 6, fontSize: 12, color: '#9a3412' }}>
                    O motorista ainda não assinou o romaneio. A liberação ficará bloqueada até a assinatura.
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="empty-state-sm">
              <p>Aguardando preenchimento pela transportadora.</p>
              <div style={{ display: 'flex', gap: 8, marginTop: 8, justifyContent: 'center' }}>
                <button className="btn-ghost" onClick={copiarLink} style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Copy size={14} /> Copiar link</button>
                {canEdit && (
                  <button className="btn-secondary" onClick={abrirColetaForm} style={{ padding: '6px 12px', fontSize: 13, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <PenLine size={13} /> Preencher Localmente
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-title">Resumo da Carga</div>
          <div className="stats-grid">
            <div className="stat"><span className="stat-value">{itens.length}</span><span className="stat-label">NF-e's</span></div>
            <div className="stat"><span className="stat-value">{totalVolumes}</span><span className="stat-label">Volumes</span></div>
            {temBipagem && (
              <div className="stat">
                <span className="stat-value" style={{ color: itensBipados === itens.length ? '#10b981' : '#2563eb' }}>
                  {itensBipados}/{itens.length}
                </span>
                <span className="stat-label">Bipados</span>
              </div>
            )}
          </div>
          {temBipagem && (
            <div style={{ marginTop: 10 }}>
              <div className="progress-bar-bg">
                <div className="progress-bar-fill" style={{ width: `${Math.round(itensBipados / itens.length * 100)}%` }} />
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div className="card-title" style={{ margin: 0 }}>Notas Fiscais ({itens.length})</div>
          {canEdit && (
            <button className="btn-ghost" onClick={() => { setShowAddItem(v => !v); setAddItemError('') }}>
              <PlusCircle size={15} /> Adicionar NF-e
            </button>
          )}
        </div>

        {showAddItem && (
          <div style={{ marginBottom: 12, background: 'var(--bg-highlight)', padding: 12, borderRadius: 8 }}>
            <div className="item-row-6col">
              <input
                placeholder={searchingNfe ? "Buscando no WMS..." : "NF-e * (Bipe ou digite + Enter)"}
                value={newItem.numero_nfe}
                disabled={searchingNfe || savingItem}
                onChange={e => {
                  const val = e.target.value
                  setNewItem(p => ({ ...p, numero_nfe: val }))
                  if (ehChaveCompleta(val)) {
                    setTimeout(() => buscarDadosWms(val), 0)
                  }
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    if (newItem.numero_nfe.trim() && !ehChaveCompleta(newItem.numero_nfe)) {
                      buscarDadosWms(newItem.numero_nfe)
                    }
                  }
                }}
              />
              <input placeholder="Destinatário *" value={newItem.cliente_destinatario} disabled={searchingNfe || savingItem} onChange={e => setNewItem(p => ({ ...p, cliente_destinatario: e.target.value }))} />
              <input placeholder="Empresa" value={newItem.empresa} disabled={searchingNfe || savingItem} onChange={e => setNewItem(p => ({ ...p, empresa: e.target.value }))} />
              <select value={newItem.depositante} disabled={searchingNfe || savingItem} onChange={e => setNewItem(p => ({ ...p, depositante: e.target.value }))}>
                <option value="">— Opcional —</option>
                <option>Amazon</option>
                <option>Correios</option>
                <option>Flex</option>
                <option>Jadlog</option>
                <option>Magalu</option>
                <option>Meli</option>
                <option>Pex</option>
                <option>Shein</option>
                <option>Shopee</option>
                <option>TikTok</option>
              </select>
              <input type="number" min={1} value={newItem.qtd_volumes} disabled={searchingNfe || savingItem} onChange={e => setNewItem(p => ({ ...p, qtd_volumes: Number(e.target.value) }))} />
              <button className="btn-primary" style={{ padding: '6px 14px' }} onClick={adicionarItem} disabled={searchingNfe || savingItem}>Salvar</button>
            </div>
            {addItemError && <div className="error-msg" style={{ marginTop: 8 }}>{addItemError}</div>}
          </div>
        )}

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>NF-e</th>
                <th>Destinatário</th>
                <th>Empresa</th>
                <th>Depositante</th>
                <th style={{ textAlign: 'center' }}>Volumes</th>
                {temBipagem && <th style={{ textAlign: 'center' }}>Bipado</th>}
                {canEdit && <th></th>}
              </tr>
            </thead>
            <tbody>
              {itens.map(it => (
                <tr key={it.id} style={it.bipado_em ? { background: '#f0fdf4' } : undefined}>
                  <td><code>{it.numero_nfe}</code></td>
                  <td>{it.cliente_destinatario}</td>
                  <td>{it.empresa || '—'}</td>
                  <td><span className="depositante-tag">{it.depositante}</span></td>
                  <td style={{ textAlign: 'center' }}>{it.qtd_volumes}</td>
                  {temBipagem && (
                    <td style={{ textAlign: 'center' }}>
                      {it.bipado_em
                        ? <span title={new Date(it.bipado_em).toLocaleString('pt-BR')}>✅</span>
                        : <span style={{ color: '#94a3b8' }}>○</span>
                      }
                    </td>
                  )}
                  {canEdit && (
                    <td>
                      <button className="btn-icon-sm danger" onClick={() => removerItem(it.id)}>
                        <Trash2 size={13} />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4}><strong>Total</strong></td>
                <td style={{ textAlign: 'center' }}><strong>{totalVolumes}</strong></td>
                {temBipagem && <td />}
                {canEdit && <td />}
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Histórico de eventos */}
      {historico.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <button
            className="historico-toggle"
            onClick={() => setShowHistorico(v => !v)}
          >
            <span className="card-title" style={{ margin: 0 }}>Histórico de Eventos ({historico.length})</span>
            {showHistorico ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
          {showHistorico && (
            <div style={{ marginTop: 12 }}>
              {historico.map(h => (
                <div key={h.id} className="historico-item">
                  <div className="historico-dot" />
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <span className="historico-descricao">{h.descricao || h.evento}</span>
                      <span className="historico-data">{new Date(h.executado_em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Foto do documento do motorista */}
      <div className="card" style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div className="card-title" style={{ margin: 0 }}>Foto do Documento do Motorista</div>
          <div style={{ display: 'flex', gap: 8 }}>
            {romaneio.foto_documento_motorista && (
              <button className="btn-icon-sm danger" onClick={removerFoto} title="Remover foto">
                <Trash2 size={14} />
              </button>
            )}
            <input
              ref={fotoInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              style={{ display: 'none' }}
              onChange={capturarFoto}
            />
            <button
              className="btn-secondary"
              onClick={() => fotoInputRef.current?.click()}
              disabled={uploadingFoto}
            >
              <Camera size={15} /> {uploadingFoto ? 'Salvando...' : romaneio.foto_documento_motorista ? 'Trocar foto' : 'Tirar foto / Anexar'}
            </button>
          </div>
        </div>
        {romaneio.foto_documento_motorista ? (
          <div style={{ textAlign: 'center' }}>
            <img
              src={romaneio.foto_documento_motorista}
              alt="Documento do motorista"
              style={{ maxWidth: '100%', maxHeight: 400, borderRadius: 8, border: '1px solid var(--border)', objectFit: 'contain' }}
            />
          </div>
        ) : (
          <div className="empty-state-sm">
            <Camera size={28} color="#94a3b8" />
            <p>Nenhum documento anexado. Tire uma foto da CNH ou outro documento do motorista.</p>
          </div>
        )}
      </div>

      <ConfirmModal
        open={modal.open}
        title={modal.title}
        message={modal.message}
        confirmLabel={modal.label}
        variant={modal.variant}
        onConfirm={confirmarMudancaStatus}
        onCancel={() => setModal(c => ({ ...c, open: false }))}
      />

      {showColetaForm && (
        <div className="modal-overlay" onClick={() => setShowColetaForm(false)}>
          <div className="modal-box" style={{ maxWidth: 650, width: '90%' }} onClick={e => e.stopPropagation()}>
            <h3 className="modal-title" style={{ marginBottom: 16 }}>Cadastro de Coleta / Motorista</h3>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxHeight: '70vh', overflowY: 'auto', paddingRight: 4 }}>
              
              {/* Transportadora */}
              <div>
                <div style={{ fontWeight: 600, fontSize: 13, textTransform: 'uppercase', color: '#64748b', marginBottom: 6 }}>Transportadora</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div className="field">
                    <label>Razão Social *</label>
                    <input
                      placeholder="Nome da transportadora"
                      value={formColeta.transportadora_nome}
                      onChange={e => setFormColeta(p => ({ ...p, transportadora_nome: e.target.value }))}
                    />
                  </div>
                  <div className="field">
                    <label>CNPJ *</label>
                    <input
                      placeholder="00.000.000/0001-00"
                      value={formColeta.transportadora_cnpj}
                      onChange={e => setFormColeta(p => ({ ...p, transportadora_cnpj: formatCNPJ(e.target.value) }))}
                    />
                  </div>
                </div>
              </div>

              {/* Motorista */}
              <div>
                <div style={{ fontWeight: 600, fontSize: 13, textTransform: 'uppercase', color: '#64748b', marginBottom: 6 }}>Motorista</div>
                <div className="field" style={{ marginBottom: 8 }}>
                  <label>Nome Completo *</label>
                  <input
                    placeholder="Nome do motorista"
                    value={formColeta.motorista_nome}
                    onChange={e => setFormColeta(p => ({ ...p, motorista_nome: e.target.value }))}
                  />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div className="field">
                    <label>CPF *</label>
                    <input
                      placeholder="000.000.000-00"
                      value={formColeta.motorista_cpf}
                      onChange={e => setFormColeta(p => ({ ...p, motorista_cpf: formatCPF(e.target.value) }))}
                    />
                  </div>
                  <div className="field">
                    <label>RG</label>
                    <input
                      placeholder="00.000.000-0"
                      value={formColeta.motorista_rg}
                      onChange={e => setFormColeta(p => ({ ...p, motorista_rg: formatRG(e.target.value) }))}
                    />
                  </div>
                </div>
              </div>

              {/* Veículo */}
              <div>
                <div style={{ fontWeight: 600, fontSize: 13, textTransform: 'uppercase', color: '#64748b', marginBottom: 6 }}>Veículo</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div className="field">
                    <label>Modelo *</label>
                    <input
                      placeholder="Ex: Volvo FH 460"
                      value={formColeta.veiculo_modelo}
                      onChange={e => setFormColeta(p => ({ ...p, veiculo_modelo: e.target.value }))}
                    />
                  </div>
                  <div className="field">
                    <label>Placa *</label>
                    <input
                      placeholder="AAA-0000"
                      value={formColeta.veiculo_placa}
                      onChange={e => setFormColeta(p => ({ ...p, veiculo_placa: e.target.value }))}
                      style={{ textTransform: 'uppercase' }}
                    />
                  </div>
                </div>
              </div>

              {/* Observações */}
              <div className="field">
                <label>Observações</label>
                <textarea
                  placeholder="Observações sobre a coleta..."
                  value={formColeta.observacao_transportadora}
                  onChange={e => setFormColeta(p => ({ ...p, observacao_transportadora: e.target.value }))}
                  rows={2}
                  style={{ resize: 'vertical' }}
                />
              </div>

              {/* Assinatura */}
              <div>
                <div style={{ fontWeight: 600, fontSize: 13, textTransform: 'uppercase', color: '#64748b', marginBottom: 6 }}>
                  Assinatura do Motorista *
                </div>
                <SignaturePad onCapture={setAssinaturaLocal} />
              </div>

              {erroColeta && <div className="error-msg" style={{ marginTop: 8 }}>{erroColeta}</div>}
            </div>

            <div className="modal-actions" style={{ marginTop: 20 }}>
              <button type="button" className="btn-secondary" onClick={() => setShowColetaForm(false)} disabled={savingColeta}>
                Cancelar
              </button>
              <button type="button" className="btn-primary" onClick={salvarColetaLocal} disabled={savingColeta}>
                {savingColeta ? 'Salvando...' : 'Salvar Coleta'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

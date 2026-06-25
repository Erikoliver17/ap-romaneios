import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import type { Romaneio, RomaneioItem, RomaneioStatus, RomaneioHistorico } from '../types'
import { useAuth } from '../context/AuthContext'
import { ArrowLeft, Share2, Camera, Trash2, CheckCircle, Truck, User, CreditCard, PenLine, AlertTriangle, Pencil, ChevronDown, ChevronUp, Clock } from 'lucide-react'

// Simple mobile signature pad using standard canvas touch events
function SignaturePad({ onCapture }: { onCapture: (data: string | null) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const [hasSig, setHasSig] = useState(false)

  // Adjust canvas width to fit parent container on load/resize
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const resizeCanvas = () => {
      canvas.width = canvas.parentElement?.clientWidth || 320
      canvas.height = 160
      // Draw signature grid lines or background
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.strokeStyle = '#e2e8f0'
        ctx.lineWidth = 1
        ctx.setLineDash([5, 5])
        ctx.beginPath()
        ctx.moveTo(0, 120)
        ctx.lineTo(canvas.width, 120)
        ctx.stroke()
        ctx.setLineDash([])
      }
    }
    resizeCanvas()
    window.addEventListener('resize', resizeCanvas)
    return () => window.removeEventListener('resize', resizeCanvas)
  }, [])

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
    ctx.lineWidth = 3
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
    
    // Redraw dash line
    ctx.strokeStyle = '#e2e8f0'
    ctx.lineWidth = 1
    ctx.setLineDash([5, 5])
    ctx.beginPath()
    ctx.moveTo(0, 120)
    ctx.lineTo(canvas.width, 120)
    ctx.stroke()
    ctx.setLineDash([])

    setHasSig(false)
    onCapture(null)
  }

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: '8px', overflow: 'hidden', background: '#fff', position: 'relative' }}>
      <canvas ref={canvasRef} style={{ display: 'block', background: '#fff', width: '100%', height: '160px' }} />
      {hasSig ? (
        <button
          type="button"
          className="btn btn-secondary"
          onClick={limpar}
          style={{ position: 'absolute', bottom: '8px', right: '8px', height: '32px', width: 'auto', padding: '0 8px', fontSize: '11px', borderRadius: '4px' }}
        >
          Limpar
        </button>
      ) : (
        <p className="text-muted" style={{ position: 'absolute', bottom: '8px', left: '8px', fontSize: '11px', pointerEvents: 'none' }}>
          Assine aqui
        </p>
      )}
    </div>
  )
}

export default function RomaneioDetalhePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { isMaster } = useAuth()
  
  const [romaneio, setRomaneio] = useState<Romaneio | null>(null)
  const [itens, setItens] = useState<RomaneioItem[]>([])
  const [historico, setHistorico] = useState<RomaneioHistorico[]>([])
  const [showHistorico, setShowHistorico] = useState(false)
  const [loading, setLoading] = useState(true)
  
  // Local driver info form states
  const [showColetaForm, setShowColetaForm] = useState(false)
  const [savingColeta, setSavingColeta] = useState(false)
  const [formColeta, setFormColeta] = useState({
    transportadora_nome: '',
    transportadora_cnpj: '',
    motorista_nome: '',
    motorista_rg: '',
    motorista_cpf: '',
    veiculo_modelo: '',
    veiculo_placa: '',
    observacao_transportadora: ''
  })
  const [assinaturaData, setAssinaturaData] = useState<string | null>(null)

  // Document photo state
  const [uploadingFoto, setUploadingFoto] = useState(false)
  const fotoInputRef = useRef<HTMLInputElement>(null)

  // Load romaneio details
  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    try {
      const [{ data: r, error: errR }, { data: its, error: errI }, { data: hist }] = await Promise.all([
        supabase.from('romaneios').select('*').eq('id', id).single(),
        supabase.from('romaneio_itens').select('*').eq('romaneio_id', id).order('inserido_em'),
        supabase.from('romaneio_historico').select('*').eq('romaneio_id', id).order('executado_em', { ascending: false }),
      ])

      if (errR) throw errR
      if (errI) throw errI

      setRomaneio(r)
      setItens(its || [])
      setHistorico(hist || [])

      if (r) {
        setFormColeta({
          transportadora_nome: r.transportadora_nome || '',
          transportadora_cnpj: r.transportadora_cnpj || '',
          motorista_nome: r.motorista_nome || '',
          motorista_rg: r.motorista_rg || '',
          motorista_cpf: r.motorista_cpf || '',
          veiculo_modelo: r.veiculo_modelo || '',
          veiculo_placa: r.veiculo_placa || '',
          observacao_transportadora: r.observacao_transportadora || ''
        })
      }
    } catch (e) {
      console.error(e)
      toast.error('Erro ao carregar detalhes.')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  // Realtime updates
  useEffect(() => {
    if (!id) return
    const channel = supabase
      .channel(`romaneio-mobile-detalhe-${id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'romaneios', filter: `id=eq.${id}` }, ({ new: updated }) => {
        setRomaneio(updated as Romaneio)
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'romaneio_itens', filter: `romaneio_id=eq.${id}` }, () => {
        supabase.from('romaneio_itens').select('*').eq('romaneio_id', id).order('inserido_em').then(({ data }) => {
          if (data) setItens(data)
        })
      })
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [id])

  // Copy anonymous link
  const getPublicLink = () => {
    const base = import.meta.env.VITE_APP_URL || window.location.origin
    return `${base}/coleta/${romaneio?.token_publico}`
  }

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(getPublicLink())
      toast.success('Link de coleta copiado!')
    } catch (err) {
      toast.error('Erro ao copiar link.')
    }
  }

  // Handle Photo Capture (CNH/Document)
  const handlePhotoCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !id) return
    e.target.value = ''
    setUploadingFoto(true)

    try {
      // Compress image locally using canvas before upload
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image()
        image.onload = () => resolve(image)
        image.onerror = reject
        image.src = URL.createObjectURL(file)
      })

      const MAX = 1000
      const scale = Math.min(1, MAX / Math.max(img.width, img.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.width * scale)
      canvas.height = Math.round(img.height * scale)
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
      
      const base64 = canvas.toDataURL('image/jpeg', 0.70)

      const { error } = await supabase
        .from('romaneios')
        .update({ foto_documento_motorista: base64 })
        .eq('id', id)

      if (error) throw error
      setRomaneio(prev => prev ? { ...prev, foto_documento_motorista: base64 } : prev)
      toast.success('Documento salvo!')
    } catch (err) {
      console.error(err)
      toast.error('Erro ao salvar foto.')
    } finally {
      setUploadingFoto(false)
    }
  }

  const handleRemovePhoto = async () => {
    if (!id || !confirm('Remover a foto do documento?')) return
    try {
      const { error } = await supabase
        .from('romaneios')
        .update({ foto_documento_motorista: null })
        .eq('id', id)
      if (error) throw error
      setRomaneio(prev => prev ? { ...prev, foto_documento_motorista: null } : prev)
      toast.success('Foto removida.')
    } catch (err) {
      toast.error('Erro ao remover foto.')
    }
  }

  // Save Local Driver Collection Info
  const handleSaveColeta = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!id) return
    setSavingColeta(true)

    try {
      const updateData: Record<string, any> = {
        transportadora_nome: formColeta.transportadora_nome.trim() || null,
        transportadora_cnpj: formColeta.transportadora_cnpj.trim() || null,
        motorista_nome: formColeta.motorista_nome.trim() || null,
        motorista_rg: formColeta.motorista_rg.trim() || null,
        motorista_cpf: formColeta.motorista_cpf.trim() || null,
        veiculo_modelo: formColeta.veiculo_modelo.trim() || null,
        veiculo_placa: formColeta.veiculo_placa.trim() || null,
        observacao_transportadora: formColeta.observacao_transportadora.trim() || null
      }

      if (assinaturaData) {
        updateData.assinatura_motorista = assinaturaData
      }

      // If status is Pendente, promote it to Preenchido since driver info is filled
      if (romaneio?.status === 'Pendente') {
        updateData.status = 'Preenchido'
      }

      const { error } = await supabase
        .from('romaneios')
        .update(updateData)
        .eq('id', id)

      if (error) throw error

      toast.success('Dados salvos!')
      setShowColetaForm(false)
      load()
    } catch (err: any) {
      toast.error(err.message || 'Erro ao salvar coleta.')
    } finally {
      setSavingColeta(false)
    }
  }

  // Quick save only the signature from details view
  const handleQuickSaveSignature = async () => {
    if (!id || !assinaturaData) return
    setSavingColeta(true)

    try {
      const updateData: Record<string, any> = {
        assinatura_motorista: assinaturaData
      }

      if (romaneio?.status === 'Pendente') {
        updateData.status = 'Preenchido'
      }

      const { error } = await supabase
        .from('romaneios')
        .update(updateData)
        .eq('id', id)

      if (error) throw error

      toast.success('Assinatura do motorista salva!')
      setAssinaturaData(null)
      load()
    } catch (err: any) {
      toast.error(err.message || 'Erro ao salvar assinatura.')
    } finally {
      setSavingColeta(false)
    }
  }

  // Move romaneio to trash (Lixeira)
  const moverParaLixeira = async () => {
    if (!confirm('Mover este romaneio para a lixeira? Você pode restaurá-lo depois.')) return
    try {
      const { error } = await supabase
        .from('romaneios')
        .update({ excluido_em: new Date().toISOString() })
        .eq('id', id!)
      if (error) throw error
      toast.success('Romaneio movido para a lixeira')
      navigate('/')
    } catch {
      toast.error('Erro ao excluir')
    }
  }

  // Update Status (Liberar / Cancelar)
  const handleUpdateStatus = async (status: RomaneioStatus) => {
    if (!id || !romaneio) return
    
    if (status === 'Liberado' && !romaneio.assinatura_motorista) {
      toast.error('O motorista precisa assinar antes da liberação.')
      return
    }

    const confirmMsg = status === 'Liberado' 
      ? 'Confirmar a liberação do veículo?' 
      : 'Tem certeza que deseja cancelar este romaneio?'

    if (!confirm(confirmMsg)) return

    try {
      const { error } = await supabase
        .from('romaneios')
        .update({ status })
        .eq('id', id)
      
      if (error) throw error
      toast.success(`Romaneio alterado para ${status}!`)
      load()
    } catch (err) {
      toast.error('Erro ao atualizar status.')
    }
  }

  if (loading) {
    return (
      <div className="flex-center" style={{ height: '50vh' }}>
        <div style={{
          width: '28px',
          height: '28px',
          borderRadius: '50%',
          border: '2px solid var(--border)',
          borderTopColor: 'var(--primary)',
          animation: 'spin 1s linear infinite'
        }} />
      </div>
    )
  }

  if (!romaneio) {
    return (
      <div className="text-center" style={{ padding: '40px' }}>
        <h3>Romaneio não encontrado</h3>
        <button className="btn btn-secondary mt-12" onClick={() => navigate('/')}>Voltar ao Início</button>
      </div>
    )
  }

  const totalVolumes = itens.reduce((s, i) => s + i.qtd_volumes, 0)
  const itensBipados = itens.filter(i => i.bipado_em).length
  const progressPercent = itens.length > 0 ? Math.round((itensBipados / itens.length) * 100) : 0
  const canEdit = !['Liberado', 'Cancelado'].includes(romaneio.status)

  return (
    <div style={{ paddingBottom: '32px' }}>
      
      {/* Back & Title */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
        <button className="header-btn" onClick={() => navigate('/')} style={{ marginLeft: '-8px' }}>
          <ArrowLeft size={24} />
        </button>
        <div style={{ flex: 1 }}>
          <h2 className="title-large" style={{ margin: 0, fontSize: '18px' }}>
            Romaneio #{romaneio.id.slice(0, 8).toUpperCase()}
          </h2>
          <span className={`badge ${romaneio.status.toLowerCase()}`} style={{ marginTop: '4px' }}>
            {romaneio.status}
          </span>
        </div>
        {isMaster && canEdit && (
          <button
            className="header-btn text-primary"
            onClick={() => navigate(`/romaneios/${romaneio.id}/editar`)}
            title="Editar romaneio"
            style={{ width: '40px', height: '40px', color: 'var(--primary)' }}
          >
            <Pencil size={20} />
          </button>
        )}
        {isMaster && (
          <button
            className="header-btn text-danger"
            onClick={moverParaLixeira}
            title="Mover para lixeira"
            style={{ width: '40px', height: '40px' }}
          >
            <Trash2 size={20} />
          </button>
        )}
      </div>

      {/* Progress Card */}
      <div className="card no-active">
        <div className="flex-between">
          <span className="font-bold">Conferência de Carga</span>
          <span className="font-bold" style={{ color: progressPercent === 100 ? 'var(--success)' : 'var(--primary)' }}>
            {itensBipados} / {itens.length} Bipados
          </span>
        </div>
        
        {/* Progress Bar */}
        <div style={{
          height: '8px',
          background: 'var(--bg-highlight)',
          borderRadius: '4px',
          overflow: 'hidden',
          marginTop: '10px',
          marginBottom: '10px'
        }}>
          <div style={{
            height: '100%',
            background: progressPercent === 100 ? 'var(--success)' : 'var(--primary)',
            width: `${progressPercent}%`,
            transition: 'width 0.3s ease'
          }} />
        </div>

        <div className="flex-between text-muted" style={{ fontSize: '12px' }}>
          <span>Progresso: {progressPercent}%</span>
          <span>{totalVolumes} Volumes no total</span>
        </div>

        {/* Scan Camera Button */}
        {canEdit && (
          <button
            className="btn btn-primary mt-12 flex-center"
            onClick={() => navigate(`/romaneios/${romaneio.id}/bipar`)}
            style={{ background: 'var(--success)' }}
          >
            <Camera size={18} />
            <span>Conferir com Câmera</span>
          </button>
        )}
      </div>

      {/* Driver and Vehicle details card */}
      <div className="card no-active">
        <h3 className="card-title">Dados do Motorista e Veículo</h3>
        
        {romaneio.transportadora_nome ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              <Truck size={16} className="text-muted" />
              <span>{romaneio.transportadora_nome} (CNPJ: {romaneio.transportadora_cnpj || '—'})</span>
            </div>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              <User size={16} className="text-muted" />
              <span>{romaneio.motorista_nome || '—'} (CPF: {romaneio.motorista_cpf || '—'})</span>
            </div>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              <CreditCard size={16} className="text-muted" />
              <span>{romaneio.veiculo_modelo || '—'} (Placa: {romaneio.veiculo_placa || '—'})</span>
            </div>

            {/* Signature view */}
            <div style={{ marginTop: '10px', borderTop: '1px solid var(--border)', paddingTop: '10px' }}>
              <span className="text-muted" style={{ fontSize: '12px', display: 'block', marginBottom: '6px' }}>
                Assinatura do Motorista:
              </span>
              {romaneio.assinatura_motorista ? (
                <img
                  src={romaneio.assinatura_motorista}
                  alt="Assinatura"
                  style={{ width: '100%', maxHeight: '80px', objectFit: 'contain', background: '#fff', border: '1px solid var(--border)', borderRadius: '6px' }}
                />
              ) : canEdit ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <SignaturePad onCapture={setAssinaturaData} />
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={!assinaturaData || savingColeta}
                    onClick={handleQuickSaveSignature}
                    style={{ height: '36px', fontSize: '13px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  >
                    {savingColeta ? 'Salvando...' : 'Gravar Assinatura'}
                  </button>
                </div>
              ) : (
                <div className="text-danger" style={{ fontSize: '12px', display: 'flex', gap: '4px', alignItems: 'center' }}>
                  <AlertTriangle size={14} />
                  <span>Falta assinatura do motorista.</span>
                </div>
              )}
            </div>

            {/* Document Photo view */}
            <div style={{ marginTop: '10px', borderTop: '1px solid var(--border)', paddingTop: '10px' }}>
              <div className="flex-between" style={{ marginBottom: '6px' }}>
                <span className="text-muted" style={{ fontSize: '12px' }}>Foto do Documento:</span>
                {romaneio.foto_documento_motorista && (
                  <button onClick={handleRemovePhoto} style={{ border: 'none', background: 'transparent', color: 'var(--danger)' }}>
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
              {romaneio.foto_documento_motorista ? (
                <img
                  src={romaneio.foto_documento_motorista}
                  alt="Documento"
                  style={{ width: '100%', maxHeight: '180px', objectFit: 'contain', border: '1px solid var(--border)', borderRadius: '6px' }}
                />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <input
                    ref={fotoInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    style={{ display: 'none' }}
                    onChange={handlePhotoCapture}
                  />
                  <button className="btn btn-secondary flex-center" onClick={() => fotoInputRef.current?.click()} disabled={uploadingFoto}>
                    <Camera size={16} />
                    <span>{uploadingFoto ? 'Processando...' : 'Tirar Foto do Documento'}</span>
                  </button>
                </div>
              )}
            </div>
            
            {/* Edit details locally button */}
            {canEdit && (
              <button className="btn btn-secondary mt-12" onClick={() => setShowColetaForm(true)}>
                Alterar Cadastro
              </button>
            )}
          </div>
        ) : (
          /* Empty driver data info - show link share and local pre-fill options */
          <div className="text-center" style={{ padding: '16px 0' }}>
            <p className="text-muted" style={{ fontSize: '13px', marginBottom: '12px' }}>
              Dados de transporte não preenchidos.
            </p>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button className="btn btn-secondary" onClick={handleCopyLink} style={{ flex: 1 }}>
                <Share2 size={16} />
                <span>Compartilhar Link</span>
              </button>
              <button className="btn btn-primary" onClick={() => setShowColetaForm(true)} style={{ flex: 1 }}>
                <PenLine size={16} />
                <span>Preencher Aqui</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Items list */}
      <div className="card no-active">
        <h3 className="card-title">Itens do Romaneio ({itens.length})</h3>
        {itens.length === 0 ? (
          <p className="text-muted text-center" style={{ padding: '20px 0' }}>
            Nenhum item cadastrado.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {itens.map((it) => (
              <div key={it.id} style={{
                background: it.bipado_em ? 'rgba(16, 185, 129, 0.08)' : 'var(--bg-card)',
                border: `1px solid ${it.bipado_em ? 'var(--success)' : 'var(--border)'}`,
                borderRadius: '8px',
                padding: '10px 12px'
              }}>
                <div className="flex-between">
                  <span className="font-bold">NF-e #{it.numero_nfe}</span>
                  {it.bipado_em ? (
                    <span className="text-success font-bold" style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <CheckCircle size={14} /> Conferido
                    </span>
                  ) : (
                    <span className="text-muted" style={{ fontSize: '12px' }}>Pendente</span>
                  )}
                </div>
                <div className="text-muted" style={{ fontSize: '13px', marginTop: '4px' }}>
                  {it.cliente_destinatario}
                </div>
                <div className="text-muted flex-between" style={{ fontSize: '11px', marginTop: '6px' }}>
                  <span>Volumes: {it.qtd_volumes}</span>
                  {it.depositante && <span>Canal: {it.depositante}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Status changes for Masters / Colaboradores */}
      {canEdit && (
        <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
          <button
            className="btn btn-primary"
            onClick={() => handleUpdateStatus('Liberado')}
            style={{ flex: 2, background: 'var(--primary)' }}
            disabled={!romaneio.assinatura_motorista}
          >
            Liberar Veículo
          </button>
          <button
            className="btn btn-danger"
            onClick={() => handleUpdateStatus('Cancelado')}
            style={{ flex: 1 }}
          >
            Cancelar
          </button>
        </div>
      )}

      {/* Local Cadastro Modal Sheet */}
      {showColetaForm && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.5)',
          zIndex: 200,
          display: 'flex',
          alignItems: 'flex-end'
        }} onClick={() => setShowColetaForm(false)}>
          <div style={{
            background: 'var(--bg-card)',
            borderTopLeftRadius: '20px',
            borderTopRightRadius: '20px',
            width: '100%',
            maxHeight: '90vh',
            overflowY: 'auto',
            padding: '24px 16px',
            boxShadow: '0 -4px 10px rgba(0,0,0,0.1)'
          }} onClick={e => e.stopPropagation()}>
            <div className="flex-between" style={{ marginBottom: '16px' }}>
              <h3 style={{ fontSize: '18px', fontWeight: 800 }}>Cadastro de Coleta</h3>
              <button style={{ border: 'none', background: 'transparent', fontSize: '20px', color: 'var(--text-muted)' }} onClick={() => setShowColetaForm(false)}>×</button>
            </div>

            <form onSubmit={handleSaveColeta} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div className="form-group">
                <label>Nome da Transportadora</label>
                <input
                  type="text"
                  className="input"
                  value={formColeta.transportadora_nome}
                  onChange={e => setFormColeta(p => ({ ...p, transportadora_nome: e.target.value }))}
                  required
                />
              </div>

              <div className="form-group">
                <label>CNPJ da Transportadora</label>
                <input
                  type="text"
                  className="input"
                  value={formColeta.transportadora_cnpj}
                  onChange={e => setFormColeta(p => ({ ...p, transportadora_cnpj: e.target.value }))}
                />
              </div>

              <div className="form-group">
                <label>Nome do Motorista</label>
                <input
                  type="text"
                  className="input"
                  value={formColeta.motorista_nome}
                  onChange={e => setFormColeta(p => ({ ...p, motorista_nome: e.target.value }))}
                  required
                />
              </div>

              <div style={{ display: 'flex', gap: '10px' }}>
                <div className="form-group" style={{ flex: 1 }}>
                  <label>CPF</label>
                  <input
                    type="text"
                    className="input"
                    value={formColeta.motorista_cpf}
                    onChange={e => setFormColeta(p => ({ ...p, motorista_cpf: e.target.value }))}
                  />
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label>RG</label>
                  <input
                    type="text"
                    className="input"
                    value={formColeta.motorista_rg}
                    onChange={e => setFormColeta(p => ({ ...p, motorista_rg: e.target.value }))}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', gap: '10px' }}>
                <div className="form-group" style={{ flex: 1 }}>
                  <label>Modelo do Veículo</label>
                  <input
                    type="text"
                    className="input"
                    value={formColeta.veiculo_modelo}
                    onChange={e => setFormColeta(p => ({ ...p, veiculo_modelo: e.target.value }))}
                  />
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label>Placa do Veículo</label>
                  <input
                    type="text"
                    className="input"
                    value={formColeta.veiculo_placa}
                    onChange={e => setFormColeta(p => ({ ...p, veiculo_placa: e.target.value }))}
                  />
                </div>
              </div>

              <div className="form-group">
                <label>Assinatura do Motorista</label>
                <SignaturePad onCapture={setAssinaturaData} />
              </div>

              <button type="submit" className="btn btn-primary flex-center" disabled={savingColeta} style={{ marginTop: '12px' }}>
                {savingColeta ? 'Salvando...' : 'Salvar Cadastro'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Histórico de eventos */}
      {historico.length > 0 && (
        <div className="card no-active" style={{ marginTop: '16px' }}>
          <button
            onClick={() => setShowHistorico(v => !v)}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              width: '100%',
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              color: 'inherit'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Clock size={16} color="var(--text-muted)" />
              <span style={{ fontWeight: 700, fontSize: '14px' }}>Histórico de Eventos ({historico.length})</span>
            </div>
            {showHistorico ? <ChevronUp size={16} color="var(--text-muted)" /> : <ChevronDown size={16} color="var(--text-muted)" />}
          </button>

          {showHistorico && (
            <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '0' }}>
              {historico.map((h, idx) => (
                <div key={h.id} style={{ display: 'flex', gap: '12px', alignItems: 'flex-start', paddingBottom: idx < historico.length - 1 ? '12px' : 0 }}>
                  <div style={{
                    width: '8px', height: '8px', borderRadius: '50%',
                    background: 'var(--primary)', flexShrink: 0, marginTop: '5px'
                  }} />
                  <div style={{ flex: 1 }}>
                    <p style={{ margin: 0, fontSize: '13px', fontWeight: 500 }}>{h.descricao || h.evento}</p>
                    <p style={{ margin: '2px 0 0', fontSize: '11px', color: 'var(--text-muted)' }}>
                      {new Date(h.executado_em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
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

import { useEffect, useState, useRef, useCallback } from 'react'
import type { FormEvent, ChangeEvent } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { formatCNPJ, formatCPF, formatRG, validateCNPJ, validateCPF, validatePlaca } from '../lib/validators'
import type { RomaneioCompleto } from '../types'
import { Truck, CheckCircle, Clock, PenLine, Trash2 } from 'lucide-react'

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

export default function ColetaPublicaPage() {
  const { token } = useParams<{ token: string }>()
  const [romaneio, setRomaneio] = useState<RomaneioCompleto | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [expired, setExpired] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [assinatura, setAssinatura] = useState<string | null>(null)
  const submitRef = useRef(false)

  const [form, setForm] = useState({
    transportadora_nome: '',
    transportadora_cnpj: '',
    motorista_nome: '',
    motorista_rg: '',
    motorista_cpf: '',
    veiculo_modelo: '',
    veiculo_placa: '',
    observacao_transportadora: '',
  })

  useEffect(() => { load() }, [token])

  async function load() {
    const { data, error } = await supabase.rpc('get_romaneio_by_token', { p_token: token })
    if (error || !data || data.error === 'not_found') { setNotFound(true); setLoading(false); return }
    const r = data as RomaneioCompleto

    if (r.token_expira_em && new Date(r.token_expira_em) < new Date()) {
      setExpired(true)
      setLoading(false)
      return
    }

    setRomaneio(r)
    setForm({
      transportadora_nome: r.transportadora_nome || '',
      transportadora_cnpj: r.transportadora_cnpj || '',
      motorista_nome: r.motorista_nome || '',
      motorista_rg: r.motorista_rg || '',
      motorista_cpf: r.motorista_cpf || '',
      veiculo_modelo: r.veiculo_modelo || '',
      veiculo_placa: r.veiculo_placa || '',
      observacao_transportadora: r.observacao_transportadora || '',
    })
    setLoading(false)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (submitRef.current) return
    setError('')

    if (!validateCNPJ(form.transportadora_cnpj)) {
      setError('CNPJ da transportadora inválido. Verifique os dígitos.')
      return
    }
    if (!validateCPF(form.motorista_cpf)) {
      setError('CPF do motorista inválido. Verifique os dígitos.')
      return
    }
    if (form.veiculo_placa.trim() && !validatePlaca(form.veiculo_placa)) {
      setError('Placa do veículo inválida. Use o formato ABC-1234 ou ABC1D23 (Mercosul).')
      return
    }
    if (!assinatura) {
      setError('A assinatura do motorista é obrigatória para confirmar os dados.')
      const sig = document.querySelector('.signature-canvas')
      sig?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }

    submitRef.current = true
    setSaving(true)
    const { data } = await supabase.rpc('preencher_dados_coleta', {
      p_token: token,
      p_transportadora_nome: form.transportadora_nome.trim(),
      p_transportadora_cnpj: form.transportadora_cnpj,
      p_motorista_nome: form.motorista_nome.trim(),
      p_motorista_rg: form.motorista_rg.trim(),
      p_motorista_cpf: form.motorista_cpf,
      p_veiculo_modelo: form.veiculo_modelo.trim(),
      p_veiculo_placa: form.veiculo_placa.trim().toUpperCase(),
      p_observacao: form.observacao_transportadora.trim() || null,
      p_assinatura: assinatura || null,
    })
    setSaving(false)
    submitRef.current = false

    if (data?.ok) setSubmitted(true)
    else setError(data?.error || 'Erro ao enviar. Tente novamente.')
  }

  function onCNPJChange(e: ChangeEvent<HTMLInputElement>) {
    setForm(p => ({ ...p, transportadora_cnpj: formatCNPJ(e.target.value) }))
  }
  function onCPFChange(e: ChangeEvent<HTMLInputElement>) {
    setForm(p => ({ ...p, motorista_cpf: formatCPF(e.target.value) }))
  }
  function onRGChange(e: ChangeEvent<HTMLInputElement>) {
    setForm(p => ({ ...p, motorista_rg: formatRG(e.target.value) }))
  }

  function getExpiryWarning(): string | null {
    if (!romaneio?.token_expira_em) return null
    const expiry = new Date(romaneio.token_expira_em)
    const hoursLeft = (expiry.getTime() - Date.now()) / 3600000
    if (hoursLeft <= 2) {
      return `Este link expira em ${Math.max(1, Math.round(hoursLeft))}h. Após isso será necessário solicitar um novo link ao remetente.`
    }
    return null
  }

  if (loading) return <div className="loading-screen"><div className="spinner" /></div>

  if (notFound) return (
    <div className="public-screen">
      <div className="public-card center">
        <h2>Link inválido</h2>
        <p>Este romaneio não foi encontrado. Verifique o link com o remetente.</p>
      </div>
    </div>
  )

  if (expired) return (
    <div className="public-screen">
      <div className="public-card center">
        <Clock size={48} color="#f59e0b" />
        <h2>Link expirado</h2>
        <p>Este link não é mais válido. Entre em contato com o remetente para obter um novo link.</p>
      </div>
    </div>
  )

  if (romaneio?.status === 'Liberado') return (
    <div className="public-screen">
      <div className="public-card center">
        <CheckCircle size={48} color="#10b981" />
        <h2>Veículo Liberado</h2>
        <p>Este romaneio já foi liberado pelo remetente.</p>
      </div>
    </div>
  )

  if (romaneio?.status === 'Cancelado') return (
    <div className="public-screen">
      <div className="public-card center">
        <h2>Romaneio Cancelado</h2>
        <p>Este romaneio foi cancelado. Entre em contato com o remetente.</p>
      </div>
    </div>
  )

  if (submitted) return (
    <div className="public-screen">
      <div className="public-card center">
        <CheckCircle size={48} color="#10b981" />
        <h2>Dados enviados com sucesso!</h2>
        <p>Aguarde a liberação do veículo pelo remetente.</p>
        <p className="muted" style={{ marginTop: 8 }}>{romaneio?.remetente_nome}</p>
      </div>
    </div>
  )

  const expiryWarning = getExpiryWarning()

  return (
    <div className="public-screen">
      <div className="public-card">
        <div className="public-header">
          <Truck size={28} color="#2563eb" />
          <div>
            <h2>Pré-Cadastro de Coleta</h2>
            <p className="muted">{romaneio?.remetente_nome} · {romaneio?.remetente_cidade_uf}</p>
          </div>
        </div>

        <div className="carga-resumo">
          <div className="resumo-item">
            <span className="resumo-num">{romaneio?.total_nfes}</span>
            <span>NF-e's</span>
          </div>
          <div className="resumo-item">
            <span className="resumo-num">{romaneio?.total_volumes}</span>
            <span>Volumes</span>
          </div>
          {romaneio?.depositantes?.length && (
            <div className="resumo-item">
              <span className="resumo-num">{romaneio.depositantes.join(', ')}</span>
              <span>Depositantes</span>
            </div>
          )}
        </div>

        {expiryWarning && (
          <div className="warning-msg" style={{ marginBottom: 16 }}>
            <Clock size={14} style={{ flexShrink: 0 }} /> {expiryWarning}
          </div>
        )}

        <form onSubmit={handleSubmit} className="public-form">
          <div className="form-section">
            <div className="section-title">Transportadora</div>
            <div className="field-row">
              <div className="field">
                <label>Razão Social *</label>
                <input value={form.transportadora_nome} onChange={e => setForm(p => ({ ...p, transportadora_nome: e.target.value }))} required placeholder="Nome da transportadora" />
              </div>
              <div className="field">
                <label>CNPJ *</label>
                <input value={form.transportadora_cnpj} onChange={onCNPJChange} required placeholder="00.000.000/0001-00" inputMode="numeric" />
              </div>
            </div>
          </div>

          <div className="form-section">
            <div className="section-title">Motorista</div>
            <div className="field">
              <label>Nome Completo *</label>
              <input value={form.motorista_nome} onChange={e => setForm(p => ({ ...p, motorista_nome: e.target.value }))} required placeholder="Nome do motorista" />
            </div>
            <div className="field-row" style={{ marginTop: 10 }}>
              <div className="field">
                <label>CPF *</label>
                <input value={form.motorista_cpf} onChange={onCPFChange} required placeholder="000.000.000-00" inputMode="numeric" />
              </div>
              <div className="field">
                <label>RG</label>
                <input value={form.motorista_rg} onChange={onRGChange} placeholder="00.000.000-0" inputMode="numeric" />
              </div>
            </div>
          </div>

          <div className="form-section">
            <div className="section-title">Veículo</div>
            <div className="field-row">
              <div className="field">
                <label>Modelo *</label>
                <input value={form.veiculo_modelo} onChange={e => setForm(p => ({ ...p, veiculo_modelo: e.target.value }))} required placeholder="Ex: Volvo FH 460" />
              </div>
              <div className="field">
                <label>Placa *</label>
                <input value={form.veiculo_placa} onChange={e => setForm(p => ({ ...p, veiculo_placa: e.target.value }))} required placeholder="AAA-0000" style={{ textTransform: 'uppercase' }} />
              </div>
            </div>
          </div>

          <div className="form-section">
            <div className="section-title">Observações</div>
            <div className="field">
              <label>Avarias, divergências ou observações</label>
              <textarea
                value={form.observacao_transportadora}
                onChange={e => setForm(p => ({ ...p, observacao_transportadora: e.target.value }))}
                placeholder="Descreva qualquer avaria, divergência de volume ou observação sobre a carga..."
                rows={3}
                style={{ resize: 'vertical' }}
              />
            </div>
          </div>

          <div className="form-section">
            <div className="section-title" style={{ marginBottom: 8 }}>
              Assinatura do Motorista <span style={{ color: '#ef4444' }}>*</span>
            </div>
            <p style={{ fontSize: 12, color: '#64748b', marginBottom: 8 }}>
              Obrigatória para confirmar o recebimento da carga. Use o dedo ou mouse para assinar.
            </p>
            <SignaturePad onCapture={setAssinatura} />
          </div>

          {error && <div className="error-msg">{error}</div>}

          <button type="submit" className="btn-primary full-width" disabled={saving}>
            {saving ? 'Enviando...' : 'Confirmar Dados e Aguardar Liberação'}
          </button>
        </form>
      </div>
    </div>
  )
}

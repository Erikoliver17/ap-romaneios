import { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { CheckCircle2, Circle, ArrowLeft, ScanLine, Camera, CameraOff } from 'lucide-react'
import type { Romaneio, RomaneioItem } from '../types'
import toast from 'react-hot-toast'
import { normalizarNfe, mesmaNfe, ehChaveCompleta } from '../lib/nfe'

export default function BipadorPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [romaneio, setRomaneio] = useState<Romaneio | null>(null)
  const [itens, setItens] = useState<RomaneioItem[]>([])
  const [loading, setLoading] = useState(true)
  const [codigoInput, setCodigoInput] = useState('')
  const [scanningCamera, setScanningCamera] = useState(false)
  const [cameraSupported, setCameraSupported] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const animFrameRef = useRef<number>(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setCameraSupported('BarcodeDetector' in window)
    load()
    return () => stopCamera()
  }, [id])

  async function load() {
    const [{ data: rom }, { data: items }] = await Promise.all([
      supabase.from('romaneios').select('*').eq('id', id).single(),
      supabase.from('romaneio_itens').select('*').eq('romaneio_id', id).order('inserido_em'),
    ])
    if (rom) setRomaneio(rom)
    if (items) setItens(items)
    setLoading(false)
  }

  async function biparItem(item: RomaneioItem, codigo?: string) {
    const { data } = await supabase.rpc('bipar_item_romaneio', {
      p_romaneio_id: id,
      p_item_id: item.id,
      p_codigo: codigo ?? item.numero_nfe,
    })
    if (data && !data.error) {
      const bipado = data.bipado as boolean
      setItens(prev => prev.map(i =>
        i.id === item.id
          ? { ...i, bipado_em: bipado ? new Date().toISOString() : null, bipado_codigo: bipado ? (codigo ?? item.numero_nfe) : null }
          : i
      ))
      if (bipado) toast.success(`NF-e ${item.numero_nfe} confirmada`)
      else toast('NF-e desmarcada', { icon: '↩' })
    } else {
      toast.error(data?.error ?? 'Erro ao bipar item')
    }
  }

  function encontrarItem(valor: string): RomaneioItem | undefined {
    // Compara normalizando ambos os lados (tolera chave completa, zeros à esquerda e formatação)
    return itens.find(i => mesmaNfe(i.numero_nfe, valor))
  }

  async function handleCodigoSubmitValor(valor: string) {
    if (!valor.trim()) return
    const nfeExtraida = normalizarNfe(valor.trim())
    const item = encontrarItem(valor.trim())
    if (item) {
      await biparItem(item, nfeExtraida)
    } else {
      toast.error(`NF-e não encontrada: ${nfeExtraida}`)
    }
    setCodigoInput('')
    inputRef.current?.focus()
  }

  async function handleCodigoSubmit() {
    await handleCodigoSubmitValor(codigoInput)
  }

  async function startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
      setScanningCamera(true)
      scanFrame()
    } catch {
      toast.error('Não foi possível acessar a câmera')
    }
  }

  function stopCamera() {
    cancelAnimationFrame(animFrameRef.current)
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    setScanningCamera(false)
  }

  async function scanFrame() {
    if (!videoRef.current || !('BarcodeDetector' in window)) return
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const detector = new (window as any).BarcodeDetector({
        formats: ['code_128', 'ean_13', 'ean_8', 'code_39', 'qr_code'],
      })
      const barcodes = await detector.detect(videoRef.current)
      if (barcodes.length > 0) {
        const rawValue: string = barcodes[0].rawValue
        const item = itens.find(i => !i.bipado_em && mesmaNfe(i.numero_nfe, rawValue))
        if (item) {
          stopCamera()
          await biparItem(item, normalizarNfe(rawValue))
          return
        }
      }
    } catch { /* BarcodeDetector pode falhar em alguns frames */ }
    animFrameRef.current = requestAnimationFrame(scanFrame)
  }

  const bipados = itens.filter(i => i.bipado_em).length
  const total = itens.length
  const progresso = total > 0 ? Math.round((bipados / total) * 100) : 0

  if (loading) return (
    <div className="loading-screen"><div className="spinner" /></div>
  )

  if (!romaneio) return (
    <div className="page"><p>Romaneio não encontrado.</p></div>
  )

  return (
    <div className="page">
        <div className="page-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button className="btn-ghost" onClick={() => navigate(`/romaneios/${id}`)}>
              <ArrowLeft size={18} />
            </button>
            <div>
              <h1>Bipagem de Saída</h1>
              <p className="subtitle">Romaneio #{romaneio.id.slice(-6).toUpperCase()}</p>
            </div>
          </div>
        </div>

        {/* Progresso */}
        <div className="form-card" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontWeight: 600, fontSize: 15 }}>{bipados} / {total} NF-e's confirmadas</span>
            <span style={{ color: bipados === total && total > 0 ? '#10b981' : '#2563eb', fontWeight: 700, fontSize: 18 }}>
              {progresso}%
            </span>
          </div>
          <div className="progress-bar-bg">
            <div className="progress-bar-fill" style={{ width: `${progresso}%` }} />
          </div>
          {bipados === total && total > 0 && (
            <div className="success-msg" style={{ marginTop: 12 }}>
              <CheckCircle2 size={16} /> Todos os itens confirmados!
            </div>
          )}
        </div>

        {/* Entrada manual / scanner */}
        <div className="form-card" style={{ marginBottom: 16 }}>
          <div className="section-title"><ScanLine size={16} /> Bipar por código</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              ref={inputRef}
              value={codigoInput}
              onChange={e => {
                const val = e.target.value
                setCodigoInput(val)
                // Chave completa (44 díg) confirma sozinha, sem precisar de Enter
                if (ehChaveCompleta(val)) setTimeout(() => { handleCodigoSubmitValor(val) }, 0)
              }}
              onKeyDown={e => {
                if (e.key !== 'Enter' || !codigoInput.trim()) return
                // Evita confirmação dupla quando a chave completa já disparou pelo onChange
                if (!ehChaveCompleta(codigoInput)) handleCodigoSubmit()
              }}
              placeholder="Digite ou escaneie o código de barras da NF-e"
              style={{ flex: 1 }}
              autoComplete="off"
              autoFocus
            />
            <button className="btn-primary" onClick={handleCodigoSubmit}>Confirmar</button>
            {cameraSupported && (
              <button
                className={`btn-secondary ${scanningCamera ? 'active' : ''}`}
                onClick={scanningCamera ? stopCamera : startCamera}
                title={scanningCamera ? 'Parar câmera' : 'Usar câmera'}
              >
                {scanningCamera ? <CameraOff size={16} /> : <Camera size={16} />}
              </button>
            )}
          </div>
          {/* Preview da chave de acesso */}
          {(() => {
            const digits = codigoInput.replace(/\D/g, '')
            if (digits.length === 44) return (
              <div style={{ marginTop: 8, padding: '8px 12px', background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 8, fontFamily: 'monospace', fontSize: 11, lineHeight: 1.6 }}>
                <div style={{ color: '#6b7280', fontSize: 10, marginBottom: 2 }}>Chave detectada — NF-e extraída das posições 30-34:</div>
                <div style={{ wordBreak: 'break-all', letterSpacing: '0.03em' }}>
                  <span style={{ color: '#9ca3af' }}>{digits.substring(0, 29)}</span>
                  <span style={{ background: '#16a34a', color: '#fff', padding: '1px 4px', borderRadius: 4, margin: '0 2px', fontWeight: 700, fontSize: 13 }}>
                    {digits.substring(29, 34)}
                  </span>
                  <span style={{ color: '#9ca3af' }}>{digits.substring(34)}</span>
                </div>
                <div style={{ marginTop: 4, color: '#16a34a', fontWeight: 600, fontSize: 12 }}>
                  → NF-e: {String(parseInt(digits.substring(29, 34), 10))} · Confirmando...
                </div>
              </div>
            )
            if (digits.length > 0 && digits.length < 44) return (
              <div style={{ marginTop: 6, fontSize: 12, color: '#6b7280' }}>
                NF-e: <strong>{digits}</strong> · {44 - digits.length} dígitos restantes para chave completa
              </div>
            )
            return null
          })()}

          {scanningCamera && (
            <div className="camera-wrapper">
              <video ref={videoRef} className="camera-video" playsInline muted />
              <div className="camera-overlay">
                <div className="camera-frame" />
                <p className="camera-hint">Aponte para o código de barras da NF-e</p>
              </div>
            </div>
          )}
        </div>

        {/* Lista de itens */}
        <div className="form-card">
          <div className="section-title">Notas Fiscais</div>
          {itens.map(item => (
            <div
              key={item.id}
              className={`bipar-item ${item.bipado_em ? 'bipado' : ''}`}
              onClick={() => biparItem(item)}
            >
              <div className="bipar-check">
                {item.bipado_em
                  ? <CheckCircle2 size={22} color="#10b981" />
                  : <Circle size={22} color="#94a3b8" />
                }
              </div>
              <div className="bipar-info">
                <div className="bipar-nfe">{item.numero_nfe}</div>
                <div className="bipar-dest">{item.cliente_destinatario}</div>
                <div className="bipar-meta">{item.qtd_volumes} vol · {item.depositante}</div>
              </div>
              {item.bipado_em && (
                <div className="bipar-hora">
                  {new Date(item.bipado_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
  )
}

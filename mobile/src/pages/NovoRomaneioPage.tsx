import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { parseNfeXml, normalizarNfe, mesmaNfe } from '../lib/nfe'
import { audioService } from '../lib/audio'
import { useAuth } from '../context/AuthContext'
import { ArrowLeft, Plus, Trash2, FileText, Camera, Search, Loader2 } from 'lucide-react'
import { Html5Qrcode } from 'html5-qrcode'
import type { TransportadoraCadastrada, MotoristaCadastrado, VeiculoCadastrado } from '../types'

interface ItemForm {
  numero_nfe: string
  cliente_destinatario: string
  empresa: string
  depositante: string
  qtd_volumes: number
}

export default function NovoRomaneioPage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  
  // Database pre-registered data states
  const [transportadoras, setTransportadoras] = useState<TransportadoraCadastrada[]>([])
  const [motoristas, setMotoristas] = useState<MotoristaCadastrado[]>([])
  const [veiculos, setVeiculos] = useState<VeiculoCadastrado[]>([])
  
  const [selectedTranspId, setSelectedTranspId] = useState('')
  const [selectedMotoristaId, setSelectedMotoristaId] = useState('')
  const [selectedVeiculoId, setSelectedVeiculoId] = useState('')
  const [emailNotificacao, setEmailNotificacao] = useState('')
  
  const [itens, setItens] = useState<ItemForm[]>([])
  const [saving, setSaving] = useState(false)

  // Manual item input states
  const [manualNfe, setManualNfe] = useState('')
  const [manualDest, setManualDest] = useState('')
  const [manualEmp, setManualEmp] = useState('')
  const [manualDep, setManualDep] = useState('')
  const [manualVol, setManualVol] = useState(1)

  // Scanner states
  const [scannerInput, setScannerInput] = useState('')
  const [cameraActive, setCameraActive] = useState(false)
  const [consultandoWms, setConsultandoWms] = useState(false)
  
  const lastProcessedRef = useRef('')
  const html5QrcodeRef = useRef<Html5Qrcode | null>(null)

  // Load registered data
  useEffect(() => {
    const loadPreCadastro = async () => {
      const [transpRes, motorRes, veicRes] = await Promise.all([
        supabase.from('transportadoras_cadastradas').select('*').eq('ativo', true).order('nome'),
        supabase.from('motoristas_cadastrados').select('*').eq('ativo', true).order('nome'),
        supabase.from('veiculos_cadastrados').select('*').eq('ativo', true).order('modelo')
      ])

      if (transpRes.data) setTransportadoras(transpRes.data)
      if (motorRes.data) setMotoristas(motorRes.data)
      if (veicRes.data) setVeiculos(veicRes.data)
    }

    loadPreCadastro()
  }, [])

  // Filter motoristas and veiculos based on selected transportadora
  const motoristasFiltered = motoristas.filter(m => m.transportadora_id === selectedTranspId)
  const veiculosFiltered = veiculos.filter(v => v.transportadora_id === selectedTranspId)
  
  const selectedTransp = transportadoras.find(t => t.id === selectedTranspId)
  const selectedMotorista = motoristas.find(m => m.id === selectedMotoristaId)
  const selectedVeiculo = veiculos.find(v => v.id === selectedVeiculoId)

  // Start/Stop camera scanner
  useEffect(() => {
    if (!cameraActive) {
      if (html5QrcodeRef.current) {
        if (html5QrcodeRef.current.isScanning) {
          html5QrcodeRef.current.stop().catch(console.error)
        }
        html5QrcodeRef.current = null
      }
      return
    }

    const html5Qrcode = new Html5Qrcode('novo-romaneio-scanner')
    html5QrcodeRef.current = html5Qrcode

    html5Qrcode.start(
      { facingMode: 'environment' },
      {
        fps: 10,
        qrbox: (width) => ({ width: Math.min(width * 0.85, 300), height: 110 }),
        aspectRatio: 1.777778
      },
      (decodedText) => {
        handleBarcodeProcessed(decodedText, true)
      },
      () => {}
    ).catch((err) => {
      console.error('Erro ao iniciar câmera:', err)
      toast.error('Não foi possível acessar a câmera.')
      setCameraActive(false)
    })

    return () => {
      if (html5Qrcode.isScanning) {
        html5Qrcode.stop().catch(console.error)
      }
    }
  }, [cameraActive])

  // Shared function to process scanned or input barcodes
  const handleBarcodeProcessed = async (barcode: string, fromCamera = false) => {
    const value = barcode.trim()
    if (!value) return

    // Debounce to prevent double trigger
    if (lastProcessedRef.current === value) return
    lastProcessedRef.current = value
    setTimeout(() => {
      if (lastProcessedRef.current === value) lastProcessedRef.current = ''
    }, 1500)

    const nfeNum = normalizarNfe(value)
    if (!nfeNum) return

    // Check duplicate
    const jaExiste = itens.some(exist => mesmaNfe(exist.numero_nfe, nfeNum))
    if (jaExiste) {
      audioService.playError()
      toast.error(`NF-e ${nfeNum} já está na lista!`)
      return
    }

    toast.loading(`Consultando NF-e ${nfeNum}...`, { id: 'wms-fetch' })
    try {
      const { data, error } = await supabase.functions.invoke('buscar-nfe', {
        body: { nfe: nfeNum }
      })

      if (error || data?.error) {
        audioService.playError()
        toast.dismiss('wms-fetch')
        toast(`NF-e ${nfeNum} não encontrada no WMS. Digite os dados manualmente.`, { icon: '⚠️' })
        
        // Auto fill manual form fields
        setManualNfe(nfeNum)
        setManualDest('')
        setManualEmp('')
        setManualDep('')
        setManualVol(1)
        
        // Close camera scanner so they can type
        if (fromCamera) setCameraActive(false)

        // Scroll to manual form anchor
        document.getElementById('manual-form-anchor')?.scrollIntoView({ behavior: 'smooth' })
      } else {
        audioService.playSuccess()
        toast.dismiss('wms-fetch')
        const newItem: ItemForm = {
          numero_nfe: data.nfe || nfeNum,
          cliente_destinatario: data.destinatario || '',
          empresa: data.empresa || '',
          depositante: data.depositante || '',
          qtd_volumes: data.volumes ?? 1
        }
        setItens(prev => [...prev, newItem])
        toast.success(`NF-e ${nfeNum} adicionada!`)
      }
    } catch {
      audioService.playError()
      toast.dismiss('wms-fetch')
      toast.error('Erro ao consultar WMS.')
    }
  }

  // WMS fetch trigger specifically for the manual input field
  const handleQueryManualNfe = async () => {
    const value = manualNfe.trim()
    if (!value) return

    const nfeNum = normalizarNfe(value)
    if (!nfeNum) {
      toast.error('Número de NF-e inválido.')
      return
    }

    setConsultandoWms(true)
    try {
      const { data, error } = await supabase.functions.invoke('buscar-nfe', {
        body: { nfe: nfeNum }
      })

      if (error || data?.error) {
        audioService.playError()
        toast(`NF-e ${nfeNum} não encontrada no WMS. Insira manualmente.`, { icon: '⚠️' })
        setManualNfe(nfeNum)
      } else {
        audioService.playSuccess()
        setManualNfe(data.nfe || nfeNum)
        setManualDest(data.destinatario || '')
        setManualEmp(data.empresa || '')
        setManualDep(data.depositante || '')
        setManualVol(data.volumes ?? 1)
        toast.success(`Dados carregados do WMS!`)
      }
    } catch {
      audioService.playError()
      toast.error('Erro ao consultar WMS.')
    } finally {
      setConsultandoWms(false)
    }
  }

  // Handle XML files upload
  async function handleXmlUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    if (!files || files.length === 0) return

    const novosItens: ItemForm[] = []
    let erros = 0

    for (let i = 0; i < files.length; i++) {
      try {
        const text = await files[i].text()
        const parsed = parseNfeXml(text)
        if (parsed) {
          novosItens.push({
            numero_nfe: parsed.numero_nfe,
            cliente_destinatario: parsed.cliente_destinatario,
            empresa: parsed.empresa,
            depositante: parsed.depositante,
            qtd_volumes: parsed.qtd_volumes
          })
        } else {
          erros++
        }
      } catch (err) {
        console.error(err)
        erros++
      }
    }

    e.target.value = ''

    if (novosItens.length === 0) {
      audioService.playError()
      toast.error('Nenhum XML válido pôde ser importado.')
      return
    }

    // Filter duplicates
    const itensFiltrados = novosItens.filter(nov => {
      const jaExiste = itens.some(exist => mesmaNfe(exist.numero_nfe, nov.numero_nfe))
      return !jaExiste
    })

    const duplicadosCount = novosItens.length - itensFiltrados.length

    if (itensFiltrados.length > 0) {
      setItens(prev => [...prev, ...itensFiltrados])
      audioService.playSuccess()
      toast.success(`${itensFiltrados.length} NF-e(s) importada(s) com sucesso!`)
    }

    if (duplicadosCount > 0) {
      toast(`${duplicadosCount} NF-e(s) ignorada(s) por já estarem na lista.`, { icon: '⚠️' })
    }

    if (erros > 0) {
      toast.error(`Falha ao ler ${erros} arquivo(s) XML.`)
    }
  }

  // Add manual item
  function addManualItem(e: React.FormEvent) {
    e.preventDefault()
    if (!manualNfe.trim()) {
      toast.error('Preencha o número da NF-e.')
      return
    }
    if (!manualDest.trim()) {
      toast.error('Preencha o destinatário.')
      return
    }

    const normalizedNum = normalizarNfe(manualNfe)
    const jaExiste = itens.some(exist => mesmaNfe(exist.numero_nfe, normalizedNum))

    if (jaExiste) {
      audioService.playError()
      toast.error('Esta NF-e já está na lista!')
      return
    }

    const newItem: ItemForm = {
      numero_nfe: normalizedNum,
      cliente_destinatario: manualDest.trim(),
      empresa: manualEmp.trim(),
      depositante: manualDep.trim(),
      qtd_volumes: Number(manualVol) || 1
    }

    setItens(prev => [...prev, newItem])
    audioService.playSuccess()
    toast.success('Nota adicionada!')

    // Clear manual inputs
    setManualNfe('')
    setManualDest('')
    setManualEmp('')
    setManualDep('')
    setManualVol(1)
  }

  // Remove item from list
  function removeItem(idx: number) {
    setItens(prev => prev.filter((_, i) => i !== idx))
  }

  // Submit and create romaneio
  async function handleSubmit() {
    if (saving) return
    if (itens.length === 0) {
      toast.error('Adicione ao menos uma NF-e para criar o romaneio.')
      return
    }

    setSaving(true)

    try {
      const insertData: Record<string, unknown> = { criado_por: user!.id }
      if (emailNotificacao.trim()) insertData.email_notificacao = emailNotificacao.trim()
      
      if (selectedTransp) {
        insertData.transportadora_nome = selectedTransp.nome
        insertData.transportadora_cnpj = selectedTransp.cnpj
      }
      if (selectedMotorista) {
        insertData.motorista_nome = selectedMotorista.nome
        insertData.motorista_cpf = selectedMotorista.cpf ?? null
        insertData.motorista_rg = selectedMotorista.rg ?? null
      }
      if (selectedVeiculo) {
        insertData.veiculo_modelo = selectedVeiculo.modelo
        insertData.veiculo_placa = selectedVeiculo.placa
      }

      // 1. Insert romaneio
      const { data: romaneio, error: errR } = await supabase
        .from('romaneios')
        .insert(insertData)
        .select('id')
        .single()

      if (errR || !romaneio) throw errR || new Error('Falha ao criar romaneio.')

      // 2. Insert items
      const { error: errI } = await supabase.from('romaneio_itens').insert(
        itens.map(it => ({
          romaneio_id: romaneio.id,
          numero_nfe: normalizarNfe(it.numero_nfe),
          cliente_destinatario: it.cliente_destinatario.trim(),
          empresa: it.empresa.trim() || null,
          depositante: it.depositante.trim() || null,
          qtd_volumes: Number(it.qtd_volumes)
        }))
      )

      if (errI) throw errI

      toast.success('Romaneio criado com sucesso!')
      navigate(`/romaneios/${romaneio.id}`)
    } catch (err: any) {
      console.error(err)
      toast.error(err.message || 'Erro ao criar o romaneio.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ paddingBottom: '32px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
        <button className="header-btn" onClick={() => navigate('/')} style={{ marginLeft: '-8px' }}>
          <ArrowLeft size={24} />
        </button>
        <h2 className="title-large" style={{ margin: 0 }}>Novo Romaneio</h2>
      </div>

      {/* Main configuration fields */}
      <div className="card no-active">
        <h3 className="card-title">Configurações Básicas</h3>
        
        <div className="form-group">
          <label htmlFor="transp">Transportadora (Opcional)</label>
          <select
            id="transp"
            className="input"
            value={selectedTranspId}
            onChange={e => {
              setSelectedTranspId(e.target.value)
              setSelectedMotoristaId('')
              setSelectedVeiculoId('')
            }}
          >
            <option value="">— Selecione a Transportadora —</option>
            {transportadoras.map(t => (
              <option key={t.id} value={t.id}>{t.nome}</option>
            ))}
          </select>
        </div>

        {selectedTranspId && (
          <>
            <div className="form-group">
              <label htmlFor="motorista">Motorista (Opcional)</label>
              <select
                id="motorista"
                className="input"
                value={selectedMotoristaId}
                onChange={e => setSelectedMotoristaId(e.target.value)}
              >
                <option value="">— Selecione o Motorista —</option>
                {motoristasFiltered.map(m => (
                  <option key={m.id} value={m.id}>{m.nome}</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="veiculo">Veículo (Opcional)</label>
              <select
                id="veiculo"
                className="input"
                value={selectedVeiculoId}
                onChange={e => setSelectedVeiculoId(e.target.value)}
              >
                <option value="">— Selecione o Veículo —</option>
                {veiculosFiltered.map(v => (
                  <option key={v.id} value={v.id}>{v.modelo} · {v.placa}</option>
                ))}
              </select>
            </div>
          </>
        )}

        <div className="form-group">
          <label htmlFor="email">E-mail para Notificação (Opcional)</label>
          <input
            id="email"
            type="email"
            className="input"
            value={emailNotificacao}
            onChange={e => setEmailNotificacao(e.target.value)}
            placeholder="notificacoes@empresa.com"
          />
        </div>
      </div>

      {/* Leitor de Código / Bipagem */}
      <div className="card no-active">
        <h3 className="card-title">Bipagem de Etiquetas</h3>
        <p className="text-muted" style={{ fontSize: '12px', marginBottom: '12px' }}>
          Bipe com um leitor externo ou use a câmera do aparelho para consultar e adicionar automaticamente.
        </p>
        
        <div style={{ display: 'flex', gap: '8px' }}>
          <input
            type="text"
            className="input"
            placeholder="Cole a chave de 44 dígitos ou bipe aqui..."
            value={scannerInput}
            onChange={e => {
              const val = e.target.value
              setScannerInput(val)
              const clean = val.trim().replace(/\D/g, '')
              if (clean.length === 44) {
                handleBarcodeProcessed(val)
                setScannerInput('')
              }
            }}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault()
                if (scannerInput.trim()) {
                  handleBarcodeProcessed(scannerInput)
                  setScannerInput('')
                }
              }
            }}
          />
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setCameraActive(!cameraActive)}
            style={{ width: 'auto', padding: '0 12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <Camera size={18} />
          </button>
        </div>

        {cameraActive && (
          <div style={{ marginTop: '12px', position: 'relative' }}>
            <div id="novo-romaneio-scanner" style={{ width: '100%', minHeight: '200px', background: '#000', borderRadius: '8px', overflow: 'hidden' }} />
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => setCameraActive(false)}
              style={{ marginTop: '8px', height: '36px', fontSize: '13px' }}
            >
              Fechar Câmera
            </button>
          </div>
        )}
      </div>

      {/* Import XML Block */}
      <div className="card no-active">
        <h3 className="card-title">Importar Arquivos XML</h3>
        <p className="text-muted" style={{ fontSize: '12px', marginBottom: '12px' }}>
          Você pode selecionar múltiplos arquivos XML de NF-e salvos no seu aparelho.
        </p>
        <label className="btn btn-secondary flex-center" style={{ cursor: 'pointer' }}>
          <FileText size={18} />
          <span>Selecionar XMLs</span>
          <input
            type="file"
            accept=".xml"
            multiple
            onChange={handleXmlUpload}
            style={{ display: 'none' }}
          />
        </label>
      </div>

      {/* Manual Item Form */}
      <div id="manual-form-anchor" className="card no-active">
        <h3 className="card-title">Adicionar NF-e Manual</h3>
        <form onSubmit={addManualItem} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div className="form-group">
            <label>Número NF-e ou Chave 44 dígitos</label>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                type="text"
                className="input"
                value={manualNfe}
                onChange={e => {
                  const val = e.target.value
                  setManualNfe(val)
                  const clean = val.trim().replace(/\D/g, '')
                  if (clean.length === 44) {
                    handleBarcodeProcessed(val)
                  }
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleQueryManualNfe()
                  }
                }}
                placeholder="Ex: 65915 ou Chave Completa"
              />
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleQueryManualNfe}
                disabled={consultandoWms}
                style={{ width: 'auto', padding: '0 12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                {consultandoWms ? <Loader2 size={16} className="spin" /> : <Search size={16} />}
              </button>
            </div>
          </div>
          <div className="form-group">
            <label>Destinatário (Cliente)</label>
            <input
              type="text"
              className="input"
              value={manualDest}
              onChange={e => setManualDest(e.target.value)}
              placeholder="Razão Social ou Nome"
            />
          </div>
          <div className="form-group">
            <label>Empresa Emitente (Opcional)</label>
            <input
              type="text"
              className="input"
              value={manualEmp}
              onChange={e => setManualEmp(e.target.value)}
              placeholder="Ex: SmartGo"
            />
          </div>
          <div className="form-group">
            <label>Depositante (Opcional)</label>
            <select
              className="input"
              value={manualDep}
              onChange={e => setManualDep(e.target.value)}
            >
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
          </div>
          <div className="form-group">
            <label>Volumes</label>
            <input
              type="number"
              className="input"
              value={manualVol}
              onChange={e => setManualVol(Number(e.target.value) || 1)}
              min="1"
            />
          </div>
          <button type="submit" className="btn btn-secondary flex-center">
            <Plus size={16} />
            <span>Adicionar à Lista</span>
          </button>
        </form>
      </div>

      {/* Added Items List */}
      <div className="card no-active">
        <h3 className="card-title">Notas no Romaneio ({itens.length})</h3>
        {itens.length === 0 ? (
          <p className="text-muted text-center" style={{ padding: '20px 0' }}>
            Nenhuma NF-e adicionada.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {itens.map((it, idx) => (
              <div key={idx} className="flex-between" style={{
                background: 'var(--bg-highlight)',
                padding: '10px 12px',
                borderRadius: '8px',
                border: '1px solid var(--border)'
              }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', maxWidth: '80%' }}>
                  <span className="font-bold">NF-e #{it.numero_nfe}</span>
                  <span className="text-muted" style={{ fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {it.cliente_destinatario}
                  </span>
                  <span className="text-muted" style={{ fontSize: '11px' }}>
                    {it.qtd_volumes} volume(s) {it.depositante && `• ${it.depositante}`} {it.empresa && `• Emitente: ${it.empresa}`}
                  </span>
                </div>
                <button
                  onClick={() => removeItem(idx)}
                  className="header-btn text-danger"
                  style={{ width: '36px', height: '36px' }}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Save action button */}
      <button
        className="btn btn-primary mt-12"
        onClick={handleSubmit}
        disabled={saving || itens.length === 0}
        style={{ marginBottom: '24px' }}
      >
        {saving ? 'Salvando...' : 'Criar Romaneio'}
      </button>

      <style>{`
        .spin {
          animation: spin 1s linear infinite;
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}

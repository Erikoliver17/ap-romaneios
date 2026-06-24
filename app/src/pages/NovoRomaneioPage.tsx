import { useState, useRef, useEffect, useCallback } from 'react'
import type { FormEvent, ChangeEvent, KeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { PlusCircle, Trash2, ArrowLeft, Upload, ChevronDown, Barcode, Loader2 } from 'lucide-react'
import type { TransportadoraCadastrada, MotoristaCadastrado, VeiculoCadastrado } from '../types'
import { normalizarNfe, mesmaNfe, ehChaveCompleta, analisarChave } from '../lib/nfe'

interface ItemForm {
  numero_nfe: string
  cliente_destinatario: string
  empresa: string
  depositante: string
  qtd_volumes: number
}

const emptyItem = (): ItemForm => ({
  numero_nfe: '',
  cliente_destinatario: '',
  empresa: '',
  depositante: '',
  qtd_volumes: 1,
})

export default function NovoRomaneioPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [itens, setItens] = useState<ItemForm[]>([emptyItem()])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [emailNotificacao, setEmailNotificacao] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const barcodeRef = useRef<HTMLInputElement>(null)
  const [barcodeValue, setBarcodeValue] = useState('')
  const [scanning, setScanning] = useState(false)

  // Transportadoras pré-cadastradas
  const [transp, setTransp] = useState<TransportadoraCadastrada[]>([])
  const [motors, setMotors] = useState<MotoristaCadastrado[]>([])
  const [veics, setVeics] = useState<VeiculoCadastrado[]>([])
  const [selectedTranspId, setSelectedTranspId] = useState('')
  const [selectedMotoristaId, setSelectedMotoristaId] = useState('')
  const [selectedVeiculoId, setSelectedVeiculoId] = useState('')
  const [showPreCadastro, setShowPreCadastro] = useState(false)

  useEffect(() => { loadTransp() }, [])

  async function loadTransp() {
    const [{ data: t, error }, { data: m }, { data: v }] = await Promise.all([
      supabase.from('transportadoras_cadastradas').select('*').eq('ativo', true).order('nome'),
      supabase.from('motoristas_cadastrados').select('*').eq('ativo', true).order('nome'),
      supabase.from('veiculos_cadastrados').select('*').eq('ativo', true).order('modelo'),
    ])
    if (error?.code === '42P01') return
    setTransp(t ?? [])
    setMotors(m ?? [])
    setVeics(v ?? [])
  }

  const motoristasFiltered = motors.filter(m => m.transportadora_id === selectedTranspId)
  const veiculosFiltered = veics.filter(v => v.transportadora_id === selectedTranspId)
  const selectedTransp = transp.find(t => t.id === selectedTranspId)
  const selectedMotorista = motors.find(m => m.id === selectedMotoristaId)
  const selectedVeiculo = veics.find(v => v.id === selectedVeiculoId)

  // ── Bipagem ──────────────────────────────────────────────────────────────────
  async function processarBipagem(nfe: string) {
    const nfeNum = normalizarNfe(nfe)
    if (!nfeNum) return
    setBarcodeValue('')

    // Checar duplicata (normalizando ambos os lados)
    if (itens.some(it => mesmaNfe(it.numero_nfe, nfeNum))) {
      toast.error(`NF-e ${nfeNum} já está na lista`)
      return
    }

    setScanning(true)
    try {
      const { data, error } = await supabase.functions.invoke('buscar-nfe', {
        body: { nfe: nfeNum }
      })
      if (error || data?.error) {
        // NF-e não encontrada no WMS — adiciona em branco para preenchimento manual
        toast(`NF-e ${nfeNum} não encontrada no WMS. Preencha manualmente.`, { icon: '⚠️' })
        setItens(prev => {
          const lista = prev.filter(it => it.numero_nfe !== '')
          return [...lista, { ...emptyItem(), numero_nfe: nfeNum }]
        })
      } else {
        setItens(prev => {
          const lista = prev.filter(it => it.numero_nfe !== '')
          return [...lista, {
            numero_nfe: data.nfe,
            cliente_destinatario: data.destinatario || '',
            empresa: data.empresa || '',
            depositante: data.depositante || '',
            qtd_volumes: data.volumes ?? 1,
          }]
        })
        toast.success(`NF-e ${nfeNum} adicionada — ${data.empresa || 'empresa não identificada'}`)
      }
    } catch {
      toast.error('Erro ao consultar WMS')
    } finally {
      setScanning(false)
      setTimeout(() => barcodeRef.current?.focus(), 100)
    }
  }

  function handleBarcodeKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter' || !barcodeValue.trim()) return
    e.preventDefault()
    // Chave de 44 dígitos já foi disparada pelo onChange — evitar duplo envio
    if (!ehChaveCompleta(barcodeValue)) processarBipagem(barcodeValue)
  }

  // ── Itens manuais ────────────────────────────────────────────────────────────
  function updateItem(idx: number, field: keyof ItemForm, value: string | number) {
    setItens(prev => prev.map((it, i) => i === idx ? { ...it, [field]: value } : it))
  }

  const itemRowRefs = useRef<Array<Array<HTMLElement | null>>>([])

  const handleItemKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>, rowIdx: number, colIdx: number) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const cols = 5 // nfe, dest, empresa, dep, vol
    const nextCol = colIdx + 1
    if (nextCol < cols) {
      itemRowRefs.current[rowIdx]?.[nextCol]?.focus()
    } else {
      const nextRow = rowIdx + 1
      if (itemRowRefs.current[nextRow]?.[0]) {
        itemRowRefs.current[nextRow][0]?.focus()
      } else {
        addItem()
        setTimeout(() => itemRowRefs.current[nextRow]?.[0]?.focus(), 50)
      }
    }
  }, [])

  function addItem() { setItens(prev => [...prev, emptyItem()]) }
  function removeItem(idx: number) { setItens(prev => prev.filter((_, i) => i !== idx)) }

  // ── Excel import ─────────────────────────────────────────────────────────────
  function detectColumns(headers: string[]) {
    const map: Record<string, number> = { nfe: -1, dest: -1, emp: -1, dep: -1, vol: -1 }
    headers.forEach((h, i) => {
      const n = String(h).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()
      if (map.nfe === -1 && /nf[e\-]?|nota.fiscal/.test(n)) map.nfe = i
      else if (map.dest === -1 && /destinat|cliente/.test(n)) map.dest = i
      else if (map.emp === -1 && /empresa|emitente|marca/.test(n)) map.emp = i
      else if (map.dep === -1 && /depositante|canal|shopee|meli|shein/.test(n)) map.dep = i
      else if (map.vol === -1 && /volume|qtd|quantidade/.test(n)) map.vol = i
    })
    if (map.nfe === -1) map.nfe = 0
    if (map.dest === -1) map.dest = 1
    if (map.dep === -1) map.dep = 2
    if (map.vol === -1) map.vol = 3
    return map
  }

  async function importarExcel(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    try {
      const XLSX = await import('xlsx')
      const buffer = await file.arrayBuffer()
      const wb = XLSX.read(new Uint8Array(buffer), { type: 'array' })
      const sheet = wb.Sheets[wb.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 }) as unknown[][]
      const primeiraLinha = rows[0] as string[]
      const temCabecalho = primeiraLinha && typeof primeiraLinha[0] === 'string' && isNaN(Number(String(primeiraLinha[0]).trim()))
      const cols = temCabecalho ? detectColumns(primeiraLinha) : { nfe: 0, dest: 1, emp: -1, dep: 2, vol: 3 }
      const dadosLinhas = temCabecalho ? rows.slice(1) : rows
      const novosItens: ItemForm[] = dadosLinhas
        .filter(row => row && row[cols.nfe])
        .map(row => ({
          numero_nfe: String(row[cols.nfe] ?? '').trim(),
          cliente_destinatario: String(row[cols.dest] ?? '').trim(),
          empresa: cols.emp >= 0 ? String(row[cols.emp] ?? '').trim() : '',
          depositante: String(row[cols.dep] ?? '').trim(),
          qtd_volumes: Math.max(1, Number(row[cols.vol]) || 1),
        }))
        .filter(it => it.numero_nfe)
      if (novosItens.length === 0) { toast.error('Nenhum item encontrado no arquivo.'); return }
      setItens(novosItens)
      toast.success(`${novosItens.length} NF-e(s) importadas!`)
    } catch {
      toast.error('Erro ao ler o arquivo.')
    }
  }

  // ── Submit ───────────────────────────────────────────────────────────────────
  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (saving) return

    // Considera apenas itens preenchidos (ignora linhas vazias residuais)
    const itensValidos = itens.filter(it => it.numero_nfe.trim())
    if (itensValidos.length === 0) {
      setError('Adicione ao menos uma NF-e (bipe a etiqueta ou preencha manualmente).')
      return
    }
    if (itensValidos.some(it => !it.cliente_destinatario.trim())) {
      setError('Preencha o Destinatário em todas as NF-e.')
      return
    }
    const nfes = itensValidos.map(it => normalizarNfe(it.numero_nfe))
    const duplicatas = nfes.filter((n, i) => nfes.indexOf(n) !== i)
    if (duplicatas.length > 0) {
      setError(`NF-e duplicada: ${[...new Set(duplicatas)].join(', ')}`)
      return
    }

    setSaving(true)
    setError('')

    const insertData: Record<string, unknown> = { criado_por: user!.id }
    if (emailNotificacao.trim()) insertData.email_notificacao = emailNotificacao.trim()
    if (selectedTransp) { insertData.transportadora_nome = selectedTransp.nome; insertData.transportadora_cnpj = selectedTransp.cnpj }
    if (selectedMotorista) { insertData.motorista_nome = selectedMotorista.nome; insertData.motorista_cpf = selectedMotorista.cpf ?? null; insertData.motorista_rg = selectedMotorista.rg ?? null }
    if (selectedVeiculo) { insertData.veiculo_modelo = selectedVeiculo.modelo; insertData.veiculo_placa = selectedVeiculo.placa }

    const { data: romaneio, error: errR } = await supabase.from('romaneios').insert(insertData).select('id, token_publico').single()
    if (errR || !romaneio) { setSaving(false); setError('Erro ao criar romaneio: ' + errR?.message); return }

    const { error: errI } = await supabase.from('romaneio_itens').insert(
      itensValidos.map(it => ({
        romaneio_id: romaneio.id,
        // Salva o número já normalizado (sem zeros à esquerda / chave) para casar na bipagem
        numero_nfe: normalizarNfe(it.numero_nfe),
        cliente_destinatario: it.cliente_destinatario.trim(),
        empresa: it.empresa.trim() || null,
        depositante: it.depositante.trim() || null,
        qtd_volumes: Number(it.qtd_volumes),
      }))
    )

    setSaving(false)
    if (errI) { setError('Erro ao salvar itens: ' + errI.message); return }
    toast.success('Romaneio criado com sucesso!')
    navigate(`/romaneios/${romaneio.id}`)
  }

  return (
    <div className="page">
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="btn-ghost" onClick={() => navigate('/')}>
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1>Novo Romaneio</h1>
            <p className="subtitle">Bipe as etiquetas ou adicione manualmente</p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={importarExcel} />
          <button type="button" className="btn-secondary" onClick={() => fileInputRef.current?.click()}>
            <Upload size={15} /> Importar Excel
          </button>
        </div>
      </div>

      {/* Área de bipagem */}
      <div className="form-card" style={{ marginBottom: 16 }}>
        <div className="section-title" style={{ marginBottom: 8 }}>
          <Barcode size={16} style={{ display: 'inline', marginRight: 6, verticalAlign: 'middle' }} />
          Bipagem de Etiquetas
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            ref={barcodeRef}
            className="barcode-input"
            placeholder="Bipe a etiqueta ou digite o número da NF-e e pressione Enter..."
            value={barcodeValue}
            onChange={e => {
              const val = e.target.value
              setBarcodeValue(val)
              // Disparo automático ao detectar chave completa (sem precisar de Enter)
              if (ehChaveCompleta(val)) setTimeout(() => processarBipagem(val), 0)
            }}
            onKeyDown={handleBarcodeKeyDown}
            disabled={scanning}
            autoFocus
          />
          {scanning && <Loader2 size={20} className="spin" style={{ flexShrink: 0, color: '#2563eb' }} />}
        </div>

        {/* Preview da chave de acesso */}
        {(() => {
          const info = analisarChave(barcodeValue)
          if (!info) return (
            <p className="import-hint" style={{ marginTop: 6, marginBottom: 0 }}>
              O leitor insere a chave automaticamente. Cada bipagem adiciona uma NF-e à lista.
            </p>
          )
          if (info.tipo === 'chave') return (
            <div style={{ marginTop: 8, padding: '8px 12px', background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 8, fontFamily: 'monospace', fontSize: 12, lineHeight: 1.6 }}>
              <div style={{ color: '#6b7280', marginBottom: 2, fontSize: 11, fontFamily: 'inherit' }}>
                Chave de acesso detectada (44 dígitos) — NF-e extraída das posições 30-34:
              </div>
              <div style={{ wordBreak: 'break-all', letterSpacing: '0.04em' }}>
                <span style={{ color: '#9ca3af' }}>{info.antes}</span>
                <span style={{
                  background: '#16a34a', color: '#fff',
                  padding: '1px 4px', borderRadius: 4, margin: '0 2px',
                  fontWeight: 700, fontSize: 13
                }}>{info.nfe}</span>
                <span style={{ color: '#9ca3af' }}>{info.depois}</span>
              </div>
              <div style={{ marginTop: 4, color: '#16a34a', fontWeight: 600, fontSize: 12 }}>
                → NF-e: {info.numero} · Consultando WMS...
              </div>
            </div>
          )
          return (
            <div style={{ marginTop: 8, padding: '6px 12px', background: '#eff6ff', border: '1px solid #93c5fd', borderRadius: 8, fontSize: 12, color: '#1d4ed8' }}>
              Número digitado: <strong>{info.nfe}</strong> · Pressione Enter para consultar o WMS
            </div>
          )
        })()}
      </div>

      {/* Pré-cadastro de transportadora */}
      {transp.length > 0 && (
        <div className="form-card" style={{ marginBottom: 16 }}>
          <button type="button" className="btn-ghost" onClick={() => setShowPreCadastro(!showPreCadastro)}
            style={{ width: '100%', justifyContent: 'space-between' }}>
            <span style={{ fontWeight: 600 }}>
              {selectedTransp ? `Transportadora: ${selectedTransp.nome}` : 'Selecionar transportadora pré-cadastrada (opcional)'}
            </span>
            <ChevronDown size={16} style={{ transform: showPreCadastro ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }} />
          </button>
          {showPreCadastro && (
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className="field">
                <label>Transportadora</label>
                <select value={selectedTranspId} onChange={e => { setSelectedTranspId(e.target.value); setSelectedMotoristaId(''); setSelectedVeiculoId('') }}>
                  <option value="">— Não usar pré-cadastro —</option>
                  {transp.map(t => <option key={t.id} value={t.id}>{t.nome} · {t.cnpj}</option>)}
                </select>
              </div>
              {selectedTranspId && (
                <div className="field-row">
                  <div className="field">
                    <label>Motorista (opcional)</label>
                    <select value={selectedMotoristaId} onChange={e => setSelectedMotoristaId(e.target.value)}>
                      <option value="">— Selecionar motorista —</option>
                      {motoristasFiltered.map(m => <option key={m.id} value={m.id}>{m.nome}</option>)}
                    </select>
                  </div>
                  <div className="field">
                    <label>Veículo (opcional)</label>
                    <select value={selectedVeiculoId} onChange={e => setSelectedVeiculoId(e.target.value)}>
                      <option value="">— Selecionar veículo —</option>
                      {veiculosFiltered.map(v => <option key={v.id} value={v.id}>{v.modelo} · {v.placa}</option>)}
                    </select>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <form onSubmit={handleSubmit} className="form-card">
        <div className="section-title">Notas Fiscais ({itens.filter(i => i.numero_nfe).length})</div>

        <div className="itens-header-6col">
          <span>NF-e *</span>
          <span>Destinatário *</span>
          <span>Empresa</span>
          <span>Depositante</span>
          <span>Volumes *</span>
          <span></span>
        </div>

        {itens.map((item, idx) => {
          if (!itemRowRefs.current[idx]) itemRowRefs.current[idx] = []
          return (
            <div key={idx} className="item-row-6col">
              <input
                placeholder="NF-e"
                value={item.numero_nfe}
                onChange={e => {
                  const val = e.target.value
                  // Se uma chave completa for colada/bipada aqui, extrai e consulta o WMS
                  if (ehChaveCompleta(val)) processarBipagem(val)
                  else updateItem(idx, 'numero_nfe', val)
                }}
                onKeyDown={e => handleItemKeyDown(e, idx, 0)}
                ref={el => { itemRowRefs.current[idx][0] = el }}
                required
              />
              <input
                placeholder="Destinatário"
                value={item.cliente_destinatario}
                onChange={e => updateItem(idx, 'cliente_destinatario', e.target.value)}
                onKeyDown={e => handleItemKeyDown(e, idx, 1)}
                ref={el => { itemRowRefs.current[idx][1] = el }}
                required
              />
              <input
                placeholder="Ex: Vegpet"
                value={item.empresa}
                onChange={e => updateItem(idx, 'empresa', e.target.value)}
                onKeyDown={e => handleItemKeyDown(e, idx, 2)}
                ref={el => { itemRowRefs.current[idx][2] = el }}
              />
              <select
                value={item.depositante}
                onChange={e => updateItem(idx, 'depositante', e.target.value)}
                ref={el => { itemRowRefs.current[idx][3] = el }}
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
              <input
                type="number" min={1}
                value={item.qtd_volumes}
                onChange={e => updateItem(idx, 'qtd_volumes', e.target.value)}
                onKeyDown={e => handleItemKeyDown(e, idx, 4)}
                ref={el => { itemRowRefs.current[idx][4] = el }}
                required
              />
              <button type="button" className="btn-icon-sm danger" onClick={() => removeItem(idx)} disabled={itens.length === 1}>
                <Trash2 size={14} />
              </button>
            </div>
          )
        })}

        <button type="button" className="btn-ghost" onClick={addItem}>
          <PlusCircle size={16} /> Adicionar NF-e manualmente
        </button>

        <div style={{ marginTop: 16 }}>
          <div className="section-title">Notificação por e-mail (opcional)</div>
          <div className="field">
            <label>E-mail para notificar quando o romaneio for liberado</label>
            <input type="email" value={emailNotificacao} onChange={e => setEmailNotificacao(e.target.value)} placeholder="cliente@empresa.com.br" />
          </div>
        </div>

        {error && <div className="error-msg">{error}</div>}

        <div className="form-actions">
          <button type="button" className="btn-secondary" onClick={() => navigate('/')}>Cancelar</button>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? 'Salvando...' : 'Criar Romaneio'}
          </button>
        </div>
      </form>
    </div>
  )
}

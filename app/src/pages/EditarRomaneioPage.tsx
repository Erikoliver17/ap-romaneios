import { useEffect, useState, useRef, useCallback } from 'react'
import type { ChangeEvent, KeyboardEvent } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { ArrowLeft, PlusCircle, Trash2, Save, Upload, Barcode, Loader2 } from 'lucide-react'
import { normalizarNfe, ehChaveCompleta, analisarChave, mesmaNfe } from '../lib/nfe'

interface ItemForm {
  id?: string
  numero_nfe: string
  cliente_destinatario: string
  empresa: string
  depositante: string
  qtd_volumes: number
  isNew?: boolean
}

function detectColumns(headers: string[]): Record<string, number> {
  const map: Record<string, number> = { nfe: -1, dest: -1, emp: -1, dep: -1, vol: -1 }
  headers.forEach((h, i) => {
    const n = h.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()
    if (map.nfe === -1 && /nf[e\-]?|nota.fiscal/.test(n)) map.nfe = i
    else if (map.dest === -1 && /destinat|cliente/.test(n)) map.dest = i
    else if (map.emp === -1 && /empresa|emitente|marca/.test(n)) map.emp = i
    else if (map.dep === -1 && /depositante|canal|shopee|meli/.test(n)) map.dep = i
    else if (map.vol === -1 && /volume|qtd|quantidade/.test(n)) map.vol = i
  })
  if (map.nfe === -1) map.nfe = 0
  if (map.dest === -1) map.dest = 1
  if (map.dep === -1) map.dep = 2
  if (map.vol === -1) map.vol = 3
  return map
}

export default function EditarRomaneioPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [itens, setItens] = useState<ItemForm[]>([])
  const [emailNotificacao, setEmailNotificacao] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const barcodeRef = useRef<HTMLInputElement>(null)
  const [barcodeValue, setBarcodeValue] = useState('')
  const [scanning, setScanning] = useState(false)

  useEffect(() => { load() }, [id])

  async function load() {
    const [romRes, itsRes] = await Promise.all([
      supabase.from('romaneios').select('*').eq('id', id!).single(),
      supabase.from('romaneio_itens').select('*').eq('romaneio_id', id!).order('inserido_em'),
    ])
    if (romRes.data) {
      const r = romRes.data as Record<string, unknown>
      setEmailNotificacao((r.email_notificacao as string) || '')
    }
    setItens((itsRes.data || []).map((it: Record<string, unknown>) => ({
      id: it.id as string,
      numero_nfe: it.numero_nfe as string,
      cliente_destinatario: it.cliente_destinatario as string,
      empresa: (it.empresa as string) || '',
      depositante: it.depositante as string,
      qtd_volumes: it.qtd_volumes as number,
    })))
    setLoading(false)
  }

  // ── Bipagem ──────────────────────────────────────────────────────────────────
  async function processarBipagem(nfe: string) {
    const nfeNum = normalizarNfe(nfe)
    if (!nfeNum) return
    setBarcodeValue('')

    // Checar duplicata
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
        toast(`NF-e ${nfeNum} não encontrada no WMS. Preencha manualmente.`, { icon: '⚠️' })
        setItens(prev => {
          const lista = prev.filter(it => it.numero_nfe !== '')
          return [...lista, { numero_nfe: nfeNum, cliente_destinatario: '', empresa: '', depositante: '', qtd_volumes: 1, isNew: true }]
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
            isNew: true
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
    if (!ehChaveCompleta(barcodeValue)) processarBipagem(barcodeValue)
  }

  function updateItem(idx: number, field: keyof ItemForm, value: string | number) {
    setItens(prev => prev.map((it, i) => i === idx ? { ...it, [field]: value } : it))
  }

  const itemRowRefs = useRef<Array<Array<HTMLElement | null>>>([])

  const handleItemKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>, rowIdx: number, colIdx: number) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const cols = 5
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

  function addItem() {
    setItens(prev => [...prev, { numero_nfe: '', cliente_destinatario: '', empresa: '', depositante: '', qtd_volumes: 1, isNew: true }])
  }

  function removeItem(idx: number) {
    setItens(prev => prev.filter((_, i) => i !== idx))
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

      const firstRow = rows[0] as string[]
      const hasHeader = firstRow && typeof firstRow[0] === 'string' && isNaN(Number(String(firstRow[0]).trim()))
      const cols = hasHeader ? detectColumns(firstRow) : { nfe: 0, dest: 1, emp: 2, dep: 3, vol: 4 }
      const dataRows = hasHeader ? rows.slice(1) : rows

      const novos: ItemForm[] = dataRows
        .filter(row => row && row[cols.nfe])
        .map(row => ({
          numero_nfe: String(row[cols.nfe] ?? '').trim(),
          cliente_destinatario: String(row[cols.dest] ?? '').trim(),
          empresa: cols.emp >= 0 ? String(row[cols.emp] ?? '').trim() : '',
          depositante: String(row[cols.dep] ?? '').trim(),
          qtd_volumes: Math.max(1, Number(row[cols.vol]) || 1),
          isNew: true,
        }))
        .filter(it => it.numero_nfe)

      if (novos.length === 0) { toast.error('Nenhum item encontrado no arquivo.'); return }
      setItens(novos)
      toast.success(`${novos.length} NF-e(s) importadas. Revise e salve.`)
    } catch {
      toast.error('Erro ao ler o arquivo.')
    }
  }

  async function salvar() {
    if (itens.some(it => !it.numero_nfe.trim() || !it.cliente_destinatario.trim())) {
      setError('Preencha os campos obrigatórios (NF-e e Destinatário) em todos os itens.')
      return
    }
    const nfes = itens.map(it => normalizarNfe(it.numero_nfe))
    const dups = nfes.filter((n, i) => nfes.indexOf(n) !== i)
    if (dups.length > 0) { setError(`NF-e duplicada: ${[...new Set(dups)].join(', ')}`); return }

    setSaving(true)
    setError('')

    // Buscar itens atuais no banco para calcular diff
    const { data: itensAtuais } = await supabase
      .from('romaneio_itens').select('id').eq('romaneio_id', id!)

    const idsAtuais = new Set((itensAtuais || []).map(i => i.id))
    const idsNovos = new Set(itens.filter(i => i.id).map(i => i.id!))

    // Excluir removidos
    const idsRemover = [...idsAtuais].filter(id => !idsNovos.has(id))
    if (idsRemover.length > 0) {
      await supabase.from('romaneio_itens').delete().in('id', idsRemover)
    }

    // Separar itens existentes (update) de novos (insert)
    const itensExistentes = itens.filter(it => it.id && !it.isNew)
    const itensNovos = itens.filter(it => !it.id || it.isNew)

    if (itensExistentes.length > 0) {
      for (const it of itensExistentes) {
        const { error } = await supabase.from('romaneio_itens').update({
          numero_nfe: normalizarNfe(it.numero_nfe),
          cliente_destinatario: it.cliente_destinatario.trim(),
          empresa: it.empresa.trim() || null,
          depositante: it.depositante.trim() || null,
          qtd_volumes: Number(it.qtd_volumes),
        }).eq('id', it.id!)
        if (error) { setError('Erro ao atualizar item: ' + error.message); setSaving(false); return }
      }
    }

    if (itensNovos.length > 0) {
      const { error } = await supabase.from('romaneio_itens').insert(
        itensNovos.map(it => ({
          romaneio_id: id!,
          numero_nfe: normalizarNfe(it.numero_nfe),
          cliente_destinatario: it.cliente_destinatario.trim(),
          empresa: it.empresa.trim() || null,
          depositante: it.depositante.trim() || null,
          qtd_volumes: Number(it.qtd_volumes),
        }))
      )
      if (error) { setError('Erro ao inserir itens: ' + error.message); setSaving(false); return }
    }

    // Atualizar email_notificacao (ignora se coluna não existe)
    const updateData: Record<string, unknown> = {}
    if (emailNotificacao !== undefined) updateData.email_notificacao = emailNotificacao.trim() || null
    if (Object.keys(updateData).length > 0) {
      await supabase.from('romaneios').update(updateData).eq('id', id!)
    }

    setSaving(false)
    toast.success('Romaneio atualizado!')
    navigate(`/romaneios/${id}`)
  }

  if (loading) return <div className="loading-center"><div className="spinner" /></div>

  return (
    <div className="page">
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="btn-ghost" onClick={() => navigate(`/romaneios/${id}`)}>
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1>Editar Romaneio</h1>
            <p className="subtitle">Altere as NF-es e informações do romaneio</p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={importarExcel} />
          <button type="button" className="btn-secondary" onClick={() => fileInputRef.current?.click()}>
            <Upload size={15} /> Importar Excel
          </button>
          <button className="btn-primary" onClick={salvar} disabled={saving}>
            <Save size={15} /> {saving ? 'Salvando...' : 'Salvar alterações'}
          </button>
        </div>
      </div>

      <div className="import-hint">
        Formato esperado do Excel: <strong>NF-e | Destinatário | Empresa | Depositante | Volumes</strong>
        <br />Cabeçalhos são detectados automaticamente. A importação substitui todos os itens atuais.
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
            <div style={{ marginTop: 6, fontSize: 12, color: '#6b7280' }}>
              NF-e: <strong>{info.nfe}</strong> · {44 - info.nfe.length} dígitos restantes para chave completa
            </div>
          )
        })()}
      </div>

      <div className="form-card">
        <div className="section-title">Notas Fiscais</div>

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
              placeholder="Ex: 1234"
              value={item.numero_nfe}
              onChange={e => {
                const val = e.target.value
                // Cola/bipa chave completa → extrai o número da NF-e
                updateItem(idx, 'numero_nfe', ehChaveCompleta(val) ? normalizarNfe(val) : val)
              }}
              onKeyDown={e => handleItemKeyDown(e, idx, 0)}
              ref={el => { itemRowRefs.current[idx][0] = el }}
            />
            <input
              placeholder="Nome do destinatário"
              value={item.cliente_destinatario}
              onChange={e => updateItem(idx, 'cliente_destinatario', e.target.value)}
              onKeyDown={e => handleItemKeyDown(e, idx, 1)}
              ref={el => { itemRowRefs.current[idx][1] = el }}
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
            />
            <button type="button" className="btn-icon-sm danger" onClick={() => removeItem(idx)} disabled={itens.length === 1}>
              <Trash2 size={14} />
            </button>
          </div>
          )
        })}

        <button type="button" className="btn-ghost" onClick={addItem}>
          <PlusCircle size={16} /> Adicionar NF-e
        </button>

        <div style={{ marginTop: 20 }}>
          <div className="section-title">E-mail de notificação</div>
          <div className="field">
            <label>E-mail para notificar quando o romaneio for liberado</label>
            <input
              type="email"
              value={emailNotificacao}
              onChange={e => setEmailNotificacao(e.target.value)}
              placeholder="cliente@empresa.com.br"
            />
          </div>
        </div>

        {error && <div className="error-msg" style={{ marginTop: 12 }}>{error}</div>}

        <div className="form-actions" style={{ marginTop: 20 }}>
          <button type="button" className="btn-secondary" onClick={() => navigate(`/romaneios/${id}`)}>Cancelar</button>
          <button className="btn-primary" onClick={salvar} disabled={saving}>
            <Save size={15} /> {saving ? 'Salvando...' : 'Salvar alterações'}
          </button>
        </div>
      </div>
    </div>
  )
}

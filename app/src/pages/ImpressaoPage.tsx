import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { RomaneioCompleto, RomaneioItem } from '../types'
import { Printer, Download, ArrowLeft } from 'lucide-react'

function obterDataExtenso(dataEmissao?: string): string {
  if (!dataEmissao) return '_______ de __________________ de ________'
  const partes = dataEmissao.split(' ')
  if (partes.length === 0) return '_______ de __________________ de ________'
  const partesData = partes[0].split('/')
  if (partesData.length !== 3) return '_______ de __________________ de ________'
  const dia = parseInt(partesData[0], 10)
  const mesIdx = parseInt(partesData[1], 10) - 1
  const ano = partesData[2]
  
  const meses = [
    'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'
  ]
  
  const mesExtenso = meses[mesIdx] || '__________________'
  return `${dia} de ${mesExtenso} de ${ano}`
}

export default function ImpressaoPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [data, setData] = useState<RomaneioCompleto | null>(null)
  const [error, setError] = useState(false)
  const [gerandoPdf, setGerandoPdf] = useState(false)
  const printRef = useRef<HTMLDivElement>(null)

  const handleVoltar = () => {
    if (window.history.length > 1) {
      navigate(-1)
    } else {
      navigate(`/romaneios/${id}`)
    }
  }

  useEffect(() => {
    supabase
      .from('vw_romaneio_completo')
      .select('*')
      .eq('romaneio_id', id!)
      .single()
      .then(({ data: r, error: err }) => {
        if (err || !r) { setError(true); return }
        setData(r)
      })
  }, [id])

  async function baixarPdf() {
    if (!printRef.current) return
    setGerandoPdf(true)
    try {
      const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
        import('html2canvas'),
        import('jspdf'),
      ])
      const canvas = await html2canvas(printRef.current, {
        scale: 2, useCORS: true, logging: false,
        windowWidth: 794, windowHeight: printRef.current.scrollHeight,
      })
      const imgData = canvas.toDataURL('image/jpeg', 0.92)
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
      const pdfW = pdf.internal.pageSize.getWidth()
      const pdfH = (canvas.height * pdfW) / canvas.width
      let yPos = 0
      const pageH = pdf.internal.pageSize.getHeight()
      while (yPos < pdfH) {
        if (yPos > 0) pdf.addPage()
        pdf.addImage(imgData, 'JPEG', 0, -yPos, pdfW, pdfH)
        yPos += pageH
      }
      pdf.save(`romaneio-${id!.slice(0, 8).toUpperCase()}.pdf`)
    } catch (e) {
      console.error(e)
      window.print()
    } finally {
      setGerandoPdf(false)
    }
  }

  if (error) return (
    <div style={{ padding: 40, textAlign: 'center' }}>
      <p>Romaneio não encontrado. Feche esta janela e tente novamente.</p>
    </div>
  )
  if (!data) return <div style={{ padding: 40 }}>Carregando...</div>

  const itens: RomaneioItem[] = data.itens || []

  return (
    <>
      {/* Barra de ações — não aparece no PDF */}
      <div className="print-toolbar no-print">
        <div className="print-toolbar-info">
          <strong>Romaneio #{data.romaneio_id.slice(0, 8).toUpperCase()}</strong>
          <span className="muted">{data.transportadora_nome || 'Aguardando transportadora'}</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-secondary" onClick={handleVoltar}>
            <ArrowLeft size={15} /> Voltar
          </button>
          <button className="btn-secondary" onClick={() => window.print()}>
            <Printer size={15} /> Imprimir
          </button>
          <button className="btn-primary" onClick={baixarPdf} disabled={gerandoPdf}>
            <Download size={15} /> {gerandoPdf ? 'Gerando PDF...' : 'Baixar PDF'}
          </button>
        </div>
      </div>

      <div ref={printRef} className="print-page">
        <div className="print-header">
          <div className="print-remetente">
            <strong>{data.remetente_nome}</strong>
            <span>CNPJ: {data.remetente_cnpj}</span>
            <span>{data.remetente_endereco}</span>
            <span>{data.remetente_cidade_uf} · CEP {data.remetente_cep}</span>
          </div>
          <div className="print-title-block">
            <h1>ROMANEIO DE CARGA</h1>
            <div className="print-meta">
              <span>Nº: <strong>{data.romaneio_id.slice(0, 8).toUpperCase()}</strong></span>
              <span>Data: <strong>{data.data_emissao}</strong></span>
              <span>Status: <strong>{data.status}</strong></span>
            </div>
          </div>
        </div>

        <hr className="print-divider" />

        <div className="print-two-col">
          <div className="print-section">
            <div className="print-section-title">TRANSPORTADORA</div>
            <table className="print-info-table">
              <tbody>
                <tr><td>Razão Social:</td><td><strong>{data.transportadora_nome || '___________________________'}</strong></td></tr>
                <tr><td>CNPJ:</td><td>{data.transportadora_cnpj || '___________________________'}</td></tr>
              </tbody>
            </table>
          </div>
          <div className="print-section">
            <div className="print-section-title">MOTORISTA & VEÍCULO</div>
            <table className="print-info-table">
              <tbody>
                <tr><td>Motorista:</td><td><strong>{data.motorista_nome || '___________________________'}</strong></td></tr>
                <tr><td>CPF:</td><td>{data.motorista_cpf || '___________________________'}</td></tr>
                <tr><td>RG:</td><td>{data.motorista_rg || '___________________________'}</td></tr>
                <tr><td>Veículo:</td><td>{data.veiculo_modelo || '___________________________'}</td></tr>
                <tr><td>Placa:</td><td><strong>{data.veiculo_placa || '___________________________'}</strong></td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <hr className="print-divider" />

        <div className="print-section-title">NOTAS FISCAIS DA CARGA</div>
        <table className="print-table">
          <thead>
            <tr>
              <th>Nº NF-e</th>
              <th>Destinatário</th>
              <th>Empresa</th>
              <th>Depositante</th>
              <th style={{ textAlign: 'center' }}>Volumes</th>
            </tr>
          </thead>
          <tbody>
            {itens.map((it, i) => (
              <tr key={i}>
                <td>{it.numero_nfe}</td>
                <td>{it.cliente_destinatario}</td>
                <td>{it.empresa || '—'}</td>
                <td>{it.depositante}</td>
                <td style={{ textAlign: 'center' }}>{it.qtd_volumes}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4}><strong>TOTAIS</strong></td>
              <td style={{ textAlign: 'center' }}><strong>{data.total_volumes}</strong></td>
            </tr>
          </tfoot>
        </table>

        {data.observacao_transportadora && (
          <>
            <hr className="print-divider" />
            <div className="print-section-title">OBSERVAÇÕES DA TRANSPORTADORA</div>
            <p style={{ fontSize: 12, marginTop: 4 }}>{data.observacao_transportadora}</p>
          </>
        )}

        <hr className="print-divider" />

        <div className="print-termo">
          <div className="print-section-title">TERMO DE DECLARAÇÃO DE RESPONSABILIDADE</div>
          <p>
            O motorista <strong>{data.motorista_nome || '____________________________'}</strong>,
            portador do CPF <strong>{data.motorista_cpf || '____________________________'}</strong>,
            RG <strong>{data.motorista_rg || '____________________________'}</strong>,
            representando a transportadora <strong>{data.transportadora_nome || '____________________________'}</strong>,
            CNPJ <strong>{data.transportadora_cnpj || '____________________________'}</strong>,
            declara ter recebido em perfeito estado as <strong>{data.total_nfes}</strong> nota(s) fiscal(is)
            descritas neste romaneio, totalizando <strong>{data.total_volumes}</strong> volume(s),
            comprometendo-se a entregar a(s) mercadoria(s) no(s) destino(s) indicado(s), assumindo
            total responsabilidade pela integridade da carga durante o transporte.
          </p>
          <p style={{ marginTop: 8 }}>
            Local e Data: {data.remetente_cidade_uf || '____________________________'}, {obterDataExtenso(data.data_emissao)}
          </p>
        </div>

        <div className="print-assinaturas">
          <div className="print-assinatura">
            <div className="print-assinatura-linha" />
            <span>Remetente / Conferente</span>
            <span>{data.remetente_nome}</span>
          </div>
          <div className="print-assinatura">
            {data.assinatura_motorista ? (
              <img
                src={data.assinatura_motorista}
                alt="Assinatura"
                style={{ height: 60, maxWidth: '100%', objectFit: 'contain', display: 'block', marginBottom: 4 }}
              />
            ) : (
              <div className="print-assinatura-linha" />
            )}
            <span>Motorista</span>
            <span>{data.motorista_nome || '____________________________'}</span>
          </div>
        </div>

        <div className="print-rodape">
          Romaneio gerado em {data.data_emissao} · Operador: {data.criado_por_nome}
        </div>
      </div>
    </>
  )
}

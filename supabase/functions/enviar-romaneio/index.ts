// Edge Function: enviar-romaneio
// Envia e-mail com resumo do romaneio quando liberado
// Setup: Supabase Dashboard → Edge Functions → Secrets → RESEND_API_KEY

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  try {
    const { romaneio_id } = await req.json()
    if (!romaneio_id) throw new Error('romaneio_id é obrigatório')

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Busca dados do romaneio
    const { data: rom, error: errR } = await supabase
      .from('romaneios')
      .select('*, config_remetente(*)')
      .eq('id', romaneio_id)
      .single()

    if (errR || !rom) throw new Error('Romaneio não encontrado')

    const emailDestino = rom.email_notificacao
    if (!emailDestino) {
      return new Response(JSON.stringify({ skipped: true, reason: 'email_notificacao não configurado' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Busca itens
    const { data: itens } = await supabase
      .from('romaneio_itens')
      .select('*')
      .eq('romaneio_id', romaneio_id)
      .order('inserido_em')

    const totalVolumes = (itens ?? []).reduce((s: number, i: { qtd_volumes: number }) => s + i.qtd_volumes, 0)

    const itensHtml = (itens ?? []).map((i: { numero_nfe: string; cliente_destinatario: string; qtd_volumes: number }) =>
      `<tr>
        <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0">${i.numero_nfe}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0">${i.cliente_destinatario}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:center">${i.qtd_volumes}</td>
      </tr>`
    ).join('')

    const html = `
<!DOCTYPE html>
<html lang="pt-BR">
<body style="font-family:sans-serif;color:#1e293b;max-width:600px;margin:0 auto;padding:24px">
  <h2 style="color:#2563eb;margin-bottom:4px">Romaneio Liberado</h2>
  <p style="color:#64748b;margin-bottom:20px">Seu romaneio foi liberado e está pronto para coleta.</p>

  <div style="background:#f8fafc;border-radius:8px;padding:16px;margin-bottom:20px">
    <strong>Transportadora:</strong> ${rom.transportadora_nome || '—'}<br>
    <strong>Motorista:</strong> ${rom.motorista_nome || '—'}<br>
    <strong>Veículo:</strong> ${rom.veiculo_modelo || '—'} · ${rom.veiculo_placa || '—'}<br>
    <strong>Total de volumes:</strong> ${totalVolumes}
  </div>

  <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
    <thead>
      <tr style="background:#2563eb;color:#fff">
        <th style="padding:8px;text-align:left">NF-e</th>
        <th style="padding:8px;text-align:left">Destinatário</th>
        <th style="padding:8px;text-align:center">Volumes</th>
      </tr>
    </thead>
    <tbody>${itensHtml}</tbody>
  </table>

  ${rom.observacao_transportadora ? `<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:6px;padding:12px;margin-bottom:16px"><strong>Observação:</strong> ${rom.observacao_transportadora}</div>` : ''}

  <p style="font-size:12px;color:#94a3b8;margin-top:24px">Gerado automaticamente pelo sistema de Romaneios.</p>
</body>
</html>`

    const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
    if (!RESEND_API_KEY) throw new Error('RESEND_API_KEY não configurada. Adicione nas Secrets da Edge Function.')

    const APP_URL = Deno.env.get('APP_URL') || 'https://app-one-kappa-31.vercel.app'
    const linkRomaneio = `${APP_URL}/coleta/${rom.token_publico}`

    const footerHtml = `
      <div style="margin-top:20px;padding:12px;background:#eff6ff;border-radius:6px;border:1px solid #bfdbfe">
        <strong style="color:#1d4ed8">Acompanhe seu romaneio:</strong><br>
        <a href="${linkRomaneio}" style="color:#2563eb">${linkRomaneio}</a>
      </div>
      <p style="font-size:12px;color:#94a3b8;margin-top:24px">Gerado automaticamente pelo sistema de Romaneios.</p>`

    const htmlFinal = html.replace(
      '<p style="font-size:12px;color:#94a3b8;margin-top:24px">Gerado automaticamente pelo sistema de Romaneios.</p>',
      footerHtml
    )

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: 'Romaneios <noreply@seudominio.com.br>',
        to: [emailDestino],
        subject: `Romaneio Liberado — ${rom.transportadora_nome || 'Coleta'}`,
        html: htmlFinal,
      }),
    })

    if (!res.ok) {
      const err = await res.text()
      throw new Error('Erro Resend: ' + err)
    }

    return new Response(JSON.stringify({ sent: true, email: emailDestino }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return new Response(JSON.stringify({ error: msg }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})

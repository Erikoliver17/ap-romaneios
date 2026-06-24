// Edge Function: buscar-nfe
// Busca dados de uma NF-e no Smartgo WMS2 via login pelo portal antigo /WMS/Login.aspx

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const WMS_OLD  = 'https://smartgo.com.br/WMS'
const WMS2_BASE = 'https://smartgo.com.br/WMS2'
const WMS2_LOGIN_ID  = () => Deno.env.get('WMS2_LOGIN_ID')  ?? '46996599000166'
const WMS2_LOGIN     = () => Deno.env.get('WMS2_LOGIN')     ?? 'Erik.Barros'
const WMS2_SENHA     = () => Deno.env.get('WMS2_SENHA')     ?? '2656'

function firstWord(s: string): string {
  return s.replace(/^\d+\s*-\s*/, '').split(' ')[0].trim()
}

// Extrai todos os cookies de um header Set-Cookie (pode vir como string única com vírgulas)
function parseCookies(raw: string | null): Record<string, string> {
  if (!raw) return {}
  const out: Record<string, string> = {}
  // Set-Cookie headers são separados por vírgulas, mas datas também têm vírgulas
  // Estratégia: split em ', ' seguido de nome=valor (sem espaço antes do =)
  const parts = raw.split(/,(?=\s*[\w\-]+=)/g)
  for (const part of parts) {
    const nameVal = part.trim().split(';')[0].trim()
    const eq = nameVal.indexOf('=')
    if (eq > 0) {
      const name = nameVal.substring(0, eq).trim()
      const val  = nameVal.substring(eq + 1)
      out[name] = val
    }
  }
  return out
}

function cookieStr(cookies: Record<string, string>): string {
  return Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ')
}

// Cache de sessão entre invocações "quentes" do mesmo isolate — evita
// fazer login no WMS a cada bipagem (economiza ~1s por scan).
let cachedSession: Record<string, string> | null = null
let cachedAt = 0
const SESSION_TTL = 10 * 60 * 1000 // 10 minutos

async function getSession(forceNew = false): Promise<Record<string, string>> {
  const fresh = cachedSession && (Date.now() - cachedAt) < SESSION_TTL
  if (!forceNew && fresh) return cachedSession!
  const session = await wmsLogin()
  cachedSession = session
  cachedAt = Date.now()
  return session
}

// Login no sistema WMS antigo (WebForms), que define WMSuCookie compartilhado
async function wmsLogin(): Promise<Record<string, string>> {
  const loginUrl = `${WMS_OLD}/Login.aspx`

  // 1. GET login page — coletar VIEWSTATE e cookies iniciais
  const getRes = await fetch(loginUrl, {
    redirect: 'follow',
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
  })

  const html = await getRes.text()

  // Extrair campos hidden do WebForms
  function extractHidden(name: string): string {
    const m = html.match(new RegExp(`name="${name.replace(/\$/g, '\\$')}"[^>]*value="([^"]*)"`, 'i'))
    return m ? m[1] : ''
  }

  const viewState          = extractHidden('__VIEWSTATE')
  const viewStateGenerator = extractHidden('__VIEWSTATEGENERATOR')

  if (!viewState) throw new Error(`VIEWSTATE não encontrado. URL: ${getRes.url}. HTML[0:300]: ${html.substring(0, 300)}`)

  // Cookies iniciais da sessão
  const initCookies = parseCookies(getRes.headers.get('set-cookie'))

  // 2. POST com credenciais
  const postBody = new URLSearchParams({
    '__EVENTTARGET':  '',
    '__EVENTARGUMENT': '',
    '__VIEWSTATE':    viewState,
    '__VIEWSTATEGENERATOR': viewStateGenerator,
    'UserControlLogin$LoginForm$TextBoxIdentificador': WMS2_LOGIN_ID(),
    'UserControlLogin$LoginForm$UserName':  WMS2_LOGIN(),
    'UserControlLogin$LoginForm$Password':  WMS2_SENHA(),
    'UserControlLogin$LoginForm$LoginButton': 'Entrar',
  })

  const loginRes = await fetch(loginUrl, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': cookieStr(initCookies),
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      'Referer': loginUrl,
    },
    body: postBody.toString(),
  })

  // Sucesso = 302 redirect para dashboard
  if (loginRes.status !== 302 && loginRes.status !== 200) {
    const txt = await loginRes.text()
    throw new Error(`Login WMS falhou: ${loginRes.status} — ${txt.substring(0, 300)}`)
  }

  const loginCookies = parseCookies(loginRes.headers.get('set-cookie'))
  const sessionCookies = { ...initCookies, ...loginCookies }

  if (!sessionCookies['WMSuCookie']) {
    throw new Error(`WMSuCookie não recebido. Status: ${loginRes.status}. Location: ${loginRes.headers.get('location')}. Cookies: ${JSON.stringify(Object.keys(sessionCookies))}`)
  }

  return sessionCookies
}

// Retorna null quando a sessão expirou (resposta não-JSON / redirect de login)
async function buscarNfeWms2(nfeNum: string, session: Record<string, string>): Promise<unknown | null> {
  const body = new URLSearchParams({ NumeroNota: nfeNum, PageNumber: '1', PageSize: '5' })

  const res = await fetch(`${WMS2_BASE}/Nfe/ConsultaNfe/Filtrar`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Requested-With': 'XMLHttpRequest',
      'Cookie': cookieStr(session),
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      'Referer': `${WMS2_BASE}/Nfe/ConsultaNfe`,
    },
    body: body.toString(),
  })

  // Sessão expirada → redirect (3xx) ou conteúdo HTML em vez de JSON
  const ct = res.headers.get('content-type') ?? ''
  if (res.status >= 300 && res.status < 400) return null
  if (!res.ok) {
    const txt = await res.text()
    if (txt.includes('<!DOCTYPE') || txt.toLowerCase().includes('login')) return null
    throw new Error(`WMS2 NF-e query ${res.status}: ${txt.substring(0, 200)}`)
  }
  if (!ct.includes('json')) return null
  return await res.json()
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  try {
    const { nfe } = await req.json()
    if (!nfe) throw new Error('nfe é obrigatório')

    const digits = String(nfe).trim().replace(/\D/g, '')
    // Chave de acesso NF-e (44 dígitos): número da NF-e nas posições 30-34
    // (1-indexed) = 3 últimos dígitos do bloco 8 + 2 primeiros do bloco 9.
    // Em índice 0-based: substring(29, 34). parseInt remove zeros à esquerda.
    const nfeNum = digits.length === 44 ? String(parseInt(digits.substring(29, 34), 10)) : digits

    // Usa sessão em cache; se expirou (null), refaz login uma vez e tenta de novo
    let session = await getSession()
    let wmsData = await buscarNfeWms2(nfeNum, session)
    if (wmsData === null) {
      session = await getSession(true)
      wmsData = await buscarNfeWms2(nfeNum, session)
    }
    const items: Array<Record<string, unknown>> =
      (wmsData as { Model?: { Items?: Array<Record<string, unknown>> } })?.Model?.Items ?? []

    if (items.length === 0) {
      return new Response(JSON.stringify({ error: 'nfe_nao_encontrada' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const item = items[0]
    const destinatario = String(item.DestinatarioNome ?? '').split(' ')[0]
    const empresa      = firstWord(String(item.Depositante ?? ''))
    const volumes      = Number(item.VolumeNota) || 1

    return new Response(JSON.stringify({
      ok: true,
      nfe: nfeNum,
      destinatario,
      empresa,
      depositante: '',
      volumes,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return new Response(JSON.stringify({ error: msg }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})

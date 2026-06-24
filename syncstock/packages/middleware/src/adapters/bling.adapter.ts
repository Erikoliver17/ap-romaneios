import { createHmac, timingSafeEqual } from 'crypto'

const BLING_API_URL = process.env.BLING_API_URL ?? 'https://www.bling.com.br/Api/v3'
const API_KEY = () => {
  if (!process.env.BLING_API_KEY) throw new Error('BLING_API_KEY not set')
  return process.env.BLING_API_KEY
}

/**
 * Validate X-Bling-Signature HMAC-SHA256 against the raw request body.
 * Uses timing-safe comparison to prevent timing attacks.
 */
export function validateBlingSignature(
  rawBody: string,
  signatureHeader: string
): boolean {
  const secret = process.env.BLING_WEBHOOK_SECRET
  if (!secret) throw new Error('BLING_WEBHOOK_SECRET not set')

  const expected = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`

  try {
    const expectedBuf = Buffer.from(expected, 'utf8')
    const receivedBuf = Buffer.from(signatureHeader, 'utf8')
    if (expectedBuf.length !== receivedBuf.length) return false
    return timingSafeEqual(expectedBuf, receivedBuf)
  } catch {
    return false
  }
}

export async function updateBlingStock(
  sku: string,
  depositoId: number,
  quantity: number
): Promise<void> {
  const res = await fetch(`${BLING_API_URL}/estoques`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_KEY()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      produto: { codigo: sku },
      deposito: { id: depositoId },
      saldoFisico: quantity,
    }),
    signal: AbortSignal.timeout(15_000),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Bling API ${res.status}: ${body}`)
  }
}

export async function checkBlingHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${BLING_API_URL}/situacoes/modulos`, {
      headers: { Authorization: `Bearer ${API_KEY()}` },
      signal: AbortSignal.timeout(5_000),
    })
    return res.ok
  } catch {
    return false
  }
}

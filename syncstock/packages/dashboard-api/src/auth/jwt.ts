import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { createHmac, timingSafeEqual } from 'crypto'

const ISSUER = process.env.JWT_ISSUER ?? 'syncstock'

function getSecrets(): string[] {
  const primary = process.env.JWT_SECRET
  if (!primary) throw new Error('JWT_SECRET not set')
  const secrets = [primary]
  if (process.env.JWT_SECRET_PREV) secrets.push(process.env.JWT_SECRET_PREV)
  return secrets
}

interface JwtPayload {
  sub: string
  role: string
  iat: number
  exp: number
  iss: string
}

function base64url(buf: Buffer | string): string {
  const b = typeof buf === 'string' ? Buffer.from(buf) : buf
  return b.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

export function signJwt(sub: string, role: string, expiresInSec = 3600): string {
  const secrets = getSecrets()
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const now = Math.floor(Date.now() / 1000)
  const payload = base64url(JSON.stringify({ sub, role, iat: now, exp: now + expiresInSec, iss: ISSUER }))
  const sig = base64url(
    createHmac('sha256', secrets[0]).update(`${header}.${payload}`).digest()
  )
  return `${header}.${payload}.${sig}`
}

export function verifyJwt(token: string): JwtPayload {
  const parts = token.split('.')
  if (parts.length !== 3) throw new Error('Invalid JWT format')

  const [header, payloadB64, sig] = parts
  const secrets = getSecrets()

  const verified = secrets.some((secret) => {
    const expected = base64url(
      createHmac('sha256', secret).update(`${header}.${payloadB64}`).digest()
    )
    try {
      const a = Buffer.from(expected, 'utf8')
      const b = Buffer.from(sig, 'utf8')
      return a.length === b.length && timingSafeEqual(a, b)
    } catch {
      return false
    }
  })

  if (!verified) throw new Error('Invalid JWT signature')

  const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString()) as JwtPayload

  if (payload.iss !== ISSUER) throw new Error('Invalid issuer')
  if (payload.exp < Math.floor(Date.now() / 1000)) throw new Error('JWT expired')

  return payload
}

export async function authMiddleware(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    return reply.code(401).send({ error: 'Missing or invalid Authorization header' })
  }

  try {
    const payload = verifyJwt(header.slice(7))
    ;(req as any).jwtPayload = payload
  } catch (err: any) {
    return reply.code(401).send({ error: err.message })
  }
}

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: { username: string; password: string } }>(
    '/auth/token',
    async (req, reply) => {
      const { username, password } = req.body ?? {}

      const adminUser = process.env.DASHBOARD_ADMIN_USER ?? 'admin'
      const adminPass = process.env.DASHBOARD_ADMIN_PASSWORD

      if (!adminPass) return reply.code(503).send({ error: 'Auth not configured' })
      if (username !== adminUser || password !== adminPass) {
        return reply.code(401).send({ error: 'Invalid credentials' })
      }

      const token = signJwt(username, 'operator')
      return reply.send({ token, expiresIn: 3600 })
    }
  )
}

import Fastify from 'fastify'
import fastifyWebSocket from '@fastify/websocket'
import fastifyCors from '@fastify/cors'
import { registerAuthRoutes } from './auth/jwt'
import { registerEventRoutes } from './routes/events'
import { registerDlqRoutes } from './routes/dlq'
import { registerMappingRoutes } from './routes/mapping'
import { registerMetricsRoutes } from './routes/metrics'
import { registerWebSocket } from './websocket/pg-notify'
import { checkConnection } from '@syncstock/core'

const PORT = parseInt(process.env.PORT ?? '4000', 10)

async function main(): Promise<void> {
  const app = Fastify({ logger: true })

  await app.register(fastifyCors, {
    origin: process.env.CORS_ORIGIN ?? false,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
  })

  await app.register(fastifyWebSocket)

  app.get('/health', async (_req, reply) => {
    const ok = await checkConnection()
    return reply.code(ok ? 200 : 503).send({ status: ok ? 'ok' : 'down', service: 'dashboard-api' })
  })

  await registerAuthRoutes(app)
  await registerEventRoutes(app)
  await registerDlqRoutes(app)
  await registerMappingRoutes(app)
  await registerMetricsRoutes(app)
  await registerWebSocket(app)

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[shutdown] ${signal}`)
    await app.close()
    process.exit(0)
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))

  await app.listen({ port: PORT, host: '0.0.0.0' })
  console.log(`[dashboard-api] listening on :${PORT}`)
}

main().catch((err) => {
  console.error('[startup] fatal', err)
  process.exit(1)
})

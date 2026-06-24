import { FastifyInstance } from 'fastify'
import { Client } from 'pg'
import { WebSocket } from 'ws'

const CHANNELS = ['syncstock_events', 'syncstock_dlq', 'syncstock_mappings']

interface NotifyMessage {
  channel: string
  payload: Record<string, unknown>
}

export async function registerWebSocket(app: FastifyInstance): Promise<void> {
  const clients = new Set<WebSocket>()

  // Dedicated pg client for LISTEN — must not be from the pool
  const pgListener = new Client({ connectionString: process.env.DATABASE_URL })
  await pgListener.connect()

  for (const channel of CHANNELS) {
    await pgListener.query(`LISTEN ${channel}`)
  }

  pgListener.on('notification', (msg) => {
    if (!msg.payload) return
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(msg.payload)
    } catch {
      return
    }

    const envelope: NotifyMessage = { channel: msg.channel, payload: parsed }
    const json = JSON.stringify(envelope)

    for (const ws of clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(json)
      }
    }
  })

  pgListener.on('error', (err) => {
    console.error('[pg-notify] listener error', err)
  })

  // @ts-ignore — fastify-websocket plugin adds this decorator
  app.get('/ws', { websocket: true }, (socket: WebSocket) => {
    clients.add(socket)

    socket.on('close', () => {
      clients.delete(socket)
    })

    socket.on('error', () => {
      clients.delete(socket)
    })

    // Send connection ack
    socket.send(JSON.stringify({ type: 'connected', channels: CHANNELS }))
  })

  app.addHook('onClose', async () => {
    await pgListener.end()
    for (const ws of clients) ws.close()
    clients.clear()
  })
}

import { Redis } from 'ioredis'
import { Queue, QueueOptions } from 'bullmq'

if (!process.env.REDIS_URL) {
  throw new Error('REDIS_URL env var is required')
}

export const redis = new Redis(process.env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  lazyConnect: true,
})

redis.on('error', (err) => {
  console.error('[redis] connection error', err)
})

const defaultQueueOpts: Partial<QueueOptions> = {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2_000 },
    removeOnComplete: { count: 1_000, age: 86_400 },
    removeOnFail: false,
  },
}

export const queues = {
  bling_in: new Queue('bling_in', defaultQueueOpts),
  bling_out: new Queue('bling_out', defaultQueueOpts),
  wms_in: new Queue('wms_in', defaultQueueOpts),
  wms_out: new Queue('wms_out', defaultQueueOpts),
}

export async function checkRedisConnection(): Promise<boolean> {
  try {
    await redis.ping()
    return true
  } catch {
    return false
  }
}

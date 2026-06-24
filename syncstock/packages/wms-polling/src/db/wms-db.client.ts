import { Pool, QueryResult, QueryResultRow } from 'pg'

if (!process.env.WMS_DB_URL) {
  throw new Error('WMS_DB_URL env var is required for legacy WMS polling')
}

// Separate pool targeting the legacy WMS database (read-only access is sufficient)
export const wmsPool = new Pool({
  connectionString: process.env.WMS_DB_URL,
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 8_000,
})

wmsPool.on('error', (err) => {
  console.error('[wms-db] idle client error', err)
})

export async function wmsQuery<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values?: unknown[]
): Promise<QueryResult<T>> {
  return wmsPool.query<T>(text, values)
}

export async function checkWmsDbConnection(): Promise<boolean> {
  try {
    await wmsPool.query('SELECT 1')
    return true
  } catch {
    return false
  }
}

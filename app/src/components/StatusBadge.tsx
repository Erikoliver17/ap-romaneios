import type { RomaneioStatus } from '../types'

const colors: Record<RomaneioStatus, string> = {
  Pendente:   '#f59e0b',
  Preenchido: '#3b82f6',
  Liberado:   '#10b981',
  Cancelado:  '#ef4444',
}

export default function StatusBadge({ status }: { status: RomaneioStatus }) {
  return (
    <span style={{
      background: colors[status] + '20',
      color: colors[status],
      border: `1px solid ${colors[status]}40`,
      padding: '2px 10px',
      borderRadius: 20,
      fontSize: 12,
      fontWeight: 600,
    }}>
      {status}
    </span>
  )
}

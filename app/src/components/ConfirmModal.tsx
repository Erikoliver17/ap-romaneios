import type { ReactNode } from 'react'

interface Props {
  open: boolean
  title: string
  message: ReactNode
  confirmLabel?: string
  variant?: 'danger' | 'success' | 'primary'
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmModal({ open, title, message, confirmLabel = 'Confirmar', variant = 'primary', onConfirm, onCancel }: Props) {
  if (!open) return null
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-box" onClick={e => e.stopPropagation()}>
        <h3 className="modal-title">{title}</h3>
        <div className="modal-msg">{message}</div>
        <div className="modal-actions">
          <button className="btn-secondary" onClick={onCancel}>Cancelar</button>
          <button className={`btn-${variant}`} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}

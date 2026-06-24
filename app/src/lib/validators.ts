// ── Formatação ────────────────────────────────────────────────

export function formatCNPJ(value: string): string {
  const d = value.replace(/\D/g, '').slice(0, 14)
  if (d.length <= 2) return d
  if (d.length <= 5) return `${d.slice(0,2)}.${d.slice(2)}`
  if (d.length <= 8) return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5)}`
  if (d.length <= 12) return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8)}`
  return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8,12)}-${d.slice(12)}`
}

export function formatCPF(value: string): string {
  const d = value.replace(/\D/g, '').slice(0, 11)
  if (d.length <= 3) return d
  if (d.length <= 6) return `${d.slice(0,3)}.${d.slice(3)}`
  if (d.length <= 9) return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6)}`
  return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6,9)}-${d.slice(9)}`
}

// ── Validação CNPJ ────────────────────────────────────────────

export function validateCNPJ(value: string): boolean {
  const cnpj = value.replace(/\D/g, '')
  if (cnpj.length !== 14) return false
  if (/^(\d)\1+$/.test(cnpj)) return false

  const calcDigit = (slice: string, weights: number[]) => {
    const sum = slice.split('').reduce((acc, d, i) => acc + parseInt(d) * weights[i], 0)
    const rem = sum % 11
    return rem < 2 ? 0 : 11 - rem
  }

  const d1 = calcDigit(cnpj.slice(0, 12), [5,4,3,2,9,8,7,6,5,4,3,2])
  const d2 = calcDigit(cnpj.slice(0, 13), [6,5,4,3,2,9,8,7,6,5,4,3,2])

  return parseInt(cnpj[12]) === d1 && parseInt(cnpj[13]) === d2
}

// ── Formatação e validação de Placa ───────────────────────────

export function formatPlaca(value: string): string {
  return value.replace(/[^A-Za-z0-9]/g, '').slice(0, 7).toUpperCase()
}

export function validatePlaca(value: string): boolean {
  const p = value.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
  return /^[A-Z]{3}[0-9]{4}$/.test(p) || /^[A-Z]{3}[0-9][A-Z][0-9]{2}$/.test(p)
}

// ── Formatação RG ─────────────────────────────────────────────

export function formatRG(value: string): string {
  const d = value.replace(/[^\dXx]/g, '').slice(0, 9)
  if (d.length <= 2) return d
  if (d.length <= 5) return `${d.slice(0,2)}.${d.slice(2)}`
  if (d.length <= 8) return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5)}`
  return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}-${d.slice(8)}`
}

// ── Validação CPF ─────────────────────────────────────────────

export function validateCPF(value: string): boolean {
  const cpf = value.replace(/\D/g, '')
  if (cpf.length !== 11) return false
  if (/^(\d)\1+$/.test(cpf)) return false

  const calcDigit = (slice: string, weights: number[]) => {
    const sum = slice.split('').reduce((acc, d, i) => acc + parseInt(d) * weights[i], 0)
    const rem = (sum * 10) % 11
    return rem >= 10 ? 0 : rem
  }

  const d1 = calcDigit(cpf.slice(0, 9), [10,9,8,7,6,5,4,3,2])
  const d2 = calcDigit(cpf.slice(0, 10), [11,10,9,8,7,6,5,4,3,2])

  return parseInt(cpf[9]) === d1 && parseInt(cpf[10]) === d2
}

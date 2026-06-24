// Utilitário central para extração e normalização de NF-e a partir da
// chave de acesso da DANFE (44 dígitos).
//
// Estrutura da chave (44 dígitos), agrupada em 11 blocos de 4 na DANFE:
//   bloco 1 (pos 1-4)   cUF + início AAMM
//   ...
//   bloco 7 (pos 25-28) série + início do nNF
//   bloco 8 (pos 29-32) ── últimos 3 dígitos = início do número da NF-e
//   bloco 9 (pos 33-36) ── 2 primeiros dígitos = fim do número da NF-e
//   ...
// O número da NF-e usado no WMS está nas POSIÇÕES 30 a 34 (1-indexed),
// ou seja: os 3 últimos dígitos do bloco 8 + os 2 primeiros do bloco 9.
// Em índice 0-based isso é substring(29, 34).

const POS_INICIO = 29 // índice 0-based da posição 30
const POS_FIM = 34    // índice 0-based exclusivo da posição 34

/** Extrai os 5 dígitos brutos (posições 30-34) de uma chave de 44 dígitos. */
export function extrairDigitosNfe(valor: string): string {
  const digits = String(valor ?? '').replace(/\D/g, '')
  if (digits.length === 44) return digits.substring(POS_INICIO, POS_FIM)
  return digits
}

/**
 * Normaliza qualquer entrada (chave de 44 dígitos, número com zeros à
 * esquerda, ou número simples) para a forma canônica usada para
 * comparação e consulta no WMS: número inteiro sem zeros à esquerda.
 *
 *   "35...6591565915..." (44 díg) → "65915"
 *   "065915"                       → "65915"
 *   "65915"                        → "65915"
 *   ""                             → ""
 */
export function normalizarNfe(valor: string): string {
  const bruto = extrairDigitosNfe(valor)
  if (!bruto) return ''
  const n = parseInt(bruto, 10)
  return Number.isNaN(n) ? bruto : String(n)
}

/** Compara dois valores de NF-e tolerando chave completa, zeros à esquerda e formatação. */
export function mesmaNfe(a: string, b: string): boolean {
  const na = normalizarNfe(a)
  return na !== '' && na === normalizarNfe(b)
}

/** Quebra a chave em partes para exibição com destaque do número da NF-e. */
export function analisarChave(
  valor: string,
): { tipo: 'chave'; antes: string; nfe: string; depois: string; numero: string } | { tipo: 'numero'; nfe: string } | null {
  const digits = String(valor ?? '').replace(/\D/g, '')
  if (!digits) return null
  if (digits.length === 44) {
    const nfe = digits.substring(POS_INICIO, POS_FIM)
    return {
      tipo: 'chave',
      antes: digits.substring(0, POS_INICIO),
      nfe,
      depois: digits.substring(POS_FIM),
      numero: normalizarNfe(digits),
    }
  }
  return { tipo: 'numero', nfe: digits }
}

/** True quando o valor já é uma chave de acesso completa (44 dígitos). */
export function ehChaveCompleta(valor: string): boolean {
  return String(valor ?? '').replace(/\D/g, '').length === 44
}

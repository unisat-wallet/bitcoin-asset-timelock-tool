import { Buffer } from 'buffer'

export const SATOSHIS_PER_FB = 100_000_000

export function fbToSatoshi(value: string): number {
  const trimmed = value.trim()
  if (!/^\d+(\.\d{0,8})?$/.test(trimmed)) {
    throw new Error('Enter an FB amount with at most 8 decimal places.')
  }
  const [wholeRaw, fractionRaw = ''] = trimmed.split('.')
  const whole = BigInt(wholeRaw || '0')
  const fraction = BigInt(fractionRaw.padEnd(8, '0'))
  const satoshi = whole * BigInt(SATOSHIS_PER_FB) + fraction
  if (satoshi <= 0n || satoshi > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('Invalid amount.')
  }
  return Number(satoshi)
}

export function satoshiToFb(satoshi: number | undefined | null): string {
  const raw = BigInt(Math.max(0, Math.trunc(satoshi || 0)))
  const whole = raw / BigInt(SATOSHIS_PER_FB)
  const fraction = String(raw % BigInt(SATOSHIS_PER_FB)).padStart(8, '0')
  return `${whole}.${fraction}`
}

export function shortAddress(value: string, head = 8, tail = 8): string {
  const clean = value.trim()
  if (!clean) return '-'
  if (clean.length <= head + tail + 3) return clean
  return `${clean.slice(0, head)}...${clean.slice(-tail)}`
}

export function copyText(value: string): Promise<void> {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(value)
  }

  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  textarea.style.pointerEvents = 'none'
  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()
  const ok = document.execCommand('copy')
  textarea.remove()
  return ok ? Promise.resolve() : Promise.reject(new Error('Copy failed.'))
}

export function base64ToHex(value: string): string {
  return Buffer.from(value, 'base64').toString('hex')
}

export function hexToBase64(value: string): string {
  return Buffer.from(value, 'hex').toString('base64')
}

export function isLikelyHex(value: string): boolean {
  const clean = value.trim()
  return clean.length > 0 && clean.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(clean)
}

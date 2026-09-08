import type { UnisatSignInput } from '../types'

function extractWalletError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string') return error
  if (error && typeof error === 'object') {
    const obj = error as Record<string, unknown>
    for (const key of ['message', 'msg', 'error', 'reason']) {
      const value = obj[key]
      if (typeof value === 'string' && value.trim()) return value
    }
  }
  return String(error)
}

function isPsbtHexRequiredError(error: unknown): boolean {
  const message = extractWalletError(error).toLowerCase()
  return message.includes('psbthex') && message.includes('required')
}

function unwrapSignedPsbt(result: unknown): string {
  if (typeof result === 'string' && result.trim()) return result.trim()
  if (result && typeof result === 'object') {
    const obj = result as Record<string, unknown>
    for (const key of ['psbt', 'base64', 'signedPsbt', 'psbtHex', 'hex']) {
      const value = obj[key]
      if (typeof value === 'string' && value.trim()) return value.trim()
    }
    const nested = obj.result
    if (typeof nested === 'string' && nested.trim()) return nested.trim()
    if (nested && typeof nested === 'object') {
      const nestedObj = nested as Record<string, unknown>
      for (const key of ['psbt', 'base64', 'signedPsbt', 'psbtHex', 'hex', 'data']) {
        const value = nestedObj[key]
        if (typeof value === 'string' && value.trim()) return value.trim()
      }
    }
  }
  throw new Error('The wallet returned an unsupported PSBT response.')
}

export async function signPsbtCompat(
  psbtHex: string,
  options?: { autoFinalized?: boolean; toSignInputs?: UnisatSignInput[] },
): Promise<string> {
  const signer = window.unisat?.signPsbt
  if (!signer) {
    throw new Error('The connected wallet does not support signPsbt.')
  }

  try {
    const result = await signer(psbtHex, options)
    return unwrapSignedPsbt(result)
  } catch (error) {
    if (!isPsbtHexRequiredError(error)) {
      throw error
    }

    const result = await (signer as unknown as (
      payload: { psbtHex: string; options?: { autoFinalized?: boolean; toSignInputs?: UnisatSignInput[] } },
    ) => Promise<unknown>)({
      psbtHex,
      options,
    })
    return unwrapSignedPsbt(result)
  }
}

export async function signPsbtsCompat(
  psbtHexs: string[],
  options: { autoFinalized?: boolean; toSignInputs?: UnisatSignInput[] }[],
): Promise<string[]> {
  if (psbtHexs.length !== options.length) {
    throw new Error('Each PSBT requires its own signing options.')
  }
  const batchSigner = window.unisat?.signPsbts
  if (!batchSigner) {
    const signed: string[] = []
    for (let index = 0; index < psbtHexs.length; index += 1) {
      signed.push(await signPsbtCompat(psbtHexs[index], options[index]))
    }
    return signed
  }

  const result = await batchSigner(psbtHexs, options)
  if (!Array.isArray(result) || result.length !== psbtHexs.length) {
    throw new Error('The wallet returned an invalid batch PSBT signing response.')
  }
  return result.map(unwrapSignedPsbt)
}

export async function pushSignedPsbt(psbt: string): Promise<string> {
  if (window.unisat?.pushPsbt) {
    return window.unisat.pushPsbt(psbt)
  }
  throw new Error('The connected wallet does not support pushPsbt broadcasting.')
}

import { getOpenApiBase } from './openapi'

type RecommendedFees = {
  fastestFee?: number
}

type Envelope = {
  code: number
  msg?: string
  data?: RecommendedFees
}

export async function getRecommendedFeeRate(chain = '', apiKey?: string): Promise<number> {
  const token = apiKey?.trim()
  if (!token) throw new Error('Enter a UniSat OpenAPI key to load the recommended fee rate.')
  const response = await fetch(`${getOpenApiBase(chain)}/fees/recommended`, {
    headers: { accept: 'application/json', Authorization: `Bearer ${token}` },
  })
  if (!response.ok) {
    throw new Error(`UniSat fee API HTTP ${response.status}`)
  }
  const envelope = await response.json() as Envelope
  if (envelope.code !== 0 || !envelope.data) {
    throw new Error(envelope.msg || `UniSat fee API error code=${envelope.code}`)
  }
  const feeRate = envelope.data.fastestFee
  if (!Number.isFinite(feeRate) || !Number.isInteger(feeRate) || (feeRate as number) < 1) {
    throw new Error('UniSat fee API returned an invalid fastest fee rate.')
  }
  return feeRate as number
}

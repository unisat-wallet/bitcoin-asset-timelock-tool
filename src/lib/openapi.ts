import { ChainType } from '../types'
import type { AddressBalance, OpenApiUtxo, RuneIndexerBalance, RuneIndexerEntry, RuneIndexerUtxo } from '../types'

const DEFAULT_OPENAPI_BASES: Record<ChainType, string> = {
  BITCOIN_MAINNET: 'https://open-api.unisat.io/v1/indexer',
  BITCOIN_TESTNET: 'https://open-api-testnet.unisat.io/v1/indexer',
  BITCOIN_TESTNET4: 'https://open-api-testnet4.unisat.io/v1/indexer',
  BITCOIN_SIGNET: 'https://open-api-signet.unisat.io/v1/indexer',
  FRACTAL_BITCOIN_MAINNET: 'https://open-api-fractal.unisat.io/v1/indexer',
  FRACTAL_BITCOIN_TESTNET: 'https://open-api-fractal-testnet.unisat.io/v1/indexer',
}

function normalizeChain(chain?: ChainType | string): ChainType {
  const value = String(chain || '') as ChainType
  return value in DEFAULT_OPENAPI_BASES ? value : ChainType.BITCOIN_MAINNET
}

export function getOpenApiBase(chain?: ChainType | string): string {
  const selected = normalizeChain(chain)
  const configuredByChain: Partial<Record<ChainType, string | undefined>> = {
    BITCOIN_MAINNET: (import.meta.env.VITE_BITCOIN_OPENAPI_BASE as string | undefined)?.trim(),
    BITCOIN_TESTNET: (import.meta.env.VITE_BITCOIN_TESTNET_OPENAPI_BASE as string | undefined)?.trim(),
    BITCOIN_TESTNET4: (import.meta.env.VITE_BITCOIN_TESTNET4_OPENAPI_BASE as string | undefined)?.trim(),
    BITCOIN_SIGNET: (import.meta.env.VITE_BITCOIN_SIGNET_OPENAPI_BASE as string | undefined)?.trim(),
    FRACTAL_BITCOIN_MAINNET: (import.meta.env.VITE_FRACTAL_OPENAPI_BASE as string | undefined)?.trim() || (import.meta.env.VITE_OPENAPI_BASE as string | undefined)?.trim(),
    FRACTAL_BITCOIN_TESTNET: (import.meta.env.VITE_FRACTAL_TESTNET_OPENAPI_BASE as string | undefined)?.trim(),
  }
  return (configuredByChain[selected] || DEFAULT_OPENAPI_BASES[selected]).replace(/\/+$/, '')
}

type Envelope<T> = {
  code: number
  msg?: string
  data: T
}

function buildHeaders(apiKey?: string): HeadersInit {
  const headers: Record<string, string> = { accept: 'application/json' }
  const token = apiKey?.trim()
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }
  return headers
}

async function requestOpenApi<T>(path: string, apiKey?: string, chain?: ChainType | string): Promise<T> {
  const response = await fetch(`${getOpenApiBase(chain)}${path}`, {
    headers: buildHeaders(apiKey),
  })
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`OpenAPI HTTP ${response.status}: ${text || response.statusText}`)
  }

  let json: Envelope<T>
  try {
    json = JSON.parse(text) as Envelope<T>
  } catch {
    throw new Error(`OpenAPI returned non-JSON data: ${text.slice(0, 160)}`)
  }

  if (json.code !== 0) {
    throw new Error(json.msg || `OpenAPI error code=${json.code}`)
  }
  return json.data
}

export async function getAddressBalance(address: string, apiKey?: string, chain?: ChainType | string): Promise<AddressBalance> {
  return requestOpenApi<AddressBalance>(`/address/${encodeURIComponent(address)}/balance`, apiKey, chain)
}

export async function getAvailableUtxos(address: string, apiKey?: string, size = 500, chain?: ChainType | string): Promise<OpenApiUtxo[]> {
  const data = await requestOpenApi<{ utxo?: OpenApiUtxo[] }>(
    `/address/${encodeURIComponent(address)}/available-utxo-data?cursor=0&size=${size}`,
    apiKey, chain,
  )
  return Array.isArray(data.utxo) ? data.utxo : []
}

export async function getBlockchainHeight(apiKey?: string, chain?: ChainType | string): Promise<number> {
  const data = await requestOpenApi<{ blocks?: number; height?: number }>('/blockchain/info', apiKey, chain)
  const height = data.blocks ?? data.height
  if (!Number.isInteger(height) || (height as number) < 0) {
    throw new Error('OpenAPI returned an invalid blockchain height.')
  }
  return height as number
}

export async function getRuneMetadata(reference: string, apiKey?: string, chain?: ChainType | string): Promise<RuneIndexerEntry> {
  const query = reference.trim()
  if (!query) throw new Error('Enter a Rune name or Rune ID.')
  if (/^\d+:\d+$/.test(query)) {
    return requestOpenApi<RuneIndexerEntry>(`/runes/${encodeURIComponent(query)}/info`, apiKey, chain)
  }
  const data = await requestOpenApi<{ detail?: RuneIndexerEntry[] }>(`/runes/info-list?rune=${encodeURIComponent(query)}&start=0&limit=20`, apiKey, chain)
  const entry = data.detail?.find((item) => item.rune === query || item.spacedRune === query)
  if (!entry) throw new Error(`No exact Rune named “${query}” was found on the connected network.`)
  return entry
}

export async function getAddressRuneUtxos(address: string, runeId: string, apiKey?: string, chain?: ChainType | string): Promise<RuneIndexerUtxo[]> {
  const data = await requestOpenApi<{ utxo?: RuneIndexerUtxo[] }>(
    `/address/${encodeURIComponent(address)}/runes/${encodeURIComponent(runeId)}/utxo?start=0&limit=500`,
    apiKey,
    chain,
  )
  return Array.isArray(data.utxo) ? data.utxo : []
}

export async function getRuneUtxoBalances(txid: string, vout: number, apiKey?: string, chain?: ChainType | string): Promise<RuneIndexerBalance[]> {
  return requestOpenApi<RuneIndexerBalance[]>(`/runes/utxo/${encodeURIComponent(txid)}/${vout}/balance`, apiKey, chain)
}

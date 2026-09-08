import { ChainType } from '../types'

export const CHAIN_OPTIONS: Array<{ value: ChainType; label: string }> = [
  { value: ChainType.BITCOIN_MAINNET, label: 'Bitcoin Mainnet' },
  { value: ChainType.BITCOIN_TESTNET4, label: 'Bitcoin Testnet4' },
  { value: ChainType.BITCOIN_SIGNET, label: 'Bitcoin Signet' },
  { value: ChainType.FRACTAL_BITCOIN_MAINNET, label: 'Fractal Mainnet' },
  { value: ChainType.FRACTAL_BITCOIN_TESTNET, label: 'Fractal Testnet' },
]

export function isFractalChain(chain?: ChainType | string): boolean {
  return String(chain || '').includes('FRACTAL')
}

export function isMainnetChain(chain?: ChainType | string): boolean {
  return String(chain || '') === 'BITCOIN_MAINNET' || String(chain || '') === 'FRACTAL_BITCOIN_MAINNET'
}

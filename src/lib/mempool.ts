const MEMPOOL_BASES: Record<string, string> = {
  BITCOIN_MAINNET: 'https://mempool.space/api',
  BITCOIN_TESTNET: 'https://mempool.space/testnet/api',
  // Testnet4 and Signet do not expose a compatible public fee endpoint here;
  // callers fall back to the configurable 1 sat/vB default when unavailable.
  BITCOIN_TESTNET4: 'https://mempool.space/testnet4/api',
  BITCOIN_SIGNET: 'https://mempool.space/signet/api',
  FRACTAL_BITCOIN_MAINNET: 'https://mempool.fractalbitcoin.io/api',
  FRACTAL_BITCOIN_TESTNET: 'https://mempool-testnet.fractalbitcoin.io/api',
}

type RecommendedFees = {
  fastestFee?: number
}

export async function getRecommendedFeeRate(chain = ''): Promise<number> {
  const base = MEMPOOL_BASES[chain] || MEMPOOL_BASES.BITCOIN_MAINNET
  const response = await fetch(`${base}/fees/recommended`)
  if (!response.ok) {
    throw new Error(`Mempool fee API HTTP ${response.status}`)
  }
  const data = await response.json() as RecommendedFees
  const feeRate = data.fastestFee
  if (!Number.isFinite(feeRate) || !Number.isInteger(feeRate) || (feeRate as number) < 1) {
    throw new Error('Mempool fee API returned an invalid fastest fee rate.')
  }
  return feeRate as number
}

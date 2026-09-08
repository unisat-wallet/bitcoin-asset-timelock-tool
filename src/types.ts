export enum ChainType {
  BITCOIN_MAINNET = 'BITCOIN_MAINNET',
  BITCOIN_TESTNET = 'BITCOIN_TESTNET',
  BITCOIN_TESTNET4 = 'BITCOIN_TESTNET4',
  BITCOIN_SIGNET = 'BITCOIN_SIGNET',
  FRACTAL_BITCOIN_MAINNET = 'FRACTAL_BITCOIN_MAINNET',
  FRACTAL_BITCOIN_TESTNET = 'FRACTAL_BITCOIN_TESTNET',
}

export type UnisatSignInput = {
  index: number
  address?: string
  publicKey?: string
  sighashTypes?: number[]
  disableTweakSigner?: boolean
}

export type UnisatWallet = {
  getAccounts: () => Promise<string[]>
  requestAccounts: () => Promise<string[]>
  getPublicKey: () => Promise<string>
  getChain?: () => Promise<{ enum: ChainType; name: string; network: string }>
  switchChain?: (chain: ChainType) => Promise<void>
  signPsbt: (psbtHex: string, options?: { autoFinalized?: boolean; toSignInputs?: UnisatSignInput[] }) => Promise<string | Record<string, unknown>>
  signPsbts?: (
    psbtHexs: string[],
    options?: { autoFinalized?: boolean; toSignInputs?: UnisatSignInput[] }[],
  ) => Promise<(string | Record<string, unknown>)[]>
  pushPsbt?: (psbtHex: string) => Promise<string>
  pushTx?: (txHex: string) => Promise<string>
  disconnect?: () => Promise<void>
  on?: (event: string, handler: (...args: unknown[]) => void) => void
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void
}

declare global {
  interface Window {
    unisat?: UnisatWallet
    Buffer?: typeof Buffer
  }
}

export type OpenApiUtxo = {
  address?: string
  height?: number
  idx?: number
  satoshi: number
  scriptPk: string
  scriptType?: string
  txid: string
  vout: number
  isLowFee?: boolean
  isSpent?: boolean
  isSpending?: boolean
}

export type RuneIndexerEntry = {
  runeid: string
  rune: string
  spacedRune?: string
  divisibility?: number
  symbol?: string
}

export type RuneIndexerBalance = {
  amount: string
  runeid: string
  rune?: string
  spacedRune?: string
  symbol?: string
  divisibility?: number
}

export type RuneIndexerUtxo = {
  address: string
  satoshi: number
  scriptPk: string
  txid: string
  vout: number
  runes: RuneIndexerBalance[]
}

export type AssetKind = 'brc20' | 'runes'

/**
 * BATL v1, wire-compatible subset of inscribe-lib SingleStepTransferAddressType.
 * Values retain compressed-key parity needed to restore a P2WPKH address.
 */
export enum OwnerAddressType {
  P2TR = 81,
  P2WPKH_EVEN = 82,
  P2WPKH_ODD = 83,
}

export type AddressBalance = {
  address: string
  satoshi: number
  pendingSatoshi: number
  utxoCount: number
  btcSatoshi?: number
  btcPendingSatoshi?: number
  btcUtxoCount?: number
}

export type ToSignInput = {
  index: number
  publicKey?: string
  useTweakedSigner?: boolean
}

export type BuiltTxOutputType =
  | 'runestone'
  | 'timelock_metadata'
  | 'rune_change'
  | 'timelock_transfer'
  | 'timelock_fee_change'
  | 'timelock_commit'
  | 'timelock_commit_change'
  | 'timelock_reveal_change'
  | 'unlock_transfer'
  | 'unlock_fee_change'

export type BuiltTxOutput = {
  type: BuiltTxOutputType
  address?: string
  satoshi: number
  scriptHex: string
}

export type ResultState =
  | { status: 'idle' }
  | { status: 'success'; txid: string; label: string }
  | { status: 'timelock_success'; commitTxid: string; revealTxid: string; timeLockAddress: string }
  | { status: 'error'; message: string }

/** BIP-68 block-based relative lock value (nSequence low 16 bits). */
export type TimeLockBlocks = number

export type TimeLockRecord = {
  id: string
  ownerAddress: string
  chain?: ChainType | string
  assetKind?: AssetKind
  ticker: string
  amount: string
  runeId?: string
  runeName?: string
  lockBlocks: TimeLockBlocks
  timeLockAddress: string
  createdAt: string
  commitTxid: string
  revealTxid: string
  initialCommitTxid?: string
  initialRevealTxid?: string
  transferToLockTxid?: string
  lockCommitTxid?: string
  lockRevealTxid?: string
  inscriptionTxid: string
  inscriptionVout: number
  inscriptionSatoshi: number
  status: 'locked' | 'unlocked'
  unlockTxid?: string
}

export type BuiltTimeLockUnlockTx = {
  kind: 'timelock_unlock'
  psbtHex: string
  toSignInputs: ToSignInput[]
  inscriptionInput: OpenApiUtxo
  feeInputs: OpenApiUtxo[]
  outputs: BuiltTxOutput[]
  estimatedFee: number
}

export type BuiltTimeLockDepositStep = {
  label: string
  txid: string
  psbtHex: string
  toSignInputs: ToSignInput[]
  outputs: BuiltTxOutput[]
  estimatedFee: number
}

export type BuiltTimeLockDepositTx = {
  kind: 'timelock_deposit'
  timeLockAddress: string
  inscriptionSatoshi: number
  transferContent: string
  fundingSatoshi: number
  firstTxChangeSatoshi: number
  totalEstimatedFee: number
  steps: BuiltTimeLockDepositStep[]
}

export type BuiltRuneTimeLockDepositTx = {
  kind: 'rune_timelock_deposit'
  timeLockAddress: string
  runeId: string
  runeName: string
  runeAmount: string
  sourceOutpoints: string[]
  psbtHex: string
  toSignInputs: ToSignInput[]
  inputs: OpenApiUtxo[]
  outputs: BuiltTxOutput[]
  estimatedFee: number
}

export type BuiltTimeLockTx = BuiltTimeLockUnlockTx | BuiltTimeLockDepositTx | BuiltRuneTimeLockDepositTx

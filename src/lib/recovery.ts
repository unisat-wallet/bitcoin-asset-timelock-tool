import { bitcoin, toPsbtNetwork } from '@unisat/wallet-bitcoin'
import { NetworkType } from '@unisat/wallet-types'
import { Buffer } from 'buffer'
import { OwnerAddressType } from '../types'
import type { ChainType, TimeLockBlocks } from '../types'

const MAGIC = 'BATL'
const VERSION = 1
const RUNESTONE_NOP_TAG = 127n
const RUNESTONE_MAGIC = BigInt('0x4241544c')

function isValidRelativeBlockLock(blocks: number): blocks is TimeLockBlocks {
  return Number.isInteger(blocks) && blocks >= 1 && blocks <= 0xffff
}

function networkForChain(chain?: ChainType | string) {
  const value = String(chain || '')
  return value === 'BITCOIN_MAINNET' || value === 'FRACTAL_BITCOIN_MAINNET' || !value
    ? toPsbtNetwork(NetworkType.MAINNET)
    : toPsbtNetwork(NetworkType.TESTNET)
}

function decodeSmallInteger(chunk: Buffer | number): number | undefined {
  if (typeof chunk === 'number') {
    if (chunk === bitcoin.opcodes.OP_0) return 0
    if (chunk >= bitcoin.opcodes.OP_1 && chunk <= bitcoin.opcodes.OP_16) return chunk - bitcoin.opcodes.OP_1 + 1
    return undefined
  }
  return chunk.length === 1 ? chunk[0] : undefined
}

function isOwnerAddressType(value: number): value is OwnerAddressType {
  return value === OwnerAddressType.P2WPKH_EVEN || value === OwnerAddressType.P2WPKH_ODD || value === OwnerAddressType.P2TR
}

export type TimeLockMetadata = {
  version: number
  lockBlocks: TimeLockBlocks
  xOnlyPubKey: string
  ownerAddressType: OwnerAddressType
}

/**
 * Returns the compact BATL v1 owner address descriptor. P2WPKH needs the
 * compressed public-key parity because an x-only key intentionally omits it.
 */
export function getOwnerAddressType(address: string, publicKey: string): OwnerAddressType {
  const normalizedAddress = address.trim().toLowerCase()
  const normalizedPubKey = publicKey.trim().replace(/^0x/i, '').toLowerCase()
  if (!/^(02|03)[0-9a-f]{64}$/.test(normalizedPubKey)) throw new Error('A compressed public key is required for BATL owner address metadata.')
  if (normalizedAddress.startsWith('bc1q') || normalizedAddress.startsWith('tb1q')) {
    return normalizedPubKey.startsWith('02') ? OwnerAddressType.P2WPKH_EVEN : OwnerAddressType.P2WPKH_ODD
  }
  if (normalizedAddress.startsWith('bc1p') || normalizedAddress.startsWith('tb1p')) return OwnerAddressType.P2TR
  throw new Error('BATL v1 supports only P2WPKH and BIP86 P2TR owner addresses.')
}

/** Reconstructs the owner address for an indexed BATL v1 marker. */
export function deriveOwnerAddress(metadata: TimeLockMetadata, chain?: ChainType | string): string | undefined {
  const xOnly = Buffer.from(metadata.xOnlyPubKey, 'hex')
  if (xOnly.length !== 32) return undefined
  const network = networkForChain(chain)
  if (metadata.ownerAddressType === OwnerAddressType.P2TR) {
    return bitcoin.payments.p2tr({ internalPubkey: xOnly, network }).address
  }
  const prefix = metadata.ownerAddressType === OwnerAddressType.P2WPKH_EVEN ? 0x02 : 0x03
  return bitcoin.payments.p2wpkh({ pubkey: Buffer.concat([Buffer.from([prefix]), xOnly]), network }).address
}

/** Public, zero-satoshi BATL v1 marker for BRC-20 lock/reveal transactions. */
export function buildTimeLockMetadataScript(metadata: TimeLockMetadata): Buffer {
  const pubKey = Buffer.from(metadata.xOnlyPubKey, 'hex')
  if (pubKey.length !== 32 || !isOwnerAddressType(metadata.ownerAddressType)) throw new Error('BATL v1 requires a 32-byte x-only key and owner address type.')
  if (!isValidRelativeBlockLock(metadata.lockBlocks)) throw new Error('BATL recovery metadata requires a relative block lock from 1 to 65535.')
  return Buffer.from(bitcoin.script.compile([
    bitcoin.opcodes.OP_RETURN,
    Buffer.from(MAGIC, 'ascii'),
    Buffer.from([VERSION]),
    Buffer.from([metadata.lockBlocks >> 8, metadata.lockBlocks & 0xff]),
    pubKey,
    Buffer.from([metadata.ownerAddressType]),
  ]))
}

export function decodeTimeLockMetadataScript(script: Buffer | string): TimeLockMetadata | undefined {
  const source = typeof script === 'string' ? Buffer.from(script, 'hex') : script
  const chunks = bitcoin.script.decompile(source)
  if (!chunks || chunks[0] !== bitcoin.opcodes.OP_RETURN) return undefined
  if (chunks.length !== 6) return undefined
  const [magic, version, blocks, pubKey, addressType] = chunks.slice(1)
  const versionValue = version && decodeSmallInteger(version)
  const addressTypeValue = addressType && decodeSmallInteger(addressType)
  if (!Buffer.isBuffer(magic) || !Buffer.isBuffer(blocks) || !Buffer.isBuffer(pubKey) || magic.toString('ascii') !== MAGIC || versionValue !== VERSION || blocks.length !== 2 || pubKey.length !== 32 || addressTypeValue === undefined || !isOwnerAddressType(addressTypeValue)) return undefined
  const lockBlocks = (blocks[0] << 8) | blocks[1]
  return isValidRelativeBlockLock(lockBlocks) ? { version: VERSION, lockBlocks, xOnlyPubKey: pubKey.toString('hex'), ownerAddressType: addressTypeValue } : undefined
}

/** Runes retain one OP_RETURN, so BATL is carried in ignored Nop (127) fields before Tag.Body. */
export function encodeRunestoneRecoveryMetadata(metadata: TimeLockMetadata): bigint[] {
  const pubKey = Buffer.from(metadata.xOnlyPubKey, 'hex')
  if (pubKey.length !== 32 || !isOwnerAddressType(metadata.ownerAddressType) || !isValidRelativeBlockLock(metadata.lockBlocks)) throw new Error('Invalid BATL v1 Runestone recovery metadata.')
  return [
    RUNESTONE_NOP_TAG, RUNESTONE_MAGIC,
    RUNESTONE_NOP_TAG, BigInt(VERSION),
    RUNESTONE_NOP_TAG, BigInt(metadata.lockBlocks),
    // Runestone integers are u128. Store the 32-byte x-only key as two
    // unsigned 128-bit big-endian halves rather than one 256-bit integer.
    RUNESTONE_NOP_TAG, BigInt(`0x${pubKey.subarray(0, 16).toString('hex')}`),
    RUNESTONE_NOP_TAG, BigInt(`0x${pubKey.subarray(16).toString('hex')}`),
    RUNESTONE_NOP_TAG, BigInt(metadata.ownerAddressType),
  ]
}

export function decodeRunestoneRecoveryMetadata(values: bigint[]): TimeLockMetadata | undefined {
  for (let index = 0; index + 7 < values.length; index += 2) {
    if (values[index] !== RUNESTONE_NOP_TAG || values[index + 1] !== RUNESTONE_MAGIC) continue
    const version = values[index + 3]
    const blocks = values[index + 5]
    if (values[index + 2] !== RUNESTONE_NOP_TAG || values[index + 4] !== RUNESTONE_NOP_TAG || !isValidRelativeBlockLock(Number(blocks))) continue
    if (version === BigInt(VERSION) && index + 11 < values.length && values[index + 6] === RUNESTONE_NOP_TAG && values[index + 8] === RUNESTONE_NOP_TAG && values[index + 10] === RUNESTONE_NOP_TAG) {
      const high = values[index + 7].toString(16).padStart(32, '0')
      const low = values[index + 9].toString(16).padStart(32, '0')
      const addressType = Number(values[index + 11])
      const hex = `${high}${low}`
      if (isOwnerAddressType(addressType) && hex.length === 64) return { version: VERSION, lockBlocks: Number(blocks), xOnlyPubKey: hex, ownerAddressType: addressType }
    }
  }
  return undefined
}

export function decodeRunestoneRecoveryMetadataScript(script: Buffer | string): TimeLockMetadata | undefined {
  const source = typeof script === 'string' ? Buffer.from(script, 'hex') : script
  const chunks = bitcoin.script.decompile(source)
  if (!chunks || chunks.length < 3 || chunks[0] !== bitcoin.opcodes.OP_RETURN || chunks[1] !== bitcoin.opcodes.OP_13) return undefined
  const payloadChunks = chunks.slice(2)
  if (!payloadChunks.every(Buffer.isBuffer)) return undefined
  const payload = Buffer.concat(payloadChunks as Buffer[])
  const values: bigint[] = []
  for (let index = 0; index < payload.length;) {
    let value = 0n
    let shift = 0n
    let completed = false
    while (index < payload.length) {
      const byte = payload[index++]
      value |= BigInt(byte & 0x7f) << shift
      if ((byte & 0x80) === 0) { completed = true; break }
      shift += 7n
      if (shift > 280n) return undefined
    }
    if (!completed) return undefined
    values.push(value)
  }
  return decodeRunestoneRecoveryMetadata(values)
}

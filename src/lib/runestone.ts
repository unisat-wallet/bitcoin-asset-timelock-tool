import { bitcoin } from '@unisat/wallet-bitcoin'
import { Buffer } from 'buffer'
import { encodeRunestoneRecoveryMetadata, type TimeLockMetadata } from './recovery'

/** Minimal canonical Runestone encoder for a single Rune edict.
 * The layout follows alkanes-lib's Runestone.encipher():
 * OP_RETURN OP_13 <LEB128(tag body, block delta, tx delta, amount, output)>.
 */
function encodeVarint(value: bigint): number[] {
  if (value < 0n) throw new Error('Runestone values cannot be negative.')
  const bytes: number[] = []
  let next = value
  do {
    let byte = Number(next & 0x7fn)
    next >>= 7n
    if (next > 0n) byte |= 0x80
    bytes.push(byte)
  } while (next > 0n)
  return bytes
}

export function parseRuneId(value: string): { block: bigint; tx: bigint } {
  const match = value.trim().match(/^(\d+):(\d+)$/)
  if (!match) throw new Error('Rune ID must use the format block:transaction-index, for example 840000:1.')
  const block = BigInt(match[1])
  const tx = BigInt(match[2])
  if (block > 0xffff_ffffn || tx > 0xffff_ffffn) throw new Error('Rune ID is outside the supported range.')
  return { block, tx }
}

export function buildRuneTransferRunestone(params: {
  runeId: string
  amount: string
  destinationOutput: number
  pointerOutput?: number
  recoveryMetadata?: TimeLockMetadata
}): Buffer {
  if (!/^\d+$/.test(params.amount.trim()) || BigInt(params.amount.trim()) <= 0n) {
    throw new Error('Rune amount must be a positive integer in base units.')
  }
  if (!Number.isInteger(params.destinationOutput) || params.destinationOutput < 0) throw new Error('Invalid Rune destination output.')
  if (params.pointerOutput !== undefined && (!Number.isInteger(params.pointerOutput) || params.pointerOutput < 0)) throw new Error('Invalid Rune pointer output.')
  const id = parseRuneId(params.runeId)
  const payload = [
    ...(params.recoveryMetadata ? encodeRunestoneRecoveryMetadata(params.recoveryMetadata) : []),
    ...(params.pointerOutput === undefined ? [] : [22n, BigInt(params.pointerOutput)]), // Tag.Pointer — fields must come before Tag.Body
    0n, // Tag.Body
    id.block,
    id.tx,
    BigInt(params.amount.trim()),
    BigInt(params.destinationOutput),
  ].flatMap(encodeVarint)

  // Runestone payloads are pushed in chunks no greater than 520 bytes.
  const chunks: Buffer[] = []
  for (let offset = 0; offset < payload.length; offset += 520) chunks.push(Buffer.from(payload.slice(offset, offset + 520)))
  return Buffer.from(bitcoin.script.compile([bitcoin.opcodes.OP_RETURN, bitcoin.opcodes.OP_13, ...chunks]))
}

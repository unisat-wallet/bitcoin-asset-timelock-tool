import { bitcoin, toPsbtNetwork, toXOnly } from '@unisat/wallet-bitcoin'
import { NetworkType } from '@unisat/wallet-types'
import { Buffer } from 'buffer'
import type { BuiltTimeLockDepositTx, BuiltTimeLockUnlockTx, BuiltTxOutput, ChainType, OpenApiUtxo, TimeLockBlocks, ToSignInput } from '../types'
import { buildRuneTransferRunestone, parseRuneId } from './runestone'
import type { BuiltRuneTimeLockDepositTx } from '../types'
import { buildTimeLockMetadataScript, getOwnerAddressType } from './recovery'

const TAPLEAF_VERSION = 0xc0
const INSCRIPTION_SATOSHI = 546
const RUNE_DUST_SATOSHI = 330
const DUST_THRESHOLD = 546
// Retained for a legacy, unused builder below. Current deposit construction
// estimates script-path witnesses with the serialized dummy transaction.
const REVEAL_FEE_BUFFER_VBYTES = 100
const REVEAL_FEE_BUFFER_MIN = 350
// BIP341 NUMS internal key: no corresponding known private key. BATL outputs
// therefore cannot be spent through Taproot key path and must use the CSV leaf.
const INTERNAL_KEY = Buffer.from(
  '50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0',
  'hex',
)

type OutputSpec = {
  type: BuiltTxOutput['type']
  address?: string
  satoshi: number
  script: Buffer
}

type TapPayment = {
  address: string
  output: Buffer
  tapLeafScript: { leafVersion: number; script: Buffer; controlBlock: Buffer }[]
}

function cleanPubKey(pubKey: string): Buffer {
  const value = pubKey.trim().replace(/^0x/i, '')
  const key = Buffer.from(value, 'hex')
  if (key.length === 33) return key
  if (key.length === 32) return Buffer.concat([Buffer.from([0x02]), key])
  throw new Error('A compressed 33-byte public key is required.')
}

function isSpendable(utxo: OpenApiUtxo): boolean {
  return !utxo.isSpent && !utxo.isSpending && utxo.satoshi > 0 && !!utxo.txid && !!utxo.scriptPk
}

function decodeScript(scriptPk: string): Buffer {
  const value = scriptPk.trim().replace(/^0x/i, '')
  return /^[0-9a-fA-F]+$/.test(value) && value.length % 2 === 0
    ? Buffer.from(value, 'hex')
    : Buffer.from(scriptPk.trim(), 'base64')
}

function networkForChain(chain?: ChainType | string) {
  const value = String(chain || '')
  return value === 'BITCOIN_MAINNET' || value === 'FRACTAL_BITCOIN_MAINNET' || !value
    ? toPsbtNetwork(NetworkType.MAINNET)
    : toPsbtNetwork(NetworkType.TESTNET)
}

// Legacy internal helpers that are not used by the current deposit flow default
// to mainnet. All exported builders receive and use their explicit chain.
const NETWORK = networkForChain()

function scriptForAddress(address: string, chain?: ChainType | string): Buffer {
  return Buffer.from(bitcoin.address.toOutputScript(address.trim(), networkForChain(chain)))
}

function outputRows(outputs: OutputSpec[]): BuiltTxOutput[] {
  return outputs.map((output) => ({
    type: output.type,
    address: output.address,
    satoshi: output.satoshi,
    scriptHex: output.script.toString('hex'),
  }))
}

type DummyFeeInput =
  | { kind: 'wallet'; utxo: OpenApiUtxo }
  | { kind: 'taproot_script_path'; payment: TapPayment }

function isTaprootScript(script: Buffer): boolean {
  return script.length === 34 && script.subarray(0, 2).toString('hex') === '5120'
}

function isWitnessPubKeyHashScript(script: Buffer): boolean {
  return script.length === 22 && script.subarray(0, 2).toString('hex') === '0014'
}

function dummyWalletWitness(utxo: OpenApiUtxo): Buffer[] {
  const script = decodeScript(utxo.scriptPk)
  if (isTaprootScript(script)) {
    // UniSat signs these inputs with SIGHASH_DEFAULT, so the Schnorr signature
    // occupies exactly 64 bytes in the final witness.
    return [Buffer.alloc(64)]
  }
  if (isWitnessPubKeyHashScript(script)) {
    // DER-encoded ECDSA signatures vary by up to two bytes. Reserve the
    // standard maximum (72-byte DER + 1-byte sighash) so fees never fall short.
    return [Buffer.alloc(73), Buffer.alloc(33)]
  }
  throw new Error('Only P2TR and native P2WPKH wallet inputs are supported.')
}

function estimateVSize(inputs: DummyFeeInput[], outputs: OutputSpec[]): number {
  const tx = new bitcoin.Transaction()
  tx.version = 2
  inputs.forEach((input, index) => {
    tx.addInput(Buffer.alloc(32), index)
    if (input.kind === 'taproot_script_path') {
      const leaf = input.payment.tapLeafScript[0]
      tx.setWitness(index, [Buffer.alloc(64), leaf.script, leaf.controlBlock])
    } else {
      tx.setWitness(index, dummyWalletWitness(input.utxo))
    }
  })
  outputs.forEach((output) => tx.addOutput(output.script, output.satoshi))
  return tx.virtualSize()
}

function estimateFeeForInputs(inputs: DummyFeeInput[], outputs: OutputSpec[], feeRate: number): number {
  return Math.ceil(estimateVSize(inputs, outputs) * Math.max(1, feeRate))
}

function estimateFee(inputs: OpenApiUtxo[], outputs: OutputSpec[], feeRate: number): number {
  return estimateFeeForInputs(inputs.map((utxo) => ({ kind: 'wallet', utxo })), outputs, feeRate)
}

function estimateTaprootScriptPathFee(payment: TapPayment, outputs: OutputSpec[], feeRate: number): number {
  return estimateFeeForInputs([{ kind: 'taproot_script_path', payment }], outputs, feeRate)
}

function makeTapPayment(script: Buffer, chain?: ChainType | string): TapPayment {
  const redeem = { output: script, redeemVersion: TAPLEAF_VERSION }
  const payment = bitcoin.payments.p2tr({
    internalPubkey: INTERNAL_KEY,
    scriptTree: { output: script, version: TAPLEAF_VERSION },
    redeem,
    network: networkForChain(chain),
  })
  if (!payment.address || !payment.output || !payment.witness?.length) {
    throw new Error('Failed to derive the Taproot time-lock address.')
  }
  return {
    address: payment.address,
    output: Buffer.from(payment.output),
    tapLeafScript: [{
      leafVersion: TAPLEAF_VERSION,
      script,
      controlBlock: payment.witness[payment.witness.length - 1],
    }],
  }
}

function buildTimeLockPayment(pubKey: string, lockBlocks: TimeLockBlocks, chain?: ChainType | string): TapPayment {
  if (!Number.isInteger(lockBlocks) || lockBlocks < 1 || lockBlocks > 0xffff) {
    throw new Error('Relative block time lock must be an integer from 1 to 65535.')
  }
  const script = bitcoin.script.compile([
    lockBlocks <= 16 ? bitcoin.opcodes.OP_1 + lockBlocks - 1 : bitcoin.script.number.encode(lockBlocks),
    bitcoin.opcodes.OP_CHECKSEQUENCEVERIFY,
    bitcoin.opcodes.OP_DROP,
    toXOnly(cleanPubKey(pubKey)),
    bitcoin.opcodes.OP_CHECKSIG,
  ])
  return makeTapPayment(script, chain)
}

function buildRecoveryMetadataOutput(pubKey: string, ownerAddress: string, lockBlocks: TimeLockBlocks): OutputSpec {
  return {
    type: 'timelock_metadata',
    satoshi: 0,
    script: buildTimeLockMetadataScript({
      version: 1,
      lockBlocks,
      xOnlyPubKey: toXOnly(cleanPubKey(pubKey)).toString('hex'),
      ownerAddressType: getOwnerAddressType(ownerAddress, pubKey),
    }),
  }
}

function buildInscriptionPayment(pubKey: string, content: string, chain?: ChainType | string): TapPayment {
  const script = bitcoin.script.compile([
    toXOnly(cleanPubKey(pubKey)),
    bitcoin.opcodes.OP_CHECKSIG,
    bitcoin.opcodes.OP_FALSE,
    bitcoin.opcodes.OP_IF,
    Buffer.from('ord'),
    Buffer.from([1]),
    Buffer.from('text/plain;charset=utf-8'),
    Buffer.alloc(0),
    Buffer.from(content, 'utf8'),
    bitcoin.opcodes.OP_ENDIF,
  ])
  return makeTapPayment(script, chain)
}

function toSignInputs(inputs: OpenApiUtxo[], pubKey: string, scriptPathInputCount = 0): ToSignInput[] {
  const compressed = cleanPubKey(pubKey).toString('hex')
  return inputs.map((input, index) => ({
    index,
    publicKey: compressed,
    useTweakedSigner: index >= scriptPathInputCount && (
      (input.scriptType || '').toUpperCase().includes('P2TR') ||
      decodeScript(input.scriptPk).subarray(0, 2).toString('hex') === '5120'
    ),
  }))
}

function addWalletInputs(psbt: bitcoin.Psbt, inputs: OpenApiUtxo[]) {
  inputs.forEach((utxo) => {
    psbt.addInput({
      hash: utxo.txid,
      index: utxo.vout,
      witnessUtxo: { value: utxo.satoshi, script: decodeScript(utxo.scriptPk) },
    })
  })
}

function addOutputs(psbt: bitcoin.Psbt, outputs: OutputSpec[]) {
  outputs.forEach((output) => psbt.addOutput({ script: output.script, value: output.satoshi }))
}

function selectFunding(params: {
  utxos: OpenApiUtxo[]
  requiredInputs?: OpenApiUtxo[]
  extraFeeInputs?: DummyFeeInput[]
  spend: number
  baseOutputs: OutputSpec[]
  changeAddress: string
  changeType: OutputSpec['type']
  feeRate: number
  chain?: ChainType | string
}): { inputs: OpenApiUtxo[]; outputs: OutputSpec[]; fee: number } {
  const selected = [...(params.requiredInputs || [])]
  let total = selected.reduce((sum, utxo) => sum + utxo.satoshi, 0)
  const changeScript = scriptForAddress(params.changeAddress, params.chain)
  const requiredKeys = new Set(selected.map((utxo) => `${utxo.txid}:${utxo.vout}`))
  const trySelect = () => {
    const feeInputs = [...(params.extraFeeInputs || []), ...selected.map((utxo) => ({ kind: 'wallet' as const, utxo }))]
    const feeWithoutChange = estimateFeeForInputs(feeInputs, params.baseOutputs, params.feeRate)
    if (total < params.spend + feeWithoutChange) return undefined
    const outputs = [...params.baseOutputs]
    const candidate = [...outputs, { type: params.changeType, address: params.changeAddress, satoshi: 0, script: changeScript }]
    const feeWithChange = estimateFeeForInputs(feeInputs, candidate, params.feeRate)
    const change = total - params.spend - feeWithChange
    if (change >= DUST_THRESHOLD) {
      candidate[candidate.length - 1] = { ...candidate[candidate.length - 1], satoshi: change }
      return { inputs: selected, outputs: candidate, fee: feeWithChange, hasChange: true }
    }
    return { inputs: selected, outputs, fee: total - params.spend, hasChange: false }
  }

  let dustChangeFallback: { inputs: OpenApiUtxo[]; outputs: OutputSpec[]; fee: number } | undefined
  const useSelection = () => {
    const result = trySelect()
    if (!result) return undefined
    if (result.hasChange) return result
    dustChangeFallback = result
    return undefined
  }
  const preselected = useSelection()
  if (preselected) return preselected
  for (const utxo of params.utxos) {
    if (requiredKeys.has(`${utxo.txid}:${utxo.vout}`) || !isSpendable(utxo)) continue
    selected.push(utxo)
    total += utxo.satoshi
    const result = useSelection()
    if (result) return result
  }
  if (dustChangeFallback) return dustChangeFallback
  throw new Error('Selected wallet UTXOs do not cover the inscription and network fees.')
}

function buildUnsignedTxId(psbt: bitcoin.Psbt): string {
  const tx = new bitcoin.Transaction()
  tx.version = 2
  psbt.txInputs.forEach((input) => tx.addInput(Buffer.from(input.hash), input.index))
  psbt.txOutputs.forEach((output) => tx.addOutput(output.script, output.value))
  return tx.getId()
}

// This tool only supports native SegWit/Taproot wallets, whose signatures do
// not alter the transaction ID. This is used for the pre-signed dependency chain.
export function getUnsignedPsbtTxId(psbtHex: string, chain?: ChainType | string): string {
  return buildUnsignedTxId(bitcoin.Psbt.fromHex(psbtHex, { network: networkForChain(chain) }))
}

export function deriveTimeLockAddress(pubKey: string, lockBlocks: TimeLockBlocks, chain?: ChainType | string): string {
  return buildTimeLockPayment(pubKey, lockBlocks, chain).address
}

export function buildBrc20TransferContent(ticker: string, amount: string): string {
  const sourceTick = ticker.trim()
  const tick = sourceTick.toLowerCase()
  const amt = amount.trim()
  if (!sourceTick) {
    throw new Error('Enter a BRC-20 ticker.')
  }
  if (!/^\d+(\.\d+)?$/.test(amt) || /^0+(?:\.0+)?$/.test(amt)) {
    throw new Error('Enter a positive BRC-20 amount.')
  }
  return JSON.stringify({ p: 'brc-20', op: 'transfer', tick, amt })
}

function buildTimeLockCreateTx(params: {
  userAddress: string
  pubKey: string
  ticker: string
  amount: string
  lockBlocks: TimeLockBlocks
  inscriptionAddress?: string
  feeRate: number
  feeUtxos: OpenApiUtxo[]
}) {
  const userAddress = params.userAddress.trim()
  const transferContent = buildBrc20TransferContent(params.ticker, params.amount)
  const timeLockPayment = buildTimeLockPayment(params.pubKey, params.lockBlocks)
  const inscriptionPayment = buildInscriptionPayment(params.pubKey, transferContent)
  const inscriptionAddress = (params.inscriptionAddress || timeLockPayment.address).trim()

  const revealBaseOutputs: OutputSpec[] = [{
    type: 'timelock_transfer',
    address: inscriptionAddress,
    satoshi: INSCRIPTION_SATOSHI,
    script: scriptForAddress(inscriptionAddress),
  }]
  const dummyRevealInput = [{ txid: '00'.repeat(32), vout: 0, satoshi: 0, scriptPk: '', scriptType: 'P2TR' }]
  const revealFee = estimateFee(dummyRevealInput, revealBaseOutputs, params.feeRate)
  // A script-path inscription witness is larger than the key-path estimate. Keep
  // an extra 100 vbytes (or 350 sats) in the commit output for the reveal.
  const actualCommitValue = INSCRIPTION_SATOSHI + revealFee + Math.max(REVEAL_FEE_BUFFER_MIN, params.feeRate * REVEAL_FEE_BUFFER_VBYTES)
  const revealWithChange = [...revealBaseOutputs, {
    type: 'timelock_reveal_change' as const,
    address: userAddress,
    satoshi: 0,
    script: scriptForAddress(userAddress),
  }]
  const revealFeeWithChange = estimateFee(dummyRevealInput, revealWithChange, params.feeRate)
  const revealChange = actualCommitValue - INSCRIPTION_SATOSHI - revealFeeWithChange
  const revealOutputs = revealChange >= DUST_THRESHOLD
    ? [{ ...revealBaseOutputs[0] }, { ...revealWithChange[1], satoshi: revealChange }]
    : revealBaseOutputs
  const actualRevealFee = revealOutputs.length > 1 ? revealFeeWithChange : actualCommitValue - INSCRIPTION_SATOSHI

  const commitSelection = selectFunding({
    utxos: params.feeUtxos,
    spend: actualCommitValue,
    baseOutputs: [{ type: 'timelock_commit', address: inscriptionPayment.address, satoshi: actualCommitValue, script: inscriptionPayment.output }],
    changeAddress: userAddress,
    changeType: 'timelock_commit_change',
    feeRate: params.feeRate,
  })
  const commitPsbt = new bitcoin.Psbt({ network: NETWORK })
  addWalletInputs(commitPsbt, commitSelection.inputs)
  addOutputs(commitPsbt, commitSelection.outputs)
  const placeholderCommitTxid = buildUnsignedTxId(commitPsbt)
  const revealPsbt = new bitcoin.Psbt({ network: NETWORK })
  revealPsbt.addInput({
    hash: placeholderCommitTxid,
    index: 0,
    witnessUtxo: { value: actualCommitValue, script: inscriptionPayment.output },
    tapLeafScript: inscriptionPayment.tapLeafScript,
    tapInternalKey: INTERNAL_KEY,
  })
  addOutputs(revealPsbt, revealOutputs)
  const leaf = inscriptionPayment.tapLeafScript[0]
  const revealContext = {
    commitValue: actualCommitValue,
    commitVout: 0,
    commitScriptHex: inscriptionPayment.output.toString('hex'),
    revealLeafScriptHex: leaf.script.toString('hex'),
    revealControlBlockHex: leaf.controlBlock.toString('hex'),
    revealInternalKeyHex: INTERNAL_KEY.toString('hex'),
  }
  return {
    kind: 'timelock_create',
    timeLockAddress: timeLockPayment.address,
    inscriptionAddress,
    inscriptionSatoshi: INSCRIPTION_SATOSHI,
    inscriptionOutputScriptHex: scriptForAddress(inscriptionAddress).toString('hex'),
    transferContent,
    commitPsbtHex: commitPsbt.toHex(),
    commitToSignInputs: toSignInputs(commitSelection.inputs, params.pubKey),
    commitInputs: commitSelection.inputs,
    commitOutputs: outputRows(commitSelection.outputs),
    revealPsbtHex: revealPsbt.toHex(),
    revealToSignInputs: [{ index: 0, publicKey: cleanPubKey(params.pubKey).toString('hex'), useTweakedSigner: false }],
    revealOutputs: outputRows(revealOutputs),
    revealContext,
    estimatedCommitFee: commitSelection.fee,
    estimatedRevealFee: actualRevealFee,
  }
}

function buildTransferToTimeLockTx(params: {
  userAddress: string
  pubKey: string
  timeLockAddress: string
  inscriptionUtxo: OpenApiUtxo
  feeUtxos: OpenApiUtxo[]
  feeRate: number
}) {
  if (!isSpendable(params.inscriptionUtxo)) throw new Error('The first transfer inscription output is not spendable.')
  const source = {
    ...params.inscriptionUtxo,
    scriptType: decodeScript(params.inscriptionUtxo.scriptPk).subarray(0, 2).toString('hex') === '5120' ? 'P2TR' : params.inscriptionUtxo.scriptType,
  }
  const primaryOutput: OutputSpec = {
    type: 'timelock_transfer',
    address: params.timeLockAddress,
    satoshi: source.satoshi,
    script: scriptForAddress(params.timeLockAddress),
  }
  const feeSelection = selectFunding({
    utxos: params.feeUtxos.filter((utxo) => `${utxo.txid}:${utxo.vout}` !== `${source.txid}:${source.vout}`),
    spend: 0,
    baseOutputs: [primaryOutput],
    changeAddress: params.userAddress,
    changeType: 'timelock_fee_change',
    feeRate: params.feeRate,
  })
  const psbt = new bitcoin.Psbt({ network: NETWORK })
  psbt.addInput({
    hash: source.txid,
    index: source.vout,
    witnessUtxo: { value: source.satoshi, script: decodeScript(source.scriptPk) },
  })
  addWalletInputs(psbt, feeSelection.inputs)
  addOutputs(psbt, feeSelection.outputs)
  return {
    kind: 'timelock_move',
    psbtHex: psbt.toHex(),
    toSignInputs: toSignInputs([source, ...feeSelection.inputs], params.pubKey),
    inscriptionInput: source,
    feeInputs: feeSelection.inputs,
    outputs: outputRows(feeSelection.outputs),
    estimatedFee: feeSelection.fee,
  }
}

function rebuildTimeLockRevealPsbt(params: {
  commitTxid: string
  context: {
    commitValue: number
    commitVout: number
    commitScriptHex: string
    revealLeafScriptHex: string
    revealControlBlockHex: string
    revealInternalKeyHex: string
  }
  outputs: BuiltTxOutput[]
}): string {
  const psbt = new bitcoin.Psbt({ network: NETWORK })
  psbt.addInput({
    hash: params.commitTxid,
    index: params.context.commitVout,
    witnessUtxo: { value: params.context.commitValue, script: Buffer.from(params.context.commitScriptHex, 'hex') },
    tapLeafScript: [{
      leafVersion: TAPLEAF_VERSION,
      script: Buffer.from(params.context.revealLeafScriptHex, 'hex'),
      controlBlock: Buffer.from(params.context.revealControlBlockHex, 'hex'),
    }],
    tapInternalKey: Buffer.from(params.context.revealInternalKeyHex, 'hex'),
  })
  params.outputs.forEach((output) => psbt.addOutput({ script: Buffer.from(output.scriptHex, 'hex'), value: output.satoshi }))
  return psbt.toHex()
}

export function buildSingleUtxoTimeLockDeposit(params: {
  userAddress: string
  pubKey: string
  ticker: string
  amount: string
  lockBlocks: TimeLockBlocks
  feeRate: number
  fundingUtxo: OpenApiUtxo
  chain?: ChainType | string
}): BuiltTimeLockDepositTx {
  if (!isSpendable(params.fundingUtxo)) throw new Error('Select one spendable funding UTXO.')
  const userAddress = params.userAddress.trim()
  const network = networkForChain(params.chain)
  const userScript = scriptForAddress(userAddress, params.chain)
  const transferContent = buildBrc20TransferContent(params.ticker, params.amount)
  const timeLock = buildTimeLockPayment(params.pubKey, params.lockBlocks, params.chain)
  const inscription = buildInscriptionPayment(params.pubKey, transferContent, params.chain)
  const root = params.fundingUtxo
  const rootLike = { ...root, scriptPk: userScript.toString('hex') }
  const selfInscription: OutputSpec = { type: 'timelock_transfer', address: userAddress, satoshi: INSCRIPTION_SATOSHI, script: userScript }
  const lockedInscription: OutputSpec = { type: 'timelock_transfer', address: timeLock.address, satoshi: INSCRIPTION_SATOSHI, script: timeLock.output }
  const recoveryMetadata = buildRecoveryMetadataOutput(params.pubKey, userAddress, params.lockBlocks)
  const commitTemplate: OutputSpec = { type: 'timelock_commit', address: inscription.address, satoshi: 0, script: inscription.output }
  const firstChangeTemplate: OutputSpec = { type: 'timelock_commit_change', address: userAddress, satoshi: 0, script: userScript }
  const fee1 = estimateFee([rootLike], [commitTemplate, firstChangeTemplate], params.feeRate)
  const fundingTemplate: OutputSpec = { type: 'timelock_reveal_change', address: userAddress, satoshi: 0, script: userScript }
  const fee2 = estimateTaprootScriptPathFee(inscription, [selfInscription, fundingTemplate], params.feeRate)
  const fee3 = estimateFee([rootLike, rootLike], [lockedInscription, fundingTemplate], params.feeRate)
  const fee4 = estimateFee([rootLike], [{ type: 'timelock_commit', address: inscription.address, satoshi: 0, script: inscription.output }], params.feeRate)
  const fee5 = estimateTaprootScriptPathFee(inscription, [lockedInscription, recoveryMetadata], params.feeRate)
  const totalEstimatedFee = fee1 + fee2 + fee3 + fee4 + fee5
  const minimum = INSCRIPTION_SATOSHI * 2 + totalEstimatedFee + DUST_THRESHOLD
  if (root.satoshi < minimum) throw new Error(`The selected UTXO needs at least ${minimum} sats for this 5-transaction flow.`)
  const commit4Value = INSCRIPTION_SATOSHI + fee5
  const funding3 = commit4Value + fee4
  const funding2 = funding3 + fee3
  const commit1Value = INSCRIPTION_SATOSHI + funding2 + fee2
  const firstTxChange = root.satoshi - commit1Value - fee1
  if (firstTxChange < DUST_THRESHOLD) throw new Error('The first transaction change would be dust; choose a larger funding UTXO.')

  const funding2Output: OutputSpec = { type: 'timelock_reveal_change', address: userAddress, satoshi: funding2, script: userScript }
  const funding3Output: OutputSpec = { type: 'timelock_fee_change', address: userAddress, satoshi: funding3, script: userScript }
  const commit1 = new bitcoin.Psbt({ network })
  addWalletInputs(commit1, [root])
  const firstTxChangeOutput = { ...firstChangeTemplate, satoshi: firstTxChange }
  addOutputs(commit1, [{ ...commitTemplate, satoshi: commit1Value }, firstTxChangeOutput])
  const txid1 = buildUnsignedTxId(commit1)
  const reveal1 = new bitcoin.Psbt({ network })
  reveal1.addInput({ hash: txid1, index: 0, witnessUtxo: { value: commit1Value, script: inscription.output }, tapLeafScript: inscription.tapLeafScript, tapInternalKey: INTERNAL_KEY })
  addOutputs(reveal1, [selfInscription, funding2Output])
  const txid2 = buildUnsignedTxId(reveal1)
  const inscriptionUtxo: OpenApiUtxo = { txid: txid2, vout: 0, satoshi: INSCRIPTION_SATOSHI, scriptPk: userScript.toString('hex'), scriptType: root.scriptType }
  const funding2Utxo: OpenApiUtxo = { txid: txid2, vout: 1, satoshi: funding2, scriptPk: userScript.toString('hex'), scriptType: root.scriptType }
  const move = new bitcoin.Psbt({ network })
  addWalletInputs(move, [inscriptionUtxo, funding2Utxo])
  addOutputs(move, [lockedInscription, funding3Output])
  const txid3 = buildUnsignedTxId(move)
  const funding3Utxo: OpenApiUtxo = { txid: txid3, vout: 1, satoshi: funding3, scriptPk: userScript.toString('hex'), scriptType: root.scriptType }
  const commit4 = new bitcoin.Psbt({ network })
  addWalletInputs(commit4, [funding3Utxo])
  addOutputs(commit4, [{ type: 'timelock_commit', address: inscription.address, satoshi: commit4Value, script: inscription.output }])
  const txid4 = buildUnsignedTxId(commit4)
  const reveal5 = new bitcoin.Psbt({ network })
  reveal5.addInput({ hash: txid4, index: 0, witnessUtxo: { value: commit4Value, script: inscription.output }, tapLeafScript: inscription.tapLeafScript, tapInternalKey: INTERNAL_KEY })
  addOutputs(reveal5, [lockedInscription, recoveryMetadata])
  const txid5 = buildUnsignedTxId(reveal5)
  const signer = cleanPubKey(params.pubKey).toString('hex')
  return {
    kind: 'timelock_deposit', timeLockAddress: timeLock.address, inscriptionSatoshi: INSCRIPTION_SATOSHI, transferContent,
    fundingSatoshi: root.satoshi, firstTxChangeSatoshi: firstTxChange, totalEstimatedFee,
    steps: [
      { label: 'Self transfer commit', txid: txid1, psbtHex: commit1.toHex(), toSignInputs: toSignInputs([root], params.pubKey), outputs: outputRows([{ ...commitTemplate, satoshi: commit1Value }, firstTxChangeOutput]), estimatedFee: fee1 },
      { label: 'Self transfer reveal', txid: txid2, psbtHex: reveal1.toHex(), toSignInputs: [{ index: 0, publicKey: signer, useTweakedSigner: false }], outputs: outputRows([selfInscription, funding2Output]), estimatedFee: fee2 },
      { label: 'Send transfer to time lock', txid: txid3, psbtHex: move.toHex(), toSignInputs: toSignInputs([inscriptionUtxo, funding2Utxo], params.pubKey), outputs: outputRows([lockedInscription, funding3Output]), estimatedFee: fee3 },
      { label: 'Time-lock transfer commit', txid: txid4, psbtHex: commit4.toHex(), toSignInputs: toSignInputs([funding3Utxo], params.pubKey), outputs: outputRows([{ type: 'timelock_commit', address: inscription.address, satoshi: commit4Value, script: inscription.output }]), estimatedFee: fee4 },
      { label: 'Time-lock transfer reveal', txid: txid5, psbtHex: reveal5.toHex(), toSignInputs: [{ index: 0, publicKey: signer, useTweakedSigner: false }], outputs: outputRows([lockedInscription, recoveryMetadata]), estimatedFee: fee5 },
    ],
  }
}

export function buildRuneTimeLockDeposit(params: {
  userAddress: string
  pubKey: string
  lockBlocks: TimeLockBlocks
  runeId: string
  runeName: string
  runeAmount: string
  runeBalance: string
  hasUnallocatedRunes: boolean
  runeUtxos: OpenApiUtxo[]
  feeUtxos: OpenApiUtxo[]
  feeRate: number
  chain?: ChainType | string
}): BuiltRuneTimeLockDepositTx {
  if (!params.runeUtxos.length || params.runeUtxos.some((utxo) => !isSpendable(utxo))) throw new Error('Select one or more spendable Rune UTXOs.')
  const runeUtxoKeys = new Set(params.runeUtxos.map((utxo) => `${utxo.txid}:${utxo.vout}`))
  if (runeUtxoKeys.size !== params.runeUtxos.length) throw new Error('Each Rune UTXO can be used only once.')
  parseRuneId(params.runeId)
  const amount = params.runeAmount.trim()
  const balance = params.runeBalance.trim()
  if (!/^\d+$/.test(amount) || BigInt(amount) <= 0n) throw new Error('Rune amount must be a positive integer in base units.')
  if (!/^\d+$/.test(balance) || BigInt(balance) < BigInt(amount)) throw new Error('Combined Rune UTXO balance must be at least the lock amount.')
  const network = networkForChain(params.chain)
  const timeLock = buildTimeLockPayment(params.pubKey, params.lockBlocks, params.chain)
  const userScript = scriptForAddress(params.userAddress, params.chain)
  const needsRuneChange = params.hasUnallocatedRunes || BigInt(balance) > BigInt(amount)
  const runestone = buildRuneTransferRunestone({
    runeId: params.runeId,
    amount,
    destinationOutput: 1,
    pointerOutput: needsRuneChange ? 2 : undefined,
    recoveryMetadata: {
      version: 1,
      lockBlocks: params.lockBlocks,
      xOnlyPubKey: toXOnly(cleanPubKey(params.pubKey)).toString('hex'),
      ownerAddressType: getOwnerAddressType(params.userAddress, params.pubKey),
    },
  })
  const outputs: OutputSpec[] = [
    { type: 'runestone', satoshi: 0, script: runestone },
    { type: 'timelock_transfer', address: timeLock.address, satoshi: RUNE_DUST_SATOSHI, script: timeLock.output },
  ]
  if (needsRuneChange) {
    // The pointer keeps all non-edicted Rune balances on every Rune source and
    // fee input out of the time lock, including other Rune IDs.
    outputs.push({ type: 'rune_change', address: params.userAddress, satoshi: RUNE_DUST_SATOSHI, script: userScript })
  }
  const uniqueInputs = [...params.runeUtxos, ...params.feeUtxos].filter(
    (utxo, index, all) => all.findIndex((candidate) => `${candidate.txid}:${candidate.vout}` === `${utxo.txid}:${utxo.vout}`) === index,
  )
  const selection = selectFunding({
    utxos: uniqueInputs,
    requiredInputs: params.runeUtxos,
    // Rune source inputs fund the lock and Rune-change outputs. Include their
    // full value here so it is deducted before calculating the fee change.
    spend: outputs.reduce((total, output) => total + output.satoshi, 0),
    baseOutputs: outputs,
    changeAddress: params.userAddress,
    changeType: 'timelock_fee_change',
    feeRate: params.feeRate,
    chain: params.chain,
  })
  const psbt = new bitcoin.Psbt({ network })
  addWalletInputs(psbt, selection.inputs)
  addOutputs(psbt, selection.outputs)
  return {
    kind: 'rune_timelock_deposit', timeLockAddress: timeLock.address,
    runeId: params.runeId.trim(), runeName: params.runeName.trim(), runeAmount: amount,
    sourceOutpoints: params.runeUtxos.map((utxo) => `${utxo.txid}:${utxo.vout}`),
    psbtHex: psbt.toHex(), toSignInputs: toSignInputs(selection.inputs, params.pubKey),
    inputs: selection.inputs, outputs: outputRows(selection.outputs), estimatedFee: selection.fee,
  }
}

export function buildTimeLockUnlockTx(params: {
  userAddress: string
  pubKey: string
  lockBlocks: TimeLockBlocks
  inscriptionUtxo: OpenApiUtxo
  feeUtxos: OpenApiUtxo[]
  feeRate: number
  chain?: ChainType | string
}): BuiltTimeLockUnlockTx {
  if (!params.inscriptionUtxo.txid || !Number.isInteger(params.inscriptionUtxo.vout) || params.inscriptionUtxo.vout < 0 || params.inscriptionUtxo.satoshi <= 0) {
    throw new Error('The saved time-lock outpoint is invalid.')
  }
  const network = networkForChain(params.chain)
  const payment = buildTimeLockPayment(params.pubKey, params.lockBlocks, params.chain)
  if (params.inscriptionUtxo.scriptPk && decodeScript(params.inscriptionUtxo.scriptPk).toString('hex') !== payment.output.toString('hex')) {
    throw new Error('The selected record does not match this wallet public key or lock period.')
  }
  const principalOutput: OutputSpec = {
    type: 'unlock_transfer',
    address: params.userAddress,
    satoshi: params.inscriptionUtxo.satoshi,
    script: scriptForAddress(params.userAddress, params.chain),
  }
  const feeSelection = selectFunding({
    utxos: params.feeUtxos.filter((utxo) => `${utxo.txid}:${utxo.vout}` !== `${params.inscriptionUtxo.txid}:${params.inscriptionUtxo.vout}`),
    extraFeeInputs: [{ kind: 'taproot_script_path', payment }],
    spend: 0,
    baseOutputs: [principalOutput],
    changeAddress: params.userAddress,
    changeType: 'unlock_fee_change',
    feeRate: params.feeRate,
    chain: params.chain,
  })
  const psbt = new bitcoin.Psbt({ network })
  psbt.setVersion(2)
  psbt.addInput({
    hash: params.inscriptionUtxo.txid,
    index: params.inscriptionUtxo.vout,
    sequence: params.lockBlocks,
    witnessUtxo: { value: params.inscriptionUtxo.satoshi, script: payment.output },
    tapLeafScript: payment.tapLeafScript,
    tapInternalKey: INTERNAL_KEY,
  })
  addWalletInputs(psbt, feeSelection.inputs)
  addOutputs(psbt, feeSelection.outputs)
  return {
    kind: 'timelock_unlock',
    psbtHex: psbt.toHex(),
    toSignInputs: [
      { index: 0, publicKey: cleanPubKey(params.pubKey).toString('hex'), useTweakedSigner: false },
      ...toSignInputs(feeSelection.inputs, params.pubKey).map((input) => ({ ...input, index: input.index + 1 })),
    ],
    inscriptionInput: params.inscriptionUtxo,
    feeInputs: feeSelection.inputs,
    outputs: outputRows(feeSelection.outputs),
    estimatedFee: feeSelection.fee,
  }
}

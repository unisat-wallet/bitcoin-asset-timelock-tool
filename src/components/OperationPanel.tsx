import { CopyOutlined, ReloadOutlined, UnlockOutlined } from '@ant-design/icons'
import { Alert, Button, Card, Descriptions, Input, InputNumber, List, Segmented, Space, Tag, Typography } from 'antd'
import type { AddressBalance, AssetKind, BuiltTimeLockTx, ResultState, TimeLockBlocks, TimeLockRecord } from '../types'
import type { UtxoSelectionState } from '../hooks/useUtxoSelection'
import { satoshiToFb, shortAddress } from '../lib/format'
import { UtxoSelector } from './UtxoSelector'
import { TxPreview } from './TxPreview'
import { ResultAlert } from './ResultAlert'

type Props = {
  ticker: string
  amount: string
  assetKind: AssetKind
  runeReference: string
  fractalNetwork: boolean
  lockBlocks: TimeLockBlocks
  feeRate: number
  timeLockAddress: string
  walletBalance: AddressBalance | null
  walletUtxos: UtxoSelectionState
  hasOpenApiKey: boolean
  canFetchUtxos: boolean
  canCreate: boolean
  builtTx: BuiltTimeLockTx | null
  result: ResultState
  records: TimeLockRecord[]
  onTickerChange: (value: string) => void
  onAmountChange: (value: string) => void
  onAssetKindChange: (value: AssetKind) => void
  onRuneReferenceChange: (value: string) => void
  onLockBlocksChange: (value: TimeLockBlocks) => void
  onFeeRateChange: (value: number) => void
  onFetchUtxos: () => void
  onCreate: () => void
  onUnlock: (record: TimeLockRecord) => void
  onCopy: (value: string, label: string) => void
}

export function OperationPanel(props: Props) {
  return (
    <>
      <Card title="2. Create Asset Time Lock" className="tool-card">
        <Space direction="vertical" size="large" className="full">
          <Segmented
            block
            value={props.assetKind}
            options={[{ label: 'BRC-20 transfer inscription', value: 'brc20' }, { label: 'Rune / Runestone', value: 'runes' }]}
            onChange={(value) => props.onAssetKindChange(value as AssetKind)}
          />
          <Alert
            type="info"
            showIcon
            message={props.assetKind === 'brc20'
              ? 'Deposit broadcasts five transactions: inscribe transfer to yourself (2) → send it to the time-lock address (1) → inscribe transfer at the time-lock address (2).'
              : 'Rune deposit broadcasts one Runestone transaction. The Runes Indexer resolves the Rune name or ID and finds a sufficient transferable Rune UTXO. A Rune-change output and pointer are added only when some Rune balance must remain in your wallet.'}
            description={props.assetKind === 'brc20'
              ? 'All five transactions are signed before any are broadcast. The final transfer inscription can be unlocked after the configured relative block count.'
              : 'Enter the exact base-unit amount. The tool selects the smallest indexed Rune UTXO that can cover it. Select normal BTC/FB UTXOs below only when extra fee funding is needed.'}
          />

          <div className="step-panel">
            <Typography.Title level={5}>1. Set {props.assetKind === 'brc20' ? 'BRC-20 Transfer' : 'Rune Transfer'}</Typography.Title>
            <div className="form-row">
              {props.assetKind === 'brc20' ? <div className="form-field compact">
                <label className="field-label">Token Tick (6–12 bytes)</label>
                <Input value={props.ticker} onChange={(event) => props.onTickerChange(event.target.value)} placeholder="Example: fractal" maxLength={12} />
              </div> : <div className="form-field">
                <label className="field-label">Rune Name or Rune ID ({props.fractalNetwork ? 'Fractal name: lowercase' : 'Bitcoin name: uppercase'})</label>
                <Input value={props.runeReference} onChange={(event) => props.onRuneReferenceChange(event.target.value)} placeholder={props.fractalNetwork ? 'fractal or 21000:1' : 'UNCOMMONGOODS or 840000:1'} />
              </div>}
              <div className="form-field">
                <label className="field-label">Transfer Amount{props.assetKind === 'runes' ? ' (base units)' : ''}</label>
                <Input value={props.amount} onChange={(event) => props.onAmountChange(event.target.value)} placeholder="Example: 100" inputMode={props.assetKind === 'runes' ? 'numeric' : 'decimal'} />
              </div>
              <div className="form-field compact">
                <label className="field-label">Relative Lock (blocks, 1–65,535)</label>
                <InputNumber min={1} max={65535} precision={0} value={props.lockBlocks} onChange={(value) => props.onLockBlocksChange(Math.min(65535, Math.max(1, value || 1)))} />
              </div>
            </div>
          </div>

          <div className="step-panel">
            <Typography.Title level={5}>2. Time-lock Address and Funding</Typography.Title>
            <div className="address-box" onClick={() => props.timeLockAddress && props.onCopy(props.timeLockAddress, 'Time-lock address copied')}>
              <span>{props.timeLockAddress || 'Connect a wallet to generate the time-lock address'}</span>
              {props.timeLockAddress && <CopyOutlined />}
            </div>
            <Descriptions className="mt-16" column={{ xs: 1, sm: 3 }} size="small" bordered>
              <Descriptions.Item label="Wallet UTXOs">{props.walletUtxos.listedUtxos.length}</Descriptions.Item>
              <Descriptions.Item label="Selected UTXOs">{props.walletUtxos.selectedUtxos.length}</Descriptions.Item>
              <Descriptions.Item label="Selected Amount">{satoshiToFb(props.walletUtxos.selectedSatoshi)} {props.fractalNetwork ? 'FB' : 'BTC'}</Descriptions.Item>
              <Descriptions.Item label="Wallet Balance">{props.walletBalance ? `${satoshiToFb(props.walletBalance.satoshi)} ${props.fractalNetwork ? 'FB' : 'BTC'}` : '-'}</Descriptions.Item>
            </Descriptions>
            <Button className="mt-16" type="primary" ghost icon={<ReloadOutlined />} disabled={!props.canFetchUtxos || !props.hasOpenApiKey} onClick={props.onFetchUtxos}>
              Load Wallet UTXOs
            </Button>
            <UtxoSelector title={props.assetKind === 'brc20' ? 'Select exactly one funding UTXO for the five transactions' : 'Optional: select normal BTC/FB UTXOs for additional miner fees'} fallbackScriptType="unknown script" utxos={props.walletUtxos.listedUtxos} selectedKeys={props.walletUtxos.selectedKeys} onSelectAll={props.walletUtxos.selectAll} onToggle={props.walletUtxos.toggle} />
          </div>

          <div className="step-panel">
            <Typography.Title level={5}>3. {props.assetKind === 'brc20' ? 'Inscribe and Lock' : 'Create Runestone and Lock'}</Typography.Title>
            <div className="form-row">
              <div className="form-field compact">
                <label className="field-label">Fee Rate (sat/vB, current network mempool recommendation by default)</label>
                <InputNumber min={1} max={1000} precision={0} value={props.feeRate} onChange={(value) => props.onFeeRateChange(value || 1)} />
              </div>
            </div>
            <Button className="mt-16" danger type="primary" disabled={!props.canCreate || !props.hasOpenApiKey} onClick={props.onCreate}>
              {props.assetKind === 'brc20' ? 'Run Five-Transaction Deposit' : 'Run Rune Time-lock Deposit'}
            </Button>
          </div>
        </Space>
        <TxPreview builtTx={props.builtTx} />
        <ResultAlert result={props.result} />
      </Card>

      <Card title="3. Local Asset Time-lock Records / Unlock" className="tool-card">
        <Alert
          type="warning"
          showIcon
          message="Records are stored only in this browser's LocalStorage"
          description="Do not clear site data. New locks include an on-chain BATL recovery marker (asset type, public key, and block count) that a compatible browser tool can decode to recreate a record. Rune metadata is embedded in its existing Runestone so it uses only one OP_RETURN. Unlock only after the configured confirmation count."
        />
        <List
          className="mt-16"
          locale={{ emptyText: 'No local time-lock records yet' }}
          dataSource={props.records}
          renderItem={(record) => (
            <List.Item
              actions={record.status === 'locked' ? [
                <Button key="unlock" type="primary" icon={<UnlockOutlined />} onClick={() => props.onUnlock(record)}>Unlock</Button>,
              ] : [<Tag key="unlocked" color="success">Unlocked</Tag>]}
            >
              <List.Item.Meta
                title={<Space wrap><Tag color={record.assetKind === 'runes' ? 'purple' : 'blue'}>{record.assetKind === 'runes' ? 'Rune' : 'BRC-20'}</Tag><strong>{record.runeName || record.ticker}</strong>{record.runeId && <Tag>{record.runeId}</Tag>}<Tag>{record.amount}</Tag><Tag color="blue">{record.lockBlocks} blocks</Tag>{record.chain && <Tag>{record.chain}</Tag>}{record.status === 'unlocked' && <Tag color="success">Unlocked</Tag>}</Space>}
                description={<Space direction="vertical" size={2}>
                  <span>Time-lock address: <a onClick={() => props.onCopy(record.timeLockAddress, 'Time-lock address copied')}>{shortAddress(record.timeLockAddress, 12, 12)}</a></span>
                  <span>Inscription outpoint: {shortAddress(record.inscriptionTxid, 12, 12)}:{record.inscriptionVout}</span>
                  {record.assetKind === 'runes' && <span>Runestone lock transaction: {shortAddress(record.commitTxid, 12, 12)}</span>}
                  {record.initialCommitTxid && <span>1/5 Self transfer commit: {shortAddress(record.initialCommitTxid, 12, 12)}</span>}
                  {record.initialRevealTxid && <span>2/5 Self transfer reveal: {shortAddress(record.initialRevealTxid, 12, 12)}</span>}
                  {record.transferToLockTxid && <span>3/5 Send to time lock: {shortAddress(record.transferToLockTxid, 12, 12)}</span>}
                  {record.lockCommitTxid && <span>4/5 Time-lock transfer commit: {shortAddress(record.lockCommitTxid, 12, 12)}</span>}
                  {record.lockRevealTxid && <span>5/5 Time-lock transfer reveal: {shortAddress(record.lockRevealTxid, 12, 12)}</span>}
                  <span>Created: {new Date(record.createdAt).toLocaleString()}</span>
                </Space>}
              />
            </List.Item>
          )}
        />
      </Card>
    </>
  )
}

import { CopyOutlined, UnlockOutlined } from '@ant-design/icons'
import { Alert, Button, Card, Input, InputNumber, List, Segmented, Space, Tag, Typography } from 'antd'
import type { AssetKind, ResultState, TimeLockBlocks, TimeLockRecord } from '../types'
import { shortAddress } from '../lib/format'
import { getAddressExplorerUrl, getTransactionExplorerUrl } from '../lib/explorer'
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
  hasOpenApiKey: boolean
  canCreate: boolean
  result: ResultState
  records: TimeLockRecord[]
  onTickerChange: (value: string) => void
  onAmountChange: (value: string) => void
  onAssetKindChange: (value: AssetKind) => void
  onRuneReferenceChange: (value: string) => void
  onLockBlocksChange: (value: TimeLockBlocks) => void
  onFeeRateChange: (value: number) => void
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
              : 'Rune deposit broadcasts one Runestone transaction. The Runes Indexer resolves the Rune name or ID and selects enough transferable Rune UTXOs. Automatic fee funding always includes a Rune-change output and pointer as a safety measure.'}
            description={props.assetKind === 'brc20'
              ? 'All five transactions are signed before any are broadcast. The tool refreshes and automatically uses the largest available wallet UTXO; it must be large enough to fund the flow. The final transfer inscription can be unlocked after the configured relative block count.'
              : 'Enter the exact base-unit amount. The tool uses the smallest indexed Rune UTXO that can cover it, or combines multiple Rune UTXOs when necessary. When extra fee funding is needed, it automatically uses the current available wallet UTXOs.'}
          />

          <div className="step-panel">
            <Typography.Title level={5}>{props.assetKind === 'brc20' ? 'Configure BRC-20 Time Lock' : 'Configure Rune Time Lock'}</Typography.Title>
            <div className="configuration-form">
              <div className="configuration-row">
                <label className="field-label">{props.assetKind === 'brc20' ? 'Token Tick (6–12 bytes)' : `Rune Name or Rune ID (${props.fractalNetwork ? 'Fractal: lowercase' : 'Bitcoin: uppercase'})`}</label>
                {props.assetKind === 'brc20'
                  ? <Input value={props.ticker} onChange={(event) => props.onTickerChange(event.target.value)} placeholder="Example: fractal" maxLength={12} />
                  : <Input value={props.runeReference} onChange={(event) => props.onRuneReferenceChange(event.target.value)} placeholder={props.fractalNetwork ? 'fractal or 21000:1' : 'UNCOMMONGOODS or 840000:1'} />}
              </div>
              <div className="configuration-row">
                <label className="field-label">Transfer Amount{props.assetKind === 'runes' ? ' (base units)' : ''}</label>
                <Input value={props.amount} onChange={(event) => props.onAmountChange(event.target.value)} placeholder="Example: 100" inputMode={props.assetKind === 'runes' ? 'numeric' : 'decimal'} />
              </div>
              <div className="configuration-row">
                <label className="field-label">Relative Lock (blocks, 1–65,535)</label>
                <InputNumber min={1} max={65535} precision={0} value={props.lockBlocks} onChange={(value) => props.onLockBlocksChange(Math.min(65535, Math.max(1, value || 1)))} />
              </div>
              <div className="configuration-row">
                <label className="field-label">Time-lock Address</label>
                <div className="address-box" onClick={() => props.timeLockAddress && props.onCopy(props.timeLockAddress, 'Time-lock address copied')}>
                  <span>{props.timeLockAddress || 'Connect a wallet to generate the time-lock address'}</span>
                  {props.timeLockAddress && <CopyOutlined />}
                </div>
              </div>
              <div className="configuration-row">
                <label className="field-label">Fee Rate (sat/vB)</label>
                <div>
                  <InputNumber min={1} max={1000} precision={0} value={props.feeRate} onChange={(value) => props.onFeeRateChange(value || 1)} />
                  <span className="field-hint">Defaults to the current network mempool recommendation.</span>
                </div>
              </div>
            </div>
            <div className="configuration-action">
              <Button type="primary" disabled={!props.canCreate || !props.hasOpenApiKey} onClick={props.onCreate}>
                Lock Asset
              </Button>
            </div>
          </div>
        </Space>
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
                  <span>Time-lock address: <a href={getAddressExplorerUrl(record.timeLockAddress, record.chain)} target="_blank" rel="noreferrer">{shortAddress(record.timeLockAddress, 12, 12)}</a></span>
                  {record.assetKind === 'runes'
                    ? <span>Lock transaction: <a href={getTransactionExplorerUrl(record.commitTxid, record.chain)} target="_blank" rel="noreferrer">{shortAddress(record.commitTxid, 12, 12)}</a></span>
                    : <span>Inscription outpoint: <a href={getTransactionExplorerUrl(record.inscriptionTxid, record.chain)} target="_blank" rel="noreferrer">{shortAddress(record.inscriptionTxid, 12, 12)}:{record.inscriptionVout}</a></span>}
                  {record.initialCommitTxid && <span>1/5 Self transfer commit: {shortAddress(record.initialCommitTxid, 12, 12)}</span>}
                  {record.initialRevealTxid && <span>2/5 Self transfer reveal: {shortAddress(record.initialRevealTxid, 12, 12)}</span>}
                  {record.transferToLockTxid && <span>3/5 Send to time lock: {shortAddress(record.transferToLockTxid, 12, 12)}</span>}
                  {record.lockCommitTxid && <span>4/5 Time-lock transfer commit: {shortAddress(record.lockCommitTxid, 12, 12)}</span>}
                  {record.lockRevealTxid && <span>5/5 Time-lock transfer reveal: {shortAddress(record.lockRevealTxid, 12, 12)}</span>}
                  {record.unlockTxid && <span>Unlock transaction: <a href={getTransactionExplorerUrl(record.unlockTxid, record.chain)} target="_blank" rel="noreferrer">{shortAddress(record.unlockTxid, 12, 12)}</a></span>}
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

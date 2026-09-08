import { Descriptions, Divider, Typography } from "antd";
import type { BuiltTimeLockTx, BuiltTxOutput } from "../types";
import { satoshiToFb } from "../lib/format";

function OutputRows({ outputs }: { outputs: BuiltTxOutput[] }) {
  return (
    <div className="outputs">
      {outputs.map((output, index) => (
        <div className="output-row" key={`${output.type}-${index}`}>
          <span>{output.type}</span>
          <strong>{satoshiToFb(output.satoshi)} BTC/FB</strong>
          <small>{output.address || output.scriptHex}</small>
        </div>
      ))}
    </div>
  );
}

export function TxPreview({ builtTx }: { builtTx: BuiltTimeLockTx | null }) {
  if (!builtTx) return null;

  if (builtTx.kind === "timelock_unlock") {
    return (
      <>
        <Divider />
        <Descriptions column={{ xs: 1, sm: 3 }} bordered size="small">
          <Descriptions.Item label="Transfer inscription input">1</Descriptions.Item>
          <Descriptions.Item label="Fee inputs">{builtTx.feeInputs.length}</Descriptions.Item>
          <Descriptions.Item label="Estimated fee">{builtTx.estimatedFee} sats</Descriptions.Item>
        </Descriptions>
        <OutputRows outputs={builtTx.outputs} />
      </>
    );
  }

  if (builtTx.kind === "timelock_deposit") {
    return (
      <>
        <Divider />
        <Typography.Title level={5}>Single-UTXO Five-Transaction Allocation</Typography.Title>
        <Descriptions column={{ xs: 1, sm: 3 }} bordered size="small">
          <Descriptions.Item label="Initial funding UTXO">{builtTx.fundingSatoshi} sats</Descriptions.Item>
          <Descriptions.Item label="Total estimated network fee">{builtTx.totalEstimatedFee} sats</Descriptions.Item>
          <Descriptions.Item label="Transaction 1 direct change">{builtTx.firstTxChangeSatoshi} sats</Descriptions.Item>
        </Descriptions>
        <Typography.Paragraph type="secondary" className="mt-16">
          Transaction 1's change is not used again. Later funding flows through commit → reveal change → transaction 3 change → transaction 4 commit.
        </Typography.Paragraph>
        {builtTx.steps.map((step, index) => (
          <div key={step.txid} className="mt-16">
            <Typography.Text strong>{index + 1}. {step.label} — {step.estimatedFee} sats</Typography.Text>
            <OutputRows outputs={step.outputs} />
          </div>
        ))}
      </>
    )
  }

  if (builtTx.kind === "rune_timelock_deposit") {
    return (
      <>
        <Divider />
        <Typography.Title level={5}>Rune / Runestone Time-lock Preview</Typography.Title>
        <Descriptions column={{ xs: 1, sm: 3 }} bordered size="small">
          <Descriptions.Item label="Rune">{builtTx.runeName}</Descriptions.Item>
          <Descriptions.Item label="Rune ID">{builtTx.runeId}</Descriptions.Item>
          <Descriptions.Item label="Locked base units">{builtTx.runeAmount}</Descriptions.Item>
          <Descriptions.Item label="Rune source">{builtTx.sourceOutpoint}</Descriptions.Item>
          <Descriptions.Item label="Inputs">{builtTx.inputs.length}</Descriptions.Item>
          <Descriptions.Item label="Estimated fee">{builtTx.estimatedFee} sats</Descriptions.Item>
        </Descriptions>
        <Typography.Paragraph type="secondary" className="mt-16">
          A Rune-change output is present only when the source or an added fee input carries Rune balances that are not being locked.
          The Runestone embeds a <code>BATL</code> recovery marker in its ignored Nop tag fields; no second OP_RETURN output is created.
        </Typography.Paragraph>
        <OutputRows outputs={builtTx.outputs} />
      </>
    )
  }

  return null;
}

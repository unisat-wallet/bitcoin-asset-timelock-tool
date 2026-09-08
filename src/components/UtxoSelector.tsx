import { Button, Checkbox, Space, Typography } from "antd";
import type { CheckboxChangeEvent } from "antd/es/checkbox";
import type { OpenApiUtxo } from "../types";
import { getUtxoKey, isSelectableUtxo } from "../lib/utxo";
import { satoshiToFb, shortAddress } from "../lib/format";

type Props = {
  title: string;
  empty?: boolean;
  fallbackScriptType: string;
  utxos: OpenApiUtxo[];
  selectedKeys: Set<string>;
  onSelectAll: (checked: boolean) => void;
  onToggle: (utxo: OpenApiUtxo, event: CheckboxChangeEvent) => void;
  singleSelection?: boolean;
};

export function UtxoSelector({
  title,
  empty,
  fallbackScriptType,
  utxos,
  selectedKeys,
  onSelectAll,
  onToggle,
  singleSelection,
}: Props) {
  if (empty || utxos.length === 0) return null;

  return (
    <div className="utxo-section">
      <div className="utxo-section-head">
        <Typography.Text strong>{title}</Typography.Text>
        <Space size="small">
          {!singleSelection && (
            <Button size="small" onClick={() => onSelectAll(true)}>
              Select All
            </Button>
          )}
          <Button size="small" onClick={() => onSelectAll(false)}>
            Clear
          </Button>
        </Space>
      </div>
      <div className="utxo-list">
        {utxos.map((utxo) => {
          const key = getUtxoKey(utxo);
          const disabled = !isSelectableUtxo(utxo);
          return (
            <label className="utxo-row" key={key}>
              <Checkbox
                checked={selectedKeys.has(key)}
                disabled={disabled}
                onChange={(event) => onToggle(utxo, event)}
              />
              <span className="utxo-main">
                <span className="utxo-id">
                  {shortAddress(utxo.txid, 10, 10)}:{utxo.vout}
                </span>
                <span className="utxo-meta">
                  {utxo.scriptType || fallbackScriptType}
                </span>
              </span>
              <strong>{satoshiToFb(utxo.satoshi)} BTC/FB</strong>
            </label>
          );
        })}
      </div>
    </div>
  );
}

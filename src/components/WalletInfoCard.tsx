import { LinkOutlined } from "@ant-design/icons";
import { Button, Card, Descriptions, Input, Select, Space } from "antd";
import type { AddressBalance, ChainType } from "../types";
import { CHAIN_OPTIONS } from '../lib/chain'
import { satoshiToFb, shortAddress } from "../lib/format";

type Props = {
  address: string;
  pubKey: string;
  chain: string;
  walletBalance: AddressBalance | null;
  totalWalletSatoshi: number;
  walletUtxoCount: number;
  openApiKey: string;
  onOpenApiKeyChange: (value: string) => void;
  onSwitchChain: (chain: ChainType) => void;
};

export function WalletInfoCard({
  address,
  pubKey,
  chain,
  walletBalance,
  totalWalletSatoshi,
  walletUtxoCount,
  openApiKey,
  onOpenApiKeyChange,
  onSwitchChain,
}: Props) {
  const assetUnit = String(chain).includes('FRACTAL') ? 'FB' : 'BTC'
  return (
    <Card title="1. Wallet Information" className="tool-card">
      <Space direction="vertical" size="middle" className="full">
        <Descriptions column={{ xs: 1, sm: 2 }} size="small" bordered>
          <Descriptions.Item label="Wallet Address">
            {address || "-"}
          </Descriptions.Item>
          <Descriptions.Item label="Public Key">
            {pubKey ? shortAddress(pubKey, 12, 12) : "-"}
          </Descriptions.Item>
          <Descriptions.Item label="Network">{chain || "-"}</Descriptions.Item>
          <Descriptions.Item label="Wallet Balance">
            {walletBalance ? `${satoshiToFb(walletBalance.satoshi)} ${assetUnit}` : "-"}
          </Descriptions.Item>
          <Descriptions.Item label="Loaded Wallet UTXO Total">
            {satoshiToFb(totalWalletSatoshi)} {assetUnit}
          </Descriptions.Item>
          <Descriptions.Item label="Loaded Wallet UTXO Count">
            {walletUtxoCount}
          </Descriptions.Item>
        </Descriptions>

        <div>
          <label className="field-label">Wallet Network</label>
          <Select
            className="full"
            value={chain || undefined}
            placeholder="Select a UniSat network"
            options={CHAIN_OPTIONS}
            disabled={!address}
            onChange={(value) => onSwitchChain(value as ChainType)}
          />
        </div>

        <div>
          <label className="field-label">UniSat OpenAPI Key</label>
          <Space.Compact className="full">
            <Input.Password
              value={openApiKey}
              onChange={(event) => onOpenApiKeyChange(event.target.value)}
              placeholder="Paste the key from developer.unisat.io"
              autoComplete="off"
            />
            <Button
              href="https://developer.unisat.io/"
              target="_blank"
              icon={<LinkOutlined />}
            >
              Get Key
            </Button>
          </Space.Compact>
        </div>
      </Space>
    </Card>
  );
}

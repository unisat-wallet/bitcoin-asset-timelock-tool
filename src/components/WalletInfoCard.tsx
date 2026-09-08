import { LinkOutlined } from "@ant-design/icons";
import { Button, Card, Input, Select, Space } from "antd";
import type { ChainType } from "../types";
import { CHAIN_OPTIONS } from '../lib/chain'

type Props = {
  address: string;
  chain: string;
  openApiKey: string;
  onOpenApiKeyChange: (value: string) => void;
  onSwitchChain: (chain: ChainType) => void;
};

export function WalletInfoCard({
  address,
  chain,
  openApiKey,
  onOpenApiKeyChange,
  onSwitchChain,
}: Props) {
  return (
    <Card title="1. Wallet Setup" className="tool-card">
      <Space direction="vertical" size="middle" className="full">
        <div className="configuration-form">
          <div className="configuration-row">
            <label className="field-label">Wallet Address</label>
            <div className="address-box">
              <span>{address || "-"}</span>
            </div>
          </div>
          <div className="configuration-row">
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
          <div className="configuration-row">
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
        </div>
      </Space>
    </Card>
  );
}

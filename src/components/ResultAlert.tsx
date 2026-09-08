import { Alert, Space } from "antd";
import type { ResultState } from "../types";

export function ResultAlert({ result }: { result: ResultState }) {
  if (result.status === "success") {
    return (
      <Alert
        className="mt-16"
        type="success"
        showIcon
        message={`${result.label} transaction broadcasted`}
        description={<span className="txid-button">{result.txid}</span>}
      />
    );
  }

  if (result.status === "timelock_success") {
    return (
      <Alert
        className="mt-16"
        type="success"
        showIcon
        message="Asset transfer has been locked"
        description={
          <Space direction="vertical" size={4}>
            <span>Time-lock address: {result.timeLockAddress}</span>
            <span>Lock transaction: {result.commitTxid}</span>
            {result.revealTxid !== result.commitTxid && <span>Final inscription transaction: {result.revealTxid}</span>}
          </Space>
        }
      />
    );
  }

  if (result.status === "error") {
    return (
      <Alert
        className="mt-16"
        type="error"
        showIcon
        message="Operation failed"
        description={result.message}
      />
    );
  }

  return null;
}

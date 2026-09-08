import { ChainType } from "../types";

function explorerBase(chain?: ChainType | string): string {
  switch (chain) {
    case ChainType.BITCOIN_MAINNET:
      return "https://uniscan.cc";
    case ChainType.FRACTAL_BITCOIN_MAINNET:
      return "https://uniscan.cc/fractal";
    case ChainType.FRACTAL_BITCOIN_TESTNET:
      return "https://uniscan.cc/fractal-testnet";
    case ChainType.BITCOIN_SIGNET:
      return "https://uniscan.cc/signet";
    case ChainType.BITCOIN_TESTNET4:
      return "https://mempool.space/testnet4";
    default:
      return "https://mempool.space";
  }
}

export function getAddressExplorerUrl(
  address: string,
  chain?: ChainType | string,
): string {
  return `${explorerBase(chain)}/address/${encodeURIComponent(address)}`;
}

export function getTransactionExplorerUrl(
  txid: string,
  chain?: ChainType | string,
): string {
  return `${explorerBase(chain)}/tx/${encodeURIComponent(txid)}`;
}

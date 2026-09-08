import type { OpenApiUtxo } from "../types";

export function getUtxoKey(utxo: OpenApiUtxo): string {
  return `${utxo.txid}:${utxo.vout}`;
}

export function isSelectableUtxo(utxo: OpenApiUtxo): boolean {
  return (
    !utxo.isSpent &&
    !utxo.isSpending &&
    utxo.satoshi > 0 &&
    !!utxo.txid &&
    !!utxo.scriptPk
  );
}

export function sumUtxos(utxos: OpenApiUtxo[]): number {
  return utxos.reduce((sum, utxo) => sum + Math.max(0, utxo.satoshi || 0), 0);
}

export function sumSelectedUtxos(
  utxos: OpenApiUtxo[],
  selectedKeys: Set<string>,
): number {
  return utxos.reduce(
    (sum, utxo) =>
      selectedKeys.has(getUtxoKey(utxo))
        ? sum + Math.max(0, utxo.satoshi || 0)
        : sum,
    0,
  );
}

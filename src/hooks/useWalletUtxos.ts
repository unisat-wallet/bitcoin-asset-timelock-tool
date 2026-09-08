import { useMemo, useState } from "react";
import type { OpenApiUtxo } from "../types";
import { isSelectableUtxo, sumUtxos } from "../lib/utxo";

export type WalletUtxoState = ReturnType<typeof useWalletUtxos>;

export function useWalletUtxos() {
  const [utxos, setUtxos] = useState<OpenApiUtxo[]>([]);
  const listedUtxos = useMemo(() => utxos.filter(isSelectableUtxo), [utxos]);
  const totalSatoshi = useMemo(() => sumUtxos(utxos), [utxos]);

  return {
    utxos,
    listedUtxos,
    totalSatoshi,
    setFetchedUtxos: setUtxos,
    clear: () => setUtxos([]),
  };
}

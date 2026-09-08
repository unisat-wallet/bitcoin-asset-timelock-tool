import { useMemo, useState } from "react";
import type { CheckboxChangeEvent } from "antd/es/checkbox";
import type { OpenApiUtxo } from "../types";
import {
  getUtxoKey,
  isSelectableUtxo,
  sumSelectedUtxos,
  sumUtxos,
} from "../lib/utxo";

export type UtxoSelectionState = ReturnType<typeof useUtxoSelection>;

export function useUtxoSelection(onReset: () => void) {
  const [utxos, setUtxos] = useState<OpenApiUtxo[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(
    () => new Set(),
  );

  const listedUtxos = useMemo(() => utxos.filter(isSelectableUtxo), [utxos]);
  const selectedUtxos = useMemo(
    () => utxos.filter((utxo) => selectedKeys.has(getUtxoKey(utxo))),
    [selectedKeys, utxos],
  );
  const totalSatoshi = useMemo(() => sumUtxos(utxos), [utxos]);
  const selectedSatoshi = useMemo(
    () => sumSelectedUtxos(utxos, selectedKeys),
    [selectedKeys, utxos],
  );

  const setFetchedUtxos = (nextUtxos: OpenApiUtxo[]) => {
    setUtxos(nextUtxos);
    // Asset-bearing UTXOs must never be selected implicitly. In particular,
    // a Rune used as a fee input can move every Rune allocated to it.
    setSelectedKeys(new Set());
  };

  const clear = () => {
    setUtxos([]);
    setSelectedKeys(new Set());
  };

  const selectAll = (checked: boolean) => {
    setSelectedKeys(
      checked
        ? new Set(utxos.filter(isSelectableUtxo).map(getUtxoKey))
        : new Set(),
    );
    onReset();
  };

  const toggle = (utxo: OpenApiUtxo, event: CheckboxChangeEvent) => {
    const key = getUtxoKey(utxo);
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (event.target.checked) {
        next.add(key);
      } else {
        next.delete(key);
      }
      return next;
    });
    onReset();
  };

  return {
    utxos,
    listedUtxos,
    selectedKeys,
    selectedUtxos,
    totalSatoshi,
    selectedSatoshi,
    setFetchedUtxos,
    clear,
    selectAll,
    toggle,
  };
}

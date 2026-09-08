# Bitcoin Asset Time Lock

A browser-based Taproot relative-block time-lock tool for Bitcoin assets. It supports Fractal BRC-20 `transfer` inscriptions and Runes on either Bitcoin mainnet or Fractal Bitcoin. Transactions are built locally; UniSat only signs and broadcasts them.

[Open the live app](https://unisat-wallet.github.io/bitcoin-asset-timelock-tool/)

## Supported asset flows

- **BRC-20 transfer inscription** — retains the original five-transaction Fractal flow: self-inscribe, move to the time lock, then inscribe at the time-lock address. The final inscription UTXO is script-path spent after the selected relative block count.
- **Runes** — uses one standard Runestone transaction. A Rune `edict` assigns the requested base-unit amount to a 330-sat time-lock output. The transaction can consume one or more source UTXOs. If those inputs have an unallocated remainder or other Runes, a 330-sat Rune-change output and Runestone `pointer` return those assets to the wallet; otherwise neither is created. The locked Rune output is later spent through the same Taproot CSV script.

Every newly created lock also has a versioned recovery marker:

```text
BRC-20: OP_RETURN "BATL" <version> <uint16_be(lock-blocks)> <x-only-public-key> <owner-address-type>
```

For BRC-20 this is the transaction's one zero-satoshi OP_RETURN output. For Runes, the same BATL metadata is encoded as repeated unknown-odd `Nop (127)` tag fields inside the existing Runestone OP_RETURN; Runes indexers ignore those fields, so the transaction still has exactly one OP_RETURN. The owner address type preserves the information needed to restore P2TR or P2WPKH owner addresses from the x-only public key. The marker is public and contains no private key or signature. A compatible browser tool can decode it, re-derive the CSV Taproot lock address, inspect the transaction outputs, and recreate an unlock record if LocalStorage has been cleared.

See [the BATL protocol specification](docs/BATL-PROTOCOL.md) for the normative encoding and recovery rules.

Runes can be identified by either their **Rune name** or **Rune ID** (`block:transaction-index`). The app resolves a name to its canonical Rune ID with UniSat's Runes Indexer before constructing the transaction. Names are an explicit network safety check:

| Network | Rune-name alphabet |
| --- | --- |
| Bitcoin mainnet | uppercase (`UNCOMMONGOODS`) |
| Fractal Bitcoin | lowercase (`fractal`) |

Mixed case and the wrong network's alphabet are rejected before signing. Amounts and balances for Runes are raw integer base units; apply the Rune's indexed divisibility before entering them.

## Rune deposit procedure

1. Connect UniSat on Bitcoin mainnet or Fractal Bitcoin.
2. Enter either the Rune name or its Rune ID, the base-unit amount, and lock period.
3. The app queries UniSat's Runes Indexer for canonical metadata and the address's transferable UTXOs. It uses the smallest single UTXO when possible; otherwise it automatically combines enough Rune UTXOs to cover the requested amount.
4. Optionally select normal BTC/FB UTXOs for miner fees. The app checks selected fee inputs with the Runes Indexer; if any carry Runes, it retains a 330-sat Rune-change output and pointer to protect them.
5. Review the PSBT. The lock output is Runestone output index `1`; recovery metadata is embedded in the Runestone at output `0`. A Rune-change output at index `2` exists only when the source UTXO(s) have Rune assets that must remain in the wallet.
6. Sign and broadcast. After the configured relative confirmations, use the local record to unlock.

Never add unrelated asset UTXOs as fee inputs. A Rune UTXO may carry other Runes; the pointer intentionally returns all unallocated Rune balances to the Rune-change output.

## Network configuration

The wallet network selector supports Bitcoin Mainnet, Testnet, Testnet4, Signet, Fractal Mainnet, and Fractal Testnet. The app chooses PSBT/address parameters, API, and mempool endpoints from UniSat's current chain. Bitcoin and Fractal mainnet use the `bc` address family; all supported test networks use `tb`.

Copy `.env.example` to `.env` to override any OpenAPI endpoint:

```text
VITE_FRACTAL_OPENAPI_BASE=https://open-api-fractal.unisat.io/v1/indexer
VITE_BITCOIN_OPENAPI_BASE=https://open-api.unisat.io/v1/indexer
VITE_BITCOIN_TESTNET_OPENAPI_BASE=https://open-api-testnet.unisat.io/v1/indexer
VITE_BITCOIN_TESTNET4_OPENAPI_BASE=https://open-api-testnet4.unisat.io/v1/indexer
VITE_BITCOIN_SIGNET_OPENAPI_BASE=https://open-api-signet.unisat.io/v1/indexer
VITE_FRACTAL_TESTNET_OPENAPI_BASE=https://open-api-fractal-testnet.unisat.io/v1/indexer
```

`VITE_OPENAPI_BASE` remains supported as a legacy Fractal endpoint override. Enter the UniSat OpenAPI key manually in the UI; it is stored only in the browser's LocalStorage for convenience and is never bundled into the application build.

## Development

```bash
npm install
npm run dev
npm run build
```

## Security notes

- Verify the asset, Rune ID, correct network-case Rune name, amounts, lock address, UTXO outpoints, fee rate, and outputs in UniSat before signing.
- Records are held in browser LocalStorage only. Save lock transaction IDs and outpoints independently.
- The tool uses UniSat's Runes Indexer to resolve the asset and select an indexed transferable UTXO, then builds the PSBT locally. Its state can change before broadcast, so review the displayed source outpoint and the wallet's final signing preview.
- The tool never requests seed phrases or private keys.

## License

MIT

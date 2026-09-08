# BATL Protocol Specification

## Bitcoin Asset Time Lock Recovery Marker

**Status:** Draft / implementation specification

**Version:** 1

`BATL` means **Bitcoin Asset Time Lock**. It is a public, versioned recovery marker for a Bitcoin asset locked by a Taproot relative block time lock. It enables an explorer, wallet, or browser-based recovery tool to recover the public parameters required to re-derive the lock address after an application's local state has been lost.

BATL does not contain private keys, signatures, seed phrases, or an unlock transaction.

## 1. Goals

BATL v1 provides enough public information to:

1. identify a transaction as a BATL time-lock transaction;
2. recover the relative block lock period, owner x-only public key, and owner address type;
3. deterministically re-derive both the owner address and expected Taproot lock output; and
4. reconstruct an unlock record or an address-to-time-lock index by inspecting the transaction and current UTXO state.

BATL does not define a token protocol. BRC-20 transfer inscriptions and Runes Runestones retain their native semantics.

## 2. Constants

| Name | Value |
| --- | --- |
| Magic | ASCII `BATL` (`0x4241544c`) |
| BATL version | `1` |
| Supported relative locks | `1`–`65535` blocks |
| Taproot leaf version | `0xc0` |
| Internal Taproot key | `50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0` (BIP341 NUMS key) |
| Runes Nop tag | `127` |

The internal Taproot key is part of the BATL v1 address derivation. Implementations MUST use the exact value above for BATL v1 recovery.

This key is the [BIP341 recommended NUMS (nothing-up-my-sleeve) internal key](https://github.com/bitcoin/bips/blob/master/bip-0341.mediawiki#constructing-and-spending-taproot-outputs). It is constructed so that no corresponding private key is known. Consequently, a BATL output has no usable Taproot key-path spend; it can only be unlocked through the committed CSV script path in Section 3. This removes a key-path bypass of the relative time lock.

## 3. Lock Script and Address Derivation

Let `blocks` be an integer from `1` to `65535`, and let `owner_xonly_pubkey` be the 32-byte x-only public key from BATL metadata.

The BATL v1 tapscript is:

```text
<blocks> OP_CHECKSEQUENCEVERIFY OP_DROP <owner_xonly_pubkey> OP_CHECKSIG
```

The script is placed in a single Taproot leaf with leaf version `0xc0`, using the fixed internal key in Section 2. The resulting P2TR output key and address are the BATL time-lock address.

To unlock, the locked output is spent through that script path with:

```text
nVersion  = 2
nSequence = blocks
```

The owner signs with the public key committed in the script. The relative lock is evaluated from the confirmation of the locked UTXO, not from BATL metadata creation time.

## 4. BRC-20 Encoding

BRC-20 BATL recovery metadata is a dedicated, zero-satoshi `OP_RETURN` output in the final lock/reveal transaction.

```text
OP_RETURN
  PUSH("BATL")
  PUSH(version)
  PUSH(blocks)
  PUSH(owner_xonly_pubkey)
  PUSH(owner_address_type)
```

### 4.1 Binary layout

| Field | Size | Value |
| --- | ---: | --- |
| `magic` | 4 bytes | ASCII `BATL` |
| `version` | 1 byte | `0x01` |
| `blocks` | 2 bytes | unsigned big-endian relative block count (`1`–`65535`) |
| `owner_xonly_pubkey` | 32 bytes | BIP340 x-only public key |
| `owner_address_type` | 1 byte | Section 4.2 enum |

Bitcoin Script minimal pushes are used. The canonical BATL v1 script shape is therefore:

```text
OP_RETURN PUSH("BATL") PUSH(0x01) PUSH(uint16_be(blocks)) PUSH(xonly_pubkey) PUSH(owner_address_type)
```

### 4.2 Owner address type

BATL v1 stores an address type instead of the owner address string. Together with the x-only public key and the chain being indexed, it permits an indexer to deterministically reconstruct the original owner address.

| Value | Name | Owner address derivation |
| ---: | --- | --- |
| `81` | `P2TR` | Derive BIP86 P2TR using the x-only key as internal key |
| `82` | `P2WPKH_EVEN` | Prefix x-only key with `0x02`, then derive P2WPKH |
| `83` | `P2WPKH_ODD` | Prefix x-only key with `0x03`, then derive P2WPKH |

BATL v1 supports only native SegWit P2WPKH and BIP86 P2TR owner addresses. These values are wire-compatible with UniSat `SingleStepTransferAddressType` (`P2TR_EMPTY`, `P2WPKH_EVEN`, and `P2WPKH_ODD`). Bitcoin and Fractal mainnet use the `bc` address family; all supported test chains use `tb`.

### 4.3 Output layout

In the final BRC-20 BATL reveal transaction:

| Vout | Purpose |
| ---: | --- |
| `0` | Locked BRC-20 transfer inscription output |
| `1` | Zero-satoshi BATL `OP_RETURN` recovery marker |

The BRC-20 transfer inscription remains at output `0`.

## 5. Runes Encoding

Runes transactions MUST use exactly one `OP_RETURN`: the Runestone output. BATL metadata is therefore embedded inside that existing Runestone, rather than emitted as a second `OP_RETURN` output.

### 5.1 Runestone Nop fields

Runestone fields are LEB128-encoded integer pairs. BATL v1 writes the following repeated `Nop` tag (`127`) pairs before `Tag.Body` (`0`):

```text
127, 0x4241544c,             # BATL magic
127, 1,                      # BATL version
127, blocks,                 # 1 to 65535
127, owner_xonly_pubkey_high,  # first 16 bytes as unsigned big-endian u128
127, owner_xonly_pubkey_low,   # last 16 bytes as unsigned big-endian u128
127, owner_address_type         # Section 4.2 enum
```

Runestone integers are limited to `u128`. The 32-byte x-only public key MUST therefore be represented by two unsigned 128-bit big-endian halves. Each half MUST be left-padded to 16 bytes before concatenating `high || low` to recover the 32-byte x-only public key.

All BATL Nop fields MUST appear before `Tag.Body`. A standard Runestone decoder ignores unknown odd tags, including tag `127`, so these fields do not change the interpretation of the edicts or pointer and do not create a cenotaph.

The remaining Runestone fields are standard:

```text
[optional Tag.Pointer, pointer_output]
Tag.Body, rune_id_block_delta, rune_id_tx_delta, amount, destination_output
```

### 5.2 Output layout

| Vout | Purpose |
| ---: | --- |
| `0` | The only `OP_RETURN`: Runestone with embedded BATL Nop fields |
| `1` | 330-satoshi BATL Rune time-lock output |
| `2` | Optional 330-satoshi Rune change output |
| `3+` | Optional normal BTC/FB fee change outputs |

The Rune edict assigns the locked amount to output `1`.

If any Rune balance must remain outside the lock, the Runestone includes `Tag.Pointer = 2` and creates output `2` to the owner address. This is required if:

- the selected Rune UTXO contains more of the locked Rune than the requested amount;
- the selected Rune UTXO carries another Rune; or
- an additional fee input carries a Rune.

If no Rune balance is left unallocated, neither the pointer nor output `2` is created.

## 6. Recovery Algorithm

Given a candidate transaction:

1. Locate BATL metadata:
   - for BRC-20, find a zero-satoshi output matching the Section 4 script; or
   - for Runes, find the Runestone output (`OP_RETURN OP_13`), decode its LEB128 payload, and locate the six Nop fields in Section 5.
2. Determine the asset family from the carrier: an outer BATL OP_RETURN is BRC-20; BATL Nop fields inside a Runestone are Runes. Validate the BATL version, block count, owner address type, and 32-byte x-only public key.
3. Reconstruct the owner address using Section 4.2, then rebuild the Section 3 tapscript and Taproot address using the BATL v1 internal key.
4. Validate that the expected locked output has the resulting P2TR script:
   - BRC-20: output `0`;
   - Runes: output `1`.
5. Confirm that the output remains unspent and retrieve its indexed confirmation height.
6. Create an unlock record containing the transaction ID, locked vout, asset kind, owner address, lock blocks, time-lock address, and locked output satoshi value.
7. Build an unlock transaction with `nSequence = blocks` only after the relative lock is mature.

A recovery tool SHOULD refuse to create an unlock record if the derived P2TR script does not exactly match the selected transaction output.

## 7. Compatibility and Security

- BATL v1 is an application protocol marker, not a consensus rule.
- BATL metadata is public and linkable. It reveals the owner public key, address type, asset family, and chosen lock period.
- Indexers SHOULD key owner lookups by the reconstructed owner `scriptPubKey` (or its hash), not by a display address string.
- A BATL marker alone does not prove that a transaction is valid. Recovery software MUST re-derive and verify the lock output script.
- Runes implementations MUST NOT add a second `OP_RETURN` for BATL metadata. Use the Nop fields in Section 5.
- Implementations MUST preserve the Runestone edict destination and pointer indices specified in Section 5.
- Local records remain a convenience layer. Users SHOULD retain lock transaction IDs independently.

## 8. Reference Implementation

The reference TypeScript encoder and decoders are available in:

- `src/lib/recovery.ts`
- `src/lib/runestone.ts`
- `src/lib/timelock.ts`

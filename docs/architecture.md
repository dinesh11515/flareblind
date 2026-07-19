# Architecture

Stillwater is three components with one invariant: nobody — including the
operator — sees an order before the batch it belongs to is settled.

```
 trader browser                enclave (GCP Confidential Space)      Flare
+---------------+             +-----------------------------+   +-------------+
| order ticket  |  sealed     | matching engine             |   | Stillwater  |
| seals order   +-----------> |  x25519 secret key          |   | Pool        |
| to enclave key|  (onchain   |  decrypt -> validate ->     |   |  balances   |
|               |   calldata) |  uniform-price auction      +-> |  batches    |
| deposits,     |             |  signs settlement           |   |  settlement |
| withdrawals   +--------------------------------------------> |  FTSO bound |
+---------------+             +-----------------------------+   +-------------+
```

## Order lifecycle

1. **Fund.** The trader deposits FXRP (base) or a USD stable (quote) into the
   venue contract. Deposits are venue balances, deliberately decoupled from
   orders so deposit size never leaks order size.
2. **Seal.** The browser builds `{trader, batchId, side, amount, limit}` and
   seals it with a libsodium sealed box (X25519 + XSalsa20-Poly1305) to the
   enclave's public key, read from the contract. The ciphertext goes onchain
   via `submitOrder` — intake is censorship-resistant and auditable, but
   opaque: an observer learns only that some funded account posted an order.
3. **Close.** After the batch window (`batchDuration`, 5 minutes) anyone can
   call `closeBatch`. Withdrawals freeze while the batch is Sealing so the
   enclave validates against stable balances.
4. **Clear.** The enclave decrypts every ciphertext; drops malformed orders,
   replayed ciphertexts (trader/batch binding), and anything unfunded; then
   runs a uniform-price auction: the single price maximizing matched volume,
   ties broken toward the FTSO reference. The oversubscribed side is filled
   pro-rata with exact-conservation rounding.
5. **Settle.** The enclave calls `settleBatch(batchId, clearingPrice, fills)`.
   The contract verifies everything it can (below) and moves balances
   atomically. The next batch opens in the same transaction.

## What the contract verifies (not trusted to the enclave)

| Check | Consequence for a compromised enclave |
| --- | --- |
| `msg.sender == teeSigner` | outsiders cannot settle at all |
| sum(buy fills) == sum(sell fills), to the wei | cannot mint or burn base volume |
| clearing price within `maxDeviationBps` of FTSO XRP/USD | cannot clear off-market and siphon value to a counterparty |
| every fill funded from frozen venue balances | cannot overdraw any trader |
| buyers pay ceil, sellers receive floor | rounding can only accrue dust to the venue, never insolvency |
| ciphertext size and per-batch order caps | cannot be griefed into unbounded work |

## What the enclave is trusted for

- **Privacy.** The x25519 secret exists only inside the TEE. Compromise means
  order flow leaks — it never means funds move wrongly (the contract checks
  above still bind).
- **Liveness.** A dead enclave stalls settlement; funds stay withdrawable
  after the batch resolves and the operator rotates keys. (Roadmap: timeout
  that voids a Sealing batch and reopens withdrawals trustlessly.)
- **Best execution within the rules.** The enclave could pick a worse-but-legal
  clearing price inside the FTSO band. Mitigated by attestation: the published
  container image is open source, its digest is pinned in the attestation
  token, and the token digest is registered onchain next to the signer.

## Attestation chain

GCP Confidential Space (Intel TDX) mints an OIDC token signed by Google whose
claims include the container image digest and our custom nonces: the enclave's
settlement address and encryption key. The token is published; its hash is
stored onchain via `setTeeSigner`. Anyone can therefore verify: this exact
open-source matching engine, and nothing else, holds the keys the venue obeys.
Outside Confidential Space the engine runs in a clearly labeled dev mode.

## Why a TEE instead of pure smart contracts

Onchain orderbooks are public by construction — that is the problem being
solved. Commit-reveal schemes leak on reveal and break when users do not
return. Threshold encryption needs a committee and still reveals the full book
to it. A TEE keeps intake onchain and settlement verified onchain, and confines
the only secret — pre-trade order contents — to attested hardware.

## FTSO integration

`FtsoV2Adapter` resolves FtsoV2 through the Flare contract registry (stable
address across networks) and normalizes the XRP/USD feed to the venue's price
convention: quote-wei per base-wei, scaled 1e18. The adapter isolates FTSOv2's
payable read interface behind the venue's `IPriceOracle`, so tests run against
a mock and the venue never depends on FTSO internals.

# 2. Libsodium sealed boxes, submitted as onchain calldata

Status: accepted

## Context

Orders must be unreadable by everyone but the enclave, yet intake should not
depend on trusting the operator's server to accept them.

## Decision

Client-side libsodium sealed boxes (X25519 + XSalsa20-Poly1305, ephemeral
sender keys) to the enclave key registered onchain. Ciphertexts are submitted
through `submitOrder` and live in calldata/logs, not contract storage.

## Consequences

- Intake inherits chain properties: censorship of a specific trader is
  visible, submission is timestamped, and the ciphertext count is public.
- Ciphertexts are non-deterministic (ephemeral keys), so identical orders are
  unlinkable. Payloads bind trader and batch id, so a ciphertext replayed by
  another account or into another batch is dropped on decryption.
- The same library runs in browser and enclave; one payload format, one code
  path to audit.
- Cost: ~189-byte calldata per order and no native onchain cancel; a cancel
  is a payload-level concern for a later iteration (orders expire with the
  batch anyway).

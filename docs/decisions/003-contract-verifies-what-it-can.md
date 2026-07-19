# 3. The contract verifies everything it can; the TEE keeps only privacy

Status: accepted

## Context

TEEs fail differently from contracts: side channels, operator pressure,
vendor compromise. A design where enclave compromise moves funds is fragile.

## Decision

Partition trust so the enclave is trusted for privacy and liveness only.
Settlement passes through contract checks that hold regardless of enclave
behavior: signer identity, exact base-volume conservation, funded fills from
frozen balances, buyer-ceil/seller-floor rounding, and a clearing price within
`maxDeviationBps` of the FTSO XRP/USD feed with a freshness bound.

## Consequences

- Worst-case enclave compromise is an information leak plus, at most, a
  legal-but-suboptimal price inside the FTSO band. It is never insolvency,
  never an overdraft, never an off-market clearing.
- The FTSO is load-bearing: an enshrined oracle the venue does not have to
  operate is what makes "off-market clearing" contract-checkable at all.
- Cost: the venue cannot clear genuinely far from oracle consensus even when
  both sides want to (band is a governance parameter, capped at 10%).

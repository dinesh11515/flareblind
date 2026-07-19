# 1. Uniform-price batch auctions, not a continuous orderbook

Status: accepted

## Context

A continuous dark orderbook gives the matcher discretion over ordering within
its private view — exactly the discretion dark pool operators have historically
abused, and it is hard to prove an enclave did not exercise it.

## Decision

Discrete batches cleared at one uniform price that maximizes matched volume,
ties broken toward the FTSO reference. Oversubscribed side filled pro-rata.

## Consequences

- Ordering within a batch is economically meaningless: same price for every
  fill, pro-rata allocation. Front-running and queue games vanish rather than
  being policed.
- The clearing rule is a pure function of the order set. Given a (voluntarily
  disclosed) batch, anyone can recompute the exact result — the enclave has
  no discretion to hide.
- Cost: execution latency up to one batch window. Acceptable for the target
  user (size traders), wrong for latency arbitrage — which is a feature.

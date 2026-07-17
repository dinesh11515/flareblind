# Stillwater

A sealed-order batch trading venue for FXRP on Flare. Orders are encrypted to a
matching engine running inside a TEE, cleared in uniform-price batch auctions,
and settled onchain with the clearing price bounded by Flare's FTSO oracle.

Still water makes no ripples: large XRP orders execute with no pre-trade
information leakage and no price impact games.

## Why

Anyone placing a large order on a public DEX broadcasts their intent to the
whole chain before execution. Searchers front-run it, quote it wider, or trade
against it. Dark pools solve this in traditional markets, but a conventional
offchain dark pool asks users to trust the operator blindly.

Stillwater removes the blind trust:

- **Orders are sealed.** Encrypted client-side to a key that only exists inside
  the enclave. The operator cannot read them.
- **Clearing is fair by construction.** A uniform-price batch auction gives
  every filled order the same price, so ordering within a batch carries no
  advantage.
- **Settlement is verified onchain.** The settlement contract only accepts
  results signed by the attested enclave key, enforces exact conservation of
  funds, and rejects any clearing price that deviates from Flare's FTSO
  XRP/USD feed beyond a set bound.

## Layout

| Path         | What it is                                                    |
| ------------ | ------------------------------------------------------------- |
| `contracts/` | Settlement contract, oracle adapter, tests (Hardhat)          |
| `engine/`    | Matching engine that runs inside the TEE (Node/TypeScript)    |
| `docs/`      | Architecture, trust model, and decision records               |

## Status

Built during [Flare Summer Signal](https://dorahacks.io/hackathon/flaresummersignal)
(June–August 2026). Targets Coston2 testnet first, Flare mainnet after audit.

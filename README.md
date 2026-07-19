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
| `web/`       | Trader terminal (React/Vite)                                  |
| `docs/`      | Architecture, trust model, and decision records               |

## Quickstart (local)

```sh
# terminal 1 — chain
cd contracts && npm install && npx hardhat node

# terminal 2 — deploy, register enclave keys, run the engine
cd contracts && npx hardhat run scripts/deploy.ts --network localhost
cd ../engine && npm install
POOL_ADDRESS=<pool from deploy> npx tsx scripts/register.ts
# then paste the exports it prints and:
npm start

# terminal 3 — trader terminal
cd web && npm install && npm run dev
```

Open the printed localhost URL, connect a wallet on the hardhat network
(chain id 31337, RPC http://127.0.0.1:8545), paste the pool address, mint
test funds, deposit, and trade. `npm run demo` in `engine/` runs the whole
flow headlessly instead.

Tests: `npx hardhat test` in `contracts/` (19), `npm test` in `engine/` (18).

## Status

Built during [Flare Summer Signal](https://dorahacks.io/hackathon/flaresummersignal)
(June–August 2026). Runs end to end locally today; Coston2 deployment and the
GCP Confidential Space enclave are next — see [docs/plan.md](docs/plan.md).

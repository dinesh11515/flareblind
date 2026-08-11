# Flareblind

A sealed-order batch trading venue for FXRP on Flare. Orders are encrypted to a
matching engine running inside a TEE, cleared in uniform-price batch auctions,
and settled onchain with the clearing price bounded by Flare's FTSO oracle.

Flare sees settlement. The book stays blind: large XRP orders execute with no
pre-trade size leakage and no price-impact games.

## Why

Anyone placing a large order on a public DEX broadcasts their intent to the
whole chain before execution. Searchers front-run it, quote it wider, or trade
against it. Dark pools solve this in traditional markets, but a conventional
offchain dark pool asks users to trust the operator blindly.

Flareblind removes the blind trust:

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

| Path              | What it is                                                 |
| ----------------- | ---------------------------------------------------------- |
| `contracts/`      | Settlement contract, oracle adapter, tests (Hardhat)       |
| `engine/`         | Matching engine that runs inside the TEE (Node/TypeScript) |
| `web/`            | Trader terminal (React/Vite)                               |
| `ARCHITECTURE.md` | How the three pieces fit, and the trust model              |

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

`npm run dev` offers the local hardhat chain alongside Coston2; a deployed
build is Coston2 only. Open the printed URL, connect a wallet on the hardhat
network (chain id 31337, RPC http://127.0.0.1:8545), paste the pool address
into Market, mint test funds, deposit, and trade.

`npm run demo` in `engine/` runs the same flow headlessly against a bare
hardhat node, asserting the settled balances to the wei.

Tests: `npm test` in `contracts/` (19) and in `engine/` (24).
`npm run typecheck` in `engine/` and `web/`.

## Live demo (Coston2)

**App:** https://flareblind.vercel.app/venue

Connect a wallet on **Coston2** (chain 114). Get C2FLR from the
[Flare faucet](https://faucet.flare.network/coston2) and FTestXRP / USD₮0 from
the FAssets faucet, then:

1. Deposit into the venue
2. Seal a **buy** and a **sell** in the same batch (same clearing window)
3. Wait ~5 minutes for the engine to close and settle the batch

A single-sided order clears with zero fills — the batch auction needs both sides
to cross.

| | |
| --- | --- |
| Pool | [`0xaB54f8a32c9ca36A12f507649bf66916b20bD2b0`](https://coston2-explorer.flare.network/address/0xaB54f8a32c9ca36A12f507649bf66916b20bD2b0) |
| FTSOv2 adapter | [`0x609328dFA6066E43b5B3e15A7ad103Ba7985116B`](https://coston2-explorer.flare.network/address/0x609328dFA6066E43b5B3e15A7ad103Ba7985116B) |
| Base (FTestXRP) | `0x0b6A3645c240605887a5532109323A3E12273dc7` |
| Quote (USD₮0) | `0xC1A5B41512496B80903D1f32d6dEa3a73212E71F` |

Full deployment metadata: [deployments/coston2.json](deployments/coston2.json).
Matching engine runs on Railway (dev attestation mode); GCP Confidential Space
with Intel TDX attestation is the production path.

Built for [Flare Summer Signal](https://dorahacks.io/hackathon/flaresummersignal)
(June–August 2026).

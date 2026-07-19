# Plan to submission (deadline 2026-08-14 19:59 UTC+?)

Submission target: DoraHacks BUIDL entered in both bounties — Interoperable
Asset Products (FXRP venue) and Confidential Compute Apps (TEE matching).
Submit by August 12 to keep two days of margin.

## Done (week of July 13)

- Settlement contract with FTSO-bounded, conservation-checked settlement; 19 tests.
- Matching engine: sealed boxes, uniform-price clearing, funding filter; 17 tests.
- End-to-end demo on a local chain, verified to the wei.
- Trader terminal (web), deploy and operator scripts.

## Week of July 20 — Coston2

- Deploy venue to Coston2 with FtsoV2Adapter on the real XRP/USD feed.
- Decide base token: canonical FTestXRP if mintable for testers, else mock.
- Engine hardening: crash-safe restart on a Sealing batch, RPC retry/backoff,
  handle settle reverts by re-reading state.
- UI: countdown from chain time, Coston2 network prompts, deployed-address default.
- Post the venue in the Flare hackathon Telegram; recruit 5-10 testers.

## Week of July 27 — Confidential Space

- Containerize the engine; pin image digest; deploy to GCP Confidential Space
  (Intel TDX).
- Real attestation: custom-audience token with signer + encryption key nonces;
  publish the token; register its digest onchain; document the verify steps.
- Batch-timeout escape hatch contract change if time allows (void a stalled
  Sealing batch trustlessly).

## Week of August 3 — product and evidence

- Tester feedback pass on the terminal; empty/error states; mobile layout.
- Collect traction evidence: settled batches on Coston2, distinct traders,
  tester quotes.
- Write the BUIDL text: problem, user, what runs where, trust assumptions,
  Flare integrations (FXRP, FTSO, registry), roadmap (FAssets v1.3 CEX
  onboarding, FBTC pair, fee model).
- Record and cut the 3-minute demo video against Coston2.

## Week of August 10 — submit

- Freeze features Monday; fix only.
- Final run-through of README quickstart on a clean machine.
- Submit BUIDL (both bounties) by August 12; announce in Telegram.

## Judging criteria mapped

- Product usefulness: size traders on the largest XRPfi venue lack a dark
  execution option; this is that product.
- Flare integration: FXRP as the traded asset, FTSO as the settlement price
  bound, contract registry for upgrades — all load-bearing, none decorative.
- Technical execution: working end to end today on a local chain; Coston2 and
  Confidential Space are deployment, not construction.
- Evidence of new work: repo history is entirely within the program window.
- Future potential: FBTC/FDOGE pairs as FAssets expand, institutional OTC
  matching, fee on matched volume.

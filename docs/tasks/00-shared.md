# Shared tasks (all three)

Work that does not belong to one area: repo setup, decisions, non-engineering work, and the integration checkpoints that close each milestone.

Marking: `- [ ]` not started, `- [~]` in progress, `- [x]` done. Every task has one driver. The driver makes sure it gets done, even when all three contribute. Drivers below are a starting split and can be swapped by agreement.

---

## M0. Foundation

- [~] **X-01 · Monorepo and repo rules** (driver: Wangsit)
  - Do: create the repo with the layout in 02; pnpm workspaces and Turborepo; `CODEOWNERS` per 06; branch protection on `main`; PR template; MIT license file.
  - Done when: all three have cloned it, a PR to `main` requires passing CI, and GitHub requests review from the right owner automatically.
  - Note: done so far: private repo `wngstnr-code/levra`, pnpm workspaces, Turborepo, PR template, MIT license. Still to do: add Dharu and Nabil as collaborators, `CODEOWNERS` (needs their GitHub usernames), branch protection on `main`, and a required CI check once SC-01, BE-01 and FE-01 add their workflows.

- [~] **X-02 · Product name and domain** (driver: Nabil)
  - Do: agree on a name; check the domain and social handles; answer Q-01.
  - Done when: the name is recorded in 09 and the domain is registered.
  - Note: the name is decided, Levra (D-15). Still to do: domain, social handles, and a check against the close names listed under Q-01.

- [ ] **X-03 · Wallets, funds and multisig** (driver: Wangsit)
  - Do: one development wallet per person with a little MON and USDC; a team treasury; a multisig on Monad with all three as signers.
  - Done when: each person has sent one real transaction on Monad mainnet, and the multisig address is in 05.

- [ ] **X-04 · Interface freeze** (driver: Dharu)
  - Needs: SC-03, BE-02, FE-04.
  - Do: one session where all three walk through 03 together, screen by screen and flow by flow, and check that nothing a screen or a service needs is missing.
  - Done when: the status table in 03 says "frozen" for contracts and API, and the date is in the daily log.

---

## Integration checkpoints

A milestone is not finished until its checkpoint passes. Someone who did not write the part runs the flow on mainnet with real money, then records transaction hashes and anything odd in PROGRESS.md.

- [ ] **I-0 · Foundation (closes M0)**
  - Done when: the repo builds for all three; ABIs and API schemas are frozen (X-04); every spike (SC-02, SC-04, SC-05, SC-06, BE-04, BE-05, BE-06) has its result written in the docs; the oracle logger (BE-03) is running. BE-03 needs a full week, so it may finish during M1.

- [ ] **I-1 · Long works for real (closes M1)**
  - Run by: Dharu or Nabil, not Wangsit.
  - Done when: through the staging app on mainnet, a $20 long on aQQQ is opened in one confirmation, collateral is added, the position is reduced, then fully closed. Every number on screen matches the block explorer. The Positions page updates within seconds.

- [ ] **I-2 · Short and Earn work for real (closes M2)**
  - Run by: Wangsit or Dharu, not Nabil.
  - Done when: a short on aQQQ is opened and closed; USDC is lent to the vault and withdrawn; aQQQ is lent to the short market and withdrawn; all five markets show correct numbers; one long on aHOOD and one on aBIL are opened and closed.

- [ ] **I-3 · Protection works through a real close (closes M3)**
  - Run by: all three, on a real Friday.
  - Done when: a test position with protection on, sitting above the closed soft limit, is auto-deleveraged before the market closes; a test position with protection off receives the three alerts and is not touched; the soft limit on screen changes at the pre-close window; on the local fork, the liquidator bot closes a position made unhealthy.

- [ ] **I-4 · A newcomer from another chain (closes M4)**
  - Run by: someone with a fresh wallet that holds no MON.
  - Done when: funds sent from two different chains arrive as USDC on Monad, the first position is opened without getting MON from anywhere else, and a withdrawal back to another chain completes.

- [ ] **I-5 · Hardened (closes M5)**
  - Done when: audit findings rated high and medium are fixed and rechecked; every monitoring alert has been triggered once on purpose; the incident runbook has been drilled once; the compliance gates block a restricted region and an unsigned user.

- [ ] **I-6 · Production (closes M6)**
  - Done when: one full round (deposit, long, short, Earn, close, withdraw) runs on the production deployment; a person outside the team completes Flows 1 to 5 without help; every line in "Public launch gates" in 08 is ticked.

---

## Non-engineering work

Without these the product can be built but cannot be opened to the public.

- [ ] **X-10 · Legal counsel** (driver: Wangsit, due by M5, start in M2)
  - Do: find counsel who knows tokenized securities and DeFi; get a written view on margin lending and shorting of tokenized stocks, on geo-blocking, and on what the web app may and may not do.
  - Done when: Q-06 has a written answer in 09.

- [ ] **X-11 · Terms of use, privacy policy, risk disclosure** (driver: Nabil, due by M5)
  - Needs: X-10.
  - Do: write the three texts. The risk disclosure must cover every item listed in 08.
  - Done when: the texts are reviewed by counsel and ready for FE-50 and FE-53.

- [ ] **X-12 · Talk to Anchored** (driver: Wangsit, start in M0)
  - Do: ask in writing: may their tokens be used as collateral and lent in Morpho markets; can the Morpho or router address be denylisted; what happens to dividends for tokens held by Morpho; how short borrowers are treated on dividend dates; how to become a partner so large liquidations can be redeemed instead of sold on a thin exchange.
  - Done when: Q-04 and Q-05 are answered in 09, or Anchored has declined to answer and that is recorded.

- [ ] **X-13 · Auditor** (driver: Wangsit, start in M3)
  - Do: collect quotes and dates from at least two audit firms; decide where the money comes from.
  - Done when: Q-12 is answered and a start date is booked.

- [ ] **X-14 · Treasury and seed funds** (driver: Wangsit, due by M2)
  - Do: decide how much team money seeds each market and the vault, and whether any goes into exchange liquidity. Answer Q-21.
  - Done when: amounts are recorded in 09 and the funds are in the multisig.

- [ ] **X-15 · Be visible where lenders look** (driver: Dharu, due by M6)
  - Do: get the markets and the USDC vault listed in the Morpho app and in the data sites lenders use; check what each one requires.
  - Done when: the vault can be found from outside our own app.

- [ ] **X-16 · Hackathon submission package** (driver: Nabil)
  - Do: confirm the rules on the official page; choose bounties (Q-13); root README with what it is, how to run it, contract addresses, real transaction hashes and the AI tool disclosure; demo video of at most 3 minutes showing real Monad transactions; submit to Track 01.
  - Done when: the submission is confirmed received.

- [ ] **X-17 · First users** (driver: Dharu, start in M2)
  - Do: list current holders of aQQQ and aHOOD and the market makers on their pools from chain data; contact them one by one with the lending offer.
  - Done when: at least five outside addresses have lent or borrowed, or the reasons they declined are written down.

- [ ] **X-18 · xStocks** (driver: Dharu, after M6)
  - Do: follow the xStocks launch on Monad; check each stock against "Requirements for adding a new stock" in 04; decide which oracle serves them. Answer Q-20.
  - Done when: the first xStocks market is live, or the blocker is recorded.

- [ ] **X-19 · Support channel** (driver: Nabil, due by M6)
  - Do: one public place for questions and one private channel for security reports.
  - Done when: both are linked from the Help page.

- [ ] **X-20 · Legal entity** (driver: Wangsit, due by M6)
  - Needs: X-10.
  - Do: decide the form and place of the entity that operates the web app and holds the fee recipient.
  - Done when: the decision is recorded in 09.

# Frontend tasks (Nabil)

Folder: `apps/web/`.

Marking: `- [ ]` not started, `- [~]` in progress, `- [x]` done. Tick the box in the same PR as the work.

Required reading before you start: 01-product.md (especially the seven flows and "What must always be shown to the user"), 02-architecture.md, 03-interfaces.md.

Four rules for the frontend:

1. No fake numbers on screen. Before the backend is ready, read directly from the chain. If data is not there yet, show an empty or loading state, not sample numbers.
2. All money math uses integers (`bigint`). Fractions only appear when displaying.
3. Do not rewrite the formulas. Use `packages/shared/math.ts`.
4. Before the wallet opens, the user has already read, in plain sentences, what they are about to sign.

---

## M0. Foundation and spikes

- [x] **FE-01 · Set up `apps/web`**
  - Do: Next.js project; Tailwind; style and type checks; CI on GitHub Actions; a preview deployment for every PR.
  - Done when: an empty page is deployed and every PR gets a preview address.
  - Note: `apps/web` exists with Next.js 16, Tailwind 4, ESLint, type checks, Vitest and a CI workflow (`.github/workflows/web.yml`). Hosting: Vercel project under Wangsit's account (an import from Nabil's Hobby account failed on the private repo), root directory `apps/web`, live at `https://levra-mon.vercel.app`. Sign-in works on the Vercel domain after adding it to the Privy allowed domains. Vercel posts a preview address on every PR (seen on PR 25). Done on 13 October 2026. `apps/web` uses TypeScript 6 because typescript-eslint does not support TypeScript 7 yet.

- [x] **FE-02 · Wallet and network**
  - Do: connect a plain wallet on Monad (chain 143); sign in by email or passkey without an existing wallet (D-16); switch network automatically; show the MON and USDC balances. The provider is Privy (D-22). Confirm with Wangsit that its embedded wallet is a normal key wallet, because that decides whether the signature path in 03 section 3 works.
  - Done when: both sign-in paths work, real balances show, a user can export or recover the created wallet, and the wallet type finding is recorded under Q-02 in 09.
  - Note: provider chosen: Privy (D-22). Its documentation says the embedded wallet is a normal key wallet that supports typed-data signing and export. Built: Privy with wagmi, sign-in by wallet, email or passkey, an embedded wallet for users without one, automatic switch to Monad, MON and USDC balances, export of the embedded wallet key. Done on 13 October 2026 with the Privy app ID: sign-in by email, passkey and external wallets (Rabby and others) works, an embedded wallet is created for users without one, MON and USDC balances read from Monad, and export of the embedded wallet opens Privy's export window with the recovery phrase. A `signTypedData` call is not run yet. It is checked in FE-11 with the first-use signatures. The Privy dashboard must list each origin exactly, for example `http://localhost:3000` (not `https://`). Without `NEXT_PUBLIC_PRIVY_APP_ID` the app shows "Sign-in unavailable" and chain reads still work.

- [x] **FE-03 · Markets page with data straight from the chain**
  - Do: read the price and market session of QQQ, HOOD and BIL directly from the Anchored oracle (address and data layout in 05). Show them in a simple list.
  - Done when: real prices and market sessions show and change with the chain, without a backend.
  - Note: done on 13 October 2026. `/markets` reads `latestPrice` for every stock in `packages/shared/markets.ts` every 10 seconds and shows price, best bid and ask, session and source quote age. Checked against mainnet: aQQQ $741.45, aHOOD $108.75, aBIL $91.51, all `PRE_MARKET`, quote age 16 minutes. A stale price flag is left to FE-13, which uses `oracleStale` from the API.

- [~] **FE-04 · Screen design**
  - Do: wireframes for all pages in 02 and the seven flows in 01; a component list; all states of each screen (loading, empty, error, stale price, market closed, pre-close window, restricted region); colors, fonts and spacing as one system.
  - Done when: Wangsit and Dharu have seen it and there is no data that a screen needs but is missing from 03. If there is, propose an addition to 03 now.
  - Note: a first written draft of every screen, its data, actions and states is in `docs/10-screens.md`, with a list of data the API does not provide yet. Nabil still has to review it, design the layouts and the design system.
  - Note: low-fidelity wireframes of every screen are in Figma, all on one page: https://www.figma.com/design/GaE4wHi18JRAhXl1obEpbY (13 October 2026). Sections: foundations and kit, entry and gates, markets, trade, trade transaction states, positions, earn, deposit and withdraw, settings, help, shared states. Each screen has a note with its data source, states and the task it belongs to. Still open: review by Wangsit and Dharu, the visual design and design system, mobile layouts.

- [~] **FE-05 · Design system in code**
  - Needs: FE-04 (the Figma page "Design").
  - Do: the design tokens (colours, type, radius, motion) as Tailwind theme values in `apps/web/app/globals.css`; the font stack (SF Pro on Apple devices, Inter elsewhere); base components in `apps/web/components/ui/` (button, card, change pill, session badge, money with faint decimals); the header with a live market session; existing screens moved onto the tokens.
  - Done when: the tokens and base components match the Figma design system, and no screen uses colours outside the tokens.
  - Note: built on 13 October 2026 on `fe/FE-05-design-system`. Checked by build and the generated CSS. Not verified: the wide display width (`font-stretch`) only works with Apple's system font, and continuous corners (`corner-shape`) only work in browsers that support it; other browsers show normal width and normal rounded corners. A visual check in the browser by Nabil is still open.

---

## M1. Core long

- [~] **FE-10 · Markets page**
  - Needs: BE-02. Data from BE-11; before that, straight from the chain.
  - Do: a list of stocks with price, market session, current limit, maximum leverage, borrow rate, available funds, and DEX-to-oracle deviation.
  - Done when: all numbers match `GET /v1/markets`; prices change through the stream without a reload.
  - Note: built on 13 October 2026 (`fe/FE-10-13-m1-core-long`): `/markets` reads `GET /v1/markets`, keeps prices current from `/v1/stream` (server-sent events), and shows price, session and quote age straight from the oracle when the service is not configured. Limits and rates are never filled with stand-in numbers. Waiting for the staging API to be hosted, with CORS, to check against `/v1/markets` (blocker in PROGRESS).

- [~] **FE-11 · Long form**
  - Needs: SC-03, BE-02. Quotes from BE-12; for tests on the local fork it needs SC-14.
  - Do: inputs for amount and leverage with their limits; a pre-confirmation summary with all items in Flow 2 in 01; the approval steps (USDC approval and Morpho authorization) combined into one confirmation when possible; a transaction tracker; a result screen; translation of every contract error into a plain sentence; the quote is requested again when it goes stale; the confirm button disappears when there is a `block` warning.
  - Done when: opening a long works on the local fork and on mainnet staging; the transaction data from the backend is checked first (the target must be the router address from `packages/shared`).
  - Note: built on 13 October 2026: `/trade` with margin, leverage within the market maximum, slippage, the summary of Flow 2 (stock and value, debt, exchange vs oracle price, impact, fee, LTV ring against soft and hard limits, liquidation price and distance, gap scenarios), a details sheet, first-use signatures in one confirmation (D-20), approvals when a token has no permit, a transaction sheet with plain sentences before the wallet opens, re-quoting before expiry, and a hidden confirm button on a `block` warning. Every transaction is decoded and checked against the router address and the market on screen before the wallet sees it (D-19). Contract errors become sentences in `apps/web/lib/i18n`. Not yet run against the API: waiting for staging hosting and CORS. `signTypedData` with the Privy embedded wallet (Q-02) is checked on the first real run.

- [~] **FE-12 · Positions page**
  - Needs: BE-14.
  - Do: a list of positions with value, debt, profit and loss, an LTV bar (with marks for the soft limit and the hard limit), and the distance to the liquidation price; actions to add collateral, remove collateral, reduce and close; history.
  - Done when: all four actions work on staging; the position changes on screen within a few seconds after the transaction.
  - Note: built on 13 October 2026: `/positions` with total equity, a card per position (LTV ring with soft and hard marks, value, debt, equity, entry, P&L, liquidation price and distance, worst gap), and a manage sheet for add, remove and repay (`/v1/quote/collateral`) and reduce and close (`/v1/quote/close`). The history tab explains each item in a sentence. Waiting for staging hosting and CORS to run the four actions.

- [~] **FE-13 · Always-visible states**
  - Do: a market session badge on all pages; a banner when the oracle price is stale; a banner when the backend or the keepers have a problem (from `/v1/status`); one consistent error message style.
  - Done when: each state can be triggered and shows correctly.
  - Note: built on 13 October 2026: the session badge is in the header on every page, read from the oracle. Banners for no service, an unreachable service, a stale price and background services behind (`/v1/status`). One empty and error style (`EmptyState`). The stale and service rules are unit tested. Checking each state live waits for the staging API.

---

## M2. Short and Earn

- [~] **FE-20 · Short form**
  - Needs: FE-11, BE-20.
  - Do: inputs for collateral and the value of the borrowed stock; a summary as in Flow 3; a short explanation of how short works and that the sale proceeds are held as collateral; closing a short shows the leftover stock that comes back.
  - Done when: open, reduce and close of a short work on staging.
  - Note: built on 13 October 2026 (`fe/FE-20-22-m2-short-earn`): the Short tab of `/trade` (collateral, short size up to the market maximum, the Flow 3 summary, a plain explanation that the sale proceeds stay as collateral) and, on close, the stock that comes back. aBIL has no short tab (D-11). The API still answers short quotes with BAD_REQUEST (BE-20), which the form shows as is.

- [~] **FE-21 · Earn page**
  - Needs: BE-21, SC-23.
  - Do: the choice to lend USDC (to the vault) and stocks (to a market); interest, the share that is borrowed, the amount that can be withdrawn now; the lender risk disclosure before confirmation; lending and withdrawing call the vault and Morpho directly (D-07).
  - Done when: lending and withdrawing work for USDC and for one stock on staging.
  - Note: built on 13 October 2026: `/earn` lends USDC to the vault (ERC-4626 `deposit`, `withdraw`, `redeem`) and stock to its short market on Morpho (`supply`, `withdraw`), both direct calls (D-07), with an approval transaction first when needed. The user's deposits, wallet balances, allowances, totals and borrowed share are read straight from the vault and Morpho, so lending and withdrawing work without the service. APY, fee and earned interest come from `/v1/earn` and `/v1/earn/:address` (BE-21), and show a dash until then. The lender risk statement must be ticked before the first supply; the choice is kept per address in the browser.

- [~] **FE-22 · Market detail page**
  - Needs: BE-23.
  - Do: market depth (price impact per size), DEX-to-oracle deviation and its history, hard and soft limits with an explanation, interest history, the age of the oracle price.
  - Done when: all five markets show with numbers from the backend.
  - Note: built on 13 October 2026: `/markets/QQQ`, `/HOOD`, `/BIL` with the long and short market, limits with a plain explanation and the worst gap from `gaps.ts`, exchange vs oracle with its history, the lending market with a utilization ring, market depth by size and the borrow rate history. Data from `/v1/markets/:symbol` (BE-23); the price and session come from the oracle meanwhile.

---

## M3. Market-hours protection

- [~] **FE-30 · Protection and before close**
  - Needs: SC-30, BE-30.
  - Do: a protection toggle per market with an honest explanation (what it does, when, what it costs, what is not guaranteed); a countdown to the market close; the soft limit on the position bar moves when the pre-close window starts; a banner for positions above the limit with two buttons: add collateral and reduce the position.
  - Done when: switching protection on and off is recorded on chain; the display changes correctly in all four market-hours states.
  - Note: built on 13 October 2026 (`fe/FE-30-33-m3-protection`): a protection switch per market on each position and in Settings, read from `protectionEnabled` and changed with a direct `setProtection` call, with a sheet that says what it does, when, what it costs and what is not guaranteed; the countdown to the close from `/v1/session`; inside the pre-close window the header badge shows the countdown, the LTV ring shows the new soft mark and the old one faintly, and a banner per position above the limit offers add collateral and reduce. Waiting for the staging API (session) and SC-30 on mainnet to check it on chain.

- [~] **FE-31 · Alert settings**
  - Needs: BE-33.
  - Do: sign in with a wallet signature; choose the channel and the types of alerts.
  - Done when: the choices are saved and a test alert arrives.
  - Note: built on 13 October 2026: Settings signs in with a wallet signature (SIWE built with viem, `/v1/auth/nonce` and `/v1/auth/siwe`), then reads and saves `/v1/alerts`: email, the Telegram link status, before-close, an LTV threshold, protection, liquidation and deposit alerts. A test alert needs an endpoint that 03 does not have yet. Waiting for BE-33.

- [~] **FE-32 · Gap scenarios panel**
  - Needs: BE-34.
  - Do: in the pre-confirmation summary and on each position: what happens if the market opens with the worst five-year gap, and a slider to try other numbers.
  - Done when: the numbers match `packages/shared/math.ts`.
  - Note: built on 13 October 2026: the trade summary and every position show the gap scenarios from the service and a slider for any gap from −50% to +50%, computed with `ltvAfterGapWad` from `packages/shared/math.ts`, so the numbers match the shared formula by construction.

- [~] **FE-33 · Explanation of auto-deleverage and liquidation**
  - Needs: BE-14.
  - Do: in the history, auto-deleverage and liquidation events are explained in plain sentences: what happened, at what price, what it cost, what is left.
  - Done when: both test events show with the correct explanation.
  - Note: built on 13 October 2026: every history item, including protection and liquidation, is one plain sentence with what happened, the amount, the price and the cost (`apps/web/lib/historyText.ts`, unit tested in English and Indonesian). For a liquidation the API does not yet give the collateral taken and the bonus separately (10-screens.md); the sentence uses the amounts it has. Checking both events live waits for the staging API.

---

## M4. Cross-chain deposits

- [~] **FE-40 · Deposit flow**
  - Needs: BE-40.
  - Do: choose the source chain and token; show the deposit address, QR code, the amount that will arrive, the estimated time and the expiry time; a status tracker; when funds arrive, guide the user straight to the transaction form; handle expiry and refunds.
  - Done when: a real deposit from another chain is completed from start to finish through the app.
  - Note: built on 13 October 2026 (`fe/FE-40-41-m4-deposits`): `/deposit` picks the origin chain and token from `/v1/deposit/tokens`, takes the amount, the refund address and whether to send MON, then shows the deposit address with a QR code, the memo, what arrives, the time and an expiry countdown, and follows `/v1/deposit/:id` through seen, processing and arrived, or refunded, failed or expired, with a button to Trade on arrival. Transfer ids are kept in the browser per address, since the API has no list yet (10-screens.md). Waiting for BE-40 to run a real deposit.

- [~] **FE-41 · Withdraw flow**
  - Needs: BE-41.
  - Done when: a real withdrawal to another chain is completed through the app.
  - Note: built on 13 October 2026: the Withdraw tab takes the USDC amount, the destination chain and token and the recipient, gets `/v1/withdraw/quote`, sends USDC on Monad to the quoted address with a plain-sentence sheet first, and follows the status. Waiting for BE-41 to run a real withdrawal.

---

## M5. Hardening

- [ ] **FE-50 · Compliance gates**
  - Needs: BE-52, X-11.
  - Do: a screen for restricted regions; acceptance of the terms and the risk disclosure on the first visit, with a wallet signature.
  - Done when: a user from a restricted region cannot reach the transaction forms; a new user cannot transact before accepting.

- [ ] **FE-51 · Mobile, accessibility and speed**
  - Done when: all flows are comfortable on a phone screen; the app can be used with a keyboard; colors have enough contrast; the main page opens quickly on a slow connection.

- [ ] **FE-52 · End-to-end UI tests**
  - Needs: SC-14.
  - Do: Playwright tests against the local fork for all seven flows.
  - Done when: the tests run on GitHub Actions on every PR to `apps/web`.

- [ ] **FE-53 · Help page**
  - Needs: X-11, SC-61.
  - Do: how the product works, an explanation of the risks, FAQ, how to revoke the Morpho authorization, the list of contract addresses, terms of use, privacy policy.
  - Done when: every term in the app has an explanation that can be opened from the place where the term appears.

- [ ] **FE-54 · Error reporting and usage metrics**
  - Do: reporting of app errors to the team; usage metrics that respect privacy (store no more than needed).
  - Done when: a test error reaches the team; the funnel from visit to first position can be seen.

- [ ] **FE-55 · Two languages**
  - Do: all text goes through translation files; languages as decided in Q-14.
  - Done when: no text is embedded in components; switching language does not break the layout.

---

## M6. Launch

- [ ] **FE-60 · Home page and domain name**
  - Needs: X-02.
  - Do: a home page that explains the product in a few sentences; a preview image for links; the production domain name.
  - Done when: the production app runs on its domain name against the production contracts and backend.

- [ ] **FE-61 · Final check**
  - Do: go through every screen and every state one by one in production.
  - Done when: there is no dead button, unfinished page, placeholder text or sample number.

# Questions for Anchored

Status: draft, not sent. Task X-12, driver Wangsit. Updated on 13 October 2026 after the staging deployment. Fill in the sender details and the recipient before sending. Answers go to 09 (Q-04, Q-05, Q-23) and 05.

What we already read ourselves is listed first, so the message asks only what we could not find.

## What we know

From Anchored's public documentation and from the chain on 13 October 2026 (details in 05):

- The stock tokens are beacon proxies and consult a compliance contract with a denylist and an approved list.
- Morpho's contract on Monad is not on the denylist today.
- The stock oracle gives price, best bid, best ask and session. It has a 10 minute heartbeat, the source quote can be about 15 minutes delayed, and the last price is carried forward while the market is closed.
- Dividends are paid in USDC to the wallet linked to an Anchored account.
- Products are for professional and qualified investors, with a list of prohibited jurisdictions.

## Message

Subject: Building a lending and margin product on Anchored tokens on Monad

Hello Anchored team,

We are a team of three building Levra, a margin account for tokenized stocks on Monad. Users can buy your tokens with borrowed USDC, borrow your tokens to sell them, or lend them for interest. We do not run our own exchange or lending pool. Trades go through the existing pools on Uniswap and Monday Trade, and lending happens in new isolated markets on Morpho. User funds stay in the user's own Morpho position. Our web app will block the jurisdictions on your prohibited list.

A small staging version is live on Monad mainnet with our own funds only: five isolated Morpho markets for aQQQ, aHOOD and aBIL, with position caps of 500 to 1,000 USDC. It is not audited and not open to the public. The code and the contract addresses are public at https://github.com/wngstnr-code/levra (see `docs/public/contracts.md`). The router is `0xa3F19ac30Be34028D9a0CaAcaF00c0b7295Fc2E6`.

We want to build this in a way you are comfortable with, so we would like to ask a few things before we open it to anyone else.

Permission and compliance

1. Do your terms allow your tokens to be supplied as collateral and lent out in Morpho markets on Monad, as our staging markets do?
2. Under what conditions would you add a contract such as Morpho, or a router that acts for users, to the denylist? Would you give notice first?
3. Does an ordinary token transfer require only that both addresses are not on the denylist, or must they be on the approved list?
4. The tokens and the compliance contract are upgradeable. Is there a notice period or a timelock before an upgrade?

Corporate actions

5. When a stock pays a dividend, what happens to tokens held by a contract such as Morpho? Is the dividend sent to the contract address, held back, or reflected some other way?
6. How should a user who has borrowed your token be treated on a dividend date?
7. How is a stock split applied? Do token balances change, does the price per token change, and at what moment does the oracle show the new price?
8. When a single stock is halted for a corporate action, can the token still be transferred, and what does the oracle report during the halt?

Oracle

9. Our markets read your StockOracle on Monad (`0x037848af338C38e1e0AB722bE80BF4C2E612a1F7`) as their price source. Are you comfortable with that use?
10. Does the oracle keep publishing while the session is closed, and at what interval?
11. Is there a notice period before the oracle proxy is upgraded or the feed for a symbol is removed?

Working together

12. Can a liquidator redeem tokens with you directly instead of selling into a thin pool? What does becoming a partner require, and is there a minimum size?
13. Which tokens do you expect to have exchange liquidity on Monad in the coming months? We currently find routes for aQQQ, aHOOD and aBIL only.
14. Is there anything in the way we plan to block jurisdictions that you would want done differently?

We can share our design documents and contract interfaces if that helps. Thank you for your time.

[Name], for the Levra team
[Contact]

# Bug bounty program (draft)

Status: draft for task SC-56. Not published. Reward amounts and the reporting channel are not decided (Q-29). The legal wording has not been reviewed by counsel (X-10).

## Purpose

Levra's router holds an authorization from every user on Morpho. A flaw in it could reach many positions at once. We pay people who find such a flaw and tell us privately before anyone can use it.

## In scope

The contracts deployed on Monad mainnet (chain ID 143), at the addresses in [`contracts/deployments/monad.json`](../../contracts/deployments/monad.json), and their source in [`contracts/src`](../../contracts/src):

| Contract | Address |
|---|---|
| `MarginRouter` | `0xa3F19ac30Be34028D9a0CaAcaF00c0b7295Fc2E6` |
| `RiskManager` | `0xe8A2088020Ea61B77e33Df953abcc4004d9FC74F` |
| `Lens` | `0xd3835f7bd58BFBE59Eae6210Bf7257405aF72cb8` |
| `Liquidator` | `0x56d40aCD99F1537f2ecfCD6ba7B1E879F9aaFd39` |
| `SessionOracle`, five instances | Listed per market in the deployment file |

The backend and the web app join the scope when they are in production.

## Out of scope

- Morpho, KyberSwap, the exchange pools, the Anchored tokens and the Anchored oracle. Report those to their own teams. We still want to hear about a flaw in how Levra uses them.
- Risks we already describe in [the public contract documentation](../public/contracts.md) and in the threat list of [07-testing-and-security.md](../07-testing-and-security.md): the issuer can block or change a token, the price can jump when the market reopens, the pools are small, the owner can change the settings listed there.
- Anything that needs the owner key, a keeper key or a user's own key to be stolen first.
- Losses from price movement, slippage a user accepted, or a failed transaction that only costs gas.
- Findings from automated tools with no working example.
- Attacks on the team's accounts, phishing, and denial of service against the website.

## Severity

| Level | Meaning | Examples |
|---|---|---|
| Critical | Theft or permanent lock of funds of users who did nothing wrong | Using the router's authorization on someone else's position. Making the router call an address other than the fixed exchange. Reducing a position that has protection off |
| High | Theft or lock of funds that needs an unusual but realistic condition, or a way to block closing | A keeper taking more than the fee and the price bound allow. A state in which a user cannot close, repay or add collateral |
| Medium | A rule in the risk layer can be bypassed without direct loss | Opening above the soft limit or the position cap. Opening on a stale price |
| Low | Wrong numbers or wrong events with no effect on funds | `Lens` returning a wrong liquidation price. An event with a wrong amount |

The team decides the level, and explains the reason in writing.

## Rewards

Not decided. See Q-29 in [09-decisions-and-questions.md](../09-decisions-and-questions.md).

## How to report

The private channel is not open yet (Q-29). When it is, a report should contain:

1. The contract and function.
2. What goes wrong and who loses what.
3. A working example as a Foundry test on a fork of Monad mainnet. `contracts/test/Base.t.sol` has the setup.
4. Your suggested fix, if you have one.
5. An address on Monad for the reward.

Do not open a public GitHub issue for a security report.

## Rules

- Test on a local fork. Do not test against positions that are not yours on mainnet.
- Do not publish or share the finding before we confirm it is fixed.
- One reward per flaw. The first complete report wins.
- Team members and people who worked on the code are not eligible.

## What we promise

| Step | Time |
|---|---|
| Confirm that the report arrived | 2 days |
| First assessment and severity | 7 days |
| Fix or a written plan for critical and high findings | 30 days |
| Payment | 14 days after the fix is confirmed |

These times are a proposal. If a finding puts funds at risk right now, the guardian pauses new positions and tightens limits first (see "If something goes wrong" in 07). Closing stays open at all times.

We will not take legal action against anyone who follows these rules. This sentence needs review by counsel before it is published.

# Keeper keys

How the backend's hot keys are made, stored, funded, rotated and dropped after a leak. Task BE-55. Read together with `07-testing-and-security.md` (keeper keys) and `docs/runbook.md` (situation 5).

Status: tools written and the leak drill passed on a local fork on 14 October 2026. Not yet done on mainnet: the role addresses wait for the owner's grant (Wangsit), and after SC-55 the owner is the multisig.

Railway stopped on 20 November 2026 (D-94). Since then the keys are secret files on the VPS (`docs/hosting.md`), and each chain gets its own four keys in its own keeper service (`keeper-monad`, later `keeper-base` and `keeper-xlayer`). The scripts below were changed for the VPS and tested in a local copy of the server setup on 20 November 2026; not yet run on the VPS.

## The four roles

One key per role. Each key can do one thing only, enforced by the contracts.

| Secret file of the keeper service | Role | What the key can call | Granted by the owner with |
|---|---|---|---|
| `ORACLE_AGE_POSTER_KEY` | Oracle age poster (BE-17) | `RiskManager.setMaxOracleAge`, only inside the owner's bounds | `setOracleAgePoster(address)` |
| `CALENDAR_POSTER_KEY` | Calendar poster (BE-30) | `RiskManager.setNextCloseAt`, only up to 8 days ahead | `setCalendarPoster(address)` |
| `PROTECTOR_KEY` | Router keeper (BE-31) | `MarginRouter.deleverage`, only for positions with protection on and above the soft limit | `MarginRouter.setKeeper(address, true)` |
| `LIQUIDATOR_KEY` | Liquidator keeper (BE-32) | `Liquidator.liquidate`, only for positions Morpho finds unhealthy | `Liquidator.setKeeper(address, true)` |

None of them can move user funds, change a fee, loosen a limit (other than `maxOracleAge` inside the bounds) or pause closing.

## Where keys live

- Only as files in `/opt/levra/secrets/keeper-<chain>/` on the VPS, one file per key, mode 0400, owned by the image's user (uid 1000). Only that keeper service mounts the folder, read only (`deploy/compose.yml`). Never in the `api` or `indexer` services, never in the repo, never in a note, chat or ticket, never in an env file.
- The keeper runs as its own service, apart from the public API.
- The keeper's logger blanks fields named `privateKey`, `key` and `env`.
- Anyone with root or Docker access on the server can read the files. Keep SSH access to the three of us (`docs/hosting.md`).

## Making the keys

On the server, as the `levra` user, after `deploy/setup-server.sh`. The keys are made inside the keeper's image and never leave the server:

```bash
# Dry run: shows what would be made. Nothing is stored.
deploy/keys.sh keeper-monad ORACLE_AGE_POSTER_KEY CALENDAR_POSTER_KEY PROTECTOR_KEY LIQUIDATOR_KEY

# Make the keys and write them as secret files. A role that already has a file is kept.
deploy/keys.sh keeper-monad ORACLE_AGE_POSTER_KEY CALENDAR_POSTER_KEY PROTECTOR_KEY LIQUIDATOR_KEY --confirm
```

The script (`apps/keeper/scripts/keys.ts`) uses the `DEPLOYMENT_FILE` of that keeper, creates each key in memory, writes it to its file, and prints only the addresses, the owner calls, and one line for the owner:

```
For the owner (Wangsit), chain 143: ORACLE_AGE_POSTER=0x... CALENDAR_POSTER=0x... KEEPER=0x... LIQUIDATOR_KEEPER=0x... make set-roles-monad CONFIRM=yes
```

On Base and X Layer the line lists the grant calls instead, since only Monad has a `make` target.

Before our deployment on Base or X Layer the keeper has no `DEPLOYMENT_FILE`, so the script takes the chain from `CHAIN_ID` (set in `keeper-base.env` and `keeper-xlayer.env`) and prints the four variables for the deploy instead of grant calls. `contracts/script/Deploy.s.sol` reads `KEEPER`, `LIQUIDATOR_KEEPER`, `CALENDAR_POSTER` and `ORACLE_AGE_POSTER` and grants the roles in the deployment itself:

```bash
deploy/keys.sh keeper-base ORACLE_AGE_POSTER_KEY CALENDAR_POSTER_KEY PROTECTOR_KEY LIQUIDATOR_KEY --confirm
deploy/keys.sh keeper-xlayer ORACLE_AGE_POSTER_KEY CALENDAR_POSTER_KEY PROTECTOR_KEY LIQUIDATOR_KEY --confirm
```

```
For the owner (Wangsit), chain 8453: ORACLE_AGE_POSTER=0x... CALENDAR_POSTER=0x... KEEPER=0x... LIQUIDATOR_KEEPER=0x... set before the deployment of this chain
```

The addresses of a dry run are thrown away: send only the addresses printed with `--confirm`.

Then:

1. Send that line to the owner. After SC-55 the same calls go through the multisig.
2. Fund each address with the chain's gas token (below).
3. Restart the keeper: `docker compose -f deploy/compose.yml restart keeper-monad`. Each job checks on start that its key holds its role, and stops with a clear error if not.

Keys that were on Railway are moved, not remade, when Railway can still be read (BE-91): `apps/keeper/scripts/move-variables.ts` pipes each value from the Railway CLI into the server's file through `ssh`, without printing it or writing it on the laptop.

## MON for gas

Initial proposals, in `apps/keeper/scripts/roles.ts`:

- Target balance 10 MON per role, about 140 transactions at the cost measured on mainnet.
- A top-up run sends at most 10 MON to one wallet and 30 MON in total.
- The team monitor (BE-50) alerts when a role's wallet holds less than 5 MON.

Gas targets for ETH on Base and OKB on X Layer are set in BE-95. Top-ups are done by a person from the team's funding wallet, never by the hosted keeper, so the funding key never sits on a server. The funding key goes in through stdin:

```bash
# Plan only
MONAD_RPC_URL=<rpc> pnpm --filter @levra/keeper topup "oracle age poster=0x..." "calendar poster=0x..." "protector=0x..." "liquidator=0x..."

# Send, reading the funding key from stdin
<command that prints the funding key> | MONAD_RPC_URL=<rpc> pnpm --filter @levra/keeper topup "protector=0x..." --confirm
```

## Rotating a key

For a planned change, or right away after a suspected leak.

1. Make the new key, replacing the old file:
   `deploy/keys.sh keeper-<chain> <ROLE> --replace --confirm`
2. Owner or multisig moves the role:
   - Poster roles: call the setter with the new address. This removes the old address in the same call.
   - Keeper roles: `setKeeper(new, true)`, then `setKeeper(old, false)`.
3. Fund the new address and restart the keeper service.
4. Move any MON left on the old address back to the funding wallet, if the old key is still under our control.
5. Write the date, role, old and new address in PROGRESS.md.

## Drill: the oracle age poster key leaked

Tested on a local fork on 14 October 2026 (`apps/keeper/test/key-rotation.fork.test.ts`):

1. The owner called `setOracleAgePoster(new address)` once.
2. The leaked key was refused: the keeper job stopped before sending anything ("not the oracle age poster"), and a direct `setMaxOracleAge` from it reverted.
3. The keeper with the new key posted a value inside the bounds.

What a leaked key could have done in the meantime: move `maxOracleAge` inside the owner's bounds. It cannot move funds or loosen anything else. A leaked calendar key can only post a close time up to 8 days ahead. A leaked router or Liquidator key can only reduce or liquidate positions that the contracts already allow to be reduced or liquidated.

Still to do on mainnet: the same drill once the multisig holds the owner role (SC-55).

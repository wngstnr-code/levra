# Backend hosting on a VPS

How the backend runs after Railway (D-94). Status on 20 November 2026: design only, nothing is deployed yet. Tasks: BE-90 (server and services), BE-91 (moving off Railway), BE-53 (backups), BE-55 (keys), BE-52 (CDN and the country header).

## Why a VPS

Railway no longer serves the backend: the old address `https://api-production-c154.up.railway.app/v1/health` answers 404 (checked on 20 November 2026). With three chains the backend needs eight long-running processes: Postgres, one API, and an indexer and a keeper for each chain. One VPS runs them at a fixed cost, keeps every secret under our own control, and calls the OKX and Coinbase APIs from a server outside the DNS blocks of our home ISPs (05, PROGRESS 20 November 2026).

## The server

| Item | Proposal | Status |
|---|---|---|
| OS | Ubuntu 24.04 LTS, x86_64 | Proposal |
| Size | 4 vCPU, 8 GB RAM, 160 GB SSD for three chains. 2 vCPU, 4 GB RAM and 80 GB is enough for Monad alone | Initial proposal, checked after one week of real load |
| Region | Outside the countries our providers restrict: not US, CA, GB, AU, SG or CH (1inch, D-73). A data center in the EU fits. Check the OKX and 1inch terms for server traffic from the chosen country | Not verified |
| Access | SSH keys of the three of us only. No password login, no root login. One `levra` user runs Docker. Being in the `docker` group equals root, so it stays with the three of us | Proposal |
| Firewall | Incoming 22, 80 and 443 only. Postgres has no public port | Proposal |
| Updates | Automatic security updates on | Proposal |
| RPC | One paid provider for Monad, Base and X Layer if one covers all three, with the public endpoint as backup. The Base endpoint must support `eth_simulateV1`, because Coinbase stock tokens cannot run on a local fork (07) | Not chosen (blocker row in PROGRESS) |

## Services

All app services use one image built from the repo (`deploy/Dockerfile`, BE-90): Node 24, pnpm, the backend workspaces only, started with `tsx` as today, as a non-root user. Restart policy `unless-stopped`. Docker logs rotate at 20 MB, five files per service.

| Service | Runs | Starts in | Its secrets |
|---|---|---|---|
| `postgres` | Postgres 17, data in a Docker volume, no public port | BE-90 | Database password |
| `migrate` | `pnpm --filter @levra/db migrate`, once per deploy, before the apps | BE-90 | `DATABASE_URL` |
| `api` | `pnpm --filter @levra/api start`. Serves every chain after BE-95 and BE-70 | BE-90 | `DATABASE_URL`, `AUTH_SECRET`, swap API keys |
| `indexer-monad` | `pnpm --filter @levra/indexer start` for chain 143 | BE-90 | `DATABASE_URL`, `ENVIO_API_TOKEN` |
| `keeper-monad` | `pnpm --filter @levra/keeper start` for chain 143, plus the jobs that run once for all chains (`KEEPER_GLOBAL=1`, BE-95) | BE-90 | `DATABASE_URL`, the four Monad role keys, `TELEGRAM_BOT_TOKEN`, swap API keys |
| `keeper-base`, `keeper-xlayer` | Same code for chains 8453 and 196. They start without keys, for the Chainlink price recorder only (BE-97), and get role keys with our deployments | BE-97, then BE-73 and BE-80 | The role keys of that chain |
| `indexer-base`, `indexer-xlayer` | Same code for chains 8453 and 196 | BE-73, BE-80 | `DATABASE_URL`, `ENVIO_API_TOKEN` |
| `agent` | MCP server and the Telegram bot updates. Holds no keys | BE-77, BE-78 | `TELEGRAM_BOT_TOKEN` (moves from the keeper) |
| `caddy` | HTTPS and the reverse proxy to `api` | BE-90 | None |

Each chain gets its own four role keys (BE-55), so a rotation on one chain does not touch the others.

## Files on the server

| Path | Content | Rights |
|---|---|---|
| `/opt/levra/app` | Checkout of `main` | Owned by `levra` |
| `/opt/levra/env/<service>.env` | Settings that are not secret: RPC addresses, `DEPLOYMENT_FILE`, `CORS_ORIGINS`, `AUTH_DOMAIN`, `MONITOR_API_URL`, `LOG_LEVEL` | 0640 |
| `/opt/levra/secrets/<service>/<NAME>` | One secret per file. The file name is the variable name, for example `PROTECTOR_KEY` | 0400, owned by the container user |
| `/opt/levra/backups` | Daily database dumps (BE-53) | 0700 |

Each service mounts only its own secrets folder, read only, at `/run/secrets`. The image's entrypoint exports each file as the variable of the same name and then starts the app. The app code does not change, and no secret sits in a compose file, an env file or the output of `docker inspect`.

Rules: a secret is never printed, pasted in chat or committed. The keeper's logger already blanks key fields (BE-55). Known limit: the files are plain text on the server disk, so anyone with root or Docker access on the server can read them. Each key can do only what its role allows (`docs/keys.md`).

## HTTPS and the API address

1. Until the domain is chosen (Q-25): Caddy gets a Let's Encrypt certificate for an interim name that points at the server's IP address, for example `api.<ip with dashes>.sslip.io`. Not verified: check that the certificate is issued before the address goes to Nabil. Before Cloudflare, the API trusts `x-forwarded-for` as written by Caddy (`TRUST_PROXY_HEADER`).
2. Once the domain exists: `api.<domain>` on Cloudflare, proxied. The server then accepts ports 80 and 443 from Cloudflare's address ranges only, so nobody can go around Cloudflare and forge the country header. The API sets `GEO_COUNTRY_HEADER=cf-ipcountry`, `GEO_REGION_HEADER=cf-region-code` and `TRUST_PROXY_HEADER=cf-connecting-ip` (BE-52). This is what lets the API refuse US users on Base (D-73).

Every change of address: `MONITOR_API_URL` on the keeper, `NEXT_PUBLIC_API_URL` on Vercel (Nabil), the API links in the root README, and the VPS row in 05.

## Deploying

First time (BE-90):

1. Harden the server (access, firewall, updates) and install Docker with the Compose plugin.
2. Clone the repo to `/opt/levra/app`, with a read-only deploy key (added by Wangsit as repo admin), or with SSH agent forwarding from a team machine so no GitHub key is stored on the server.
3. Write the env files and the secret files (BE-91 for the values that were on Railway).
4. Run `deploy/deploy.sh`.

Every update, `deploy/deploy.sh`:

1. Fetch `main` and check out the commit to deploy.
2. Build the image with `APP_VERSION` set to that commit.
3. Run `migrate`. Stop if it fails.
4. Start or restart the services.
5. Wait for `/v1/health`, then print the `/v1/status` summary.

Rollback: check out the previous commit and run the script again. This cannot undo a migration, and going back across one needs a restore (BE-53), so migrations stay additive.

Later (BE-60): GitHub Actions builds the image for every `main` commit, pushes it to a registry and deploys it. Production gets its own server.

## Backups (BE-53)

- Every day at 03:00 UTC, `packages/db/scripts/backup.ts` runs in a one-shot container and keeps 14 dumps in `/opt/levra/backups`.
- Each dump is copied off the server to a storage bucket (provider chosen in BE-53). A backup that lives only on the same server does not count.
- A restore check (`restore-check.ts`) every week, and a restore drill once a month. Results go in the runbook.
- What can be rebuilt without a backup: our events (the indexer replays from the deployment block) and oracle prices (the recorder reads logs back). What cannot: DEX depth runs, rate snapshots, cross-chain transfers, alert settings, Telegram links and terms acceptances.

## Monitoring

- The team monitor (BE-50) keeps posting to the team Telegram group.
- An outside uptime check calls `/v1/health` every minute and `/v1/status` every 5 minutes and alerts the team (service chosen in BE-90). It catches what the monitor cannot see: the whole server down.
- Disk: an alert at 80% full, since Postgres and the logs grow.
- Public status page: `/status` on the API address (BE-61).

## Moving off Railway (BE-91)

1. Right away, if the Railway project can still be read: dump its database with `packages/db/scripts/backup.ts`, and move the four Monad role keys from the keeper's variables straight into the secret files on the VPS through a pipe, never printed. Copy the settings that are not secret.
2. If it cannot be read: start with an empty database. The indexer replays from the deployment block, and the oracle recorder backfills about 15 million blocks to reach 29 September 2026 (4 million blocks is about two weeks). Make new Monad role keys on the VPS, ask Wangsit to move the four roles (`make set-roles-monad`), and fund the new wallets. The MON left on the old role wallets (about 10 each) is then lost.
3. Make a new `AUTH_SECRET` either way, so users sign in again. The Telegram bot token comes from BotFather if it cannot be read.
4. The Monad keepers are down until the VPS runs. Check that our five Monad markets have no open borrow positions (the team withdrew its liquidity on 12 November 2026), and that the calendar poster posts `nextCloseAt` once the keeper is back.
5. Nabil points `NEXT_PUBLIC_API_URL` at the new address. The root README and 05 get the new address with the date it was checked.

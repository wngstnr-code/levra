# Backend hosting on a VPS

How the backend runs after Railway (D-94). Tasks: BE-90 (server and services), BE-91 (moving off Railway), BE-53 (backups), BE-55 (keys), BE-52 (CDN and the country header).

Status on 20 November 2026: the files in `deploy/` are written. Verified in a local copy of this setup on Docker Desktop (Windows), against Monad mainnet on the public RPC: the image builds; `migrate` runs before the apps; the API answers `/v1/health` and `/v1/status` through Caddy; the indexer syncs; the keeper jobs that need no key report healthy and the role jobs stay off without keys; secrets reach the apps from files and do not show in `docker inspect`; `deploy/keys.sh`'s script writes key files and prints only addresses. Not verified yet: `setup-server.sh`, `new-secrets.sh`, `deploy.sh` and `backup.sh` on the real server, HTTPS with a real certificate, and recovery after a reboot. The server keeps netcup's Debian 13 (D-101): in Debian 13 containers, `setup-server.sh`'s OS check, its packages and Docker 29.10 from Docker's Debian repository install cleanly, and its check of the SSH settings in effect catches an image line that still allows passwords; the steps that need systemd (SSH reload, firewall, timezone) run only on the server. The VPS is bought and running since 20 November 2026 (see "The server"); setup on it has not started.

| File in `deploy/` | Purpose |
|---|---|
| `Dockerfile`, `entrypoint.sh` | The one image, and the start step that loads secret files |
| `compose.yml`, `caddy/` | The services below, and HTTPS in front of the API (`caddy/Caddyfile`, plus `origin-open.caddy` and `origin-cloudflare.caddy` for who may connect) |
| `env/*.env.example` | The settings each service reads, copied to `/opt/levra/env/` |
| `secrets.md` | Which secret file each service needs |
| `setup-server.sh` | First-time hardening of a fresh Debian 13 (or Ubuntu 24.04) server, run once as root |
| `new-secrets.sh` | Makes the database password, every `DATABASE_URL` and `AUTH_SECRET` on the server, without showing them |
| `keys.sh` | Makes role keys on the server (BE-55, `docs/keys.md`) |
| `deploy.sh` | Builds, migrates, starts and checks a commit |
| `backup.sh`, `restore-check.sh`, `backup-common.sh`, `cron/levra-backup` | The daily backup and the weekly restore check (BE-53) |

Known limit: the image is about 2.5 GB unpacked, because it carries the dev tools (`tsx` runs the TypeScript directly, as on Railway). Fine for one server; to trim later with BE-60.

## Why a VPS

Railway no longer serves the backend: the old address `https://api-production-c154.up.railway.app/v1/health` answers 404 (checked on 20 November 2026). With three chains the backend needs eight long-running processes: Postgres, one API, and an indexer and a keeper for each chain. One VPS runs them at a fixed cost, keeps every secret under our own control, and calls the OKX and Coinbase APIs from a server outside the DNS blocks of our home ISPs (05, PROGRESS 20 November 2026).

## The server

| Item | Proposal | Status |
|---|---|---|
| Host | netcup VPS 1000 G12.5 ("VPS 1000 G12.5 iv 1M EU"), Nürnberg, Germany. Monthly term, 14.01 EUR a month with one IPv4 address and an IPv6 /64, next bill on 20 December 2026. Account of the team Gmail with 2FA on. Managed in netcup's Server Control Panel | Ordered, paid and listed as a product on 20 November 2026. Its IP addresses stay out of this public repo, so nobody can go around Cloudflare; the team keeps them in its private notes |
| OS | Debian 13 (trixie), x86_64, as netcup installed it (D-101). `setup-server.sh` also accepts Ubuntu 24.04 | Decided on 20 November 2026. Debian 13 seen on the server's console in netcup's panel; check with `cat /etc/os-release` before `setup-server.sh` |
| Size | 4 vCPU, 8 GB RAM, 160 GB SSD for three chains. 2 vCPU, 4 GB RAM and 80 GB is enough for Monad alone | Initial proposal. Bought: 4 vCore, 8 GB RAM, 128 GB disk. Checked after one week of real load |
| Region | Outside the countries our providers restrict: not US, CA, GB, AU, SG or CH (1inch, D-73). A data center in the EU fits. Check the OKX and 1inch terms for server traffic from the chosen country | Germany is outside the 1inch list (D-73). The OKX and 1inch terms for server traffic are not verified |
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
| `indexer-base`, `indexer-xlayer` | Same code for chains 8453 and 196, from the deployment block. On the public endpoints until a paid RPC or HyperSync: `base-rpc.publicnode.com` (10,000 blocks per log query; `mainnet.base.org` answers 429) and `rpc.xlayer.tech` (`LOG_BLOCK_RANGE=100`) | BE-73, BE-80 | `DATABASE_URL`, `ENVIO_API_TOKEN` |
| `agent` | `apps/agent` MCP server at `api.levra.finance/mcp` (stateless Streamable HTTP, port 8790, no public port). Calls the API at `http://api:8787` and passes on only the caller's address (`CLIENT_IP_HEADER`, D-111). Holds no keys. Later also the Telegram bot updates (BE-78) | BE-77, BE-78 | None now; `TELEGRAM_BOT_TOKEN` with BE-78 (moves from the keeper) |
| `caddy` | HTTPS and the reverse proxy: `/mcp` to `agent`, everything else to `api` | BE-90 | None |

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

1. First deploy: `api.levra.finance` (D-96) is an `A` record on Cloudflare pointing at the server's IPv4 address, **DNS only** (grey cloud), and `API_HOST=api.levra.finance` in `caddy.env`. Caddy then gets a Let's Encrypt certificate itself. Not verified: check that the certificate is issued (`curl https://api.levra.finance/v1/health`) before the address goes to Nabil. Until Cloudflare proxies it, the API trusts `x-forwarded-for` as written by Caddy (`TRUST_PROXY_HEADER`).
2. Then (BE-52): the `api` record proxied (orange cloud), with Cloudflare's SSL mode "Full (strict)" so it checks Caddy's certificate. The server then accepts ports 80 and 443 from Cloudflare's address ranges only, so nobody can go around Cloudflare and forge the country header. The API sets `GEO_COUNTRY_HEADER=cf-ipcountry`, `GEO_REGION_HEADER=cf-region-code` and `TRUST_PROXY_HEADER=cf-connecting-ip` (BE-52), and `agent.env` sets `CLIENT_IP_HEADER=cf-connecting-ip` in the same deploy (`deploy.sh` refuses a mismatch). This is what lets the API refuse US users on Base (D-73).

### Cloudflare in front (BE-52)

Turning the proxy on changes three things at once, so do it in one go, in this order:

1. Cloudflare, any time before: SSL/TLS mode **Full (strict)** (Flexible would loop with Caddy's redirect to HTTPS) and minimum TLS version 1.2. Neither changes anything while the record is DNS only.
2. Read Cloudflare's ranges again (`https://www.cloudflare.com/ips-v4` and `ips-v6`) and compare them with `deploy/caddy/origin-cloudflare.caddy`. A change goes through a PR first.
3. Cloudflare: turn the `api` record to Proxied. The API keeps working, but until step 4 every visitor shares Cloudflare's address in the rate limit.
4. On the server, right after: in `caddy.env` set `ORIGIN=cloudflare`; in `api.env` set `TRUST_PROXY_HEADER=cf-connecting-ip`, `GEO_COUNTRY_HEADER=cf-ipcountry` and `GEO_REGION_HEADER=cf-region-code`; then `deploy/deploy.sh`. The script refuses Cloudflare headers with `ORIGIN=open` (anyone could forge them) and `ORIGIN=cloudflare` without `cf-connecting-ip` (shared rate limit), and checks the Caddy config before the running Caddy sees it.
5. Check: `/v1/health` answers through the domain; a request straight to the server's IP is closed; `curl -sI https://api.levra.finance` shows `server: cloudflare`.

With `ORIGIN=cloudflare` Caddy closes every connection that does not come from Cloudflare's ranges (`remote_ip`). Docker publishes ports 80 and 443 past `ufw`, which is why the check is in Caddy and not in the firewall. Turning the proxy off again is the same steps in reverse: `ORIGIN=open` and `TRUST_PROXY_HEADER=x-forwarded-for` with the GEO headers emptied, deployed right after the record goes back to DNS only.

Not verified yet: certificate renewal through the proxy. Caddy answers the ACME HTTP challenge before its routes and Let's Encrypt reaches it through Cloudflare, so it is expected to work; check Caddy's log at the first renewal (about 30 days before the certificate ends in February 2027). Known limit: another Cloudflare account could point its own record at our IP and pass the range check; Cloudflare still writes the real visitor address and country in that case, but this is not verified. Authenticated origin pulls with our own certificate would close it.

Every change of address: `MONITOR_API_URL` on the keeper, `NEXT_PUBLIC_API_URL` on Vercel (Nabil), the API links in the root README, and the VPS row in 05.

## Deploying

First time (BE-90):

1. Harden the server (access, firewall, updates) and install Docker with the Compose plugin: `deploy/setup-server.sh`, copied to the server with `scp` because the repo is not there yet.
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

- Every day at 03:00 UTC, cron runs `deploy/backup.sh` as `levra`: `pg_dump` inside the Postgres container, 14 dumps kept in `/opt/levra/backups`, log in `backups/backup.log`.
- Each dump is copied off the server with rclone to `LEVRA_BACKUP_REMOTE` (set in `/opt/levra/env/backup.env`). A backup that lives only on the same server does not count: the script records it as failed.
- The off-site copy is the Cloudflare R2 bucket `levra-backups` on the levra.finance Cloudflare account (`LEVRA_BACKUP_REMOTE=r2:levra-backups`, since 24 November 2026). The bucket is private, a lifecycle rule deletes objects 30 days after upload, and the API token can only read and write objects in this one bucket, so the rclone remote `r2` of the `levra` user has `no_check_bucket = true`. The token lives only in `/home/levra/.config/rclone/rclone.conf`. Within R2's free tier (10 GB a month); a dump is about 2 MB.
- rclone comes from downloads.rclone.org, pinned with its checksum in `setup-server.sh`: the 1.60 package of Debian 13 and Ubuntu 24.04 gets 501 NotImplemented from R2 on every upload. To update it on a running server, raise `rclone_version` and the checksums there, then run that section as root with `su -` (a plain `su -c` keeps the `levra` PATH, without `/usr/sbin`, and `dpkg` fails).
- Every Sunday at 04:00 UTC, `deploy/restore-check.sh` restores the newest dump into a scratch database in the same container and checks it (age, off-site copy, every table and migration present). Log in `backups/restore-check.log`.
- Both scripts write one row per run in the `backup_runs` table. The team monitor in the `KEEPER_GLOBAL` keeper alerts the team on a failed run, a backup older than 26 hours or a restore check older than 7 days and 2 hours (D-114).
- A restore drill once a month by a person, following the runbook. Results go in the runbook.
- After a change to `cron/levra-backup`, install it again as root: `su -c "install -m 0644 /opt/levra/app/deploy/cron/levra-backup /etc/cron.d/levra-backup"`.
- What can be rebuilt without a backup: our events (the indexer replays from the deployment block) and oracle prices (the recorder reads logs back). What cannot: DEX depth runs, rate snapshots, cross-chain transfers, alert settings, Telegram links and terms acceptances.

## Monitoring

- The team monitor (BE-50) keeps posting to the team Telegram group.
- An outside uptime check calls `/v1/health` every minute and `/v1/status` every 5 minutes and alerts the team (service chosen in BE-90). It catches what the monitor cannot see: the whole server down.
- Disk: an alert at 80% full, since Postgres and the logs grow.
- Public status page: `/status` on the API address (BE-61).

## Moving off Railway (BE-91)

1. Railway on 20 November 2026: the project still opens, but the services are stopped because the plan's limit was reached, and the Railway CLI on Dharu's laptop is no longer logged in. So:
   - Keys and other secrets: after `railway login` and `railway link`, once the VPS has run `setup-server.sh`, move them straight into the secret files:
     `pnpm --filter @levra/keeper exec tsx scripts/move-variables.ts --from keeper --to levra@<server> --service keeper-monad ORACLE_AGE_POSTER_KEY CALENDAR_POSTER_KEY PROTECTOR_KEY LIQUIDATOR_KEY TELEGRAM_BOT_TOKEN RESEND_API_KEY TEAM_WEBHOOK_URL KYBER_API_KEY INTENTS_JWT --confirm`
     First run it without `--confirm` to see which names Railway has. Then once more with `--from indexer --service indexer-monad ENVIO_API_TOKEN` and once with `--from api --service api KYBER_API_KEY INTENTS_JWT`. `AUTH_SECRET` is not moved: a new one is made (step 3). Whether variables can still be read while the services are stopped is not verified. Copy the settings that are not secret (`CORS_ORIGINS`, `AUTH_DOMAIN`, `TERMS_VERSION`, the geo settings, `TEAM_TELEGRAM_CHAT_ID`, `TELEGRAM_BOT_USERNAME`) by hand into the env files.
   - Database: a dump needs the Railway Postgres to run, which needs the plan's limit raised. Worth it only for what cannot be rebuilt (alert settings, Telegram links, terms acceptances, transfers, depth runs and rate snapshots, see Backups). If it runs again, dump it with the public database URL from the Railway dashboard, without putting the URL in a file: `docker run --rm -i -v "${PWD}:/out" postgres:17-alpine sh -c 'read -r url; pg_dump "$url" --format=custom --no-owner --no-privileges -f /out/railway.dump'`, then type the URL and press Enter (the file is written by `pg_dump` itself, since a PowerShell redirect would corrupt the binary dump). Before the first `deploy.sh` on the VPS: `docker compose -f deploy/compose.yml up -d postgres`, then `docker compose -f deploy/compose.yml exec -T postgres pg_restore -U levra -d levra --no-owner < railway.dump`, and compare row counts with `packages/db/scripts/restore-check.ts`'s query.
2. If it cannot be read: start with an empty database. The indexer replays from the deployment block, and the oracle recorder backfills about 15 million blocks to reach 29 September 2026 (4 million blocks is about two weeks). Make new Monad role keys on the VPS, ask Wangsit to move the four roles (`make set-roles-monad`), and fund the new wallets. The MON left on the old role wallets (about 10 each) is then lost.
   - Either way the transactions themselves are safe: they are on chain, and the database only holds a copy. Use and traction (wallets, positions opened and closed, vault use) are counted from those events, so they come back in full without the dump.
   - With a dump: restore it before the first `deploy.sh`. `deploy.sh` then runs migration 0008, which marks every restored row as Monad (143, D-95), and the indexer and the recorder go on from their stored cursors. Without one: set `ORACLE_BACKFILL_BLOCKS=15000000` in `keeper-monad.env` for the first start (the example file has it), so the oracle history reaches back before the Monad launch.
   - Check the data before Nabil switches the web app (step 5). Once the indexer has caught up (`/v1/status`, lag under 300 blocks), run `docker compose -f deploy/compose.yml run --rm --no-deps indexer-monad node_modules/.bin/tsx src/verify-cli.ts`. It reads every router, Morpho and vault event of our deployment from the RPC endpoint again, compares it with the database, compares each position rebuilt from Morpho events with `Morpho.position`, and prints the traction table (events and wallets). It exits 1 on any difference. Paste its output into PROGRESS under the day of the move.
3. Make a new `AUTH_SECRET` either way, so users sign in again. The Telegram bot token comes from BotFather if it cannot be read.
4. The Monad keepers are down until the VPS runs. Check that our five Monad markets have no open borrow positions (the team withdrew its liquidity on 12 November 2026), and that the calendar poster posts `nextCloseAt` once the keeper is back.
5. Nabil points `NEXT_PUBLIC_API_URL` at the new address. The root README and 05 get the new address with the date it was checked.

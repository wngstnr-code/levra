# Secret files on the VPS

One file per secret in `/opt/levra/secrets/<service>/<NAME>`. The file name is the variable name and the file holds only the value. Folders are mode 0700 and files 0400, owned by uid 1000 (the `node` user in the image); the `postgres` folder is read by root at start. Each service mounts only its own folder, read only, at `/run/secrets` (`entrypoint.sh`). Never print a value, paste it in chat or commit it (`docs/hosting.md`).

| Folder | Files | Required |
|---|---|---|
| `postgres` | `POSTGRES_PASSWORD` | Yes |
| `migrate` | `DATABASE_URL` | Yes |
| `api` | `DATABASE_URL`, `AUTH_SECRET` (at least 32 random characters), `KYBER_API_KEY`, `ONEINCH_API_KEY` (1inch in the Base quotes), `OKX_API_KEY`, `OKX_SECRET_KEY` and `OKX_API_PASSPHRASE` (the X Layer quotes, all three needed), `INTENTS_JWT` | `DATABASE_URL`; the others turn features on |
| `indexer-monad` | `DATABASE_URL`, `ENVIO_API_TOKEN` | `DATABASE_URL` |
| `keeper-monad` | `DATABASE_URL`, `ORACLE_AGE_POSTER_KEY`, `CALENDAR_POSTER_KEY`, `PROTECTOR_KEY`, `LIQUIDATOR_KEY`, `TELEGRAM_BOT_TOKEN`, `RESEND_API_KEY`, `TEAM_WEBHOOK_URL`, `KYBER_API_KEY`, `INTENTS_JWT` | `DATABASE_URL`; each role job runs only when its key is set |
| `keeper-base`, `keeper-xlayer` | `DATABASE_URL`. The role keys of that chain come with our deployment there (BE-73, BE-80). `keeper-xlayer` also takes `OKX_API_KEY`, `OKX_SECRET_KEY` and `OKX_API_PASSPHRASE` (copies of the API's) for its depth table; without them it measures Uniswap only, whose wGOOGLx pool is mispriced (05) | `DATABASE_URL` |

`DATABASE_URL` is `postgres://levra:<POSTGRES_PASSWORD>@postgres:5432/levra`, with the password URL encoded. `deploy/new-secrets.sh` writes the database password, every `DATABASE_URL` and `AUTH_SECRET` without showing them. Role keys are made with `deploy/keys.sh` (new keys, BE-55) or moved from Railway (`apps/keeper/scripts/move-variables.ts`, BE-91).

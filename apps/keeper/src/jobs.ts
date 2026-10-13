import { createKyber, KYBER_MONAD_URL } from "@levra/kyber";
import { readDeployment } from "@levra/shared/deployments/node";
import { createWalletClient, http, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monad } from "viem/chains";
import { createAlerts } from "./alerts/job";
import { resendEmail, telegramBot, type Channels } from "./alerts/channels";
import { createCalendarPoster } from "./calendar/poster";
import { createMarketDepth } from "./dex/depth";
import type { Env } from "./env";
import { createLiquidatorBot } from "./liquidator/bot";
import type { Logger } from "./logger";
import { createOracleAgePoster } from "./oracle/age-poster";
import { createOracleRecorder } from "./oracle/recorder";
import { createProtector } from "./protector/protector";
import type { Job } from "./runner";

export function createJobs(env: Env, client: PublicClient, logger: Logger): Job[] {
  const swap = createKyber({ baseUrl: env.KYBER_BASE_URL ?? KYBER_MONAD_URL, clientId: env.KYBER_CLIENT_ID });
  const deployment = env.DEPLOYMENT_FILE ? readDeployment(env.DEPLOYMENT_FILE) : null;
  const jobs: Job[] = [createOracleRecorder({ client, backfillBlocks: env.ORACLE_BACKFILL_BLOCKS }), createMarketDepth({ client, swap, deployment })];
  /** One wallet per role key (BE-55). */
  const walletFor = (key: string) =>
    createWalletClient({
      account: privateKeyToAccount(key as `0x${string}`),
      chain: monad,
      transport: http(env.MONAD_RPC_URL, { retryCount: 3, timeout: 20_000 }),
    });

  if (deployment && env.ORACLE_AGE_POSTER_KEY) {
    jobs.push(createOracleAgePoster({ client, wallet: walletFor(env.ORACLE_AGE_POSTER_KEY), deployment }));
  } else {
    logger.info("oracle age poster off: ORACLE_AGE_POSTER_KEY or DEPLOYMENT_FILE is not set");
  }

  if (deployment && env.CALENDAR_POSTER_KEY) {
    jobs.push(createCalendarPoster({ client, wallet: walletFor(env.CALENDAR_POSTER_KEY), deployment }));
  } else {
    logger.info("calendar poster off: CALENDAR_POSTER_KEY or DEPLOYMENT_FILE is not set");
  }

  if (deployment && env.PROTECTOR_KEY) {
    jobs.push(createProtector({ client, wallet: walletFor(env.PROTECTOR_KEY), deployment, swap }));
  } else {
    logger.info("protector off: PROTECTOR_KEY or DEPLOYMENT_FILE is not set");
  }

  const bot = env.TELEGRAM_BOT_TOKEN ? telegramBot(env.TELEGRAM_BOT_TOKEN) : undefined;
  const channels: Channels = {
    ...(env.RESEND_API_KEY && env.ALERT_EMAIL_FROM ? { email: resendEmail(env.RESEND_API_KEY, env.ALERT_EMAIL_FROM) } : {}),
    ...(bot ? { telegram: bot.send } : {}),
  };
  if (deployment && (channels.email || channels.telegram)) {
    jobs.push(createAlerts({ client, deployment, channels, telegram: bot }));
  } else {
    logger.info("alerts off: no email or Telegram channel, or DEPLOYMENT_FILE is not set");
  }

  if (deployment && env.LIQUIDATOR_KEY) {
    jobs.push(createLiquidatorBot({ client, wallet: walletFor(env.LIQUIDATOR_KEY), deployment, swap }));
  } else {
    logger.info("liquidator bot off: LIQUIDATOR_KEY or DEPLOYMENT_FILE is not set");
  }
  return jobs;
}

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
import { createMonitor, webhookChannel, type TeamChannel } from "./monitor/job";
import type { Logger } from "./logger";
import { createOracleAgePoster } from "./oracle/age-poster";
import { createOracleRecorder } from "./oracle/recorder";
import { createProtector } from "./protector/protector";
import { createTransferWatcher } from "./transfers/watcher";
import { createIntents } from "@levra/intents";
import type { Job } from "./runner";

export function createJobs(env: Env, client: PublicClient, logger: Logger): Job[] {
  const swap = createKyber({ baseUrl: env.KYBER_BASE_URL ?? KYBER_MONAD_URL, clientId: env.KYBER_CLIENT_ID });
  const deployment = env.DEPLOYMENT_FILE ? readDeployment(env.DEPLOYMENT_FILE) : null;
  const jobs: Job[] = [
    createOracleRecorder({ client, backfillBlocks: env.ORACLE_BACKFILL_BLOCKS }),
    createMarketDepth({ client, swap, deployment }),
    createTransferWatcher({ intents: createIntents({ jwt: env.INTENTS_JWT }) }),
  ];
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

  if (deployment) {
    const team: TeamChannel[] = [
      ...(bot && env.TEAM_TELEGRAM_CHAT_ID ? [(text: string) => bot.send(env.TEAM_TELEGRAM_CHAT_ID!, text)] : []),
      ...(env.TEAM_WEBHOOK_URL ? [webhookChannel(env.TEAM_WEBHOOK_URL)] : []),
    ];
    if (team.length === 0) logger.warn("team monitor has no channel: set TEAM_TELEGRAM_CHAT_ID (with TELEGRAM_BOT_TOKEN) or TEAM_WEBHOOK_URL; alerts only go to the log");
    // The MON balance of every role key this keeper runs with.
    const roles = [
      ["oracle age poster", env.ORACLE_AGE_POSTER_KEY],
      ["calendar poster", env.CALENDAR_POSTER_KEY],
      ["protector", env.PROTECTOR_KEY],
      ["liquidator", env.LIQUIDATOR_KEY],
    ] as const;
    const wallets = roles.filter(([, key]) => key).map(([role, key]) => ({ role, address: privateKeyToAccount(key as `0x${string}`).address }));
    jobs.push(createMonitor({ client, deployment, channels: team, wallets, apiUrl: env.MONITOR_API_URL }));
  } else {
    logger.info("team monitor off: DEPLOYMENT_FILE is not set");
  }
  return jobs;
}

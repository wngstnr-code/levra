import { createKyber, KYBER_MONAD_URL } from "@levra/swap";
import { tokensByChain } from "@levra/shared/addresses";
import { chains } from "@levra/shared/chains";
import { readDeployment } from "@levra/shared/deployments/node";
import { stocksByChain, type ChainlinkStock } from "@levra/shared/markets";
import { createWalletClient, http, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createAlerts } from "./alerts/job";
import { resendEmail, telegramBot, type Channels } from "./alerts/channels";
import { createCalendarPoster } from "./calendar/poster";
import { viemChains } from "./chain";
import { chainlinkPrices, createMarketDepth } from "./dex/depth";
import { depthSwap } from "./dex/swap";
import type { Env } from "./env";
import { createLiquidatorBot } from "./liquidator/bot";
import { createMonitor, webhookChannel, type TeamChannel } from "./monitor/job";
import type { Logger } from "./logger";
import { createOracleAgePoster } from "./oracle/age-poster";
import { chainFeedReader, createChainlinkRecorder } from "./oracle/chainlink";
import { createOracleRecorder } from "./oracle/recorder";
import { createProtector } from "./protector/protector";
import { createTransferWatcher } from "./transfers/watcher";
import { createIntents } from "@levra/intents";
import type { Job } from "./runner";

/**
 * The jobs of one keeper process, for the chain in CHAIN_ID (BE-95). Jobs that read the Anchored oracle or swap through
 * KyberSwap on Monad run on Monad only, until their task brings them to Base and X Layer. Jobs that serve every chain
 * once run only where KEEPER_GLOBAL is set.
 */
export function createJobs(env: Env, client: PublicClient, logger: Logger): Job[] {
  const chainId = env.CHAIN_ID;
  const chainName = chains[chainId].name;
  const onMonad = chainId === 143;
  const deployment = env.DEPLOYMENT_FILE ? readDeployment(env.DEPLOYMENT_FILE) : null;
  if (deployment && deployment.chainId !== chainId) {
    throw new Error(`DEPLOYMENT_FILE is for chain ${deployment.chainId}, but CHAIN_ID is ${chainId}`);
  }
  const notHere = (job: string, task: string) => logger.info(`${job} off: not on ${chainName} yet (${task})`);
  const swap = createKyber({ baseUrl: env.KYBER_BASE_URL ?? KYBER_MONAD_URL, clientId: env.KYBER_CLIENT_ID, apiKey: env.KYBER_API_KEY });
  const jobs: Job[] = [];

  if (onMonad) {
    jobs.push(createOracleRecorder({ client, backfillBlocks: env.ORACLE_BACKFILL_BLOCKS }), createMarketDepth({ client, swap, deployment }));
  } else {
    // Base and X Layer price through Chainlink feeds, recorded round by round (BE-97). Needs no key and no deployment.
    const feedStocks = Object.values(stocksByChain[chainId]) as ChainlinkStock[];
    const reader = chainFeedReader(client);
    jobs.push(createChainlinkRecorder({ reader, stocks: feedStocks, backfillSeconds: env.CHAINLINK_BACKFILL_DAYS * 86_400 }));
    // The DEX mid price and depth against the feed price (BE-96 step 4), for the markets and the soft layer.
    const depth = depthSwap(chainId, client, { kyberClientId: env.KYBER_CLIENT_ID, kyberApiKey: env.KYBER_API_KEY });
    if (depth) {
      jobs.push(createMarketDepth({ client, swap: depth, deployment, prices: chainlinkPrices(reader, feedStocks), usdc: tokensByChain[chainId].USDC }));
    } else {
      notHere("market depth", "BE-81");
    }
  }

  if (env.KEEPER_GLOBAL) {
    jobs.push(createTransferWatcher({ intents: createIntents({ jwt: env.INTENTS_JWT }) }));
  } else {
    logger.info("transfer watcher, Telegram linking, API check and gap check off: they run in the KEEPER_GLOBAL keeper");
  }

  /** One wallet per role key (BE-55). */
  const walletFor = (key: string) =>
    createWalletClient({
      account: privateKeyToAccount(key as `0x${string}`),
      chain: viemChains[chainId],
      transport: http(env.rpcUrl, { retryCount: 3, timeout: 20_000 }),
    });

  if (!onMonad) {
    notHere("oracle age poster", "Anchored oracle only");
  } else if (deployment && env.ORACLE_AGE_POSTER_KEY) {
    jobs.push(createOracleAgePoster({ client, wallet: walletFor(env.ORACLE_AGE_POSTER_KEY), deployment }));
  } else {
    logger.info("oracle age poster off: ORACLE_AGE_POSTER_KEY or DEPLOYMENT_FILE is not set");
  }

  // Every chain: Anchored's observed schedule on Monad, the Chainlink feeds' weekly freeze elsewhere (scheduleForChain).
  if (deployment && env.CALENDAR_POSTER_KEY) {
    jobs.push(createCalendarPoster({ client, wallet: walletFor(env.CALENDAR_POSTER_KEY), deployment }));
  } else {
    logger.info("calendar poster off: CALENDAR_POSTER_KEY or DEPLOYMENT_FILE is not set");
  }

  if (!onMonad) {
    notHere("protector", "BE-88, BE-96");
  } else if (deployment && env.PROTECTOR_KEY) {
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
    jobs.push(createAlerts({ client, deployment, channels, telegram: env.KEEPER_GLOBAL ? bot : undefined }));
  } else {
    logger.info("alerts off: no email or Telegram channel, or DEPLOYMENT_FILE is not set");
  }

  if (!onMonad) {
    notHere("liquidator bot", "BE-89, BE-96");
  } else if (deployment && env.LIQUIDATOR_KEY) {
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
    // The gas token balance of every role key this keeper runs with.
    const roles = [
      ["oracle age poster", env.ORACLE_AGE_POSTER_KEY],
      ["calendar poster", env.CALENDAR_POSTER_KEY],
      ["protector", env.PROTECTOR_KEY],
      ["liquidator", env.LIQUIDATOR_KEY],
    ] as const;
    const wallets = roles.filter(([, key]) => key).map(([role, key]) => ({ role, address: privateKeyToAccount(key as `0x${string}`).address }));
    jobs.push(
      createMonitor({
        client,
        deployment,
        channels: team,
        wallets,
        apiUrl: env.KEEPER_GLOBAL ? env.MONITOR_API_URL : undefined,
        checkGaps: env.KEEPER_GLOBAL,
      }),
    );
  } else {
    logger.info("team monitor off: DEPLOYMENT_FILE is not set");
  }
  return jobs;
}

import { createKyber, KYBER_MONAD_URL } from "@levra/swap";
import { tokensByChain, xlayerTapeout } from "@levra/shared/addresses";
import { chains } from "@levra/shared/chains";
import { readDeployment } from "@levra/shared/deployments/node";
import { stocksByChain, type ChainlinkStock } from "@levra/shared/markets";
import { createWalletClient, http, type Address, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { cctpArrivals } from "./alerts/arrivals";
import { createAlerts } from "./alerts/job";
import { resendEmail, tapesendQueue, telegramBot, type Channels } from "./alerts/channels";
import { memoClock, onchainClock } from "./calendar/clock-circuit";
import { createReceipts } from "./receipts/job";
import { createTapeSendSender } from "./receipts/sender";
import { createCalendarPoster } from "./calendar/poster";
import { viemChains } from "./chain";
import { chainlinkPrices, createMarketDepth } from "./dex/depth";
import { depthSwap, executionSwap, keeperProviders } from "./dex/swap";
import type { Env } from "./env";
import { createLiquidatorBot } from "./liquidator/bot";
import { createMonitor, webhookChannel, type TeamChannel } from "./monitor/job";
import type { Logger } from "./logger";
import { createOracleAgePoster } from "./oracle/age-poster";
import { chainFeedReader, createChainlinkRecorder } from "./oracle/chainlink";
import { createOracleRecorder } from "./oracle/recorder";
import { createProtector } from "./protector/protector";
import { levraApi } from "./telegram/commands";
import { createTelegramBot } from "./telegram/job";
import { createTransferWatcher } from "./transfers/watcher";
import { createIntents } from "@levra/intents";
import type { Job } from "./runner";

/**
 * The jobs of one keeper process, for the chain in CHAIN_ID (BE-95). Jobs that read the Anchored oracle run on Monad
 * only. Jobs that serve every chain once run only where KEEPER_GLOBAL is set.
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
  const { OKX_API_KEY: apiKey, OKX_SECRET_KEY: secretKey, OKX_API_PASSPHRASE: passphrase } = env;
  const okx = apiKey && secretKey && passphrase ? { apiKey, secretKey, passphrase } : undefined;
  const swapKeys = { kyberClientId: env.KYBER_CLIENT_ID, kyberApiKey: env.KYBER_API_KEY, okx };
  /** Monad trades through KyberSwap; Base and X Layer through the providers the contract accepts (BE-73, BE-80). */
  const tradeProviders = chainId === 143 ? null : keeperProviders(chainId, client, swapKeys);
  const tradeSwap = (contract: Address) => (tradeProviders ? executionSwap(client, contract, tradeProviders) : swap);
  const jobs: Job[] = [];

  if (onMonad) {
    jobs.push(createOracleRecorder({ client, backfillBlocks: env.ORACLE_BACKFILL_BLOCKS }), createMarketDepth({ client, swap, deployment }));
  } else {
    // Base and X Layer price through Chainlink feeds, recorded round by round (BE-97). Needs no key and no deployment.
    const feedStocks = Object.values(stocksByChain[chainId]) as ChainlinkStock[];
    const reader = chainFeedReader(client);
    jobs.push(createChainlinkRecorder({ reader, stocks: feedStocks, backfillSeconds: env.CHAINLINK_BACKFILL_DAYS * 86_400 }));
    // The DEX mid price and depth against the feed price (BE-96 step 4), for the markets and the soft layer.
    if (chainId === 196 && !okx) logger.warn("market depth, the protector and the liquidator on X Layer use Uniswap only: set OKX_API_KEY, OKX_SECRET_KEY and OKX_API_PASSPHRASE");
    const depth = depthSwap(chainId, client, swapKeys);
    jobs.push(createMarketDepth({ client, swap: depth, deployment, prices: chainlinkPrices(reader, feedStocks), usdc: tokensByChain[chainId].USDC }));
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

  const bot = env.TELEGRAM_BOT_TOKEN ? telegramBot(env.TELEGRAM_BOT_TOKEN) : undefined;
  const team: TeamChannel[] = [
    ...(bot && env.TEAM_TELEGRAM_CHAT_ID ? [(text: string) => bot.send(env.TEAM_TELEGRAM_CHAT_ID!, text)] : []),
    ...(env.TEAM_WEBHOOK_URL ? [webhookChannel(env.TEAM_WEBHOOK_URL)] : []),
  ];
  const tellTeam = async (text: string) => void (await Promise.all(team.map((send) => send(text))));

  // Telegram allows one update reader per bot: chat linking and the chat commands (BE-78) run in the KEEPER_GLOBAL keeper.
  if (env.KEEPER_GLOBAL && bot) {
    if (!env.LEVRA_API_URL) logger.warn("Telegram chat commands off: set LEVRA_API_URL; chat linking still runs");
    jobs.push(createTelegramBot({ bot, api: env.LEVRA_API_URL ? levraApi(env.LEVRA_API_URL) : undefined }));
  }

  // Every chain: Anchored's observed schedule on Monad, the Chainlink feeds' weekly freeze elsewhere (scheduleForChain).
  // On X Layer the Wall Street Clock circuit checks each close (D-113).
  if (deployment && env.CALENDAR_POSTER_KEY) {
    const clock =
      chainId === 196
        ? { read: memoClock(onchainClock(client, xlayerTapeout.processor, BigInt(xlayerTapeout.circuits.wallStreetClock))), chainName, tell: tellTeam }
        : undefined;
    jobs.push(createCalendarPoster({ client, wallet: walletFor(env.CALENDAR_POSTER_KEY), deployment, clock }));
  } else {
    logger.info("calendar poster off: CALENDAR_POSTER_KEY or DEPLOYMENT_FILE is not set");
  }

  if (deployment && env.PROTECTOR_KEY) {
    jobs.push(createProtector({ client, wallet: walletFor(env.PROTECTOR_KEY), deployment, swap: tradeSwap(deployment.router) }));
  } else {
    logger.info("protector off: PROTECTOR_KEY or DEPLOYMENT_FILE is not set");
  }

  // TapeSend needs no key here: every keeper queues, and the X Layer keeper with TAPEOUT_KEY sends (BE-84).
  const channels: Channels = {
    ...(env.RESEND_API_KEY && env.ALERT_EMAIL_FROM ? { email: resendEmail(env.RESEND_API_KEY, env.ALERT_EMAIL_FROM) } : {}),
    ...(bot ? { telegram: bot.send } : {}),
    tapesend: tapesendQueue,
  };
  if (deployment) {
    jobs.push(createAlerts({ client, deployment, channels, arrivals: cctpArrivals(client, tokensByChain[chainId].USDC.address) }));
    jobs.push(createReceipts({ client, deployment }));
  } else {
    logger.info("alerts and receipts off: DEPLOYMENT_FILE is not set");
  }

  if (chainId === 196 && env.TAPEOUT_KEY) {
    jobs.push(createTapeSendSender({ client, wallet: walletFor(env.TAPEOUT_KEY) }));
  } else if (chainId === 196) {
    logger.info("TapeSend sender off: TAPEOUT_KEY is not set; receipts and alerts stay queued");
  }

  if (deployment?.liquidator && env.LIQUIDATOR_KEY) {
    jobs.push(createLiquidatorBot({ client, wallet: walletFor(env.LIQUIDATOR_KEY), deployment, swap: tradeSwap(deployment.liquidator) }));
  } else {
    logger.info("liquidator bot off: LIQUIDATOR_KEY or DEPLOYMENT_FILE is not set, or the deployment has no Liquidator");
  }

  if (deployment) {
    if (team.length === 0) logger.warn("team monitor has no channel: set TEAM_TELEGRAM_CHAT_ID (with TELEGRAM_BOT_TOKEN) or TEAM_WEBHOOK_URL; alerts only go to the log");
    // The gas token balance of every role key this keeper runs with.
    const roles = [
      ["oracle age poster", env.ORACLE_AGE_POSTER_KEY],
      ["calendar poster", env.CALENDAR_POSTER_KEY],
      ["protector", env.PROTECTOR_KEY],
      ["liquidator", env.LIQUIDATOR_KEY],
      ["TapeSend sender", chainId === 196 ? env.TAPEOUT_KEY : undefined],
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
        checkBackups: env.KEEPER_GLOBAL,
      }),
    );
  } else {
    logger.info("team monitor off: DEPLOYMENT_FILE is not set");
  }
  return jobs;
}

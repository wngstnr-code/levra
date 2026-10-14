import { account, historyQuery, historyResponse } from "./accounts";
import { alertSettings, alertSettingsUpdate, telegramLinkResponse } from "./alerts";
import { authNonceResponse, siweRequest, siweResponse } from "./auth";
import { configResponse } from "./config";
import { eligibilityQuery, eligibilityResponse, termsAcceptRequest, termsAcceptResponse } from "./compliance";
import {
  depositQuoteRequest,
  depositQuoteResponse,
  depositStatus,
  depositTokensResponse,
  withdrawQuoteRequest,
  withdrawQuoteResponse,
} from "./deposit";
import { earnAccount, earnResponse } from "./earn";
import { marketDetail, marketsResponse, priceHistoryQuery, priceHistoryResponse } from "./markets";
import {
  quoteCloseRequest,
  quoteCloseResponse,
  quoteCollateralRequest,
  quoteCollateralResponse,
  quoteOpenRequest,
  quoteOpenResponse,
} from "./quotes";
import { sessionInfo } from "./session";
import { healthResponse, statusResponse } from "./status";

export const API_PREFIX = "/v1";

export const endpoints = {
  health: { method: "GET", path: "/v1/health", response: healthResponse },
  status: { method: "GET", path: "/v1/status", response: statusResponse },
  config: { method: "GET", path: "/v1/config", response: configResponse },
  session: { method: "GET", path: "/v1/session", response: sessionInfo },
  markets: { method: "GET", path: "/v1/markets", response: marketsResponse },
  marketDetail: { method: "GET", path: "/v1/markets/:symbol", response: marketDetail },
  marketPrices: { method: "GET", path: "/v1/markets/:symbol/prices", query: priceHistoryQuery, response: priceHistoryResponse },
  stream: { method: "GET", path: "/v1/stream" },

  quoteOpen: { method: "POST", path: "/v1/quote/open", body: quoteOpenRequest, response: quoteOpenResponse },
  quoteClose: { method: "POST", path: "/v1/quote/close", body: quoteCloseRequest, response: quoteCloseResponse },
  quoteCollateral: {
    method: "POST",
    path: "/v1/quote/collateral",
    body: quoteCollateralRequest,
    response: quoteCollateralResponse,
  },

  account: { method: "GET", path: "/v1/accounts/:address", response: account },
  accountHistory: {
    method: "GET",
    path: "/v1/accounts/:address/history",
    query: historyQuery,
    response: historyResponse,
  },

  earn: { method: "GET", path: "/v1/earn", response: earnResponse },
  earnAccount: { method: "GET", path: "/v1/earn/:address", response: earnAccount },

  depositTokens: { method: "GET", path: "/v1/deposit/tokens", response: depositTokensResponse },
  depositQuote: { method: "POST", path: "/v1/deposit/quote", body: depositQuoteRequest, response: depositQuoteResponse },
  depositStatus: { method: "GET", path: "/v1/deposit/:id", response: depositStatus },
  withdrawQuote: {
    method: "POST",
    path: "/v1/withdraw/quote",
    body: withdrawQuoteRequest,
    response: withdrawQuoteResponse,
  },

  eligibility: { method: "GET", path: "/v1/eligibility", query: eligibilityQuery, response: eligibilityResponse },
  termsAccept: { method: "POST", path: "/v1/terms/accept", body: termsAcceptRequest, response: termsAcceptResponse },

  authNonce: { method: "GET", path: "/v1/auth/nonce", response: authNonceResponse },
  authSiwe: { method: "POST", path: "/v1/auth/siwe", body: siweRequest, response: siweResponse },
  alertsGet: { method: "GET", path: "/v1/alerts", response: alertSettings, auth: true },
  alertsPut: { method: "PUT", path: "/v1/alerts", body: alertSettingsUpdate, response: alertSettings, auth: true },
  alertsTelegramLink: { method: "POST", path: "/v1/alerts/telegram", response: telegramLinkResponse, auth: true },
  alertsTelegramUnlink: { method: "DELETE", path: "/v1/alerts/telegram", response: alertSettings, auth: true },
} as const;

export type EndpointName = keyof typeof endpoints;

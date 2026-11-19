// SC-83: the real X Layer deployment script on a local fork of X Layer, then a full NVDA long through
// OKX DEX both ways and a QQQ short opened through Uniswap SwapRouter02 and closed through OKX DEX.
// Swap calldata comes from the live OKX DEX API, so this proves D-88 (OKX pulls through its approve
// contract) end to end. Nothing touches mainnet: everything runs on anvil.
//
// Usage (from contracts/): set -a; . ../.env; set +a; node script/xlayer-fork-e2e.mjs
// Needs OKX_API_KEY, OKX_SECRET_KEY and OKX_API_PASSPHRASE.
import { execFileSync, spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

const UPSTREAM = process.env.XLAYER_RPC_URL ?? "https://rpc.xlayer.tech";
const PORT = 8552;
const RPC = `http://127.0.0.1:${PORT}`;
// anvil's first default account: a public test key that only exists on the local fork.
const DEPLOYER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const MORPHO = "0xeb00C490E888286357dC5B0a35D37D9260D11Ab5";
const USDC = "0xB6CEceAB302E2E4948951eE7843FC24E92933061";
const WNVDAX = "0xa8ddb5Cd96b5222AFe198316E9A57CAA642850D5";
const WQQQX = "0x4C1AE29c159838fC1b224636E28E086EB69101f7";
const UNISWAP = "0x4f0C28f5926AFDA16bf2506D5D9e57Ea190f9bcA";
const LENDER = "0x00000000000000000000000000000000Ce751d03";
const USER = "0x00000000000000000000000000000000Ce751d04";
const MAX = (2n ** 256n - 1n).toString();

const cast = (...args) => execFileSync("cast", args, { encoding: "utf8" }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const send = (from, to, sig, ...args) =>
  execFileSync("cast", ["send", to, sig, ...args, "--from", from, "--unlocked", "--rpc-url", RPC, "--gas-limit", "5000000", "--json"], { encoding: "utf8" });
const call = (to, sig, ...args) => cast("call", to, sig, ...args, "--rpc-url", RPC).split(" ")[0];

async function okx(path, params) {
  const q = `${path}?${new URLSearchParams(params)}`;
  const ts = new Date().toISOString();
  const sign = createHmac("sha256", process.env.OKX_SECRET_KEY).update(ts + "GET" + q).digest("base64");
  const res = await fetch(`https://web3.okx.com${q}`, {
    headers: { "OK-ACCESS-KEY": process.env.OKX_API_KEY, "OK-ACCESS-SIGN": sign, "OK-ACCESS-TIMESTAMP": ts, "OK-ACCESS-PASSPHRASE": process.env.OKX_API_PASSPHRASE, "User-Agent": "curl/8.7.1" },
  });
  const json = await res.json();
  await sleep(1200);
  if (String(json.code) !== "0") throw new Error(`okx ${path}: ${json.code} ${json.msg}`);
  return json.data[0];
}

async function okxSwap(from, to, amount, wallet) {
  const d = await okx("/api/v6/dex/aggregator/swap", { chainIndex: "196", fromTokenAddress: from, toTokenAddress: to, amount: String(amount), slippagePercent: "1", userWalletAddress: wallet });
  return { target: d.tx.to, data: d.tx.data, out: BigInt(d.routerResult.toTokenAmount) };
}

function uniswapSingle(tokenIn, tokenOut, fee, recipient, amountIn, minOut) {
  const data = cast("calldata", "exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))", `(${tokenIn},${tokenOut},${fee},${recipient},${amountIn},${minOut},0)`);
  return { target: UNISWAP, data, out: minOut };
}

const openSig = "((bytes32,uint256,uint256,(address,bytes,uint256),uint256,uint256))";
const closeSig = "((bytes32,uint256,uint256,uint256,(address,bytes,uint256),uint256,uint256))";
const position = (id, who) => cast("call", MORPHO, "position(bytes32,address)(uint256,uint128,uint128)", id, who, "--rpc-url", RPC).split("\n").map((l) => BigInt(l.split(" ")[0]));
const price = (feed) => Number(BigInt(call(feed, "latestAnswer()(int256)"))) / 1e8;

async function main() {
  const anvil = spawn("anvil", ["--fork-url", UPSTREAM, "--port", String(PORT), "--silent"], { stdio: "ignore" });
  try {
    for (let i = 0; i < 60; i++) {
      try { execFileSync("cast", ["chain-id", "--rpc-url", RPC], { stdio: "ignore" }); break; } catch { await sleep(1000); }
    }

    execFileSync("forge", ["script", "script/Deploy.s.sol", "--network", "optimism", "--rpc-url", RPC, "--private-key", DEPLOYER_KEY, "--broadcast", "--slow"], {
      env: { ...process.env, DEPLOY_CONFIG: "config/xlayer.json", DEPLOY_ENV: "xlayer-fork" }, stdio: "ignore",
    });
    const dep = JSON.parse(readFileSync("deployments/xlayer-fork.json", "utf8"));
    const market = (symbol, side) => dep.markets.find((m) => m.symbol === symbol && m.side === side);
    const nvdaLong = market("NVDA", "long"), qqqShort = market("QQQ", "short");
    const router = dep.router;
    const config = JSON.parse(readFileSync("config/xlayer.json", "utf8"));
    const feedOf = (symbol) => config.markets.find((m) => m.symbol === symbol).feed;
    console.log(`deployed on the fork: router ${router}, ${dep.markets.length} markets`);

    for (const who of [MORPHO, LENDER, USER]) {
      cast("rpc", "anvil_impersonateAccount", who, "--rpc-url", RPC);
      cast("rpc", "anvil_setBalance", who, "0x8AC7230489E80000", "--rpc-url", RPC);
    }
    send(MORPHO, USDC, "transfer(address,uint256)", LENDER, "20000000000");
    send(MORPHO, WQQQX, "transfer(address,uint256)", LENDER, "1000000000000000000");
    send(MORPHO, USDC, "transfer(address,uint256)", USER, "1000000000");
    const params = (m) => `(${m.loanToken},${m.collateralToken},${m.oracle},${config.irm},${m.lltv})`;
    send(LENDER, USDC, "approve(address,uint256)", MORPHO, MAX);
    send(LENDER, WQQQX, "approve(address,uint256)", MORPHO, MAX);
    send(LENDER, MORPHO, "supply((address,address,address,address,uint256),uint256,uint256,address,bytes)", params(nvdaLong), "20000000000", "0", LENDER, "0x");
    send(LENDER, MORPHO, "supply((address,address,address,address,uint256),uint256,uint256,address,bytes)", params(qqqShort), "1000000000000000000", "0", LENDER, "0x");
    send(USER, USDC, "approve(address,uint256)", router, MAX);
    send(USER, MORPHO, "setAuthorization(address,bool)", router, "true");
    const deadline = Number(cast("block", "latest", "--field", "timestamp", "--rpc-url", RPC)) + 3600;

    // NVDA long, $100 margin and $100 borrowed, in through OKX DEX.
    const margin = 100_000_000n, borrow = 100_000_000n;
    const swapIn = margin + borrow - ((margin + borrow) * 10n) / 10_000n;
    const longIn = await okxSwap(USDC, WNVDAX, swapIn, router);
    send(USER, router, `openLong${openSig}`, `(${nvdaLong.marketId},${margin},${borrow},(${longIn.target},${longIn.data},${(longIn.out * 98n) / 100n}),580000000000000000,${deadline})`);
    const [, , longCollateral] = position(nvdaLong.marketId, USER);
    console.log(`NVDA long opened through OKX DEX: ${Number(longCollateral) / 1e18} wNVDAx collateral`);

    // QQQ short, $50 of stock, sold through Uniswap SwapRouter02 straight into the wQQQx / USDC pool.
    const qqq = price(feedOf("QQQ"));
    const shortBorrow = BigInt(Math.floor((50 / qqq) * 1e18));
    const shortIn = uniswapSingle(WQQQX, USDC, 500, router, shortBorrow, BigInt(Math.floor(50 * 0.97 * 1e6)));
    send(USER, router, `openShort${openSig}`, `(${qqqShort.marketId},${margin},${shortBorrow},(${shortIn.target},${shortIn.data},${shortIn.out}),580000000000000000,${deadline})`);
    const [, shortShares] = position(qqqShort.marketId, USER);
    console.log(`QQQ short opened through Uniswap: ${shortShares} borrow shares`);

    // Close the long through OKX DEX: sell all the collateral.
    const longOut = await okxSwap(WNVDAX, USDC, longCollateral, router);
    send(USER, router, `closeLong${closeSig}`, `(${nvdaLong.marketId},${MAX},${MAX},${MAX},(${longOut.target},${longOut.data},${(longOut.out * 98n) / 100n}),0,${deadline})`);

    // Close the short through OKX DEX: buy back the debt with a 3% margin; the surplus goes to the user.
    const spend = BigInt(Math.ceil(((Number(shortBorrow) / 1e18) * qqq * 1.03) * 1e6));
    const buyBack = await okxSwap(USDC, WQQQX, spend, router);
    send(USER, router, `closeShort${closeSig}`, `(${qqqShort.marketId},${MAX},${MAX},${spend},(${buyBack.target},${buyBack.data},${(buyBack.out * 98n) / 100n}),0,${deadline})`);

    const [, lb, lc] = position(nvdaLong.marketId, USER);
    const [, sb, sc] = position(qqqShort.marketId, USER);
    const held = [USDC, WNVDAX, WQQQX].map((t) => BigInt(call(t, "balanceOf(address)(uint256)", router)));
    const userUsdc = Number(BigInt(call(USDC, "balanceOf(address)(uint256)", USER))) / 1e6;
    const userQqq = Number(BigInt(call(WQQQX, "balanceOf(address)(uint256)", USER))) / 1e18;
    console.log(`after closing: long debt ${lb} collateral ${lc}, short debt ${sb} collateral ${sc}`);
    console.log(`router holds ${held.join(", ")} (USDC, wNVDAx, wQQQx); user ends with ${userUsdc} USDC and ${userQqq} wQQQx from 1000 USDC`);
    if (lb + lc + sb + sc !== 0n) throw new Error("a position is still open");
    if (held.some((x) => x !== 0n)) throw new Error("the router kept tokens");
    console.log("OK: NVDA long in and out through OKX DEX, QQQ short in through Uniswap and out through OKX DEX, router empty.");
  } finally {
    anvil.kill();
  }
}

await main();

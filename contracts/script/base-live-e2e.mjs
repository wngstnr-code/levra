// SC-75: a full long and short on Base through each swap target of D-80, run inside eth_simulateV1 on
// the live Base node. Coinbase stock tokens are precompiles a fork cannot run, so this is the only way
// to exercise our router against them before deploying. Nothing is sent and nothing is written.
//
// Usage (from contracts/, after forge build):
//   set -a; . ../.env; set +a; node script/base-live-e2e.mjs
// Needs ONEINCH_API_KEY. BASE_RPC_URL defaults to the public endpoint.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const RPC = process.env.BASE_RPC_URL ?? "https://mainnet.base.org";
const ONEINCH_KEY = process.env.ONEINCH_API_KEY;
if (!ONEINCH_KEY) throw new Error("ONEINCH_API_KEY is not set");
const UA = { "User-Agent": "curl/8.7.1" };

const MORPHO = "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb";
const IRM = "0x46415998764C29aB2a25CbeA6254146D50D22687";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const NVDAC = "0xb20000000000000000000078ee7ce2fE4908108C";
const NVDA_FEED = "0x04689a41629776563E6822F76f2e57D148d28513";
const ONEINCH = "0x111111125421cA6dc452d289314280a0f8842A65";
const KYBER = "0x6131B5fae19EA4f9D964eAc0408E4408b66337b5";
const AERO = "0x9Ee35Bf1bd69a03c6F0393582030fCe8Bb93D418";
const AERO_TICK_SPACING = 10;
const LLTV = "625000000000000000";
const DEPLOYER = "0x00000000000000000000000000000000Ce751d01";
const USER = "0x00000000000000000000000000000000Ce751d02";

const cast = (...args) => execFileSync("cast", args, { encoding: "utf8" }).trim();
const calldata = (sig, ...args) => cast("calldata", sig, ...args);
const decode = (sig, data) => cast("decode-abi", sig, data).split("\n").map((l) => l.split(" ")[0]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function rpc(method, params) {
  for (let i = 0; i < 5; i++) {
    const res = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json", ...UA }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
    if (res.status === 429) { await sleep(2000 * (i + 1)); continue; }
    const json = await res.json();
    if (json.error) throw new Error(`${method}: ${JSON.stringify(json.error)}`);
    return json.result;
  }
  throw new Error(`${method}: rate limited`);
}

async function oneInchSwap(src, dst, amount, account) {
  const q = new URLSearchParams({ src, dst, amount: String(amount), from: account, receiver: account, slippage: "1", disableEstimate: "true" });
  const res = await fetch(`https://api.1inch.dev/swap/v6.0/8453/swap?${q}`, { headers: { Authorization: `Bearer ${ONEINCH_KEY}`, ...UA } });
  const json = await res.json();
  if (!json.tx) throw new Error(`1inch: ${JSON.stringify(json).slice(0, 200)}`);
  await sleep(1200);
  return { target: json.tx.to, data: json.tx.data, out: BigInt(json.dstAmount) };
}

async function kyberSwap(src, dst, amount, account) {
  const base = "https://aggregator-api.kyberswap.com/base/api/v1";
  const headers = { "x-client-id": "levra", ...UA };
  const route = await (await fetch(`${base}/routes?tokenIn=${src}&tokenOut=${dst}&amountIn=${amount}`, { headers })).json();
  if (!route.data) throw new Error(`kyber route: ${JSON.stringify(route).slice(0, 200)}`);
  const built = await (await fetch(`${base}/route/build`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ routeSummary: route.data.routeSummary, sender: account, recipient: account, slippageTolerance: 100 }),
  })).json();
  if (!built.data) throw new Error(`kyber build: ${JSON.stringify(built).slice(0, 200)}`);
  return { target: built.data.routerAddress, data: built.data.data, out: BigInt(built.data.amountOut) };
}

function aeroSwap(src, dst, amount, minOut, recipient, deadline) {
  const data = calldata(
    "exactInputSingle((address,address,int24,address,uint256,uint256,uint256,uint160))",
    `(${src},${dst},${AERO_TICK_SPACING},${recipient},${deadline},${amount},${minOut},0)`,
  );
  return { target: AERO, data, out: minOut };
}

const marketId = (loan, collateral, oracle) =>
  cast("keccak", cast("abi-encode", "f(address,address,address,address,uint256)", loan, collateral, oracle, IRM, LLTV));

const G = (n) => "0x" + n.toString(16);
const call = (from, to, data, gas = G(300_000)) => ({ from, to, data, gas });
const swapCall = (to, data) => call(USER, to, data, G(2_500_000));
const transfer = (token, from, to, amount) => call(from, token, calldata("transfer(address,uint256)", to, String(amount)));
const balanceOf = (token, who) => call(USER, token, calldata("balanceOf(address)", who));
const position = (id, who) => call(USER, MORPHO, calldata("position(bytes32,address)", id, who));
const market = (id) => call(USER, MORPHO, calldata("market(bytes32)", id));

async function main() {
  const block = await rpc("eth_getBlockByNumber", ["latest", false]);
  const pinned = block.number;
  const deadline = Number(BigInt(block.timestamp)) + 3600;
  const nonce = Number(BigInt(await rpc("eth_getTransactionCount", [DEPLOYER, pinned])));
  const harness = cast("compute-address", DEPLOYER, "--nonce", String(nonce)).split(" ").pop();
  const [risk, router, longOracle, shortOracle] = [1, 2, 3, 4].map((n) => cast("compute-address", harness, "--nonce", String(n)).split(" ").pop());
  const longId = marketId(USDC, NVDAC, longOracle);
  const shortId = marketId(NVDAC, USDC, shortOracle);
  const price = Number(BigInt(cast("call", NVDA_FEED, "latestAnswer()(int256)", "--rpc-url", RPC).split(" ")[0])) / 1e8;
  console.log(`block ${BigInt(pinned)}, NVDA oracle $${price}, harness ${harness}, router ${router}`);

  const artifact = JSON.parse(readFileSync("out/BaseLiveHarness.sol/BaseLiveHarness.json", "utf8"));
  const ctor = cast("abi-encode", "f(address[])", `[${ONEINCH},${KYBER},${AERO}]`).slice(2);
  const setup = [
    { from: DEPLOYER, data: artifact.bytecode.object + ctor, gas: G(16_000_000) },
    transfer(USDC, MORPHO, harness, 20_000e6),
    transfer(NVDAC, MORPHO, harness, 5e8),
    call(DEPLOYER, harness, calldata("lend()"), G(1_000_000)),
    transfer(USDC, MORPHO, USER, 1_000e6),
    call(USER, USDC, calldata("approve(address,uint256)", router, String(2n ** 256n - 1n))),
    call(USER, MORPHO, calldata("setAuthorization(address,bool)", router, "true")),
  ];

  const margin = 100_000_000n, borrow = 100_000_000n;
  const swapIn = margin + borrow - ((margin + borrow) * 10n) / 10_000n;
  const longOpen = await oneInchSwap(USDC, NVDAC, swapIn, router);
  const shortBorrow = BigInt(Math.floor((50 / price) * 1e8));
  const shortOpen = await kyberSwap(NVDAC, USDC, shortBorrow, router);
  const openLong = swapCall(router, calldata(
    "openLong((bytes32,uint256,uint256,(address,bytes,uint256),uint256,uint256))",
    `(${longId},${margin},${borrow},(${longOpen.target},${longOpen.data},${(longOpen.out * 99n) / 100n}),580000000000000000,${deadline})`,
  ));
  const openShort = swapCall(router, calldata(
    "openShort((bytes32,uint256,uint256,(address,bytes,uint256),uint256,uint256))",
    `(${shortId},${margin},${shortBorrow},(${shortOpen.target},${shortOpen.data},${(shortOpen.out * 99n) / 100n}),580000000000000000,${deadline})`,
  ));
  const opened = [...setup, openLong, openShort, position(longId, USER), position(shortId, USER), market(shortId)];

  const simulate = async (calls) => (await rpc("eth_simulateV1", [{ blockStateCalls: [{ calls }], validation: false }, pinned]))[0].calls;
  const check = (results, names) => results.forEach((r, i) => {
    if (r.status !== "0x1") throw new Error(`${names[i] ?? `call ${i}`} failed: ${r.error?.message ?? ""} ${r.returnData}`);
  });

  const a = await simulate(opened);
  check(a, ["deploy harness", "fund harness USDC", "fund harness stock", "lend", "fund user", "approve", "authorize", "open long (1inch)", "open short (KyberSwap)"]);
  const n = setup.length;
  const collateral = BigInt(decode("f()(uint256,uint128,uint128)", a[n + 2].returnData)[2]);
  const shortShares = BigInt(decode("f()(uint256,uint128,uint128)", a[n + 3].returnData)[1]);
  const [, , totalBorrowAssets, totalBorrowShares] = decode("f()(uint128,uint128,uint128,uint128,uint128,uint128)", a[n + 4].returnData).map(BigInt);
  const shortDebt = (shortShares * totalBorrowAssets + totalBorrowShares - 1n) / totalBorrowShares;
  console.log(`opened: long collateral ${Number(collateral) / 1e8} NVDAc, short debt ${Number(shortDebt) / 1e8} NVDAc`);

  const closeLongOut = (BigInt(Math.floor(Number(collateral) * price)) * 97n) / 100n / 100n;
  const longClose = aeroSwap(NVDAC, USDC, collateral, closeLongOut, router, deadline);
  const buyBackSpend = BigInt(Math.ceil((Number(shortDebt) / 1e8) * price * 1.03 * 1e6));
  const shortClose = await oneInchSwap(USDC, NVDAC, buyBackSpend, router);
  if (shortClose.out < shortDebt) throw new Error("the buy back quote does not cover the short debt");
  const max = String(2n ** 256n - 1n);
  const closeLong = swapCall(router, calldata(
    "closeLong((bytes32,uint256,uint256,uint256,(address,bytes,uint256),uint256,uint256))",
    `(${longId},${max},${max},${max},(${longClose.target},${longClose.data},${longClose.out}),0,${deadline})`,
  ));
  const closeShort = swapCall(router, calldata(
    "closeShort((bytes32,uint256,uint256,uint256,(address,bytes,uint256),uint256,uint256))",
    `(${shortId},${max},${max},${buyBackSpend},(${shortClose.target},${shortClose.data},${(shortClose.out * 99n) / 100n}),0,${deadline})`,
  ));
  const b = await simulate([
    ...setup, openLong, openShort, closeLong, closeShort,
    position(longId, USER), position(shortId, USER),
    balanceOf(USDC, router), balanceOf(NVDAC, router), balanceOf(USDC, USER), balanceOf(NVDAC, USER),
  ]);
  check(b, ["deploy harness", "fund harness USDC", "fund harness stock", "lend", "fund user", "approve", "authorize", "open long (1inch)", "open short (KyberSwap)", "close long (Aero)", "close short (1inch)"]);
  const at = n + 4;
  const [, longBorrow, longColl] = decode("f()(uint256,uint128,uint128)", b[at].returnData).map(BigInt);
  const [, shortBorrowLeft, shortColl] = decode("f()(uint256,uint128,uint128)", b[at + 1].returnData).map(BigInt);
  const [routerUsdc, routerStock, userUsdc, userStock] = [2, 3, 4, 5].map((k) => BigInt(b[at + k].returnData));
  const gas = (k) => Number(BigInt(b[n + k].gasUsed));
  console.log(`gas: open long ${gas(0)}, open short ${gas(1)}, close long ${gas(2)}, close short ${gas(3)}`);
  console.log(`after closing: long debt ${longBorrow} collateral ${longColl}, short debt ${shortBorrowLeft} collateral ${shortColl}`);
  console.log(`router holds ${routerUsdc} USDC and ${routerStock} NVDAc; user ends with ${Number(userUsdc) / 1e6} USDC and ${Number(userStock) / 1e8} NVDAc from 1000 USDC`);
  if (longBorrow + longColl + shortBorrowLeft + shortColl !== 0n) throw new Error("a position is still open");
  if (routerUsdc + routerStock !== 0n) throw new Error("the router kept tokens");
  console.log("OK: long through 1inch and Aero, short through KyberSwap and 1inch, router empty.");
}

await main();

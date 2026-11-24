import { externalByChain, tokensByChain } from "@levra/shared/addresses";
import { chains as sharedChains } from "@levra/shared/chains";
import { webChains, type WebChain } from "./chains";

/**
 * A single static page that explains how to leave Levra straight on Morpho, with no script and no request to our
 * servers, so it can be served from X Layer DeWEB (FE-82, D-113). Every address comes from packages/shared.
 */

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function addressLink(chain: WebChain, address: string): string {
  const base = sharedChains[chain.id].explorer;
  return `<a href="${esc(`${base}/address/${address}`)}"><code>${esc(address)}</code></a>`;
}

function chainSection(chain: WebChain): string {
  const morpho = externalByChain[chain.id].morpho;
  const usdc = tokensByChain[chain.id].USDC.address;
  const routers = [chain.deployment.router, ...(chain.deployment.previousRouters ?? []).filter((r) => r.toLowerCase() !== chain.deployment.router.toLowerCase())];
  const rows = chain.deployment.markets
    .map((mk) => `<tr><td>${esc(mk.symbol)} ${esc(mk.side)}</td><td><code>${esc(mk.marketId)}</code></td></tr>`)
    .join("");
  return `<section>
<h2>${esc(chain.name)}</h2>
<p>Morpho: ${addressLink(chain, morpho)}<br>USDC: ${addressLink(chain, usdc)}<br>Levra router${routers.length > 1 ? "s" : ""}: ${routers.map((r) => addressLink(chain, r)).join(", ")}</p>
<ol>
<li><b>Revoke Levra's access.</b> On Morpho, call <code>setAuthorization(router, false)</code> for each router above. Check it with <code>isAuthorized(yourAddress, router)</code>.</li>
<li><b>Remove a USDC allowance.</b> On USDC, call <code>approve(router, 0)</code> for each router you approved.</li>
<li><b>Close on Morpho.</b> Call <code>repay</code> for your debt, then <code>withdrawCollateral</code>, with your market's parameters (<code>idToMarketParams(marketId)</code> on Morpho). A long repays USDC and gets the stock back. A short repays the stock and gets USDC back.</li>
</ol>
<details><summary>Market IDs on ${esc(chain.name)}</summary><table><tr><th>Market</th><th>Morpho market ID</th></tr>${rows}</table></details>
</section>`;
}

export function exitPageHtml(chains: readonly WebChain[] = webChains): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Close a Levra position without Levra</title>
<style>
:root{color-scheme:light dark;--bg:#fbfbfa;--fg:#111;--muted:#555;--line:#ddd}
@media (prefers-color-scheme:dark){:root{--bg:#0a0a0b;--fg:#f5f5f7;--muted:#a1a1a6;--line:#2a2a2e}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 system-ui,sans-serif}
main{max-width:760px;margin:0 auto;padding:32px 16px 64px}
h1{font-size:32px;line-height:1.2;margin:0 0 12px}h2{margin-top:40px;border-top:1px solid var(--line);padding-top:24px}
p,li{color:var(--fg)}small,.muted{color:var(--muted)}
code{font-size:13px;word-break:break-all}a{color:inherit}
table{border-collapse:collapse;width:100%;font-size:13px}td,th{border-bottom:1px solid var(--line);padding:6px 4px;text-align:left;vertical-align:top}
</style>
</head>
<body>
<main>
<h1>Close a Levra position without Levra</h1>
<p>Your collateral and your debt sit in your own position on Morpho, under your own address. Levra's contracts hold nothing between transactions. You can manage or close the position straight on Morpho, from any wallet that can call a contract, for example the "Write contract" tab of the block explorer.</p>
<p class="muted">This page has no script and loads nothing from Levra's servers. Not audited. The limits are initial proposals.</p>
${chains.map(chainSection).join("\n")}
</main>
</body>
</html>
`;
}

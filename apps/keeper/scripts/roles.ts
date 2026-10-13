import type { Deployment } from "@levra/shared/deployments";
import { formatEther, parseEther, type Address } from "viem";

/**
 * One key per keeper role (BE-55, 07). Each role is granted on chain by the owner (later the multisig, SC-55) with the
 * call below, and can do one thing only.
 */
export const ROLES = {
  ORACLE_AGE_POSTER_KEY: { label: "oracle age poster", grant: (d: Deployment, a: Address) => `cast send ${d.riskManager} "setOracleAgePoster(address)" ${a}`, revoke: (d: Deployment) => `cast send ${d.riskManager} "setOracleAgePoster(address)" <new address>` },
  CALENDAR_POSTER_KEY: { label: "calendar poster", grant: (d: Deployment, a: Address) => `cast send ${d.riskManager} "setCalendarPoster(address)" ${a}`, revoke: (d: Deployment) => `cast send ${d.riskManager} "setCalendarPoster(address)" <new address>` },
  PROTECTOR_KEY: { label: "router keeper (protector)", grant: (d: Deployment, a: Address) => `cast send ${d.router} "setKeeper(address,bool)" ${a} true`, revoke: (d: Deployment, a: Address) => `cast send ${d.router} "setKeeper(address,bool)" ${a} false` },
  LIQUIDATOR_KEY: { label: "Liquidator keeper", grant: (d: Deployment, a: Address) => `cast send ${d.liquidator ?? "<liquidator>"} "setKeeper(address,bool)" ${a} true`, revoke: (d: Deployment, a: Address) => `cast send ${d.liquidator ?? "<liquidator>"} "setKeeper(address,bool)" ${a} false` },
} as const;

export type RoleName = keyof typeof ROLES;

/** The address variables of `make set-roles-monad` (contracts/script/mainnet-set-roles.sh), which grants the roles. */
export const SET_ROLES_ENV: Record<RoleName, string> = {
  ORACLE_AGE_POSTER_KEY: "ORACLE_AGE_POSTER",
  CALENDAR_POSTER_KEY: "CALENDAR_POSTER",
  PROTECTOR_KEY: "KEEPER",
  LIQUIDATOR_KEY: "LIQUIDATOR_KEEPER",
};
export const isRoleName = (s: string): s is RoleName => Object.hasOwn(ROLES, s);

/** Top-up limits, initial proposals: enough MON for about 140 transactions per role, never much more on a hot key. */
export const TOP_UP = {
  targetWei: parseEther("10"),
  maxPerWalletWei: parseEther("10"),
  maxTotalWei: parseEther("30"),
} as const;

export type TopUp = { role: string; address: Address; balanceWei: bigint; sendWei: bigint };

/**
 * What to send so each wallet reaches the target, never more than the per-wallet cap, and stopping once the total cap
 * for this run is spent. The lowest balances are served first.
 */
export function planTopUps(wallets: { role: string; address: Address; balanceWei: bigint }[], limits: { targetWei: bigint; maxPerWalletWei: bigint; maxTotalWei: bigint } = TOP_UP): TopUp[] {
  let left = limits.maxTotalWei;
  return [...wallets]
    .sort((a, b) => (a.balanceWei < b.balanceWei ? -1 : a.balanceWei > b.balanceWei ? 1 : 0))
    .map((w) => {
      const need = w.balanceWei >= limits.targetWei ? 0n : limits.targetWei - w.balanceWei;
      const capped = need > limits.maxPerWalletWei ? limits.maxPerWalletWei : need;
      const sendWei = capped > left ? left : capped;
      left -= sendWei;
      return { ...w, sendWei };
    });
}

export const mon = (wei: bigint) => `${Number(formatEther(wei)).toFixed(4)} MON`;

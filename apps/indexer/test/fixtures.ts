import { marginRouterAbi } from "@levra/shared/abis";
import { encodeAbiParameters, encodeEventTopics, getAbiItem, type Hex } from "viem";
import type { RawLog } from "../src/sources/types";

export const user = "0x00000000000000000000000000000000000b1601";
export const marketId = `0x${"ab".repeat(32)}` as Hex;
export const router = "0x5f246addcf057e0f778cd422e20e413be70f9a0c";

/** A PositionOpened log built with the shared ABI, as the router would emit it. */
export function openedLog(blockNumber: bigint, logIndex = 0): RawLog {
  const event = getAbiItem({ abi: marginRouterAbi, name: "PositionOpened" });
  const topics = encodeEventTopics({ abi: [event], eventName: "PositionOpened", args: { user, marketId } });
  const data = encodeAbiParameters(
    event.inputs.filter((i) => !i.indexed),
    [0, 50_000_000n, 135_000_000_000_000_000n, 50_000_000n, 73_500_000_000n, 74_000_000_000n, 100_000n, 500_000_000_000_000_000n],
  );
  return {
    blockNumber,
    blockTime: 1_791_876_168,
    logIndex,
    txHash: `0x${blockNumber.toString(16).padStart(64, "0")}`,
    address: router,
    topics: topics as RawLog["topics"],
    data,
  };
}

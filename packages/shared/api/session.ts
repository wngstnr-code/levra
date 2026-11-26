import { z } from "zod";
import { clockCheck } from "./circuits";
import { sessionName, unixSeconds } from "./primitives";

export const sessionInfo = z.object({
  session: sessionName,
  closedRegime: z.boolean(),
  nextCloseAt: unixSeconds.nullable(),
  nextOpenAt: unixSeconds.nullable(),
  updatedAt: unixSeconds,
  /** X Layer only (BE-86): the Wall Street Clock circuit's session at `updatedAt`; null when it could not be read. */
  clock: clockCheck.nullable().optional(),
});
export type SessionInfo = z.infer<typeof sessionInfo>;

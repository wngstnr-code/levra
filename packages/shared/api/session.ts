import { z } from "zod";
import { sessionName, unixSeconds } from "./primitives";

export const sessionInfo = z.object({
  session: sessionName,
  closedRegime: z.boolean(),
  nextCloseAt: unixSeconds.nullable(),
  nextOpenAt: unixSeconds.nullable(),
  updatedAt: unixSeconds,
});
export type SessionInfo = z.infer<typeof sessionInfo>;

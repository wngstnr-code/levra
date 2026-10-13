import { z } from "zod";
import { wad } from "./primitives";

export const alertSettings = z.object({
  channels: z.object({
    email: z.email().nullable(),
    telegramLinked: z.boolean(),
  }),
  events: z.object({
    preClose: z.boolean(),
    ltvThresholdWad: wad.nullable(),
    autoDeleverage: z.boolean(),
    liquidation: z.boolean(),
    depositArrived: z.boolean(),
  }),
});
export type AlertSettings = z.infer<typeof alertSettings>;

export const alertSettingsUpdate = z.object({
  channels: z.object({ email: z.email().nullable() }).optional(),
  events: alertSettings.shape.events.partial().optional(),
});
export type AlertSettingsUpdate = z.infer<typeof alertSettingsUpdate>;

import { track } from "@vercel/analytics";

/** Steps of the funnel from a visit to a first position. No amounts and no addresses are sent. */
export type FunnelStep = "sign_in_opened" | "confirm_opened" | "position_opened" | "deposit_address_shown" | "supply_confirmed";

export function trackStep(step: FunnelStep, props?: Record<string, string>) {
  try {
    track(step, props);
  } catch {
    // Metrics must never break the app.
  }
}

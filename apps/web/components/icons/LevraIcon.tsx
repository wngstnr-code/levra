import type { SVGProps } from "react";

/** Product icons on a 24 px grid, 1.75 stroke, round caps. Common actions use Lucide. */
const paths = {
  long: "M4 17 L10 11 L13 14 L20 7 M15 7 H20 V12",
  short: "M4 7 L10 13 L13 10 L20 17 M15 17 H20 V12",
  leverage: "M5 19 V13 M10 19 V9 M15 19 V5 M19 9 L19 5 L15 5",
  lend: "M4 12 a8 8 0 1 0 16 0 a8 8 0 1 0 -16 0 M12 8 V16 M9 11 L12 8 L15 11",
  weekendGuard: "M12 3 L19 6 V11 C19 16 15.5 19.5 12 21 C8.5 19.5 5 16 5 11 V6 Z M14.5 9.5 A3.2 3.2 0 1 0 14.5 15 A4 4 0 0 1 14.5 9.5 Z",
  pricePaused: "M4 12 a8 8 0 1 0 16 0 a8 8 0 1 0 -16 0 M10 9 V15 M14 9 V15",
  mondayGap: "M4 8 H10 M14 16 H20 M10 8 L14 16 M4 20 H20",
  borrowLimit: "M4 18 A8 8 0 0 1 20 18 M12 18 L16 11 M4 18 H6 M18 18 H20",
  liquidation: "M12 3 L21 19 H3 Z M12 10 V14 M12 17 V17.2",
  debtRatio: "M4 12 a8 8 0 1 0 16 0 a8 8 0 1 0 -16 0 M12 4 V12 L18 16",
  verified:
    "M12 3 L14.5 5 L18 5 L18.5 8.5 L21 11 L19 14 L19 17.5 L15.5 18 L12 21 L8.5 18 L5 17.5 L5 14 L3 11 L5.5 8.5 L6 5 L9.5 5 Z M8.5 12 L11 14.5 L15.5 9.5",
  anyNetwork: "M3 12 a9 9 0 1 0 18 0 a9 9 0 1 0 -18 0 M3 12 H21 M12 3 C15 6 15 18 12 21 C9 18 9 6 12 3",
} as const;

export type LevraIconName = keyof typeof paths;
export const levraIconNames = Object.keys(paths) as LevraIconName[];

export function LevraIcon({ name, size = 20, ...props }: { name: LevraIconName; size?: number } & Omit<SVGProps<SVGSVGElement>, "name">) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      <path d={paths[name]} />
    </svg>
  );
}

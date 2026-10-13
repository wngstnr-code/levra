import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "quiet" | "caution";
type Size = "md" | "sm";

const variants: Record<Variant, string> = {
  primary: "bg-lime text-ink hover:brightness-105",
  secondary: "bg-surface-3 text-fg hover:bg-[#38383e]",
  quiet: "text-fg-2 hover:text-fg",
  caution: "bg-caution text-ink hover:brightness-105",
};

const sizes: Record<Size, string> = {
  md: "h-11 px-6 text-[15px]",
  sm: "h-9 px-4 text-sm",
};

export function Button({
  variant = "primary",
  size = "md",
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return (
    <button
      type={type}
      className={cn(
        "squircle inline-flex items-center justify-center gap-2 rounded-full font-semibold whitespace-nowrap",
        "transition-[transform,filter,background-color,color] duration-200 ease-spring active:scale-[0.97]",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime",
        "disabled:pointer-events-none disabled:opacity-40",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  );
}

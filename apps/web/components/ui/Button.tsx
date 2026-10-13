import Link from "next/link";
import type { ButtonHTMLAttributes, ComponentProps } from "react";
import { cn } from "@/lib/cn";

export type ButtonVariant = "primary" | "secondary" | "quiet" | "caution" | "danger";
type Size = "md" | "sm" | "lg";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-lime text-ink hover:brightness-105",
  secondary: "bg-surface-3 text-fg hover:bg-[#38383e]",
  quiet: "text-fg-2 hover:text-fg",
  caution: "bg-caution text-ink hover:brightness-105",
  danger: "bg-down-soft text-down hover:brightness-110",
};

const sizes: Record<Size, string> = {
  sm: "h-9 px-4 text-sm",
  md: "h-11 px-6 text-[15px]",
  lg: "h-14 px-6 text-base",
};

export function buttonClass(variant: ButtonVariant = "primary", size: Size = "md", className?: string) {
  return cn(
    "squircle inline-flex items-center justify-center gap-2 rounded-full font-semibold whitespace-nowrap",
    "transition-[transform,filter,background-color,color] duration-200 ease-spring active:scale-[0.97]",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime",
    "disabled:pointer-events-none disabled:opacity-40 aria-disabled:pointer-events-none aria-disabled:opacity-40",
    variants[variant],
    sizes[size],
    className,
  );
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: Size }) {
  return <button type={type} className={buttonClass(variant, size, className)} {...props} />;
}

/** A link that looks like a button. When disabled it is not focusable and says so to screen readers. */
export function ButtonLink({
  variant = "primary",
  size = "md",
  className,
  disabled,
  ...props
}: ComponentProps<typeof Link> & { variant?: ButtonVariant; size?: Size; disabled?: boolean }) {
  return (
    <Link
      className={buttonClass(variant, size, className)}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : undefined}
      {...props}
    />
  );
}

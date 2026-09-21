import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset transition-colors",
  {
    variants: {
      variant: {
        default: "bg-white/10 text-white ring-white/10",
        success: "bg-brand-green/15 text-brand-green ring-brand-green/30",
        warning: "bg-brand-amber/15 text-brand-amber ring-brand-amber/30",
        danger: "bg-brand-red/15 text-brand-red ring-brand-red/30",
        outline: "border border-white/20 text-white/80 ring-transparent",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

interface BadgeProps extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

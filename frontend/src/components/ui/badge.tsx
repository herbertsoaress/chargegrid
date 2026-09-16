import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", {
  variants: {
    variant: {
      default: "bg-white/10 text-white",
      success: "bg-brand-teal/20 text-brand-teal",
      warning: "bg-brand-amber/20 text-brand-amber",
      danger: "bg-brand-red/20 text-brand-red",
      outline: "border border-white/20 text-white/80",
    },
  },
  defaultVariants: { variant: "default" },
});

interface BadgeProps extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

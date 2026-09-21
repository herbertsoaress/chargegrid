import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium transition-all duration-200 ease-out disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red/50 focus-visible:ring-offset-2 focus-visible:ring-offset-navy-950",
  {
    variants: {
      variant: {
        default: "bg-brand-red text-white shadow-md shadow-brand-red/20 hover:bg-brand-red-dark hover:shadow-lg hover:shadow-brand-red/30",
        secondary: "bg-navy-700 text-white shadow-sm hover:bg-navy-800",
        outline: "border border-white/15 text-white hover:border-white/30 hover:bg-white/10",
        ghost: "text-white/80 hover:bg-white/10",
        success: "bg-brand-green text-white shadow-md shadow-brand-green/20 hover:opacity-90 hover:shadow-lg hover:shadow-brand-green/30",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-8 px-3 text-xs",
        lg: "h-12 px-6 text-base",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({ className, variant, size, asChild, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

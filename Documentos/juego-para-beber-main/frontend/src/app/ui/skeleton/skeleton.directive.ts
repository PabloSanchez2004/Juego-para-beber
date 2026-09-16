import { Directive, computed, input } from "@angular/core";
import { cva, type VariantProps } from "class-variance-authority";
import { hlm } from "../utils";

export const skeletonVariants = cva(
  "animate-pulse rounded-2xl bg-ink-800/80 border border-ink-700/40",
  {
    variants: {
      variant: {
        default: "",
        card: "h-32 w-full",
        avatar: "h-10 w-10 rounded-full",
        text: "h-4 w-3/4 rounded-md",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export type SkeletonVariants = VariantProps<typeof skeletonVariants>;

@Directive({
  selector: "[hlmSkeleton]",
  standalone: true,
  host: {
    "[class]": "classes()",
  },
})
export class HlmSkeletonDirective {
  readonly variant = input<SkeletonVariants["variant"]>("default");
  readonly userClass = input<string>("", { alias: "class" });

  protected readonly classes = computed(() =>
    hlm(skeletonVariants({ variant: this.variant() }), this.userClass())
  );
}

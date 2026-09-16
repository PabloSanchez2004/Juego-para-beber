import { Component, computed, input } from "@angular/core";
import { cva, type VariantProps } from "class-variance-authority";
import { hlm } from "../utils";

export const progressVariants = cva(
  "relative w-full overflow-hidden rounded-full bg-ink-850 border border-ink-700/50 transition-all",
  {
    variants: {
      height: {
        sm: "h-1.5",
        default: "h-2 sm:h-2.5",
        lg: "h-4",
      },
    },
    defaultVariants: {
      height: "default",
    },
  }
);

export const progressFillVariants = cva(
  "h-full w-full flex-1 rounded-full transition-all duration-500 ease-out shadow-sm",
  {
    variants: {
      variant: {
        default:
          "bg-gradient-to-r from-primary to-[#ff758c] shadow-[0_0_12px_rgba(255,42,95,0.4)]",
        party:
          "bg-gradient-to-r from-primary via-[#a855f7] to-[#00f5a0] shadow-[0_0_12px_rgba(255,42,95,0.4)]",
        mint:
          "bg-gradient-to-r from-neon-mint to-[#2bfd9c] shadow-[0_0_12px_rgba(0,245,160,0.4)]",
        gold:
          "bg-gradient-to-r from-gold-400 to-amber-500 shadow-[0_0_12px_rgba(255,209,102,0.4)]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

@Component({
  selector: "hlm-progress",
  standalone: true,
  host: {
    role: "progressbar",
    "[attr.aria-valuenow]": "value()",
    "[attr.aria-valuemin]": "0",
    "[attr.aria-valuemax]": "max()",
    "[class]": "containerClasses()",
  },
  template: `
    <div
      [class]="fillClasses()"
      [style.width.%]="percentage()"></div>
  `,
})
export class HlmProgressComponent {
  readonly value = input<number>(0);
  readonly max = input<number>(100);
  readonly variant = input<"default" | "party" | "mint" | "gold">("default");
  readonly height = input<"sm" | "default" | "lg">("default");
  readonly userClass = input<string>("", { alias: "class" });

  protected readonly percentage = computed(() => {
    const maxVal = this.max() || 100;
    const val = this.value() || 0;
    return Math.min(100, Math.max(0, (val / maxVal) * 100));
  });

  protected readonly containerClasses = computed(() =>
    hlm(progressVariants({ height: this.height() }), this.userClass())
  );

  protected readonly fillClasses = computed(() =>
    progressFillVariants({ variant: this.variant() })
  );
}

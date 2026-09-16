import { Component, Directive, computed, input } from "@angular/core";
import { cva, type VariantProps } from "class-variance-authority";
import { hlm } from "../utils";

export const avatarVariants = cva(
  "relative flex shrink-0 overflow-hidden select-none transition-all",
  {
    variants: {
      size: {
        default: "h-10 w-10 text-base rounded-2xl",
        sm: "h-8 w-8 text-xs rounded-xl",
        lg: "h-14 w-14 text-xl rounded-3xl",
      },
      variant: {
        default: "bg-ink-850 text-foreground border border-ink-700/60",
        me: "bg-gradient-to-tr from-primary to-[#ff1447] text-white font-black border-2 border-primary/80 shadow-[0_0_12px_rgba(255,42,95,0.35)]",
        gold: "bg-gradient-to-tr from-gold-400 to-amber-500 text-ink-950 font-black border-2 border-gold-400 shadow-[0_0_12px_rgba(255,209,102,0.35)]",
        mint: "bg-gradient-to-tr from-neon-mint to-[#00d285] text-ink-950 font-black border-2 border-neon-mint shadow-[0_0_12px_rgba(0,245,160,0.35)]",
      },
    },
    defaultVariants: {
      size: "default",
      variant: "default",
    },
  }
);

export type AvatarVariants = VariantProps<typeof avatarVariants>;

@Component({
  selector: "hlm-avatar",
  standalone: true,
  host: {
    "[class]": "classes()",
  },
  template: `
    <div class="flex h-full w-full items-center justify-center font-black">
      <ng-content />
    </div>
  `,
})
export class HlmAvatarComponent {
  readonly size = input<AvatarVariants["size"]>("default");
  readonly variant = input<AvatarVariants["variant"]>("default");
  readonly userClass = input<string>("", { alias: "class" });

  protected readonly classes = computed(() =>
    hlm(
      avatarVariants({
        size: this.size(),
        variant: this.variant(),
      }),
      this.userClass()
    )
  );
}

@Directive({
  selector: "[hlmAvatarFallback]",
  standalone: true,
  host: {
    "[class]": "classes()",
  },
})
export class HlmAvatarFallbackDirective {
  readonly userClass = input<string>("", { alias: "class" });
  protected readonly classes = computed(() =>
    hlm("flex h-full w-full items-center justify-center font-black uppercase", this.userClass())
  );
}

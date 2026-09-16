import { Directive, computed, input } from '@angular/core';
import { cva, type VariantProps } from 'class-variance-authority';
import { hlm } from '../utils';

export const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-xl border px-3 py-1 text-xs font-black tracking-wide transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 select-none',
  {
    variants: {
      variant: {
        default:
          'border-transparent bg-primary text-primary-foreground shadow-sm hover:bg-primary/80',
        secondary:
          'border-border bg-secondary text-secondary-foreground hover:bg-secondary/80',
        destructive:
          'border-red-500/50 bg-red-950/80 text-red-200 shadow-sm',
        outline:
          'border-border text-foreground',
        gold:
          'border-gold-400/50 bg-gradient-to-r from-gold-400/20 to-amber-500/20 text-gold-300 shadow-[0_0_12px_rgba(255,209,102,0.2)]',
        mint:
          'border-neon-mint/50 bg-neon-mint/20 text-neon-mint shadow-[0_0_12px_rgba(0,245,160,0.2)]',
        party:
          'border-primary/50 bg-primary/20 text-brand-300 shadow-[0_0_12px_rgba(255,42,95,0.2)]',
        neutral:
          'border-border bg-ink-850 text-slate-300',
      },
      size: {
        default: 'px-3 py-1 text-xs',
        sm: 'px-2 py-0.5 text-[10px]',
        lg: 'px-4 py-1.5 text-sm',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

export type BadgeVariants = VariantProps<typeof badgeVariants>;

@Directive({
  selector: '[hlmBadge]',
  standalone: true,
  host: {
    '[class]': 'classes()',
  },
})
export class HlmBadgeDirective {
  readonly variant = input<BadgeVariants['variant']>('default');
  readonly size = input<BadgeVariants['size']>('default');
  readonly userClass = input<string>('', { alias: 'class' });

  protected readonly classes = computed(() =>
    hlm(
      badgeVariants({
        variant: this.variant(),
        size: this.size(),
      }),
      this.userClass()
    )
  );
}

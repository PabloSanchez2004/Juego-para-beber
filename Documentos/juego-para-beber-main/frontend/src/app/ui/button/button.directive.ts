import { Directive, computed, input } from '@angular/core';
import { cva, type VariantProps } from 'class-variance-authority';
import { hlm } from '../utils';

export const buttonVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap rounded-2xl text-base font-extrabold transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-45 select-none active:translate-y-0.5',
  {
    variants: {
      variant: {
        default:
          'bg-gradient-to-r from-primary to-[#ff1447] text-white border border-[#ff4777] shadow-button hover:from-[#ff3d6e] hover:to-primary active:shadow-none',
        party:
          'bg-gradient-to-r from-primary to-[#ff1447] text-white border border-[#ff4777] shadow-button hover:from-[#ff3d6e] hover:to-primary active:shadow-none',
        secondary:
          'bg-secondary text-secondary-foreground border border-border hover:bg-secondary/80 hover:border-border/80 shadow-sm active:shadow-none',
        destructive:
          'bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-sm border border-red-500/50',
        outline:
          'border-2 border-border bg-transparent hover:bg-accent hover:text-accent-foreground text-foreground',
        ghost:
          'hover:bg-accent hover:text-accent-foreground text-foreground',
        link:
          'text-primary underline-offset-4 hover:underline min-h-0 p-0',
        mint:
          'bg-neon-mint text-[#062316] font-black hover:bg-neon-mint/90 shadow-md shadow-neon-mint/20 active:shadow-none',
        gold:
          'bg-gold-400 text-ink-950 font-black hover:bg-gold-400/90 shadow-md shadow-gold-400/20 active:shadow-none',
        muted:
          'bg-ink-850 text-muted-foreground border border-ink-700 hover:bg-ink-800 hover:text-foreground',
      },
      size: {
        default: 'min-h-[56px] px-5 py-3.5',
        sm: 'min-h-[38px] px-3.5 py-1.5 text-xs',
        lg: 'min-h-[64px] px-8 py-4 text-lg font-black',
        icon: 'h-10 w-10 p-0 rounded-xl min-h-0',
        pill: 'min-h-[36px] px-4 py-1.5 text-xs rounded-full',
        full: 'w-full min-h-[56px] px-5 py-3.5',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

export type ButtonVariants = VariantProps<typeof buttonVariants>;

@Directive({
  selector: '[hlmBtn], [hlmButton]',
  standalone: true,
  host: {
    '[class]': 'classes()',
  },
})
export class HlmButtonDirective {
  readonly variant = input<ButtonVariants['variant']>('default');
  readonly size = input<ButtonVariants['size']>('default');
  readonly userClass = input<string>('', { alias: 'class' });

  protected readonly classes = computed(() =>
    hlm(
      buttonVariants({
        variant: this.variant(),
        size: this.size(),
      }),
      this.userClass()
    )
  );
}

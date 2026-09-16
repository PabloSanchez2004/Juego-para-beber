import { Directive, computed, input } from '@angular/core';
import { cva, type VariantProps } from 'class-variance-authority';
import { hlm } from '../utils';

export const inputVariants = cva(
  'flex w-full rounded-2xl border-1.5 border-border bg-ink-950/80 px-4 py-3.5 text-base font-bold text-foreground ring-offset-background transition-all placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-primary focus-visible:ring-4 focus-visible:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'min-h-[58px] text-lg font-bold',
        numeric:
          'min-h-[130px] px-4 py-6 text-center text-4xl sm:text-5xl font-black text-neon-mint tracking-tight border-2 border-border focus-visible:border-neon-mint focus-visible:ring-neon-mint/20 shadow-inner bg-ink-950/90',
        code:
          'min-h-[64px] px-4 py-3 text-center text-3xl font-black tracking-[0.4em] uppercase border-2 border-primary/40 bg-ink-950 text-gold-400 focus-visible:border-primary focus-visible:ring-primary/20',
        textarea:
          'min-h-[140px] resize-none text-base font-medium leading-relaxed',
      },
      size: {
        default: 'h-auto',
        sm: 'min-h-[44px] px-3 py-2 text-sm',
        lg: 'min-h-[68px] px-5 py-4 text-xl',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

export type InputVariants = VariantProps<typeof inputVariants>;

@Directive({
  selector: '[hlmInput], [hlmTextarea]',
  standalone: true,
  host: {
    '[class]': 'classes()',
  },
})
export class HlmInputDirective {
  readonly variant = input<InputVariants['variant']>('default');
  readonly size = input<InputVariants['size']>('default');
  readonly userClass = input<string>('', { alias: 'class' });

  protected readonly classes = computed(() =>
    hlm(
      inputVariants({
        variant: this.variant(),
        size: this.size(),
      }),
      this.userClass()
    )
  );
}

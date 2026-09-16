import { Directive, computed, input } from '@angular/core';
import { cva, type VariantProps } from 'class-variance-authority';
import { hlm } from '../utils';

export const cardVariants = cva(
  'rounded-3xl border text-card-foreground transition-all duration-200',
  {
    variants: {
      variant: {
        default:
          'bg-card border-border shadow-card p-6',
        elevated:
          'bg-ink-800 border-ink-600 shadow-elevated p-6',
        winner:
          'bg-gradient-to-br from-gold-400/20 via-ink-900 to-ink-900 border-2 border-gold-400 shadow-[0_0_24px_rgba(255,209,102,0.25)] p-5',
        loser:
          'bg-gradient-to-br from-destructive/20 via-ink-900 to-ink-900 border-2 border-destructive shadow-[0_0_24px_rgba(255,42,95,0.25)] p-5',
        ticket:
          'bg-[#f7f6f0] text-[#0f121d] border-0 shadow-md p-6 rounded-2xl',
        joker:
          'bg-gradient-to-br from-violet-950/80 via-ink-900 to-ink-950 border-2 border-violet-600 shadow-[0_0_20px_rgba(168,85,247,0.2)] p-4',
        compact:
          'bg-card border-border shadow-sm p-4 rounded-2xl',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

export type CardVariants = VariantProps<typeof cardVariants>;

@Directive({
  selector: '[hlmCard]',
  standalone: true,
  host: {
    '[class]': 'classes()',
  },
})
export class HlmCardDirective {
  readonly variant = input<CardVariants['variant']>('default');
  readonly userClass = input<string>('', { alias: 'class' });

  protected readonly classes = computed(() =>
    hlm(cardVariants({ variant: this.variant() }), this.userClass())
  );
}

@Directive({
  selector: '[hlmCardHeader]',
  standalone: true,
  host: {
    '[class]': 'classes()',
  },
})
export class HlmCardHeaderDirective {
  readonly userClass = input<string>('', { alias: 'class' });
  protected readonly classes = computed(() =>
    hlm('flex flex-col space-y-1.5 pb-4', this.userClass())
  );
}

@Directive({
  selector: '[hlmCardTitle]',
  standalone: true,
  host: {
    '[class]': 'classes()',
  },
})
export class HlmCardTitleDirective {
  readonly userClass = input<string>('', { alias: 'class' });
  protected readonly classes = computed(() =>
    hlm('text-xl sm:text-2xl font-black leading-tight tracking-tight text-foreground', this.userClass())
  );
}

@Directive({
  selector: '[hlmCardDescription]',
  standalone: true,
  host: {
    '[class]': 'classes()',
  },
})
export class HlmCardDescriptionDirective {
  readonly userClass = input<string>('', { alias: 'class' });
  protected readonly classes = computed(() =>
    hlm('text-sm text-muted-foreground leading-relaxed', this.userClass())
  );
}

@Directive({
  selector: '[hlmCardContent]',
  standalone: true,
  host: {
    '[class]': 'classes()',
  },
})
export class HlmCardContentDirective {
  readonly userClass = input<string>('', { alias: 'class' });
  protected readonly classes = computed(() =>
    hlm('pt-0', this.userClass())
  );
}

@Directive({
  selector: '[hlmCardFooter]',
  standalone: true,
  host: {
    '[class]': 'classes()',
  },
})
export class HlmCardFooterDirective {
  readonly userClass = input<string>('', { alias: 'class' });
  protected readonly classes = computed(() =>
    hlm('flex items-center pt-4', this.userClass())
  );
}

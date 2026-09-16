import { Directive, computed, input } from '@angular/core';
import { cva, type VariantProps } from 'class-variance-authority';
import { hlm } from '../utils';

export const alertVariants = cva(
  'relative w-full rounded-2xl border p-4 text-sm [&>svg]:absolute [&>svg]:text-foreground [&>svg]:left-4 [&>svg]:top-4 [&>svg+div]:translate-y-[-3px] [&:has(svg)]:pl-11 transition-all',
  {
    variants: {
      variant: {
        default: 'bg-card text-foreground border-border shadow-sm',
        destructive:
          'border-red-500/50 bg-gradient-to-br from-red-950/80 to-ink-950 text-red-200 shadow-[0_4px_16px_rgba(255,42,95,0.2)] font-semibold',
        warning:
          'border-amber-500/50 bg-gradient-to-br from-amber-950/80 to-ink-950 text-amber-200 shadow-sm font-semibold',
        success:
          'border-emerald-500/50 bg-gradient-to-br from-emerald-950/80 to-ink-950 text-emerald-200 shadow-sm font-semibold',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

export type AlertVariants = VariantProps<typeof alertVariants>;

@Directive({
  selector: '[hlmAlert]',
  standalone: true,
  host: {
    role: 'alert',
    '[class]': 'classes()',
  },
})
export class HlmAlertDirective {
  readonly variant = input<AlertVariants['variant']>('default');
  readonly userClass = input<string>('', { alias: 'class' });

  protected readonly classes = computed(() =>
    hlm(alertVariants({ variant: this.variant() }), this.userClass())
  );
}

@Directive({
  selector: '[hlmAlertTitle]',
  standalone: true,
  host: {
    '[class]': 'classes()',
  },
})
export class HlmAlertTitleDirective {
  readonly userClass = input<string>('', { alias: 'class' });
  protected readonly classes = computed(() =>
    hlm('mb-1 font-bold leading-none tracking-tight', this.userClass())
  );
}

@Directive({
  selector: '[hlmAlertDescription]',
  standalone: true,
  host: {
    '[class]': 'classes()',
  },
})
export class HlmAlertDescriptionDirective {
  readonly userClass = input<string>('', { alias: 'class' });
  protected readonly classes = computed(() =>
    hlm('text-xs leading-relaxed opacity-90', this.userClass())
  );
}

import {
  Component,
  Directive,
  HostListener,
  computed,
  input,
  model,
  output,
} from "@angular/core";
import { CommonModule } from "@angular/common";
import { hlm } from "../utils";

@Component({
  selector: "hlm-dialog",
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (open()) {
      <div
        class="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 animate-fade-in"
        role="presentation">
        <div
          class="fixed inset-0 bg-black/80 backdrop-blur-sm transition-opacity"
          aria-hidden="true"
          (click)="handleBackdropClick()"></div>

        <div
          class="relative z-50 w-full max-w-lg rounded-3xl border border-border bg-card p-6 shadow-2xl animate-pop-in sm:p-8"
          role="dialog"
          aria-modal="true"
          [attr.aria-labelledby]="ariaLabelledBy()"
          [attr.aria-describedby]="ariaDescribedBy()">
          <ng-content />
        </div>
      </div>
    }
  `,
})
export class HlmDialogComponent {
  readonly open = model<boolean>(false);
  readonly closeOnBackdrop = input<boolean>(true);
  readonly closeOnEscape = input<boolean>(true);
  readonly ariaLabelledBy = input<string | undefined>(undefined);
  readonly ariaDescribedBy = input<string | undefined>(undefined);

  readonly closed = output<void>();

  @HostListener("document:keydown.escape", ["$event"])
  handleEscape(event: Event): void {
    if (this.open() && this.closeOnEscape()) {
      event.preventDefault();
      this.close();
    }
  }

  handleBackdropClick(): void {
    if (this.closeOnBackdrop()) {
      this.close();
    }
  }

  close(): void {
    this.open.set(false);
    this.closed.emit();
  }
}

@Component({
  selector: "hlm-dialog-header",
  standalone: true,
  template: `
    <div class="flex flex-col space-y-2 text-center sm:text-left mb-5">
      <ng-content />
    </div>
  `,
})
export class HlmDialogHeaderComponent {}

@Directive({
  selector: "[hlmDialogTitle]",
  standalone: true,
  host: {
    "[class]": "classes()",
  },
})
export class HlmDialogTitleDirective {
  readonly userClass = input<string>("", { alias: "class" });
  protected readonly classes = computed(() =>
    hlm("text-2xl font-black leading-none tracking-tight text-foreground", this.userClass())
  );
}

@Directive({
  selector: "[hlmDialogDescription]",
  standalone: true,
  host: {
    "[class]": "classes()",
  },
})
export class HlmDialogDescriptionDirective {
  readonly userClass = input<string>("", { alias: "class" });
  protected readonly classes = computed(() =>
    hlm("text-sm text-muted-foreground leading-relaxed", this.userClass())
  );
}

@Component({
  selector: "hlm-dialog-footer",
  standalone: true,
  template: `
    <div class="flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-3 gap-2 mt-6">
      <ng-content />
    </div>
  `,
})
export class HlmDialogFooterComponent {}

import {
  Component,
  EventEmitter,
  Input,
  OnDestroy,
  OnInit,
  Output,
  computed,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { formatEsNumber } from '../../utils/number-format';
import { sourceUrl } from '../../utils/source-url';
import type { PodiumRow } from '../results/results.component';

/**
 * Fases de la ceremonia final:
 *   answer      → la respuesta de la IA, grande y sola en el centro
 *   revealing   → aparecen los jugadores del último puesto al primero
 *   leaderboard → todos visibles, las barras se llenan y salen las reglas
 */
export type RevealPhase = 'answer' | 'revealing' | 'leaderboard';

/** Tiempo que la respuesta correcta se queda sola en pantalla. */
export const ANSWER_HOLD_MS = 3000;

/** Separación entre la aparición de un jugador y el siguiente. */
export const REVEAL_STEP_MS = 1500;

/** Pausa entre el último revelado (el campeón) y el leaderboard con barras. */
export const SETTLE_MS = 1200;

@Component({
  selector: 'app-final-reveal',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './final-reveal.component.html',
  styleUrls: ['./final-reveal.component.scss'],
})
export class FinalRevealComponent implements OnInit, OnDestroy {
  /** Clasificación de peor a mejor: el índice 0 es el primero en revelarse. */
  @Input({ required: true })
  set rows(value: PodiumRow[]) {
    this.worstFirst.set(value ?? []);
  }

  @Input() correctAnswer = 0;
  @Input() question = '';
  @Input() answerSource = '';
  @Input() roomCode = '';
  @Input() maxRounds = 0;
  @Input() myPlayerId = '';
  @Input() bestNames = '';
  @Input() worstNames = '';
  @Input() isTie = false;
  @Input() alcoholFree = false;
  @Input() busy = false;
  @Input() error = '';
  @Output() back = new EventEmitter<void>();

  /** Se emite cuando el jugador cierra la ceremonia. */
  @Output() finish = new EventEmitter<void>();

  formatNumber = formatEsNumber;
  sourceUrl = sourceUrl;

  worstFirst = signal<PodiumRow[]>([]);

  phase = signal<RevealPhase>('answer');

  /** Cuántos jugadores se han revelado ya (de peor a mejor). */
  revealedCount = signal(0);

  /** Dispara el llenado de las barras (necesita partir de 0 para que anime). */
  barsFilled = signal(false);

  /** Orden de leaderboard: campeón arriba. Es el orden en que se pintan las filas. */
  leaderboard = computed(() => [...this.worstFirst()].reverse());

  total = computed(() => this.worstFirst().length);

  done = computed(() => this.phase() === 'leaderboard');

  /** Con mucha gente apretamos las filas para que quepan sin scroll. */
  compact = computed(() => this.total() > 6);

  /** Puesto que se está revelando ahora mismo (para el rótulo de tensión). */
  currentPlace = computed(() => {
    const revealed = this.revealedCount();
    if (revealed === 0) return 0;
    return this.worstFirst()[revealed - 1]?.place ?? 0;
  });

  private timers: ReturnType<typeof setTimeout>[] = [];

  ngOnInit(): void {
    if (this.prefersReducedMotion()) {
      this.skip();
      return;
    }
    this.startSequence();
  }

  ngOnDestroy(): void {
    this.clearTimers();
  }

  /**
   * Programa toda la secuencia de una vez con setTimeout absolutos, en lugar de
   * encadenar timers: si un frame llega tarde no se acumula el desfase.
   */
  private startSequence(): void {
    this.clearTimers();

    const n = this.total();
    if (n === 0) {
      this.at(ANSWER_HOLD_MS, () => this.finishSequence());
      return;
    }

    for (let i = 0; i < n; i++) {
      this.at(ANSWER_HOLD_MS + i * REVEAL_STEP_MS, () => {
        this.phase.set('revealing');
        this.revealedCount.set(i + 1);
      });
    }

    this.at(ANSWER_HOLD_MS + (n - 1) * REVEAL_STEP_MS + SETTLE_MS, () => this.finishSequence());
  }

  private finishSequence(): void {
    this.revealedCount.set(this.total());
    this.phase.set('leaderboard');
    // Un tick después: la barra debe pintarse a 0 antes de animar hacia su ancho.
    this.at(50, () => this.barsFilled.set(true));
  }

  /** Salta la ceremonia y muestra el leaderboard ya montado. */
  skip(): void {
    this.clearTimers();
    this.revealedCount.set(this.total());
    this.phase.set('leaderboard');
    this.barsFilled.set(true);
  }

  // ── Estado por fila ────────────────────────────────────────────────────

  /**
   * Índice de revelado de una fila del leaderboard. La última posición
   * (abajo) es la primera en aparecer.
   */
  revealIndexOf(displayIndex: number): number {
    return this.total() - 1 - displayIndex;
  }

  isRevealed(displayIndex: number): boolean {
    return this.revealedCount() > this.revealIndexOf(displayIndex);
  }

  /** El campeón entra distinto: es el clímax de la secuencia. */
  isChampion(row: PodiumRow): boolean {
    return row.place === 1;
  }

  isMe(playerId: string): boolean {
    return playerId === this.myPlayerId;
  }

  trackPodium(_: number, row: PodiumRow): string {
    return row.player.playerId;
  }

  onFinish(): void {
    if (!this.busy) this.finish.emit();
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  private at(delayMs: number, action: () => void): void {
    this.timers.push(setTimeout(action, delayMs));
  }

  private clearTimers(): void {
    this.timers.forEach(clearTimeout);
    this.timers = [];
  }

  private prefersReducedMotion(): boolean {
    return typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
}

import {
  Component,
  OnInit,
  OnDestroy,
  signal,
  computed,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { RoomService } from '../../services/room.service';
import { GameStateDto } from '../../models/game.models';
import {
  MAGNITUDES,
  Magnitude,
  MagnitudeId,
  describeResolvedGuess,
  formatEsNumber,
  formatGuessTyping,
  magnitudeOf,
  resolveGuess,
} from '../../utils/number-format';

@Component({
  selector: 'app-game',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './game.component.html',
  styleUrls: ['./game.component.scss'],
})
export class GameComponent implements OnInit, OnDestroy {
  state = signal<GameStateDto | null>(null);
  errorMsg = signal('');
  loading = signal(false);
  guessSent = signal(false);
  questionSent = signal(false);

  // Formularios
  question = signal('');
  guessInput = signal('');
  magnitudeId = signal<MagnitudeId>('units');

  readonly magnitudes = MAGNITUDES;

  myPlayerId = computed(() => this.roomService.localPlayer?.playerId ?? '');

  isRedactor = computed(() => {
    const s = this.state();
    return s?.redactorPlayerId === this.myPlayerId();
  });

  isWritingPhase = computed(() => this.state()?.phase === 'WritingQuestion');
  isCollectingPhase = computed(() => this.state()?.phase === 'CollectingGuesses');

  redactorName = computed(() => {
    const s = this.state();
    if (!s) return '';
    return s.players.find(p => p.playerId === s.redactorPlayerId)?.name ?? '';
  });

  /**
   * Estimaciones esperadas esta ronda = jugadores conectados - 1 (el Redactor no adivina).
   * El servidor ya lo calcula así (GuessesExpected); si por cualquier motivo no llega
   * (0 / undefined), lo derivamos localmente de la lista de jugadores para que el
   * contador nunca muestre «N/N» con el Redactor incluido.
   */
  guessesExpected = computed(() => {
    const s = this.state();
    if (!s) return 0;
    if (s.guessesExpected > 0) return s.guessesExpected;
    return s.players.filter(p => p.isConnected && p.playerId !== s.redactorPlayerId).length;
  });

  guessProgress = computed(() => {
    const s = this.state();
    const expected = this.guessesExpected();
    if (!s || expected === 0) return 0;
    return Math.min(100, (s.guessesSubmitted / expected) * 100);
  });

  questionValid = computed(() =>
    this.question().trim().length >= 5 && this.question().trim().length <= 300
  );

  selectedMagnitude = computed(() => magnitudeOf(this.magnitudeId()));

  resolvedGuess = computed(() =>
    resolveGuess(this.guessInput(), this.selectedMagnitude().factor)
  );

  guessValid = computed(() => {
    const val = this.resolvedGuess();
    return val !== null;
  });

  guessPreview = computed(() =>
    describeResolvedGuess(this.guessInput(), this.selectedMagnitude())
  );

  formattedResolvedGuess = computed(() => {
    const val = this.resolvedGuess();
    return val === null ? '' : formatEsNumber(val);
  });

  private subs = new Subscription();

  constructor(
    private roomService: RoomService,
    private router: Router,
  ) {}

  ngOnInit(): void {
    if (!this.roomService.localPlayer) {
      this.router.navigate(['/']);
      return;
    }

    this.subs.add(
      this.roomService.gameState$.subscribe(s => {
        if (!s) { this.router.navigate(['/']); return; }
        this.state.set(s);

        // Reset al cambiar de fase
        if (s.phase === 'WritingQuestion') {
          this.question.set('');
          this.questionSent.set(false);
          this.guessSent.set(false);
          this.guessInput.set('');
          this.magnitudeId.set('units');
          this.loading.set(false);
        }
      })
    );

    this.subs.add(
      this.roomService.error$.subscribe(msg => {
        this.errorMsg.set(msg);
        this.loading.set(false);
      })
    );

    this.subs.add(
      this.roomService.guessAcknowledged$.subscribe(() => {
        this.guessSent.set(true);
        this.loading.set(false);
      })
    );
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
  }

  // ── Acciones ───────────────────────────────────────────────────────────

  async submitQuestion(): Promise<void> {
    if (!this.questionValid() || this.loading()) return;

    this.loading.set(true);
    this.errorMsg.set('');

    try {
      await this.roomService.submitQuestion(this.question().trim());
      this.questionSent.set(true);
    } catch {
      this.errorMsg.set('Error al enviar la pregunta.');
    } finally {
      this.loading.set(false);
    }
  }

  async submitGuess(): Promise<void> {
    if (!this.guessValid() || this.loading() || this.guessSent()) return;

    const val = this.resolvedGuess();
    if (val === null) return;

    this.loading.set(true);
    this.errorMsg.set('');

    try {
      await this.roomService.submitGuess(val);
      // guessSent se activa en GuessAcknowledged
    } catch {
      this.errorMsg.set('Error al enviar tu estimación.');
      this.loading.set(false);
    }
  }

  async forceResults(): Promise<void> {
    if (this.loading()) return;
    this.loading.set(true);
    this.errorMsg.set('');

    try {
      await this.roomService.requestResults();
    } catch {
      this.errorMsg.set('Error al cerrar la ronda.');
      this.loading.set(false);
    }
  }

  onGuessInput(event: Event): void {
    const el = event.target as HTMLInputElement;
    const formatted = formatGuessTyping(el.value);
    this.guessInput.set(formatted);
    el.value = formatted;
  }

  selectMagnitude(id: MagnitudeId): void {
    this.magnitudeId.set(id);
  }

  isMagnitude(m: Magnitude): boolean {
    return this.magnitudeId() === m.id;
  }

  trackByPlayerId(_: number, p: { playerId: string }): string {
    return p.playerId;
  }
}

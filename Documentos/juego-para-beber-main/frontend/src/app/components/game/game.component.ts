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

  guessProgress = computed(() => {
    const s = this.state();
    if (!s || s.guessesExpected === 0) return 0;
    return (s.guessesSubmitted / s.guessesExpected) * 100;
  });

  questionValid = computed(() =>
    this.question().trim().length >= 5 && this.question().trim().length <= 300
  );

  guessValid = computed(() => {
    const val = parseFloat(this.guessInput().replace(',', '.'));
    return !isNaN(val) && isFinite(val);
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

    const val = parseFloat(this.guessInput().replace(',', '.'));
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
    const val = (event.target as HTMLInputElement).value;
    // Permitir números, punto, coma, signo negativo
    const cleaned = val.replace(/[^0-9.,\-]/g, '');
    this.guessInput.set(cleaned);
    (event.target as HTMLInputElement).value = cleaned;
  }

  trackByPlayerId(_: number, p: { playerId: string }): string {
    return p.playerId;
  }
}

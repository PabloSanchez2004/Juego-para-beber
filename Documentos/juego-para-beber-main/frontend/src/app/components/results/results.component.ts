import {
  Component,
  OnInit,
  OnDestroy,
  signal,
  computed,
} from '@angular/core';
import { CommonModule, DecimalPipe } from '@angular/common';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { RoomService } from '../../services/room.service';
import { GameStateDto, PlayerRoundResult } from '../../models/game.models';

@Component({
  selector: 'app-results',
  standalone: true,
  imports: [CommonModule, DecimalPipe],
  templateUrl: './results.component.html',
  styleUrls: ['./results.component.scss'],
})
export class ResultsComponent implements OnInit, OnDestroy {
  state = signal<GameStateDto | null>(null);
  loading = signal(false);
  errorMsg = signal('');

  myPlayerId = computed(() => this.roomService.localPlayer?.playerId ?? '');

  result = computed(() => this.state()?.lastResult ?? null);

  ranking = computed(() =>
    [...(this.result()?.ranking ?? [])].sort((a, b) => a.rank - b.rank)
  );

  isLastRound = computed(() => {
    const s = this.state();
    return s ? s.roundNumber >= s.maxRounds : false;
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
      })
    );

    this.subs.add(
      this.roomService.error$.subscribe(msg => {
        this.errorMsg.set(msg);
        this.loading.set(false);
      })
    );
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
  }

  async nextRound(): Promise<void> {
    if (this.loading()) return;
    this.loading.set(true);
    this.errorMsg.set('');

    try {
      await this.roomService.nextRound();
    } catch {
      this.errorMsg.set('Error al avanzar a la siguiente ronda.');
      this.loading.set(false);
    }
  }

  isMe(playerId: string): boolean {
    return playerId === this.myPlayerId();
  }

  rankEmoji(rank: number): string {
    switch (rank) {
      case 1: return '🥇';
      case 2: return '🥈';
      case 3: return '🥉';
      default: return `#${rank}`;
    }
  }

  formatError(pct: number): string {
    if (pct === 0) return '¡Exacto! 🎯';
    if (pct < 5) return `${pct.toFixed(1)}% 🔥`;
    if (pct < 20) return `${pct.toFixed(1)}% 👍`;
    if (pct < 50) return `${pct.toFixed(1)}% 😬`;
    return `${pct.toFixed(1)}% 💀`;
  }

  trackByPlayerId(_: number, r: PlayerRoundResult): string {
    return r.playerId;
  }
}

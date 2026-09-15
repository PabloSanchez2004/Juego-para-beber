import {
  Component,
  OnInit,
  OnDestroy,
  signal,
  computed,
} from '@angular/core';
import { CommonModule, DecimalPipe } from '@angular/common';
import { Router } from '@angular/router';
import { FinalRevealComponent } from '../final-reveal/final-reveal.component';
import { Subscription } from 'rxjs';
import { RoomService } from '../../services/room.service';
import {
  GameStateDto,
  PlayerPublicDto,
  PlayerRoundResult,
} from '../../models/game.models';
import {
  FinalStanding,
  buildFinalStandings,
  namesOf,
} from '../../utils/standings-comments';

/** Papel de cada jugador en el ranking de la ronda, según la distancia a la respuesta. */
export type RankOutcome = 'winner' | 'loser' | 'neutral';

export interface RankRow {
  entry: PlayerRoundResult;
  outcome: RankOutcome;
}

/** Fila del podio final: de peor a mejor, con barra relativa al máximo. */
export interface PodiumRow {
  player: PlayerPublicDto;
  place: number;
  outcome: FinalStanding['outcome'];
  comment: string;
  barPercent: number;
  emoji: string;
}

@Component({
  selector: 'app-results',
  standalone: true,
  imports: [CommonModule, DecimalPipe, FinalRevealComponent],
  templateUrl: './results.component.html',
  styleUrls: ['./results.component.scss'],
})
export class ResultsComponent implements OnInit, OnDestroy {
  state = signal<GameStateDto | null>(null);
  loading = signal(false);
  errorMsg = signal('');

  myPlayerId = computed(() => this.roomService.localPlayer?.playerId ?? '');

  result = computed(() => this.state()?.lastResult ?? null);

  /** Ranking ordenado de mejor a peor (menor error primero). */
  ranking = computed(() =>
    [...(this.result()?.ranking ?? [])].sort((a, b) => a.rank - b.rank)
  );

  /** Peor rango de la ronda (el que más se alejó). */
  private worstRank = computed(() =>
    this.ranking().reduce((max, r) => Math.max(max, r.rank), 0)
  );

  /**
   * Solo hay un estimador (partida de 2 jugadores: Redactor + 1).
   * Gana por defecto y no existe perdedor.
   */
  isSoloEstimator = computed(() => this.ranking().length === 1);

  /** Nombre del Redactor de la ronda (no participa adivinando). */
  redactorName = computed(() => {
    const s = this.state();
    if (!s) return '';
    return s.players.find(p => p.playerId === s.redactorPlayerId)?.name ?? '';
  });

  /**
   * Quién redactará la siguiente ronda: el más cercano que siga conectado.
   * Coincide con la regla del backend (ranking por error, empate por nombre).
   */
  nextRedactor = computed(() => {
    const s = this.state();
    if (!s) return null;

    const connected = new Set(
      s.players.filter(p => p.isConnected).map(p => p.playerId)
    );
    return this.ranking().find(r => connected.has(r.playerId)) ?? null;
  });

  /** Ganador(es): rango 1. */
  winners = computed(() => this.ranking().filter(r => r.rank === 1));

  /** Nombre del ganador cuando solo hay un estimador (texto explicativo). */
  soloWinnerName = computed(() => this.winners()[0]?.playerName ?? '');

  /** Perdedor(es): peor rango, siempre que no sea también el rango 1 (empate total o único estimador). */
  losers = computed(() => {
    const worst = this.worstRank();
    if (worst <= 1) return [];
    return this.ranking().filter(r => r.rank === worst);
  });

  /** Filas del ranking con su desenlace ya resuelto (evita recalcular en la plantilla). */
  rows = computed<RankRow[]>(() =>
    this.ranking().map(entry => ({ entry, outcome: this.outcomeOf(entry) }))
  );

  /** Marcador acumulado ordenado por puntos. */
  scoreboard = computed<PlayerPublicDto[]>(() => {
    const s = this.state();
    if (!s) return [];
    return [...s.players].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  });

  isLastRound = computed(() => {
    const s = this.state();
    return s ? s.roundNumber >= s.maxRounds : false;
  });

  /** Tabla de clasificación al acabar la partida (mejor → peor, para reglas). */
  finalStandings = computed<FinalStanding[]>(() => {
    const s = this.state();
    if (!s || !this.isLastRound()) return [];
    return buildFinalStandings(s.players, s.roomCode);
  });

  /**
   * Podio animado: peor primero, campeón al final.
   * barPercent = puntos / maxPuntos * 100 para que la barra no desborde.
   */
  podiumRows = computed<PodiumRow[]>(() => {
    const standings = this.finalStandings();
    if (standings.length === 0) return [];

    const maxScore = Math.max(...standings.map(r => r.player.score), 0);
    return [...standings]
      .sort((a, b) => a.player.score - b.player.score || b.place - a.place)
      .map(row => ({
        player: row.player,
        place: row.place,
        outcome: row.outcome,
        comment: row.comment,
        barPercent: maxScore > 0 ? (row.player.score / maxScore) * 100 : 0,
        emoji: this.placeEmoji(row.place),
      }));
  });

  finalBestNames = computed(() => namesOf(this.finalStandings(), 'best'));
  finalWorstNames = computed(() => namesOf(this.finalStandings(), 'worst'));
  finalIsTie = computed(() =>
    this.finalStandings().length > 1 && this.finalStandings().every(r => r.outcome !== 'best')
  );

  /** Tragos que reparte el ganador (viene del backend; 1 por defecto). */
  drinksToDistribute = computed(() => this.result()?.drinksToDistribute || 1);

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
        if (!s) {
          if (this.roomService.localPlayer) return;
          this.router.navigate(['/']);
          return;
        }
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

  async finishGame(): Promise<void> {
    if (this.loading()) return;
    this.loading.set(true);
    try {
      await this.roomService.leaveRoom();
    } finally {
      this.router.navigate(['/']);
    }
  }

  // ── Helpers de presentación ────────────────────────────────────────────

  isMe(playerId: string): boolean {
    return playerId === this.myPlayerId();
  }

  isRedactor(playerId: string): boolean {
    return playerId === this.state()?.redactorPlayerId;
  }

  isNextRedactor(playerId: string): boolean {
    return playerId === this.nextRedactor()?.playerId;
  }

  /** Clasifica una entrada del ranking para colorear la tarjeta y mostrar el badge. */
  outcomeOf(entry: PlayerRoundResult): RankOutcome {
    if (entry.rank === 1) return 'winner';
    if (this.losers().some(l => l.playerId === entry.playerId)) return 'loser';
    return 'neutral';
  }

  /** Texto del badge de ganador: «🎯 ¡Reparte 1 trago!» */
  winnerBadge(): string {
    const n = this.drinksToDistribute();
    return `🎯 ¡Reparte ${n} ${n === 1 ? 'trago' : 'tragos'}!`;
  }

  /** Texto del badge de perdedor: «🍺 ¡Te toca beber!» */
  loserBadge(): string {
    const dry = this.state()?.isAlcoholFreeRoom;
    return `${dry ? '🧃' : '🍺'} ¡Te toca beber!`;
  }

  formatError(pct: number): string {
    if (pct === 0) return '¡Exacto! 🎯';
    if (pct < 5) return `${pct.toFixed(1)}% 🔥`;
    if (pct < 20) return `${pct.toFixed(1)}% 👍`;
    if (pct < 50) return `${pct.toFixed(1)}% 😬`;
    return `${pct.toFixed(1)}% 💀`;
  }

  /** Color del porcentaje de error según lo lejos que se quedó. */
  errorTone(pct: number): string {
    if (pct < 5) return 'text-emerald-300';
    if (pct < 20) return 'text-slate-200';
    if (pct < 50) return 'text-amber-300';
    return 'text-red-300';
  }

  initialOf(name: string): string {
    return (name?.trim().charAt(0) || '?').toUpperCase();
  }

  trackByPlayerId(_: number, r: PlayerRoundResult): string {
    return r.playerId;
  }

  trackPodium(_: number, row: PodiumRow): string {
    return row.player.playerId;
  }

  placeEmoji(place: number): string {
    switch (place) {
      case 1: return '🥇';
      case 2: return '🥈';
      case 3: return '🥉';
      default: return '🎯';
    }
  }
}

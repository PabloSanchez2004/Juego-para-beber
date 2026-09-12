import {
  Component,
  OnInit,
  OnDestroy,
  signal,
  computed,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { RoomService } from '../../services/room.service';
import { GameStateDto, PlayerPublicDto } from '../../models/game.models';

@Component({
  selector: 'app-lobby',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './lobby.component.html',
  styleUrls: ['./lobby.component.scss'],
})
export class LobbyComponent implements OnInit, OnDestroy {
  state = signal<GameStateDto | null>(null);
  errorMsg = signal('');
  loading = signal(false);
  codeCopied = signal(false);

  myPlayerId = computed(() => this.roomService.localPlayer?.playerId ?? '');

  players = computed(() => this.state()?.players ?? []);
  connectedCount = computed(() => this.players().filter(p => p.isConnected).length);
  canStart = computed(() => this.connectedCount() >= 2 && !this.loading());

  private subs = new Subscription();

  constructor(
    private roomService: RoomService,
    private router: Router,
  ) {}

  ngOnInit(): void {
    // Redirigir si no hay sesión
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

  async startGame(): Promise<void> {
    if (!this.canStart()) return;
    this.loading.set(true);
    this.errorMsg.set('');

    try {
      await this.roomService.startGame(this.state()?.maxRounds ?? 10);
    } catch {
      this.errorMsg.set('Error al iniciar el juego.');
      this.loading.set(false);
    }
  }

  async copyCode(): Promise<void> {
    const code = this.state()?.roomCode;
    if (!code) return;

    try {
      await navigator.clipboard.writeText(code);
      this.codeCopied.set(true);
      setTimeout(() => this.codeCopied.set(false), 2000);
    } catch {
      // Fallback para navegadores sin clipboard API
      this.codeCopied.set(true);
      setTimeout(() => this.codeCopied.set(false), 2000);
    }
  }

  async leaveRoom(): Promise<void> {
    await this.roomService.leaveRoom();
    this.router.navigate(['/']);
  }

  isMe(player: PlayerPublicDto): boolean {
    return player.playerId === this.myPlayerId();
  }

  trackByPlayerId(_: number, p: PlayerPublicDto): string {
    return p.playerId;
  }
}

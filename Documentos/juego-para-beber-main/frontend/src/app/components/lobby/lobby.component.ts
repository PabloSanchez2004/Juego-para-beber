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
  modeSaving = signal(false);
  codeCopied = signal(false);
  linkCopied = signal(false);

  /** PlayerId al que estamos pidiendo confirmación de expulsión. */
  confirmKickId = signal('');

  myPlayerId = computed(() => this.roomService.localPlayer?.playerId ?? '');

  players = computed(() => this.state()?.players ?? []);
  connectedCount = computed(() => this.players().filter(p => p.isConnected).length);

  /** Soy el anfitrión: mando yo sobre empezar y expulsar. */
  isAdmin = computed(() => {
    const s = this.state();
    if (!s) return false;
    const me = this.myPlayerId();
    if (!me) return false;
    // El flag del jugador es la fuente principal; adminPlayerId cubre clientes viejos.
    return s.players.some(p => p.playerId === me && p.isAdmin) || s.adminPlayerId === me;
  });

  adminName = computed(() => this.players().find(p => p.isAdmin)?.name ?? '');

  enoughPlayers = computed(() => this.connectedCount() >= 2);
  canStart = computed(() => this.enoughPlayers() && this.isAdmin() && !this.loading() && !this.modeSaving());

  /** Enlace de invitación directo: abre la app con el código ya puesto. */
  inviteLink = computed(() => {
    const code = this.state()?.roomCode;
    if (!code) return '';
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    return `${origin}/join/${code}`;
  });

  private subs = new Subscription();
  private copyTimers: ReturnType<typeof setTimeout>[] = [];

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
        if (!s) {
          if (this.roomService.localPlayer) return;
          this.router.navigate(['/']);
          return;
        }
        this.state.set(s);
        // Si el objetivo ya no está, cerramos la confirmación abierta.
        if (this.confirmKickId() && !s.players.some(p => p.playerId === this.confirmKickId())) {
          this.confirmKickId.set('');
        }
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
    this.copyTimers.forEach(clearTimeout);
  }

  async startGame(): Promise<void> {
    if (!this.canStart()) return;
    this.loading.set(true);
    this.errorMsg.set('');

    try {
      await this.roomService.startGame(this.state()?.maxRounds ?? 10);
    } catch {
      this.errorMsg.set('Error al iniciar el juego.');
    } finally {
      this.loading.set(false);
    }
  }

  async selectMode(redactorCanGuess: boolean): Promise<void> {
    if (!this.isAdmin() || this.loading() || this.modeSaving() ||
        this.state()?.redactorCanGuess === redactorCanGuess) return;
    this.modeSaving.set(true);
    this.errorMsg.set('');
    try {
      await this.roomService.setRedactorCanGuess(redactorCanGuess);
    } catch {
      this.errorMsg.set('No se pudo cambiar el modo. Inténtalo de nuevo.');
    } finally {
      this.modeSaving.set(false);
    }
  }

  // ── Expulsar ───────────────────────────────────────────────────────────

  /** Primer toque: pedir confirmación. Evita echar a alguien por un roce. */
  askKick(player: PlayerPublicDto): void {
    if (!this.isAdmin() || this.isMe(player)) return;
    this.confirmKickId.set(player.playerId);
    this.errorMsg.set('');
  }

  cancelKick(): void {
    this.confirmKickId.set('');
  }

  async confirmKick(player: PlayerPublicDto): Promise<void> {
    if (!this.isAdmin() || this.isMe(player)) return;
    this.confirmKickId.set('');
    this.errorMsg.set('');

    try {
      await this.roomService.kickPlayer(player.playerId);
    } catch {
      this.errorMsg.set(`No se pudo expulsar a ${player.name}.`);
    }
  }

  isConfirmingKick(player: PlayerPublicDto): boolean {
    return this.confirmKickId() === player.playerId;
  }

  /** El anfitrión ve la cruz junto a todos menos a sí mismo. */
  canKick(player: PlayerPublicDto): boolean {
    return this.isAdmin() && !this.isMe(player);
  }

  // ── Compartir ──────────────────────────────────────────────────────────

  async copyCode(): Promise<void> {
    const code = this.state()?.roomCode;
    if (!code) return;

    if (await this.writeToClipboard(code)) this.flag(this.codeCopied);
  }

  /**
   * Comparte el enlace directo. Usa el diálogo nativo del móvil si existe
   * (WhatsApp, Telegram…) y si no cae al portapapeles.
   */
  async copyInviteLink(): Promise<void> {
    const link = this.inviteLink();
    if (!link) return;

    const nav = navigator as Navigator & { share?: (data: ShareData) => Promise<void> };
    if (typeof nav.share === 'function') {
      try {
        await nav.share({
          title: 'Aproximados',
          text: `Únete a mi sala ${this.state()?.roomCode}`,
          url: link,
        });
        return;
      } catch {
        // Cancelado o no permitido: seguimos con el portapapeles.
      }
    }

    if (await this.writeToClipboard(link)) this.flag(this.linkCopied);
  }

  async leaveRoom(): Promise<void> {
    try {
      await this.roomService.leaveRoom();
    } catch {
      // The local session is cleared even if the connection has already gone.
    } finally {
      this.router.navigate(['/']);
    }
  }

  isMe(player: PlayerPublicDto): boolean {
    return player.playerId === this.myPlayerId();
  }

  trackByPlayerId(_: number, p: PlayerPublicDto): string {
    return p.playerId;
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  private async writeToClipboard(text: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Navegadores sin Clipboard API (http, WebViews antiguos)
      this.errorMsg.set('No se pudo copiar. Selecciona el código de la sala y compártelo manualmente.');
      return false;
    }
  }

  private flag(target: { set: (v: boolean) => void }): void {
    target.set(true);
    this.copyTimers.push(setTimeout(() => target.set(false), 2000));
  }
}

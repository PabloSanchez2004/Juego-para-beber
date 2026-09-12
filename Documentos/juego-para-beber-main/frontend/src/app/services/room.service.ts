import { Injectable, OnDestroy } from '@angular/core';
import {
  HubConnection,
  HubConnectionBuilder,
  HubConnectionState,
  LogLevel,
} from '@microsoft/signalr';
import {
  BehaviorSubject,
  Observable,
  Subject,
  firstValueFrom,
} from 'rxjs';
import {
  ConnectionStatus,
  GameStateDto,
  LocalPlayerState,
} from '../models/game.models';

// [RELLENAR_AQUI_PABLO: Reemplaza esta URL con la URL real de tu backend .NET
//  desplegado. En desarrollo local usa http://localhost:5000/gamehub.
//  En producción usa https://tu-backend.tudominio.com/gamehub.
//  Esta URL se puede configurar también en environment.ts.
// ]
const HUB_URL = (window as any).__APROXIMADOS_HUB_URL__ ?? 'http://localhost:5000/gamehub';

const RECONNECT_DELAYS_MS = [0, 2000, 5000, 10000, 20000, 30000];
const SESSION_KEY = 'aproximados_session';

@Injectable({ providedIn: 'root' })
export class RoomService implements OnDestroy {
  // ── Estado reactivo ────────────────────────────────────────────────────

  private readonly _connectionStatus$ = new BehaviorSubject<ConnectionStatus>('disconnected');
  private readonly _gameState$ = new BehaviorSubject<GameStateDto | null>(null);
  private readonly _error$ = new Subject<string>();
  private readonly _guessAcknowledged$ = new Subject<void>();

  readonly connectionStatus$: Observable<ConnectionStatus> = this._connectionStatus$.asObservable();
  readonly gameState$: Observable<GameStateDto | null> = this._gameState$.asObservable();
  readonly error$: Observable<string> = this._error$.asObservable();
  readonly guessAcknowledged$: Observable<void> = this._guessAcknowledged$.asObservable();

  // ── Estado local ───────────────────────────────────────────────────────

  private _localPlayer: LocalPlayerState | null = null;
  get localPlayer(): LocalPlayerState | null { return this._localPlayer; }

  // ── Conexión ───────────────────────────────────────────────────────────

  private _hub: HubConnection | null = null;
  private _destroyed = false;

  constructor() {
    this.restoreSession();
  }

  ngOnDestroy(): void {
    this._destroyed = true;
    this.disconnect();
  }

  // ── Conexión / reconexión ──────────────────────────────────────────────

  async connect(): Promise<void> {
    if (this._hub?.state === HubConnectionState.Connected) return;

    this._connectionStatus$.next('connecting');

    this._hub = new HubConnectionBuilder()
      .withUrl(HUB_URL)
      .withAutomaticReconnect({
        nextRetryDelayInMilliseconds: (ctx) => {
          const idx = Math.min(ctx.previousRetryCount, RECONNECT_DELAYS_MS.length - 1);
          return RECONNECT_DELAYS_MS[idx];
        },
      })
      .configureLogging(LogLevel.Warning)
      .build();

    this.registerHandlers();

    this._hub.onreconnecting(() => {
      this._connectionStatus$.next('reconnecting');
    });

    this._hub.onreconnected(async () => {
      this._connectionStatus$.next('connected');
      await this.tryAutoReconnectToRoom();
    });

    this._hub.onclose(() => {
      if (!this._destroyed) {
        this._connectionStatus$.next('failed');
      }
    });

    try {
      await this._hub.start();
      this._connectionStatus$.next('connected');
      await this.tryAutoReconnectToRoom();
    } catch (err) {
      console.error('[RoomService] Error al conectar:', err);
      this._connectionStatus$.next('failed');
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    if (this._hub) {
      await this._hub.stop();
      this._hub = null;
    }
    this._connectionStatus$.next('disconnected');
  }

  // ── Operaciones de sala ────────────────────────────────────────────────

  async createRoom(name: string, alcoholFree: boolean): Promise<void> {
    await this.ensureConnected();
    await this._hub!.invoke('CreateRoom', name, alcoholFree);
  }

  async joinRoom(code: string, name: string, alcoholFree: boolean): Promise<void> {
    await this.ensureConnected();
    await this._hub!.invoke('JoinRoom', code.toUpperCase(), name, alcoholFree);
  }

  async startGame(maxRounds: number = 10): Promise<void> {
    await this.ensureConnected();
    await this._hub!.invoke('StartGame', maxRounds);
  }

  async submitQuestion(question: string): Promise<void> {
    await this.ensureConnected();
    await this._hub!.invoke('SubmitQuestion', question);
  }

  async submitGuess(guess: number): Promise<void> {
    await this.ensureConnected();
    await this._hub!.invoke('SubmitGuess', guess);
  }

  async requestResults(): Promise<void> {
    await this.ensureConnected();
    await this._hub!.invoke('RequestResults');
  }

  async nextRound(): Promise<void> {
    await this.ensureConnected();
    await this._hub!.invoke('NextRound');
  }

  async leaveRoom(): Promise<void> {
    if (this._hub?.state === HubConnectionState.Connected) {
      await this._hub.invoke('LeaveRoom');
    }
    this._localPlayer = null;
    this._gameState$.next(null);
    sessionStorage.removeItem(SESSION_KEY);
  }

  // ── Handlers de eventos del servidor ──────────────────────────────────

  private registerHandlers(): void {
    if (!this._hub) return;

    this._hub.on('RoomCreated', (roomCode: string, playerId: string, state: GameStateDto) => {
      this.saveSession({ playerId, roomCode, name: this.findPlayerName(state, playerId), alcoholFree: false });
      this._gameState$.next(state);
    });

    this._hub.on('JoinedRoom', (playerId: string, state: GameStateDto) => {
      this.saveSession({ playerId, roomCode: state.roomCode, name: this.findPlayerName(state, playerId), alcoholFree: false });
      this._gameState$.next(state);
    });

    this._hub.on('ReconnectedRoom', (state: GameStateDto) => {
      this._gameState$.next(state);
    });

    this._hub.on('GameStateUpdated', (state: GameStateDto) => {
      this._gameState$.next(state);
    });

    this._hub.on('GuessAcknowledged', () => {
      this._guessAcknowledged$.next();
    });

    this._hub.on('Error', (message: string) => {
      this._error$.next(message);
    });

    this._hub.on('PlayerDisconnected', (playerName: string) => {
      // El estado se actualiza vía GameStateUpdated; aquí solo notificamos
      console.info(`[Aproximados] ${playerName} se desconectó.`);
    });

    this._hub.on('PlayerReconnected', (playerName: string) => {
      console.info(`[Aproximados] ${playerName} reconectado.`);
    });

    this._hub.on('RoomClosed', (reason: string) => {
      this._error$.next(`Sala cerrada: ${reason}`);
      this._gameState$.next(null);
      this._localPlayer = null;
      sessionStorage.removeItem(SESSION_KEY);
    });
  }

  // ── Sesión persistente ─────────────────────────────────────────────────

  private saveSession(player: LocalPlayerState): void {
    this._localPlayer = player;
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(player));
  }

  private restoreSession(): void {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (raw) {
        this._localPlayer = JSON.parse(raw) as LocalPlayerState;
      }
    } catch {
      sessionStorage.removeItem(SESSION_KEY);
    }
  }

  private async tryAutoReconnectToRoom(): Promise<void> {
    if (!this._localPlayer) return;

    try {
      await this._hub!.invoke('Reconnect', this._localPlayer.roomCode, this._localPlayer.playerId);
    } catch (err) {
      console.warn('[RoomService] Auto-reconexión fallida:', err);
      // No limpiar sesión aquí; el servidor enviará Error si expiró
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  private async ensureConnected(): Promise<void> {
    if (this._hub?.state !== HubConnectionState.Connected) {
      await this.connect();
    }
  }

  private findPlayerName(state: GameStateDto, playerId: string): string {
    return state.players.find(p => p.playerId === playerId)?.name ?? '';
  }

  /** Snapshot del estado actual (sin suscripción) */
  get currentState(): GameStateDto | null {
    return this._gameState$.value;
  }

  get isConnected(): boolean {
    return this._hub?.state === HubConnectionState.Connected;
  }
}

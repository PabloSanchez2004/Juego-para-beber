import { Injectable, OnDestroy } from '@angular/core';
import {
  HttpTransportType,
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
import { environment } from '../../environments/environment';

const PRODUCTION_API_URL = 'https://juego-para-beber.onrender.com';

const RECONNECT_DELAYS_MS = [0, 2000, 5000, 10000, 20000, 30000];
const CONNECT_TIMEOUT_MS = 15_000;
const INVOKE_TIMEOUT_MS = 15_000;
const SESSION_KEY = 'aproximados_session';

const SIGNALR_TRANSPORTS =
  HttpTransportType.WebSockets |
  HttpTransportType.ServerSentEvents |
  HttpTransportType.LongPolling;

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

    const hubUrl = this.getHubUrl();
    console.info(`[RoomService] Connecting to: ${hubUrl}`);

    this._hub = new HubConnectionBuilder()
      .withUrl(hubUrl, {
        skipNegotiation: false,
        transport: SIGNALR_TRANSPORTS,
      })
      .withAutomaticReconnect({
        nextRetryDelayInMilliseconds: (ctx) => {
          const idx = Math.min(ctx.previousRetryCount, RECONNECT_DELAYS_MS.length - 1);
          return RECONNECT_DELAYS_MS[idx];
        },
      })
      .configureLogging(LogLevel.Information)
      .build();

    this._hub.serverTimeoutInMilliseconds = 60_000;
    this._hub.keepAliveIntervalInMilliseconds = 15_000;

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
      await this.startWithTimeout(this._hub, CONNECT_TIMEOUT_MS);
      console.info(`[RoomService] Connected via ${this._hub.connectionId ?? 'unknown id'}`);
      this._connectionStatus$.next('connected');
      await this.tryAutoReconnectToRoom();
    } catch (err) {
      console.error('[RoomService] Error al conectar:', err);
      await this._hub.stop().catch(() => undefined);
      this._hub = null;
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
    try {
      await this.invokeWithTimeout('CreateRoom', INVOKE_TIMEOUT_MS, name, alcoholFree);
    } catch (err) {
      console.error('[RoomService] CreateRoom failed:', err);
      throw err;
    }
  }

  async joinRoom(code: string, name: string, alcoholFree: boolean): Promise<void> {
    await this.ensureConnected();
    try {
      await this.invokeWithTimeout('JoinRoom', INVOKE_TIMEOUT_MS, code.toUpperCase(), name, alcoholFree);
    } catch (err) {
      console.error('[RoomService] JoinRoom failed:', err);
      throw err;
    }
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

    this._hub.on('RoomCreated', (roomCode: string, playerId: string, raw: GameStateDto) => {
      try {
        const state = normalizeGameState(raw);
        if (!state) throw new Error('RoomCreated sin estado válido');
        this.saveSession({
          playerId,
          roomCode: roomCode || state.roomCode,
          name: this.findPlayerName(state, playerId),
          alcoholFree: false,
        });
        this._gameState$.next(state);
      } catch (err) {
        console.error('[RoomService] RoomCreated handler failed:', err, raw);
        this._error$.next('La sala se creó pero no se pudo leer el estado. Recarga e inténtalo de nuevo.');
      }
    });

    this._hub.on('JoinedRoom', (playerId: string, raw: GameStateDto) => {
      try {
        const state = normalizeGameState(raw);
        if (!state) throw new Error('JoinedRoom sin estado válido');
        this.saveSession({
          playerId,
          roomCode: state.roomCode,
          name: this.findPlayerName(state, playerId),
          alcoholFree: false,
        });
        this._gameState$.next(state);
      } catch (err) {
        console.error('[RoomService] JoinedRoom handler failed:', err, raw);
        this._error$.next('Te uniste a la sala pero no se pudo leer el estado.');
      }
    });

    this._hub.on('ReconnectedRoom', (raw: GameStateDto) => {
      const state = normalizeGameState(raw);
      if (state) this._gameState$.next(state);
    });

    this._hub.on('GameStateUpdated', (raw: GameStateDto) => {
      const state = normalizeGameState(raw);
      if (state) this._gameState$.next(state);
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

  private async invokeWithTimeout(method: string, timeoutMs: number, ...args: unknown[]): Promise<void> {
    if (!this._hub) throw new Error('Hub no conectado');
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this._hub.invoke(method, ...args),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`${method} timeout after ${timeoutMs}ms`)),
            timeoutMs,
          );
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  private async startWithTimeout(hub: HubConnection, timeoutMs: number): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        hub.start(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`SignalR start timeout after ${timeoutMs}ms`)),
            timeoutMs,
          );
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  private getHubUrl(): string {
    const baseUrl = (environment.apiUrl || PRODUCTION_API_URL).replace(/\/$/, '');
    const hubUrl = `${baseUrl}/gamehub`;
    const runningOnProdHost =
      typeof window !== 'undefined' && !window.location.hostname.includes('localhost');

    if ((environment.production || runningOnProdHost) && hubUrl.includes('localhost')) {
      console.error('❌ CRITICAL: Production code trying to connect to localhost!');
      return `${PRODUCTION_API_URL}/gamehub`;
    }

    return hubUrl;
  }

  private async ensureConnected(): Promise<void> {
    if (this._hub?.state !== HubConnectionState.Connected) {
      await this.connect();
    }
  }

  private findPlayerName(state: GameStateDto, playerId: string): string {
    return state.players?.find(p => p.playerId === playerId)?.name ?? '';
  }

  /** Snapshot del estado actual (sin suscripción) */
  get currentState(): GameStateDto | null {
    return this._gameState$.value;
  }

  get isConnected(): boolean {
    return this._hub?.state === HubConnectionState.Connected;
  }
}

const GAME_PHASES: GameStateDto['phase'][] = [
  'Lobby',
  'WritingQuestion',
  'CollectingGuesses',
  'ShowingResults',
  'Closed',
];

function normalizeRole(raw: unknown): GameStateDto['players'][number]['role'] {
  if (raw === 0 || raw === 'Redactor') return 'Redactor';
  return 'Estimator';
}

function normalizeGameState(raw: unknown): GameStateDto | null {
  if (!raw || typeof raw !== 'object') return null;

  const src = raw as Record<string, unknown>;
  const phaseRaw = src['phase'] ?? src['Phase'];
  const phase = typeof phaseRaw === 'number'
    ? GAME_PHASES[phaseRaw]
    : (phaseRaw as GameStateDto['phase']);

  const playersRaw = (src['players'] ?? src['Players'] ?? []) as Array<Record<string, unknown>>;

  return {
    roomCode: String(src['roomCode'] ?? src['RoomCode'] ?? ''),
    phase,
    roundNumber: Number(src['roundNumber'] ?? src['RoundNumber'] ?? 0),
    currentQuestion: (src['currentQuestion'] ?? src['CurrentQuestion'] ?? null) as string | null,
    redactorPlayerId: (src['redactorPlayerId'] ?? src['RedactorPlayerId'] ?? null) as string | null,
    players: playersRaw.map(p => ({
      playerId: String(p['playerId'] ?? p['PlayerId'] ?? ''),
      name: String(p['name'] ?? p['Name'] ?? ''),
      role: normalizeRole(p['role'] ?? p['Role']),
      score: Number(p['score'] ?? p['Score'] ?? 0),
      drinksOwed: Number(p['drinksOwed'] ?? p['DrinksOwed'] ?? 0),
      isConnected: Boolean(p['isConnected'] ?? p['IsConnected'] ?? true),
      alcoholFree: Boolean(p['alcoholFree'] ?? p['AlcoholFree'] ?? false),
      guess: (p['guess'] ?? p['Guess'] ?? null) as number | null,
    })),
    lastResult: (src['lastResult'] ?? src['LastResult'] ?? null) as GameStateDto['lastResult'],
    maxRounds: Number(src['maxRounds'] ?? src['MaxRounds'] ?? 10),
    isAlcoholFreeRoom: Boolean(src['isAlcoholFreeRoom'] ?? src['IsAlcoholFreeRoom'] ?? false),
    guessesSubmitted: Number(src['guessesSubmitted'] ?? src['GuessesSubmitted'] ?? 0),
    guessesExpected: Number(src['guessesExpected'] ?? src['GuessesExpected'] ?? 0),
  };
}

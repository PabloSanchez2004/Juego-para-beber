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
const SESSION_BACKUP_KEY = 'aproximados_session_backup';

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
  private readonly _kicked$ = new Subject<string>();

  readonly connectionStatus$: Observable<ConnectionStatus> = this._connectionStatus$.asObservable();
  readonly gameState$: Observable<GameStateDto | null> = this._gameState$.asObservable();
  readonly error$: Observable<string> = this._error$.asObservable();
  readonly guessAcknowledged$: Observable<void> = this._guessAcknowledged$.asObservable();
  /** El anfitrión ha expulsado a este cliente de la sala. */
  readonly kicked$: Observable<string> = this._kicked$.asObservable();

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

  private connecting: Promise<void> | null = null;

  connect(): Promise<void> {
    if (!this.connecting) {
      this.connecting = this.connectOnce().finally(() => { this.connecting = null; });
    }
    return this.connecting;
  }

  private async connectOnce(): Promise<void> {
    if (this._hub?.state === HubConnectionState.Connected) return;

    // Stop a stale/reconnecting transport before creating a replacement.
    // Otherwise its late callbacks can reclaim the same player's seat.
    if (this._hub) {
      await this._hub.stop().catch(() => undefined);
      this._hub = null;
    }

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

  async createRoom(name: string, maxRounds: number = 10): Promise<void> {
    await this.ensureConnected();
    try {
      const rounds = Math.min(20, Math.max(1, Math.round(maxRounds) || 10));
      const playerId = this.ensurePlayerId();
      await this.invokeWithTimeout('CreateRoom', INVOKE_TIMEOUT_MS, name, false, rounds, playerId);
    } catch (err) {
      console.error('[RoomService] CreateRoom failed:', err);
      throw err;
    }
  }

  async joinRoom(code: string, name: string): Promise<void> {
    await this.ensureConnected();
    try {
      const playerId = this.ensurePlayerId();
      await this.invokeWithTimeout('JoinRoom', INVOKE_TIMEOUT_MS, code.toUpperCase(), name, false, playerId);
    } catch (err) {
      console.error('[RoomService] JoinRoom failed:', err);
      throw err;
    }
  }

  /**
   * Comprueba si el código corresponde a una sala viva. Se usa en el paso
   * «introduce el código» para no pedir el nombre de una sala que no existe.
   */
  async roomExists(code: string): Promise<boolean> {
    await this.ensureConnected();
    return await this._hub!.invoke<boolean>('RoomExists', code.trim().toUpperCase());
  }

  /** Expulsa a un jugador del lobby. Solo funciona si eres el anfitrión. */
  async kickPlayer(targetPlayerId: string): Promise<void> {
    await this.ensureConnected();
    await this._hub!.invoke('KickPlayer', targetPlayerId);
  }

  async startGame(maxRounds: number = 10): Promise<void> {
    await this.ensureConnected();
    const rounds = Math.min(20, Math.max(1, Math.round(maxRounds) || 10));
    await this._hub!.invoke('StartGame', rounds);
  }

  async setRedactorCanGuess(enabled: boolean): Promise<void> {
    await this.ensureConnected();
    const code = this._gameState$.value?.roomCode ?? this._localPlayer?.roomCode;
    if (!code) throw new Error('No estás en ninguna sala.');
    await this._hub!.invoke('SetRedactorCanGuess', code, enabled);
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

  async distributeDrinks(targetPlayerId: string, amount: number): Promise<void> {
    await this.ensureConnected();
    await this._hub!.invoke('DistributeDrinks', targetPlayerId, amount);
  }

  /**
   * Olvida la sesión guardada sin avisar al servidor. Se usa cuando el jugador
   * abre un enlace de invitación a una sala distinta: sin esto la reconexión
   * automática lo devolvería a la sala anterior.
   */
  forgetSession(): void {
    this._localPlayer = null;
    this._gameState$.next(null);
    this.clearStoredSession();
  }

  async leaveRoom(): Promise<void> {
    try {
      if (this._hub?.state === HubConnectionState.Connected) {
        await this.invokeWithTimeout('LeaveRoom', INVOKE_TIMEOUT_MS);
      }
    } finally {
      this._localPlayer = null;
      this.clearStoredSession();
      this._gameState$.next(null);
    }
  }

  // ── Handlers de eventos del servidor ──────────────────────────────────

  private registerHandlers(): void {
    if (!this._hub) return;

    this._hub.on('RoomCreated', (roomCode: string, playerId: string, raw: GameStateDto, reconnectToken: string) => {
      try {
        const state = normalizeGameState(raw);
        if (!state) throw new Error('RoomCreated sin estado válido');
        this.saveSession({
          playerId,
          reconnectToken,
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

    this._hub.on('JoinedRoom', (playerId: string, raw: GameStateDto, reconnectToken: string) => {
      try {
        const state = normalizeGameState(raw);
        if (!state) throw new Error('JoinedRoom sin estado válido');
        this.saveSession({
          playerId,
          reconnectToken,
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
      if (/ya no existe|sesión expiró/i.test(message) && !this._gameState$.value) {
        this._localPlayer = null;
        this.clearStoredSession();
      }
    });

    this._hub.on('PlayerDisconnected', (playerName: string) => {
      // El estado se actualiza vía GameStateUpdated; aquí solo notificamos
      console.info(`[Aproximados] ${playerName} se desconectó.`);
    });

    this._hub.on('PlayerReconnected', (playerName: string) => {
      console.info(`[Aproximados] ${playerName} reconectado.`);
    });

    this._hub.on('PlayerKicked', (playerName: string) => {
      console.info(`[Aproximados] ${playerName} fue expulsado por el anfitrión.`);
    });

    // Nos han echado: olvidar la sesión para que no intentemos reengancharnos.
    this._hub.on('Kicked', (reason: string) => {
      this._localPlayer = null;
      this.clearStoredSession();
      this._gameState$.next(null);
      this._kicked$.next(reason || 'El anfitrión te ha sacado de la sala.');
    });

    this._hub.on('RoomClosed', (reason: string) => {
      this._error$.next(`Sala cerrada: ${reason}`);
      this._localPlayer = null;
      this.clearStoredSession();
      this._gameState$.next(null);
    });
  }

  // ── Sesión persistente ─────────────────────────────────────────────────

  private saveSession(player: LocalPlayerState): void {
    this._localPlayer = player;
    const raw = JSON.stringify(player);
    try { sessionStorage.setItem(SESSION_KEY, raw); } catch { /* private mode */ }
    try { localStorage.setItem(SESSION_BACKUP_KEY, raw); } catch { /* private mode */ }
  }

  private restoreSession(): void {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY) ?? localStorage.getItem(SESSION_BACKUP_KEY);
      if (raw) {
        this._localPlayer = JSON.parse(raw) as LocalPlayerState;
        if (this._localPlayer) {
          try { sessionStorage.setItem(SESSION_KEY, raw); } catch { /* noop */ }
        }
      }
    } catch {
      this.clearStoredSession();
    }
  }

  private clearStoredSession(): void {
    try { sessionStorage.removeItem(SESSION_KEY); } catch { /* noop */ }
    try { localStorage.removeItem(SESSION_BACKUP_KEY); } catch { /* noop */ }
  }

  private ensurePlayerId(): string {
    if (this._localPlayer?.playerId) return this._localPlayer.playerId;
    return newPlayerId();
  }

  private async tryAutoReconnectToRoom(): Promise<void> {
    if (!this._localPlayer?.playerId || !this._localPlayer.roomCode) return;
    if (!this._localPlayer.reconnectToken) {
      this.forgetSession();
      return;
    }

    try {
      await this._hub!.invoke(
        'RejoinRoom',
        this._localPlayer.roomCode,
        this._localPlayer.playerId,
        this._localPlayer.reconnectToken ?? null,
      );
    } catch (err) {
      console.warn('[RoomService] RejoinRoom falló, reintentando alias Reconnect:', err);
      try {
        await this._hub!.invoke(
          'Reconnect',
          this._localPlayer.roomCode,
          this._localPlayer.playerId,
          this._localPlayer.reconnectToken ?? null,
        );
      } catch (retryErr) {
        console.warn('[RoomService] Auto-reconexión fallida:', retryErr);
      }
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
    const baseUrl = environment.apiUrl.replace(/\/$/, '');
    // A phone on the same Wi-Fi must reach the development machine, not its
    // own localhost or the production service.
    if (!environment.production && typeof window !== 'undefined' &&
        /^https?:\/\/localhost(?::\d+)?$/.test(baseUrl)) {
      const api = new URL(baseUrl);
      api.hostname = window.location.hostname;
      return `${api.origin}/gamehub`;
    }
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

function newPlayerId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '');
  }
  return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

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
    adminPlayerId: (src['adminPlayerId'] ?? src['AdminPlayerId'] ?? null) as string | null,
    players: playersRaw.map(p => ({
      playerId: String(p['playerId'] ?? p['PlayerId'] ?? ''),
      name: String(p['name'] ?? p['Name'] ?? ''),
      role: normalizeRole(p['role'] ?? p['Role']),
      score: Number(p['score'] ?? p['Score'] ?? 0),
      drinksOwed: Number(p['drinksOwed'] ?? p['DrinksOwed'] ?? 0),
      isConnected: Boolean(p['isConnected'] ?? p['IsConnected'] ?? true),
      alcoholFree: Boolean(p['alcoholFree'] ?? p['AlcoholFree'] ?? false),
      guess: (p['guess'] ?? p['Guess'] ?? null) as number | null,
      isAdmin: Boolean(p['isAdmin'] ?? p['IsAdmin'] ?? false),
    })),
    lastResult: (src['lastResult'] ?? src['LastResult'] ?? null) as GameStateDto['lastResult'],
    maxRounds: Number(src['maxRounds'] ?? src['MaxRounds'] ?? 10),
    isAlcoholFreeRoom: Boolean(src['isAlcoholFreeRoom'] ?? src['IsAlcoholFreeRoom'] ?? false),
    redactorCanGuess: Boolean(src['redactorCanGuess'] ?? src['RedactorCanGuess'] ?? false),
    guessesSubmitted: Number(src['guessesSubmitted'] ?? src['GuessesSubmitted'] ?? 0),
    guessesExpected: Number(src['guessesExpected'] ?? src['GuessesExpected'] ?? 0),
  };
}

/**
 * Modelos TypeScript que reflejan los DTOs del backend C#.
 * Mantener sincronizados con Models/GameState.cs y Models/Player.cs.
 */

export type GamePhase =
  | 'Lobby'
  | 'WritingQuestion'
  | 'CollectingGuesses'
  | 'ShowingResults'
  | 'Closed';

export type PlayerRole = 'Redactor' | 'Estimator';

export interface PlayerPublicDto {
  playerId: string;
  name: string;
  role: PlayerRole;
  score: number;
  drinksOwed: number;
  isConnected: boolean;
  alcoholFree: boolean;
  /** Null durante CollectingGuesses para otros jugadores */
  guess: number | null;
  /** Anfitrión: el único que puede empezar la partida y expulsar. */
  isAdmin: boolean;
}

export interface PlayerRoundResult {
  playerId: string;
  playerName: string;
  guess: number;
  correctAnswer: number;
  relativeErrorPercent: number;
  rank: number;
  drinksThisRound: number;
  penaltyDescription: string;
}

export interface RoundResult {
  roundNumber: number;
  question: string;
  correctAnswer: number;
  answerSource: string;
  ranking: PlayerRoundResult[];
  sarcasticComment: string;
  winnerName: string;
  loserName: string;
  drinksToDistribute: number;
  loserPenalty: number;
}

export interface GameStateDto {
  roomCode: string;
  phase: GamePhase;
  roundNumber: number;
  currentQuestion: string | null;
  redactorPlayerId: string | null;
  /** PlayerId del anfitrión de la sala. */
  adminPlayerId: string | null;
  players: PlayerPublicDto[];
  lastResult: RoundResult | null;
  maxRounds: number;
  isAlcoholFreeRoom: boolean;
  guessesSubmitted: number;
  guessesExpected: number;
}

/** Estado local del cliente (no viene del servidor) */
export interface LocalPlayerState {
  playerId: string;
  roomCode: string;
  name: string;
  alcoholFree: boolean;
}

/** Estado de conexión SignalR */
export type ConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'failed';

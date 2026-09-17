import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ResultsComponent } from './results.component';
import { RoomService } from '../../services/room.service';
import { Router } from '@angular/router';
import { BehaviorSubject, Subject } from 'rxjs';
import { GameStateDto, RoundResult } from '../../models/game.models';

const mockResult: RoundResult = {
  roundNumber: 1,
  question: '¿Cuántos km tiene la Tierra de diámetro?',
  correctAnswer: 12742,
  answerSource: 'wikipedia.org',
  ranking: [
    {
      playerId: 'p2',
      playerName: 'Bob',
      guess: 12742,
      correctAnswer: 12742,
      relativeErrorPercent: 0,
      rank: 1,
      pointsEarned: 100,
      drinksThisRound: 0,
      penaltyDescription: '',
    },
    {
      playerId: 'p3',
      playerName: 'Carlos',
      guess: 15000,
      correctAnswer: 12742,
      relativeErrorPercent: 17.7,
      rank: 2,
      pointsEarned: 82,
      drinksThisRound: 1,
      penaltyDescription: '🍺 Un trago.',
    },
  ],
  sarcasticComment: '¡Carlos, eso ha sido épicamente malo!',
  winnerName: 'Bob',
  loserName: 'Carlos',
  drinksToDistribute: 3,
  loserPenalty: 2,
  redactorPenalty: 0,
  redactorPenaltyDescription: '',
  drinksDistributedByWinner: {},
  drinkAssignments: [],
};

const mockState: GameStateDto = {
  roomCode: 'TEST',
  phase: 'ShowingResults',
  roundNumber: 1,
  currentQuestion: '¿Cuántos km tiene la Tierra de diámetro?',
  redactorPlayerId: 'p1',
  adminPlayerId: 'p1',
  players: [
    { playerId: 'p1', name: 'Ana', role: 'Redactor', score: 10, drinksOwed: 0, isConnected: true, alcoholFree: false, guess: null, isAdmin: true },
    { playerId: 'p2', name: 'Bob', role: 'Estimator', score: 110, drinksOwed: 0, isConnected: true, alcoholFree: false, guess: 12742, isAdmin: false },
    { playerId: 'p3', name: 'Carlos', role: 'Estimator', score: 82, drinksOwed: 2, isConnected: true, alcoholFree: false, guess: 15000, isAdmin: false },
  ],
  lastResult: mockResult,
  maxRounds: 5,
  isAlcoholFreeRoom: false,
  redactorCanGuess: false,
  guessesSubmitted: 2,
  guessesExpected: 2,
};

describe('ResultsComponent', () => {
  let component: ResultsComponent;
  let fixture: ComponentFixture<ResultsComponent>;
  let mockRoomService: jasmine.SpyObj<RoomService>;
  let gameState$: BehaviorSubject<GameStateDto | null>;

  beforeEach(async () => {
    gameState$ = new BehaviorSubject<GameStateDto | null>(mockState);

    mockRoomService = jasmine.createSpyObj('RoomService', ['nextRound', 'leaveRoom'], {
      gameState$: gameState$.asObservable(),
      error$: new Subject<string>().asObservable(),
      localPlayer: { playerId: 'p2', roomCode: 'TEST', name: 'Bob', alcoholFree: false },
    });

    await TestBed.configureTestingModule({
      imports: [ResultsComponent],
      providers: [
        { provide: RoomService, useValue: mockRoomService },
        { provide: Router, useValue: jasmine.createSpyObj('Router', ['navigate']) },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ResultsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should show result', () => {
    expect(component.result()).toBeTruthy();
    expect(component.result()?.correctAnswer).toBe(12742);
  });

  it('should rank players correctly', () => {
    const ranking = component.ranking();
    expect(ranking[0].rank).toBe(1);
    expect(ranking[0].playerName).toBe('Bob');
    expect(ranking[1].rank).toBe(2);
    expect(ranking[1].playerName).toBe('Carlos');
  });

  it('should identify self', () => {
    expect(component.isMe('p2')).toBeTrue();
    expect(component.isMe('p1')).toBeFalse();
  });

  it('should not be last round when roundNumber < maxRounds', () => {
    expect(component.isLastRound()).toBeFalse();
  });

  it('should be last round when roundNumber === maxRounds', () => {
    gameState$.next({ ...mockState, roundNumber: 5, maxRounds: 5 });
    fixture.detectChanges();
    expect(component.isLastRound()).toBeTrue();
  });

  it('should mark rank 1 as winner and worst rank as loser', () => {
    const rows = component.rows();
    expect(rows[0].outcome).toBe('winner');
    expect(rows[1].outcome).toBe('loser');
    expect(component.winners().map(w => w.playerName)).toEqual(['Bob']);
    expect(component.losers().map(l => l.playerName)).toEqual(['Carlos']);
  });

  it('should mark middle players as neutral with 3+ estimators', () => {
    gameState$.next({
      ...mockState,
      lastResult: {
        ...mockResult,
        ranking: [
          { ...mockResult.ranking[0], rank: 1 },
          { playerId: 'p4', playerName: 'Dani', guess: 13000, correctAnswer: 12742, relativeErrorPercent: 2, rank: 2, pointsEarned: 98, drinksThisRound: 0, penaltyDescription: '' },
          { ...mockResult.ranking[1], rank: 3 },
        ],
      },
    });
    fixture.detectChanges();

    expect(component.rows().map(r => r.outcome)).toEqual(['winner', 'neutral', 'loser']);
  });

  it('single estimator (2-player game) is winner by default and there is no loser', () => {
    gameState$.next({
      ...mockState,
      players: mockState.players.slice(0, 2),
      lastResult: { ...mockResult, ranking: [mockResult.ranking[0]], loserName: '' },
    });
    fixture.detectChanges();

    expect(component.isSoloEstimator()).toBeTrue();
    expect(component.rows().length).toBe(1);
    expect(component.rows()[0].outcome).toBe('winner');
    expect(component.losers()).toEqual([]);
  });

  it('full tie has winners but no loser', () => {
    gameState$.next({
      ...mockState,
      lastResult: {
        ...mockResult,
        ranking: mockResult.ranking.map(r => ({ ...r, rank: 1, relativeErrorPercent: 10 })),
      },
    });
    fixture.detectChanges();

    expect(component.winners().length).toBe(2);
    expect(component.losers()).toEqual([]);
    expect(component.rows().every(r => r.outcome === 'winner')).toBeTrue();
  });

  it('badges should carry the drinking mechanic text', () => {
    gameState$.next({ ...mockState, lastResult: { ...mockResult, drinksToDistribute: 1 } });
    fixture.detectChanges();
    expect(component.winnerBadge()).toBe('¡Reparte 1 trago!');
    expect(component.loserBadge()).toBe('¡Te toca beber!');

    gameState$.next({ ...mockState, isAlcoholFreeRoom: true });
    fixture.detectChanges();
    expect(component.loserBadge()).toBe('¡Te toca beber!');
  });

  it('should render winner and loser badges in the template', () => {
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.rank-card .badge-gold')?.textContent).toContain('¡Reparte');
    expect(el.querySelector('.rank-card .badge-red')?.textContent).toContain('¡Te toca beber!');
    expect(el.textContent).toContain(mockResult.sarcasticComment);
    expect(el.textContent).toContain('+100 pts');
    expect(el.textContent).toContain('+82 pts');
  });

  it('should resolve the redactor name', () => {
    expect(component.redactorName()).toBe('Ana');
    expect(component.isRedactor('p1')).toBeTrue();
  });

  it('should pick the closest connected player as next redactor', () => {
    expect(component.nextRedactor()?.playerId).toBe('p2');
    expect(component.nextRedactor()?.playerName).toBe('Bob');
    expect(component.isNextRedactor('p2')).toBeTrue();
    expect(component.isNextRedactor('p1')).toBeFalse();
  });

  it('should skip a disconnected closest player for next redactor', () => {
    gameState$.next({
      ...mockState,
      players: mockState.players.map(p =>
        p.playerId === 'p2' ? { ...p, isConnected: false } : p
      ),
    });
    fixture.detectChanges();
    expect(component.nextRedactor()?.playerId).toBe('p3');
  });

  it('formatAccuracy should format precision nicely', () => {
    expect(component.formatAccuracy({
      playerId: 'p1', playerName: 'Ana', guess: 100, correctAnswer: 100,
      accuracy: 1.0, accuracyPercent: 100, relativePerformance: 1.0,
      relativeErrorPercent: 0, rank: 1, pointsEarned: 100, drinksThisRound: 0, penaltyDescription: ''
    })).toBe('100 % precisión');

    expect(component.formatAccuracy({
      playerId: 'p2', playerName: 'Bob', guess: 80, correctAnswer: 100,
      accuracy: 0.80, accuracyPercent: 80, relativePerformance: 0.8,
      relativeErrorPercent: 20, rank: 2, pointsEarned: 88, drinksThisRound: 0, penaltyDescription: ''
    })).toBe('80 % precisión');
  });

  it('formatError should handle exact answer', () => {
    expect(component.formatError(0)).toContain('Exacto');
  });

  it('formatError should handle small error', () => {
    expect(component.formatError(3)).toContain('3,0 %');
  });

  it('formatError should handle large error', () => {
    expect(component.formatError(75)).toContain('75,0 %');
  });

  it('should call nextRound on service', async () => {
    gameState$.next({ ...mockState, adminPlayerId: 'p2' });
    mockRoomService.nextRound.and.returnValue(Promise.resolve());
    await component.nextRound();
    expect(mockRoomService.nextRound).toHaveBeenCalled();
  });

  it('should not build the final table until the last round', () => {
    expect(component.finalStandings()).toEqual([]);
  });

  it('should build the final standings with comments and drink rules on the last round', () => {
    gameState$.next({ ...mockState, roundNumber: 5, maxRounds: 5 });
    fixture.detectChanges();

    const rows = component.finalStandings();
    expect(rows.length).toBe(3);
    expect(rows[0].player.name).toBe('Bob');
    expect(rows[0].outcome).toBe('best');
    expect(rows[rows.length - 1].outcome).toBe('worst');
    expect(component.finalBestNames()).toBe('Bob');
    expect(component.finalWorstNames()).toBe('Ana');
    expect(component.finalIsTie()).toBeFalse();
  });

  it('podium rows go from worst to best, with bars relative to the top score', () => {
    gameState$.next({ ...mockState, roundNumber: 5, maxRounds: 5 });
    fixture.detectChanges();

    const podium = component.podiumRows();
    expect(podium[0].player.name).toBe('Ana');
    expect(podium[podium.length - 1].player.name).toBe('Bob');
    expect(podium[podium.length - 1].barPercent).toBe(100);
    expect(podium[0].barPercent).toBeCloseTo((10 / 110) * 100, 5);
  });

  it('can open final reveal in the last round', () => {
    gameState$.next({ ...mockState, roundNumber: 5, maxRounds: 5 });
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('app-final-reveal')).toBeNull();
    component.openFinal();
    fixture.detectChanges();
    expect(component.showFinal()).toBeTrue();
    expect(el.querySelector('app-final-reveal')).toBeTruthy();
  });

  it('keeps the normal results view on intermediate rounds', () => {
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('app-final-reveal')).toBeNull();
    expect(el.textContent).toContain('Resultados');
  });

  it('should leave the room when finishing the game', async () => {
    mockRoomService.leaveRoom.and.returnValue(Promise.resolve());
    await component.finishGame();
    expect(mockRoomService.leaveRoom).toHaveBeenCalled();
  });

  it('shows the easy-question penalty and the AI comment', () => {
    gameState$.next({ ...mockState, lastResult: { ...mockResult, redactorPenalty: 1,
      redactorPenaltyDescription: 'Todos acertaron: un trago para el redactor.' } });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Todos acertaron');
    expect(fixture.nativeElement.textContent).toContain(mockResult.sarcasticComment);
  });

  it('renders verbal drink verdict for winner and loser correctly', () => {
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(component.isWinnerMe()).toBeTrue();
    expect(component.isLoserMe()).toBeFalse();
    expect(component.winnerNames()).toBe('Bob');
    expect(component.loserNames()).toBe('Carlos');
    expect(el.textContent).toContain('¡Has ganado la ronda!');
    expect(el.textContent).toContain('decir en voz alta quién bebe');
    expect(el.textContent).toContain('¡Carlos ha quedado más lejos!');
    expect(el.textContent).toContain('beber 2 tragos');
  });

  it('renders verdict correctly when local player is the loser', () => {
    gameState$.next({
      ...mockState,
      lastResult: {
        ...mockResult,
        ranking: [
          { ...mockResult.ranking[1], playerId: 'p2', playerName: 'Bob', rank: 2 },
          { ...mockResult.ranking[0], playerId: 'p3', playerName: 'Carlos', rank: 1 },
        ],
      },
    });
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(component.isWinnerMe()).toBeFalse();
    expect(component.isLoserMe()).toBeTrue();
    expect(el.textContent).toContain('¡Carlos gana la ronda!');
    expect(el.textContent).toContain('¡Te has quedado más lejos!');
    expect(el.textContent).toContain('Te toca');
  });

  it('allows host to advance round', async () => {
    gameState$.next({ ...mockState, adminPlayerId: 'p2' });
    fixture.detectChanges();
    expect(component.canAdvance()).toBeTrue();
    mockRoomService.nextRound.and.returnValue(Promise.resolve());
    await component.nextRound();
    expect(mockRoomService.nextRound).toHaveBeenCalled();
  });

  it('prevents non-host from advancing round', async () => {
    gameState$.next({ ...mockState, adminPlayerId: 'p1' });
    fixture.detectChanges();
    expect(component.canAdvance()).toBeFalse();
    await component.nextRound();
    expect(mockRoomService.nextRound).not.toHaveBeenCalled();
  });

  it('promptLeave opens leave confirmation dialog and cancel closes it', () => {
    expect(component.showLeaveDialog()).toBeFalse();
    component.promptLeave();
    expect(component.showLeaveDialog()).toBeTrue();
    component.cancelLeave();
    expect(component.showLeaveDialog()).toBeFalse();
  });

  it('confirmLeave closes dialog and finishes game', async () => {
    mockRoomService.leaveRoom.and.returnValue(Promise.resolve());
    component.promptLeave();
    await component.confirmLeave();
    expect(component.showLeaveDialog()).toBeFalse();
    expect(mockRoomService.leaveRoom).toHaveBeenCalled();
  });

});

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
      drinksThisRound: 1,
      penaltyDescription: '🍺 Un trago.',
    },
  ],
  sarcasticComment: '¡Carlos, eso ha sido épicamente malo!',
  winnerName: 'Bob',
  loserName: 'Carlos',
  drinksToDistribute: 3,
  loserPenalty: 2,
};

const mockState: GameStateDto = {
  roomCode: 'TEST',
  phase: 'ShowingResults',
  roundNumber: 1,
  currentQuestion: '¿Cuántos km tiene la Tierra de diámetro?',
  redactorPlayerId: 'p1',
  players: [
    { playerId: 'p1', name: 'Ana', role: 'Redactor', score: 10, drinksOwed: 0, isConnected: true, alcoholFree: false, guess: null },
    { playerId: 'p2', name: 'Bob', role: 'Estimator', score: 110, drinksOwed: 0, isConnected: true, alcoholFree: false, guess: 12742 },
    { playerId: 'p3', name: 'Carlos', role: 'Estimator', score: 82, drinksOwed: 2, isConnected: true, alcoholFree: false, guess: 15000 },
  ],
  lastResult: mockResult,
  maxRounds: 5,
  isAlcoholFreeRoom: false,
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
          { playerId: 'p4', playerName: 'Dani', guess: 13000, correctAnswer: 12742, relativeErrorPercent: 2, rank: 2, drinksThisRound: 0, penaltyDescription: '' },
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
    expect(component.winnerBadge()).toBe('🎯 ¡Reparte 1 trago!');
    expect(component.loserBadge()).toBe('🍺 ¡Te toca beber!');

    gameState$.next({ ...mockState, isAlcoholFreeRoom: true });
    fixture.detectChanges();
    expect(component.loserBadge()).toBe('🧃 ¡Te toca beber!');
  });

  it('should render winner and loser badges in the template', () => {
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.badge-gold')?.textContent).toContain('¡Reparte');
    expect(el.querySelector('.badge-red')?.textContent).toContain('¡Te toca beber!');
    expect(el.textContent).not.toContain('La IA opina');
  });

  it('should resolve the redactor name', () => {
    expect(component.redactorName()).toBe('Ana');
    expect(component.isRedactor('p1')).toBeTrue();
  });

  it('formatError should handle exact answer', () => {
    expect(component.formatError(0)).toContain('Exacto');
  });

  it('formatError should handle small error', () => {
    expect(component.formatError(3)).toContain('3.0%');
  });

  it('formatError should handle large error', () => {
    expect(component.formatError(75)).toContain('75.0%');
    expect(component.formatError(75)).toContain('💀');
  });

  it('should call nextRound on service', async () => {
    mockRoomService.nextRound.and.returnValue(Promise.resolve());
    await component.nextRound();
    expect(mockRoomService.nextRound).toHaveBeenCalled();
  });

  it('should not build the final table until the last round', () => {
    expect(component.finalStandings()).toEqual([]);
  });

  it('should show final standings with comments and drink rules on the last round', () => {
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

    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('Clasificación final');
    expect(el.textContent).toContain('Elige quién bebe');
    expect(el.textContent).toContain('Bebe');
    expect(el.querySelector('.podium')).toBeTruthy();
    expect(component.podiumRows()[0].player.name).toBe('Ana');
    expect(component.podiumRows()[component.podiumRows().length - 1].player.name).toBe('Bob');
    expect(component.podiumRows()[component.podiumRows().length - 1].barPercent).toBe(100);
  });

  it('podium bar percent is relative to the highest score', () => {
    gameState$.next({ ...mockState, roundNumber: 5, maxRounds: 5 });
    fixture.detectChanges();
    const ana = component.podiumRows().find(r => r.player.name === 'Ana');
    expect(ana?.barPercent).toBeCloseTo((10 / 110) * 100, 5);
  });

  it('staggers each podium row by 1 second and starts bars at 0 width', () => {
    gameState$.next({ ...mockState, roundNumber: 5, maxRounds: 5 });
    fixture.detectChanges();

    const rows = fixture.nativeElement.querySelectorAll('.podium-row') as NodeListOf<HTMLElement>;
    expect(rows.length).toBe(3);
    expect(rows[0].style.animationDelay).toBe('0ms');
    expect(rows[1].style.animationDelay).toBe('1000ms');
    expect(rows[2].style.animationDelay).toBe('2000ms');

    const bars = fixture.nativeElement.querySelectorAll('.podium-bar-fill') as NodeListOf<HTMLElement>;
    expect(component.podiumArmed()).toBeFalse();
    expect(bars[0].style.width).toBe('0%');
    expect(bars[2].style.transitionDelay).toBe('2000ms');
  });

  it('should leave the room when finishing the game', async () => {
    mockRoomService.leaveRoom.and.returnValue(Promise.resolve());
    await component.finishGame();
    expect(mockRoomService.leaveRoom).toHaveBeenCalled();
  });
});

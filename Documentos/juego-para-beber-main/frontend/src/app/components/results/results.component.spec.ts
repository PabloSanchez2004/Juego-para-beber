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

    mockRoomService = jasmine.createSpyObj('RoomService', ['nextRound'], {
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

  it('rankEmoji should return correct emojis', () => {
    expect(component.rankEmoji(1)).toBe('🥇');
    expect(component.rankEmoji(2)).toBe('🥈');
    expect(component.rankEmoji(3)).toBe('🥉');
    expect(component.rankEmoji(4)).toBe('#4');
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
});

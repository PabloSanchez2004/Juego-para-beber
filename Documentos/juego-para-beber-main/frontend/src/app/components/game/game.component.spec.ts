import { ComponentFixture, TestBed } from '@angular/core/testing';
import { GameComponent } from './game.component';
import { RoomService } from '../../services/room.service';
import { Router } from '@angular/router';
import { BehaviorSubject, Subject } from 'rxjs';
import { GameStateDto } from '../../models/game.models';

const mockState: GameStateDto = {
  roomCode: 'TEST',
  phase: 'WritingQuestion',
  roundNumber: 1,
  currentQuestion: null,
  redactorPlayerId: 'p1',
  adminPlayerId: 'p1',
  players: [
    { playerId: 'p1', name: 'Ana', role: 'Redactor', score: 0, drinksOwed: 0, isConnected: true, alcoholFree: false, guess: null, isAdmin: true },
    { playerId: 'p2', name: 'Bob', role: 'Estimator', score: 0, drinksOwed: 0, isConnected: true, alcoholFree: false, guess: null, isAdmin: false },
  ],
  lastResult: null,
  maxRounds: 5,
  isAlcoholFreeRoom: false,
  redactorCanGuess: false,
  guessesSubmitted: 0,
  guessesExpected: 1,
};

describe('GameComponent', () => {
  let component: GameComponent;
  let fixture: ComponentFixture<GameComponent>;
  let mockRoomService: jasmine.SpyObj<RoomService>;
  let gameState$: BehaviorSubject<GameStateDto | null>;
  let error$: Subject<string>;
  let guessAcknowledged$: Subject<void>;

  beforeEach(async () => {
    gameState$ = new BehaviorSubject<GameStateDto | null>(mockState);
    error$ = new Subject<string>();
    guessAcknowledged$ = new Subject<void>();

    mockRoomService = jasmine.createSpyObj('RoomService', [
      'submitQuestion', 'submitGuess', 'requestResults'
    ], {
      gameState$: gameState$.asObservable(),
      error$: error$.asObservable(),
      guessAcknowledged$: guessAcknowledged$.asObservable(),
      localPlayer: { playerId: 'p2', roomCode: 'TEST', name: 'Bob', alcoholFree: false },
    });

    await TestBed.configureTestingModule({
      imports: [GameComponent],
      providers: [
        { provide: RoomService, useValue: mockRoomService },
        { provide: Router, useValue: jasmine.createSpyObj('Router', ['navigate']) },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(GameComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should detect estimator role (not redactor)', () => {
    expect(component.isRedactor()).toBeFalse();
  });

  it('should detect writing phase', () => {
    expect(component.isWritingPhase()).toBeTrue();
    expect(component.isCollectingPhase()).toBeFalse();
    expect(component.isFollowUpRound()).toBeFalse();
  });

  it('should mark follow-up rounds after the first', () => {
    gameState$.next({ ...mockState, roundNumber: 2 });
    fixture.detectChanges();
    expect(component.isFollowUpRound()).toBeTrue();
  });

  it('should detect collecting phase', () => {
    gameState$.next({ ...mockState, phase: 'CollectingGuesses', currentQuestion: '¿Cuántos km?' });
    fixture.detectChanges();
    expect(component.isCollectingPhase()).toBeTrue();
  });

  it('should validate guess: valid number', () => {
    component.guessInput.set('42');
    expect(component.guessValid()).toBeTrue();
  });

  it('should format thousands with dots (1000 → 1.000)', () => {
    const event = { target: { value: '1000' } } as unknown as Event;
    component.onGuessInput(event);
    expect(component.guessInput()).toBe('1.000');
    expect(component.resolvedGuess()).toBe(1000);
  });

  it('should preview 7.000.000 as seven million', () => {
    component.guessInput.set('7.000.000');
    expect(component.resolvedGuess()).toBe(7_000_000);
    expect(component.guessPreview()).toBe('7.000.000 (7 millones)');
  });

  it('should validate guess: comma as decimal separator', () => {
    component.guessInput.set('42,5');
    expect(component.guessValid()).toBeTrue();
    expect(component.resolvedGuess()).toBe(42.5);
  });

  it('should validate guess: negative number', () => {
    component.guessInput.set('-100');
    expect(component.guessValid()).toBeTrue();
  });

  it('should validate guess: empty is invalid', () => {
    component.guessInput.set('');
    expect(component.guessValid()).toBeFalse();
  });

  it('should validate guess: text is invalid', () => {
    component.guessInput.set('abc');
    expect(component.guessValid()).toBeFalse();
  });

  it('should not submit guess if already sent', async () => {
    component.guessSent.set(true);
    component.guessInput.set('42');
    await component.submitGuess();
    expect(mockRoomService.submitGuess).not.toHaveBeenCalled();
  });

  it('should call submitGuess with parsed number', async () => {
    mockRoomService.submitGuess.and.returnValue(Promise.resolve());
    gameState$.next({ ...mockState, phase: 'CollectingGuesses' });
    component.guessInput.set('1.234');
    await component.submitGuess();
    expect(mockRoomService.submitGuess).toHaveBeenCalledWith(1234);
  });

  it('should mark guessSent on GuessAcknowledged', () => {
    gameState$.next({ ...mockState, phase: 'CollectingGuesses' });
    expect(component.guessSent()).toBeFalse();
    guessAcknowledged$.next();
    expect(component.guessSent()).toBeTrue();
  });

  it('should compute guessProgress correctly', () => {
    gameState$.next({ ...mockState, phase: 'CollectingGuesses', guessesSubmitted: 1, guessesExpected: 2 });
    fixture.detectChanges();
    expect(component.guessProgress()).toBe(50);
  });

  it('guessesExpected should be players - 1 (redactor never counts)', () => {
    // Valor del servidor
    gameState$.next({ ...mockState, phase: 'CollectingGuesses', guessesExpected: 1 });
    fixture.detectChanges();
    expect(component.guessesExpected()).toBe(1);

    // Fallback local si el servidor no lo envía: conectados menos el Redactor
    gameState$.next({ ...mockState, phase: 'CollectingGuesses', guessesExpected: 0 });
    fixture.detectChanges();
    expect(component.guessesExpected()).toBe(mockState.players.length - 1);
  });

  it('should compute guessProgress 0 when no estimators', () => {
    gameState$.next({ ...mockState, phase: 'CollectingGuesses', guessesSubmitted: 0, guessesExpected: 0 });
    fixture.detectChanges();
    expect(component.guessProgress()).toBe(0);
  });
  it('keeps a draft when a connection update arrives in the same round', () => {
    component.question.set('¿Cuántos huesos tiene un adulto?');
    gameState$.next({ ...mockState, players: [...mockState.players] });
    expect(component.question()).toBe('¿Cuántos huesos tiene un adulto?');
  });

  it('clears the draft when a new round begins', () => {
    component.question.set('Pregunta anterior');
    gameState$.next({ ...mockState, roundNumber: 2 });
    expect(component.question()).toBe('');
  });

  it('hides the answer form from the redactor in classic mode', async () => {
    gameState$.next({ ...mockState, phase: 'CollectingGuesses', redactorPlayerId: 'p2' });
    fixture.detectChanges();
    expect(component.canGuess()).toBeFalse();
    expect(fixture.nativeElement.querySelector('#guess-input')).toBeNull();
    component.guessInput.set('42');
    await component.submitGuess();
    expect(mockRoomService.submitGuess).not.toHaveBeenCalled();
  });

  it('lets the redactor answer and close the round in the all-play mode', async () => {
    gameState$.next({ ...mockState, phase: 'CollectingGuesses', redactorPlayerId: 'p2', redactorCanGuess: true, guessesExpected: 0 });
    fixture.detectChanges();
    expect(component.canGuess()).toBeTrue();
    expect(component.canCloseRound()).toBeTrue();
    expect(component.guessesExpected()).toBe(2);
    expect(fixture.nativeElement.querySelector('#guess-input')).not.toBeNull();
    mockRoomService.submitGuess.and.returnValue(Promise.resolve());
    component.guessInput.set('42');
    await component.submitGuess();
    expect(mockRoomService.submitGuess).toHaveBeenCalledWith(42);
  });

  it('restores the author’s zero guess after reconnecting in all-play mode', () => {
    gameState$.next({ ...mockState, phase: 'CollectingGuesses', redactorPlayerId: 'p2', redactorCanGuess: true,
      players: mockState.players.map(p => p.playerId === 'p2' ? { ...p, guess: 0 } : p) });
    fixture.detectChanges();
    expect(component.guessSent()).toBeTrue();
    expect(component.formattedResolvedGuess()).toBe('0');
    expect(fixture.nativeElement.querySelector('#guess-input')).toBeNull();
  });

  it('clears a previous submitted guess if reconnecting directly into a later round', () => {
    gameState$.next({ ...mockState, phase: 'CollectingGuesses' });
    component.guessInput.set('42');
    guessAcknowledged$.next();
    gameState$.next({ ...mockState, phase: 'CollectingGuesses', roundNumber: 2 });
    expect(component.guessSent()).toBeFalse();
    expect(component.guessInput()).toBe('');
  });

  it('does not disclose another player’s secret estimate', () => {
    gameState$.next({ ...mockState, phase: 'CollectingGuesses',
      players: mockState.players.map(p => p.playerId === 'p1' ? { ...p, guess: 987654321 } : p) });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('987');
  });

  it('allows the host to close a round even when another player is the author', async () => {
    gameState$.next({ ...mockState, phase: 'CollectingGuesses', adminPlayerId: 'p2', guessesSubmitted: 1 });
    mockRoomService.requestResults.and.returnValue(Promise.resolve());
    await component.forceResults();
    expect(mockRoomService.requestResults).toHaveBeenCalled();
    expect(component.loading()).toBeFalse();
  });

  it('does not close a round without any estimates', async () => {
    gameState$.next({ ...mockState, phase: 'CollectingGuesses', adminPlayerId: 'p2', guessesSubmitted: 0 });
    await component.forceResults();
    expect(mockRoomService.requestResults).not.toHaveBeenCalled();
  });

  it('does not lock the question editor when the server rejects a question', async () => {
    gameState$.next({ ...mockState, redactorPlayerId: 'p2' });
    component.question.set('¿Cuántos huesos tiene un adulto?');
    mockRoomService.submitQuestion.and.callFake(async () => { error$.next('Pregunta inválida'); });
    await component.submitQuestion();
    expect(component.questionSent()).toBeFalse();
    expect(component.errorMsg()).toBe('Pregunta inválida');
    expect(component.loading()).toBeFalse();
  });

});

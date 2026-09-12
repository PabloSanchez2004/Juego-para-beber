import { ComponentFixture, TestBed } from '@angular/core/testing';
import { LobbyComponent } from './lobby.component';
import { RoomService } from '../../services/room.service';
import { Router } from '@angular/router';
import { BehaviorSubject, Subject } from 'rxjs';
import { GameStateDto } from '../../models/game.models';

const mockState: GameStateDto = {
  roomCode: 'ABCD',
  phase: 'Lobby',
  roundNumber: 0,
  currentQuestion: null,
  redactorPlayerId: null,
  players: [
    { playerId: 'p1', name: 'Ana', role: 'Estimator', score: 0, drinksOwed: 0, isConnected: true, alcoholFree: false, guess: null },
    { playerId: 'p2', name: 'Bob', role: 'Estimator', score: 0, drinksOwed: 0, isConnected: true, alcoholFree: false, guess: null },
  ],
  lastResult: null,
  maxRounds: 10,
  isAlcoholFreeRoom: false,
  guessesSubmitted: 0,
  guessesExpected: 0,
};

describe('LobbyComponent', () => {
  let component: LobbyComponent;
  let fixture: ComponentFixture<LobbyComponent>;
  let mockRoomService: jasmine.SpyObj<RoomService>;
  let gameState$: BehaviorSubject<GameStateDto | null>;

  beforeEach(async () => {
    gameState$ = new BehaviorSubject<GameStateDto | null>(mockState);

    mockRoomService = jasmine.createSpyObj('RoomService', ['startGame', 'leaveRoom'], {
      gameState$: gameState$.asObservable(),
      error$: new Subject<string>().asObservable(),
      localPlayer: { playerId: 'p1', roomCode: 'ABCD', name: 'Ana', alcoholFree: false },
    });

    await TestBed.configureTestingModule({
      imports: [LobbyComponent],
      providers: [
        { provide: RoomService, useValue: mockRoomService },
        { provide: Router, useValue: jasmine.createSpyObj('Router', ['navigate']) },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LobbyComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should show 2 connected players', () => {
    expect(component.connectedCount()).toBe(2);
  });

  it('canStart should be true with 2+ players', () => {
    expect(component.canStart()).toBeTrue();
  });

  it('canStart should be false with 1 player', () => {
    gameState$.next({
      ...mockState,
      players: [mockState.players[0]],
    });
    fixture.detectChanges();
    expect(component.canStart()).toBeFalse();
  });

  it('should identify self', () => {
    expect(component.isMe(mockState.players[0])).toBeTrue();
    expect(component.isMe(mockState.players[1])).toBeFalse();
  });

  it('should call startGame on service', async () => {
    mockRoomService.startGame.and.returnValue(Promise.resolve());
    await component.startGame();
    expect(mockRoomService.startGame).toHaveBeenCalled();
  });

  it('should not start if only 1 player connected', async () => {
    gameState$.next({
      ...mockState,
      players: [{ ...mockState.players[0], isConnected: true }],
    });
    fixture.detectChanges();
    await component.startGame();
    expect(mockRoomService.startGame).not.toHaveBeenCalled();
  });
});

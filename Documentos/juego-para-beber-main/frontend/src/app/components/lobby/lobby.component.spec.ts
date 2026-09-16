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
  adminPlayerId: 'p1',
  players: [
    { playerId: 'p1', name: 'Ana', role: 'Estimator', score: 0, drinksOwed: 0, isConnected: true, alcoholFree: false, guess: null, isAdmin: true },
    { playerId: 'p2', name: 'Bob', role: 'Estimator', score: 0, drinksOwed: 0, isConnected: true, alcoholFree: false, guess: null, isAdmin: false },
  ],
  lastResult: null,
  maxRounds: 10,
  isAlcoholFreeRoom: false,
  redactorCanGuess: false,
  guessesSubmitted: 0,
  guessesExpected: 0,
};

describe('LobbyComponent', () => {
  let component: LobbyComponent;
  let fixture: ComponentFixture<LobbyComponent>;
  let mockRoomService: jasmine.SpyObj<RoomService>;
  let gameState$: BehaviorSubject<GameStateDto | null>;

  /** Monta el lobby como si fuésemos `playerId` (p1 = anfitrión, p2 = invitado). */
  async function createAs(playerId: string): Promise<void> {
    TestBed.resetTestingModule();
    gameState$ = new BehaviorSubject<GameStateDto | null>(mockState);

    mockRoomService = jasmine.createSpyObj(
      'RoomService',
      ['startGame', 'leaveRoom', 'kickPlayer', 'setRedactorCanGuess'],
      {
        gameState$: gameState$.asObservable(),
        error$: new Subject<string>().asObservable(),
        localPlayer: { playerId, roomCode: 'ABCD', name: playerId === 'p1' ? 'Ana' : 'Bob', alcoholFree: false },
      },
    );

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
  }

  beforeEach(async () => {
    await createAs('p1');
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
    expect(mockRoomService.startGame).toHaveBeenCalledWith(10);
  });

  it('should start the game with the rounds chosen when the room was created', async () => {
    gameState$.next({ ...mockState, maxRounds: 3 });
    fixture.detectChanges();
    mockRoomService.startGame.and.returnValue(Promise.resolve());
    await component.startGame();
    expect(mockRoomService.startGame).toHaveBeenCalledWith(3);
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

  // ── Anfitrión ────────────────────────────────────────────────────────

  it('the room creator is the admin and sees the start button', () => {
    expect(component.isAdmin()).toBeTrue();
    expect(component.adminName()).toBe('Ana');
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[aria-label="Empezar partida"]')).not.toBeNull();
  });

  it('a guest is not admin and cannot start the game', async () => {
    await createAs('p2');

    expect(component.isAdmin()).toBeFalse();
    expect(component.canStart()).toBeFalse();

    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[aria-label="Empezar partida"]')).toBeNull();
    expect(el.textContent).toContain('Esperando a Ana para empezar');

    await component.startGame();
    expect(mockRoomService.startGame).not.toHaveBeenCalled();
  });

  // ── Expulsar ─────────────────────────────────────────────────────────

  it('the admin can kick others but never itself', () => {
    expect(component.canKick(mockState.players[1])).toBeTrue();
    expect(component.canKick(mockState.players[0])).toBeFalse();
  });

  it('a guest sees no kick buttons', async () => {
    await createAs('p2');
    expect(component.canKick(mockState.players[0])).toBeFalse();
    expect(fixture.nativeElement.querySelector('[aria-label^="Expulsar a"]')).toBeNull();
  });

  it('kicking asks for confirmation before calling the hub', async () => {
    mockRoomService.kickPlayer.and.returnValue(Promise.resolve());

    component.askKick(mockState.players[1]);
    expect(component.isConfirmingKick(mockState.players[1])).toBeTrue();
    expect(mockRoomService.kickPlayer).not.toHaveBeenCalled();

    await component.confirmKick(mockState.players[1]);
    expect(mockRoomService.kickPlayer).toHaveBeenCalledWith('p2');
    expect(component.isConfirmingKick(mockState.players[1])).toBeFalse();
  });

  it('cancelling a kick leaves the player alone', () => {
    component.askKick(mockState.players[1]);
    component.cancelKick();
    expect(component.confirmKickId()).toBe('');
    expect(mockRoomService.kickPlayer).not.toHaveBeenCalled();
  });

  it('renders a kick button per other player for the admin', () => {
    const buttons = fixture.nativeElement.querySelectorAll('[aria-label^="Expulsar a"]');
    expect(buttons.length).toBe(1);
    expect(buttons[0].getAttribute('aria-label')).toBe('Expulsar a Bob');
  });

  // ── Invitación ───────────────────────────────────────────────────────

  it('builds a direct invite link with the room code', () => {
    expect(component.inviteLink()).toBe(`${window.location.origin}/join/ABCD`);
    expect(fixture.nativeElement.textContent).toContain('Copiar enlace de invitación');
  });
});

// These checks verify server-authoritative mode selection across participants.
describe('Lobby mode selection', () => {
  let component: LobbyComponent;
  let service: jasmine.SpyObj<RoomService>;
  beforeEach(() => {
    service = jasmine.createSpyObj('RoomService', ['setRedactorCanGuess'], {
      localPlayer: { playerId: 'p1' },
    });
    component = new LobbyComponent(service, jasmine.createSpyObj('Router', ['navigate']));
    component.state.set(mockState);
  });
  it('saves the selected mode without optimistically changing shared state', async () => {
    service.setRedactorCanGuess.and.resolveTo();
    await component.selectMode(true);
    expect(service.setRedactorCanGuess).toHaveBeenCalledWith(true);
    expect(component.state()?.redactorCanGuess).toBeFalse();
    expect(component.modeSaving()).toBeFalse();
  });
  it('prevents starting while the mode is being saved', async () => {
    let finish!: () => void;
    service.setRedactorCanGuess.and.returnValue(new Promise(resolve => finish = resolve));
    const pending = component.selectMode(true);
    expect(component.canStart()).toBeFalse();
    await component.selectMode(false);
    expect(service.setRedactorCanGuess).toHaveBeenCalledTimes(1);
    finish();
    await pending;
    expect(component.canStart()).toBeTrue();
  });
  it('prevents guests from changing mode', async () => {
    component.state.set({ ...mockState, adminPlayerId: 'p2', players: mockState.players.map(p => ({...p, isAdmin: p.playerId === 'p2'})) });
    await component.selectMode(true);
    expect(service.setRedactorCanGuess).not.toHaveBeenCalled();
  });
  it('leaves the previous selection when saving fails', async () => {
    service.setRedactorCanGuess.and.rejectWith(new Error('offline'));
    await component.selectMode(true);
    expect(component.errorMsg()).toContain('No se pudo cambiar');
    expect(component.state()?.redactorCanGuess).toBeFalse();
    expect(component.modeSaving()).toBeFalse();
  });
});

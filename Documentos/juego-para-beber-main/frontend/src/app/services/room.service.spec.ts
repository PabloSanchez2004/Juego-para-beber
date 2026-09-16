/**
 * Tests unitarios del RoomService.
 * Usan un mock de HubConnection para no requerir servidor real.
 *
 * Para ejecutar: ng test (requiere node_modules instalados)
 */
import { take } from 'rxjs';
import { TestBed } from '@angular/core/testing';
import { RoomService } from './room.service';

// Mock mínimo de HubConnection
const mockHub = {
  state: 'Connected',
  start: jasmine.createSpy('start').and.returnValue(Promise.resolve()),
  stop: jasmine.createSpy('stop').and.returnValue(Promise.resolve()),
  invoke: jasmine.createSpy('invoke').and.returnValue(Promise.resolve()),
  on: jasmine.createSpy('on'),
  onreconnecting: jasmine.createSpy('onreconnecting'),
  onreconnected: jasmine.createSpy('onreconnected'),
  onclose: jasmine.createSpy('onclose'),
};

describe('RoomService', () => {
  let service: RoomService;

  beforeEach(() => {
    sessionStorage.clear();
    localStorage.removeItem('aproximados_session_backup');
    TestBed.configureTestingModule({});
    service = TestBed.inject(RoomService);
    // Inyectar hub mock
    (service as any)._hub = mockHub;
    mockHub.invoke.calls.reset();
    mockHub.invoke.and.resolveTo();
    mockHub.on.calls.reset();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('initial connectionStatus should be disconnected', (done) => {
    service.connectionStatus$.pipe(take(1)).subscribe(status => {
      expect(status).toBe('disconnected');
      done();
    });
  });

  it('initial gameState should be null', (done) => {
    service.gameState$.pipe(take(1)).subscribe(state => {
      expect(state).toBeNull();
      done();
    });
  });

  it('submitGuess should invoke SubmitGuess on hub', async () => {
    await service.submitGuess(42.5);
    expect(mockHub.invoke).toHaveBeenCalledWith('SubmitGuess', 42.5, false);
  });

  it('sends the Doble o nada choice with the guess', async () => {
    await service.submitGuess(42.5, true);
    expect(mockHub.invoke).toHaveBeenCalledWith('SubmitGuess', 42.5, true);
  });

  it('submitQuestion should invoke SubmitQuestion on hub', async () => {
    await service.submitQuestion('¿Cuántos km tiene la Tierra?');
    expect(mockHub.invoke).toHaveBeenCalledWith('SubmitQuestion', '¿Cuántos km tiene la Tierra?');
  });

  it('nextRound should invoke NextRound on hub', async () => {
    await service.nextRound();
    expect(mockHub.invoke).toHaveBeenCalledWith('NextRound');
  });

  it('leaveRoom should clear localPlayer and gameState', async () => {
    // Simular sesión activa
    (service as any)._localPlayer = { playerId: 'p1', roomCode: 'ABCD', name: 'Ana', alcoholFree: false };
    (service as any)._gameState$.next({ roomCode: 'ABCD', phase: 'Lobby' } as any);

    await service.leaveRoom();

    expect(service.localPlayer).toBeNull();
    expect(service.currentState).toBeNull();
  });
  it('does not overwrite a valid recovery secret when joining fails', async () => {
    const session = { playerId: 'p1', roomCode: 'ABCD', name: 'Ana', alcoholFree: false, reconnectToken: 'private-secret' };
    (service as any)._localPlayer = session;
    mockHub.invoke.and.returnValue(Promise.reject(new Error('Connection failed')));
    await expectAsync(service.joinRoom('EFGH', 'Ana')).toBeRejected();
    expect(service.localPlayer).toEqual(session);
    mockHub.invoke.and.returnValue(Promise.resolve());
  });

  it('sends the mode change for the current room', async () => {
    (service as any)._gameState$.next({ roomCode: 'ABCD' });
    await service.setRedactorCanGuess(true);
    expect(mockHub.invoke).toHaveBeenCalledWith('SetRedactorCanGuess', 'ABCD', true);
  });

  it('does not send a mode change without a room', async () => {
    await expectAsync(service.setRedactorCanGuess(true)).toBeRejected();
    expect(mockHub.invoke).not.toHaveBeenCalled();
  });

  it('clears the session when leaving fails due to a broken connection', async () => {
    (service as any)._localPlayer = { playerId: 'p1', roomCode: 'ABCD' };
    sessionStorage.setItem('aproximados_session', '{}');
    mockHub.invoke.and.rejectWith(new Error('offline'));
    await expectAsync(service.leaveRoom()).toBeRejected();
    expect(service.localPlayer).toBeNull();
    expect(sessionStorage.getItem('aproximados_session')).toBeNull();
  });

  it('normalizes the game mode from both serializer conventions', () => {
    (service as any).registerHandlers();
    const update = mockHub.on.calls.allArgs().find(args => args[0] === 'GameStateUpdated')![1];
    update({ RoomCode: 'ABCD', Phase: 0, RedactorCanGuess: true });
    expect(service.currentState?.redactorCanGuess).toBeTrue();
    update({ roomCode: 'ABCD', phase: 'Lobby', redactorCanGuess: false });
    expect(service.currentState?.redactorCanGuess).toBeFalse();
    update({ roomCode: 'ABCD', phase: 'Lobby' });
    expect(service.currentState?.redactorCanGuess).toBeFalse();
  });

  it('clears player identity before notifying subscribers of room closure', () => {
    (service as any).registerHandlers();
    (service as any)._localPlayer = { playerId: 'p1', roomCode: 'ABCD' };
    let localPlayerOnClose: unknown = 'not notified';
    service.gameState$.subscribe(state => { if (!state) localPlayerOnClose = service.localPlayer; });
    const close = mockHub.on.calls.allArgs().find(args => args[0] === 'RoomClosed')![1];
    close('Final de la partida');
    expect(localPlayerOnClose).toBeNull();
  });

  it('normalizes lastResult drink assignments from either serializer', () => {
    (service as any).registerHandlers();
    const update = mockHub.on.calls.allArgs().find(args => args[0] === 'GameStateUpdated')![1];
    update({
      RoomCode: 'ABCD',
      Phase: 3,
      LastResult: {
        RoundNumber: 1,
        Question: '¿Cuántos?',
        CorrectAnswer: 10,
        Ranking: [{ PlayerId: 'p1', PlayerName: 'Ana', Guess: 10, Rank: 1, PointsEarned: 100 }],
        DrinksToDistribute: 1,
        DrinksDistributedByWinner: { p1: 1 },
        DrinkAssignments: [{ FromPlayerId: 'p1', ToPlayerId: 'p2', Amount: 1 }],
      },
    });
    expect(service.currentState?.lastResult?.drinksToDistribute).toBe(1);
    expect(service.currentState?.lastResult?.drinkAssignments[0]).toEqual({
      fromPlayerId: 'p1',
      toPlayerId: 'p2',
      amount: 1,
    });
    expect(service.currentState?.lastResult?.ranking[0].playerName).toBe('Ana');
    expect(service.currentState?.lastResult?.ranking[0].pointsEarned).toBe(100);
    expect(service.currentState?.lastResult?.ranking[0].basePoints).toBe(100);
  });

});

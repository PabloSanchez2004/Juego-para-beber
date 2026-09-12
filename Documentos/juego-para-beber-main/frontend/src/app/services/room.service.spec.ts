/**
 * Tests unitarios del RoomService.
 * Usan un mock de HubConnection para no requerir servidor real.
 *
 * Para ejecutar: ng test (requiere node_modules instalados)
 */
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
    TestBed.configureTestingModule({});
    service = TestBed.inject(RoomService);
    // Inyectar hub mock
    (service as any)._hub = mockHub;
    mockHub.invoke.calls.reset();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('initial connectionStatus should be disconnected', (done) => {
    service.connectionStatus$.subscribe(status => {
      expect(status).toBe('disconnected');
      done();
    });
  });

  it('initial gameState should be null', (done) => {
    service.gameState$.subscribe(state => {
      expect(state).toBeNull();
      done();
    });
  });

  it('submitGuess should invoke SubmitGuess on hub', async () => {
    await service.submitGuess(42.5);
    expect(mockHub.invoke).toHaveBeenCalledWith('SubmitGuess', 42.5);
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
});

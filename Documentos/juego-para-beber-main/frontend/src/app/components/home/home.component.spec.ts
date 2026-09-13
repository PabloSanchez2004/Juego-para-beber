import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HomeComponent } from './home.component';
import { RoomService } from '../../services/room.service';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { Subject } from 'rxjs';

describe('HomeComponent', () => {
  let component: HomeComponent;
  let fixture: ComponentFixture<HomeComponent>;
  let mockRoomService: jasmine.SpyObj<RoomService>;
  let mockRouter: jasmine.SpyObj<Router>;
  let routeParams: Record<string, string>;

  /** Crea el componente con los parámetros de ruta ya fijados (para /join/:roomId). */
  async function createComponent(params: Record<string, string> = {}): Promise<void> {
    TestBed.resetTestingModule();
    routeParams = params;
    const errorSubject = new Subject<string>();
    const gameStateSubject = new Subject<any>();

    mockRoomService = jasmine.createSpyObj(
      'RoomService',
      ['createRoom', 'joinRoom', 'connect', 'roomExists', 'forgetSession'],
      {
        error$: errorSubject.asObservable(),
        gameState$: gameStateSubject.asObservable(),
        localPlayer: null,
      },
    );
    mockRoomService.roomExists.and.returnValue(Promise.resolve(true));

    mockRouter = jasmine.createSpyObj('Router', ['navigate']);

    await TestBed.configureTestingModule({
      imports: [HomeComponent],
      providers: [
        { provide: RoomService, useValue: mockRoomService },
        { provide: Router, useValue: mockRouter },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap(routeParams) } },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(HomeComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await createComponent();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should start on main view', () => {
    expect(component.view()).toBe('main');
  });

  it('should switch to create view', () => {
    component.showCreate();
    expect(component.view()).toBe('create');
  });

  it('joining asks for the room code first', () => {
    component.showJoin();
    expect(component.view()).toBe('code');
  });

  it('should validate name: empty is invalid', () => {
    component.name.set('');
    expect(component.nameValid()).toBeFalse();
  });

  it('should validate name: single char is invalid', () => {
    component.name.set('A');
    expect(component.nameValid()).toBeFalse();
  });

  it('should validate name: 2+ chars is valid', () => {
    component.name.set('Ana');
    expect(component.nameValid()).toBeTrue();
  });

  it('should validate name: >20 chars is invalid', () => {
    component.name.set('A'.repeat(21));
    expect(component.nameValid()).toBeFalse();
  });

  it('should validate room code: 4 chars is valid', () => {
    component.roomCode.set('ABCD');
    expect(component.codeValid()).toBeTrue();
  });

  it('should validate room code: 3 chars is invalid', () => {
    component.roomCode.set('ABC');
    expect(component.codeValid()).toBeFalse();
  });

  it('should not call createRoom if name is invalid', async () => {
    component.name.set('A');
    await component.createRoom();
    expect(mockRoomService.createRoom).not.toHaveBeenCalled();
  });

  it('should call createRoom with trimmed name', async () => {
    component.name.set('  Ana  ');
    mockRoomService.createRoom.and.returnValue(Promise.resolve());
    await component.createRoom();
    expect(mockRoomService.createRoom).toHaveBeenCalledWith('Ana', 10);
  });

  it('should send the selected number of rounds when creating a room', async () => {
    component.name.set('Ana');
    component.maxRounds.set(3);
    mockRoomService.createRoom.and.returnValue(Promise.resolve());
    await component.createRoom();
    expect(mockRoomService.createRoom).toHaveBeenCalledWith('Ana', 3);
  });

  // ── Paso del código ──────────────────────────────────────────────────

  it('an existing code advances to the name step', async () => {
    component.showJoin();
    component.roomCode.set('ABCD');
    await component.checkCode();

    expect(mockRoomService.roomExists).toHaveBeenCalledWith('ABCD');
    expect(component.view()).toBe('name');
    expect(component.errorMsg()).toBe('');
  });

  it('a missing room keeps the user on the code step with an error', async () => {
    mockRoomService.roomExists.and.returnValue(Promise.resolve(false));
    component.showJoin();
    component.roomCode.set('ZZZZ');
    await component.checkCode();

    expect(component.view()).toBe('code');
    expect(component.errorMsg()).toContain('ZZZZ');
    expect(mockRoomService.joinRoom).not.toHaveBeenCalled();
  });

  it('going back from the name step returns to the code step', async () => {
    component.showJoin();
    component.roomCode.set('ABCD');
    await component.checkCode();
    component.back();
    expect(component.view()).toBe('code');
  });

  it('joins with the code and name already collected', async () => {
    mockRoomService.joinRoom.and.returnValue(Promise.resolve());
    component.showJoin();
    component.roomCode.set('abcd');
    await component.checkCode();
    component.name.set('  Bob ');
    await component.joinRoom();

    expect(mockRoomService.joinRoom).toHaveBeenCalledWith('ABCD', 'Bob');
  });

  // ── Enlace directo /join/:roomId ─────────────────────────────────────

  it('an invite link jumps straight to the name step with the code preloaded', async () => {
    await createComponent({ roomId: 'wxyz' });
    await fixture.whenStable();

    expect(component.fromInvite()).toBeTrue();
    expect(component.roomCode()).toBe('WXYZ');
    expect(component.view()).toBe('name');
  });

  it('an invite link to a dead room falls back to the code step', async () => {
    routeParams = { roomId: 'GONE' };
    await createComponent({ roomId: 'GONE' });
    mockRoomService.roomExists.and.returnValue(Promise.resolve(false));
    // Re-ejecutamos la entrada por invitación con la sala ya caída.
    component.ngOnInit();
    await fixture.whenStable();

    expect(component.view()).toBe('code');
    expect(component.errorMsg()).toContain('GONE');
  });

  it('going back from an invite returns to the main view, not to the code step', async () => {
    await createComponent({ roomId: 'ABCD' });
    await fixture.whenStable();
    component.back();
    expect(component.view()).toBe('main');
  });
});

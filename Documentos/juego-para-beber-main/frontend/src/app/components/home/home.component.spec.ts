import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HomeComponent } from './home.component';
import { RoomService } from '../../services/room.service';
import { Router } from '@angular/router';
import { Subject } from 'rxjs';

describe('HomeComponent', () => {
  let component: HomeComponent;
  let fixture: ComponentFixture<HomeComponent>;
  let mockRoomService: jasmine.SpyObj<RoomService>;
  let mockRouter: jasmine.SpyObj<Router>;

  beforeEach(async () => {
    const errorSubject = new Subject<string>();
    const gameStateSubject = new Subject<any>();

    mockRoomService = jasmine.createSpyObj('RoomService', ['createRoom', 'joinRoom', 'connect'], {
      error$: errorSubject.asObservable(),
      gameState$: gameStateSubject.asObservable(),
      localPlayer: null,
    });

    mockRouter = jasmine.createSpyObj('Router', ['navigate']);

    await TestBed.configureTestingModule({
      imports: [HomeComponent],
      providers: [
        { provide: RoomService, useValue: mockRoomService },
        { provide: Router, useValue: mockRouter },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(HomeComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
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

  it('should switch to join view', () => {
    component.showJoin();
    expect(component.view()).toBe('join');
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
    expect(mockRoomService.createRoom).toHaveBeenCalledWith('Ana', false);
  });

  it('should toggle alcoholFree', () => {
    expect(component.alcoholFree()).toBeFalse();
    component.toggleAlcoholFree();
    expect(component.alcoholFree()).toBeTrue();
    component.toggleAlcoholFree();
    expect(component.alcoholFree()).toBeFalse();
  });
});

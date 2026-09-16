import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import {
  ANSWER_HOLD_MS,
  FinalRevealComponent,
  REVEAL_STEP_MS,
  SETTLE_MS,
} from './final-reveal.component';
import { PodiumRow } from '../results/results.component';

/** Filas de peor a mejor, tal y como las entrega ResultsComponent. */
const rows: PodiumRow[] = [
  { player: player('p1', 'Ana', 30), place: 3, outcome: 'worst', comment: 'Ana, mal.', barPercent: 30, emoji: '🥉' },
  { player: player('p3', 'Carlos', 60), place: 2, outcome: 'mid', comment: 'Carlos, regular.', barPercent: 60, emoji: '🥈' },
  { player: player('p2', 'Bob', 100), place: 1, outcome: 'best', comment: 'Bob, crack.', barPercent: 100, emoji: '🥇' },
];

function player(playerId: string, name: string, score: number) {
  return {
    playerId,
    name,
    role: 'Estimator' as const,
    score,
    drinksOwed: 0,
    isConnected: true,
    alcoholFree: false,
    guess: null,
    isAdmin: false,
  };
}

describe('FinalRevealComponent', () => {
  let component: FinalRevealComponent;
  let fixture: ComponentFixture<FinalRevealComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FinalRevealComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(FinalRevealComponent);
    component = fixture.componentInstance;
    component.rows = rows;
    component.correctAnswer = 12742;
    component.question = '¿Diámetro de la Tierra en km?';
    component.bestNames = 'Bob';
    component.worstNames = 'Ana';
    component.myPlayerId = 'p2';
  });

  /** Evita que la preferencia real del navegador salte la ceremonia. */
  function withMotion(): void {
    spyOn(window, 'matchMedia').and.returnValue({ matches: false } as MediaQueryList);
  }

  it('should create', () => {
    withMotion();
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('opens on the correct answer alone, with no player card yet', () => {
    withMotion();
    fixture.detectChanges();

    expect(component.phase()).toBe('answer');
    expect(component.revealedCount()).toBe(0);

    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.answer-number')?.textContent).toContain('12.742');
    expect(el.querySelectorAll('.podium-row').length).toBe(0);
  });

  it('renders a full-screen overlay above the results view', () => {
    withMotion();
    fixture.detectChanges();

    const overlay = fixture.nativeElement.querySelector('.reveal-overlay') as HTMLElement;
    expect(overlay).toBeTruthy();

    const styles = getComputedStyle(overlay);
    expect(styles.position).toBe('fixed');
    expect(styles.zIndex).toBe('50');
    expect(styles.overflowY).not.toBe('hidden');
  });

  it('holds the answer for 3 seconds and then reveals the last place first', fakeAsync(() => {
    withMotion();
    fixture.detectChanges();

    tick(ANSWER_HOLD_MS - 1);
    fixture.detectChanges();
    expect(component.phase()).toBe('answer');

    tick(1);
    fixture.detectChanges();

    expect(component.phase()).toBe('revealing');
    expect(component.revealedCount()).toBe(1);
    expect(component.currentPlace()).toBe(3);

    const names = visibleNames();
    expect(names).toEqual(['Ana']);

    component.skip();
  }));

  it('reveals one player per step, in ascending order up to the champion', fakeAsync(() => {
    withMotion();
    fixture.detectChanges();

    tick(ANSWER_HOLD_MS);
    fixture.detectChanges();
    expect(visibleNames()).toEqual(['Ana']);

    tick(REVEAL_STEP_MS);
    fixture.detectChanges();
    // El nuevo se coloca encima: orden de leaderboard con el campeón arriba.
    expect(visibleNames()).toEqual(['Carlos', 'Ana']);

    tick(REVEAL_STEP_MS);
    fixture.detectChanges();
    expect(visibleNames()).toEqual(['Bob', 'Carlos', 'Ana']);
    expect(component.phase()).toBe('revealing');

    component.skip();
  }));

  it('the champion gets its own entrance animation', fakeAsync(() => {
    withMotion();
    fixture.detectChanges();

    tick(ANSWER_HOLD_MS + 2 * REVEAL_STEP_MS);
    fixture.detectChanges();

    const champion = fixture.nativeElement.querySelector('.champion-entrance');
    expect(champion).toBeTruthy();
    expect(champion.textContent).toContain('Bob');
    expect(champion.textContent).toContain('CAMPEÓN');

    component.skip();
  }));

  it('settles into the leaderboard and fills the bars from zero', fakeAsync(() => {
    withMotion();
    fixture.detectChanges();

    // Barras a 0 mientras se revela.
    tick(ANSWER_HOLD_MS + 2 * REVEAL_STEP_MS);
    fixture.detectChanges();
    expect(component.barsFilled()).toBeFalse();
    expect(barWidths()[0]).toBe('0%');

    tick(SETTLE_MS);
    fixture.detectChanges();
    expect(component.phase()).toBe('leaderboard');
    expect(component.barsFilled()).toBeFalse();

    tick(50);
    fixture.detectChanges();
    expect(component.barsFilled()).toBeTrue();
    expect(barWidths()).toEqual(['100%', '60%', '30%']);
  }));

  it('shows the final standing and the exit button only once everything is revealed', fakeAsync(() => {
    withMotion();
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).not.toContain('Terminar partida');

    tick(ANSWER_HOLD_MS + 2 * REVEAL_STEP_MS + SETTLE_MS + 50);
    fixture.detectChanges();

    expect(component.done()).toBeTrue();
    expect(el.textContent).toContain('Victoria');
    expect(el.textContent).toContain('Bob');
    expect(el.textContent).toContain('Terminar partida');
  }));

  it('skipping jumps straight to the finished leaderboard', () => {
    withMotion();
    fixture.detectChanges();

    component.skip();
    fixture.detectChanges();

    expect(component.phase()).toBe('leaderboard');
    expect(component.revealedCount()).toBe(3);
    expect(component.barsFilled()).toBeTrue();
    expect(visibleNames()).toEqual(['Bob', 'Carlos', 'Ana']);
  });

  it('emits finish when the player closes the ceremony', () => {
    withMotion();
    fixture.detectChanges();
    const spy = jasmine.createSpy('finish');
    component.finish.subscribe(spy);

    component.onFinish();
    expect(spy).toHaveBeenCalled();
  });

  it('skips the whole sequence when the system asks for reduced motion', () => {
    spyOn(window, 'matchMedia').and.returnValue({ matches: true } as MediaQueryList);
    fixture.detectChanges();

    expect(component.phase()).toBe('leaderboard');
    expect(component.barsFilled()).toBeTrue();
  });

  it('compacts the rows when the room is crowded', () => {
    withMotion();
    component.rows = Array.from({ length: 8 }, (_, i) => ({
      ...rows[0],
      player: player(`x${i}`, `J${i}`, 10 * (i + 1)),
      place: 8 - i,
    }));
    fixture.detectChanges();

    expect(component.compact()).toBeTrue();
  });

  it('allows skipping while the answer is still on screen', () => {
    withMotion();
    fixture.detectChanges();
    const skip = fixture.nativeElement.querySelector('[aria-label="Saltar la animación y ver la clasificación"]') as HTMLButtonElement;
    skip.click();
    expect(component.done()).toBeTrue();
  });

  it('prevents duplicate finish events while leaving the room', () => {
    withMotion();
    fixture.detectChanges();
    const finish = jasmine.createSpy('finish');
    component.finish.subscribe(finish);
    component.busy = true;
    component.onFinish();
    expect(finish).not.toHaveBeenCalled();
  });

  // ── Helpers ──────────────────────────────────────────────────────────

  function visibleNames(): string[] {
    return Array.from(
      fixture.nativeElement.querySelectorAll('.podium-name') as NodeListOf<HTMLElement>,
    ).map(p => (p.textContent ?? '').trim().replace(/\s*·\s*tú$/, ''));
  }

  function barWidths(): string[] {
    return Array.from(
      fixture.nativeElement.querySelectorAll('.podium-bar-fill') as NodeListOf<HTMLElement>,
    ).map(b => b.style.width);
  }
});

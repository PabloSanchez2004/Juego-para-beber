import { Component, OnInit, OnDestroy } from '@angular/core';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { CommonModule } from '@angular/common';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { pageview } from '@vercel/analytics';
import { Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';
import { RoomService } from './services/room.service';
import { GamePhase } from './models/game.models';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, CommonModule],
  template: `
    <div class="min-h-screen safe-top safe-bottom">
      <!-- Banner de reconexión -->
      @if (isReconnecting) {
        <div class="fixed top-0 left-0 right-0 z-50 bg-amber-400/95 text-ink-950
                    text-center py-2 px-4 text-sm font-semibold animate-pulse">
          🔄 Reconectando... No cierres la app
        </div>
      }

      <!-- Banner de error de conexión -->
      @if (connectionFailed) {
        <div class="fixed top-0 left-0 right-0 z-50 bg-red-600/90 text-white
                    text-center py-2 px-4 text-sm font-semibold">
          ❌ Sin conexión. Recarga la página para reintentar.
        </div>
      }

      <!-- Expulsado por el anfitrión -->
      @if (kickedMessage) {
        <div class="fixed top-0 left-0 right-0 z-[60] bg-red-600 text-white
                    text-center py-3 px-4 text-sm font-semibold shadow-elevated"
             role="alert">
          🚫 {{ kickedMessage }}
        </div>
      }

      <router-outlet />
    </div>
  `,
})
export class AppComponent implements OnInit, OnDestroy {
  isReconnecting = false;
  connectionFailed = false;
  kickedMessage = '';

  private subs = new Subscription();
  private kickedTimer: ReturnType<typeof setTimeout> | undefined;
  private updateTimer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private roomService: RoomService,
    private router: Router,
    private swUpdate: SwUpdate,
  ) {}

  ngOnInit(): void {
    this.setupAnalyticsPageViews();
    this.setupServiceWorkerUpdates();

    // Recarga de Vercel / bloqueo de pantalla: si hay sesión, reconectar ya.
    if (this.roomService.localPlayer && !window.location.pathname.startsWith('/join/')) {
      void this.roomService.connect().catch(err => {
        console.warn('[App] Conexión inicial fallida:', err);
      });
    }

    // Navegar automáticamente según el estado del juego
    this.subs.add(
      this.roomService.gameState$.subscribe(state => {
        if (!state) {
          if (!this.roomService.localPlayer && /^\/(lobby|game|results)(?:\/|$)/.test(this.router.url)) {
            this.router.navigate(['/']);
          }
          return;
        }
        this.navigateToPhase(state.phase);
      })
    );

    this.subs.add(
      this.roomService.connectionStatus$.subscribe(status => {
        this.isReconnecting = status === 'reconnecting';
        this.connectionFailed = status === 'failed';
      })
    );

    // Nos ha echado el anfitrión: fuera de la sala y aviso visible.
    this.subs.add(
      this.roomService.kicked$.subscribe(reason => {
        this.kickedMessage = reason;
        this.router.navigate(['/']);
        clearTimeout(this.kickedTimer);
        this.kickedTimer = setTimeout(() => (this.kickedMessage = ''), 6000);
      })
    );
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
    clearTimeout(this.kickedTimer);
    clearInterval(this.updateTimer);
  }

  private setupAnalyticsPageViews(): void {
    this.subs.add(
      this.router.events
        .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
        .subscribe(event => {
          pageview({
            path: this.currentRoutePattern(),
            route: this.currentRoutePattern(),
          });
        })
    );
  }

  private currentRoutePattern(): string {
    let snapshot = this.router.routerState.snapshot.root;
    const segments: string[] = [];

    while (snapshot.firstChild) {
      snapshot = snapshot.firstChild;
      if (snapshot.routeConfig?.path) {
        segments.push(snapshot.routeConfig.path);
      }
    }

    return segments.length ? `/${segments.join('/')}` : '/';
  }

  private setupServiceWorkerUpdates(): void {
    if (!this.swUpdate.isEnabled) return;

    this.subs.add(
      this.swUpdate.versionUpdates
        .pipe(filter((event): event is VersionReadyEvent => event.type === 'VERSION_READY'))
        .subscribe(() => {
          console.info('[PWA] Nueva versión lista. Se aplicará al volver a abrir el juego.');
        })
    );

    void this.swUpdate.checkForUpdate().catch(() => undefined);
    this.updateTimer = setInterval(() => {
      void this.swUpdate.checkForUpdate().catch(() => undefined);
    }, 60 * 60 * 1000);
  }

  private navigateToPhase(phase: GamePhase | number): void {
    const current = this.router.url;
    const phases: GamePhase[] = ['Lobby', 'WritingQuestion', 'CollectingGuesses', 'ShowingResults', 'Closed'];
    const normalized = typeof phase === 'number' ? phases[phase] : phase;

    switch (normalized) {
      case 'Lobby':
        if (!current.startsWith('/lobby')) this.router.navigate(['/lobby']);
        break;
      case 'WritingQuestion':
      case 'CollectingGuesses':
        if (!current.startsWith('/game')) this.router.navigate(['/game']);
        break;
      case 'ShowingResults':
        if (!current.startsWith('/results')) this.router.navigate(['/results']);
        break;
      case 'Closed':
        this.router.navigate(['/']);
        break;
    }
  }
}

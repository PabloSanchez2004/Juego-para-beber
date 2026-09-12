import { Component, OnInit, OnDestroy } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { RoomService } from './services/room.service';
import { GamePhase } from './models/game.models';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, CommonModule],
  template: `
    <div class="min-h-screen bg-gray-950 safe-top safe-bottom">
      <!-- Banner de reconexión -->
      @if (isReconnecting) {
        <div class="fixed top-0 left-0 right-0 z-50 bg-yellow-500/90 text-gray-950
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

      <router-outlet />
    </div>
  `,
})
export class AppComponent implements OnInit, OnDestroy {
  isReconnecting = false;
  connectionFailed = false;

  private subs = new Subscription();

  constructor(
    private roomService: RoomService,
    private router: Router,
  ) {}

  ngOnInit(): void {
    // Navegar automáticamente según el estado del juego
    this.subs.add(
      this.roomService.gameState$.subscribe(state => {
        if (!state) return;
        this.navigateToPhase(state.phase);
      })
    );

    this.subs.add(
      this.roomService.connectionStatus$.subscribe(status => {
        this.isReconnecting = status === 'reconnecting';
        this.connectionFailed = status === 'failed';
      })
    );
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
  }

  private navigateToPhase(phase: GamePhase): void {
    const current = this.router.url;

    switch (phase) {
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

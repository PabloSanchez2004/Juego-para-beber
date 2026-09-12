import {
  Component,
  OnInit,
  OnDestroy,
  signal,
  computed,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { RoomService } from '../../services/room.service';

type HomeView = 'main' | 'create' | 'join';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.scss'],
})
export class HomeComponent implements OnInit, OnDestroy {
  view = signal<HomeView>('main');

  // Formulario
  name = signal('');
  roomCode = signal('');
  alcoholFree = signal(false);
  maxRounds = signal(10);

  // Estado
  loading = signal(false);
  errorMsg = signal('');

  // Validaciones
  nameValid = computed(() => this.name().trim().length >= 2 && this.name().trim().length <= 20);
  codeValid = computed(() => this.roomCode().trim().length === 4);

  private subs = new Subscription();

  constructor(
    private roomService: RoomService,
    private router: Router,
  ) {}

  ngOnInit(): void {
    // Escuchar errores del servidor
    this.subs.add(
      this.roomService.error$.subscribe(msg => {
        this.errorMsg.set(msg);
        this.loading.set(false);
      })
    );

    // Si ya hay sesión activa, intentar reconectar
    if (this.roomService.localPlayer) {
      this.loading.set(true);
      this.roomService.connect().catch(() => {
        this.loading.set(false);
      });
    }
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
  }

  // ── Acciones ───────────────────────────────────────────────────────────

  showCreate(): void {
    this.view.set('create');
    this.errorMsg.set('');
  }

  showJoin(): void {
    this.view.set('join');
    this.errorMsg.set('');
  }

  back(): void {
    this.view.set('main');
    this.errorMsg.set('');
  }

  async createRoom(): Promise<void> {
    if (!this.nameValid() || this.loading()) return;

    this.loading.set(true);
    this.errorMsg.set('');

    try {
      await this.roomService.createRoom(this.name().trim(), this.alcoholFree());
      // La navegación la gestiona AppComponent vía gameState$
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[Home] createRoom failed:', err);
      this.errorMsg.set(message || 'No se pudo crear la sala. Inténtalo de nuevo.');
    } finally {
      this.loading.set(false);
    }
  }

  async joinRoom(): Promise<void> {
    if (!this.nameValid() || !this.codeValid() || this.loading()) return;

    this.loading.set(true);
    this.errorMsg.set('');

    try {
      await this.roomService.joinRoom(
        this.roomCode().trim().toUpperCase(),
        this.name().trim(),
        this.alcoholFree(),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[Home] joinRoom failed:', err);
      this.errorMsg.set(message || 'No se pudo unir a la sala. Inténtalo de nuevo.');
    } finally {
      this.loading.set(false);
    }
  }

  onCodeInput(event: Event): void {
    const val = (event.target as HTMLInputElement).value
      .toUpperCase()
      .replace(/[^A-Z]/g, '')
      .slice(0, 4);
    this.roomCode.set(val);
    (event.target as HTMLInputElement).value = val;
  }

  onNameInput(event: Event): void {
    this.name.set((event.target as HTMLInputElement).value);
  }

  toggleAlcoholFree(): void {
    this.alcoholFree.update(v => !v);
  }
}

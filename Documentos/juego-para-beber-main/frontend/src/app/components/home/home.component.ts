import {
  Component,
  OnInit,
  OnDestroy,
  signal,
  computed,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { RoomService } from '../../services/room.service';

/**
 * Pasos de entrada:
 *   main   → elegir crear o unirse
 *   create → nombre + rondas (el creador será el anfitrión)
 *   code   → código de sala; solo avanza si la sala existe
 *   name   → nombre, con el código ya fijado (flujo normal o enlace directo)
 */
export type HomeView = 'main' | 'create' | 'code' | 'name';

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
  maxRounds = signal(10);

  // Estado
  loading = signal(false);
  errorMsg = signal('');

  /** True si llegamos por un enlace /join/:roomId (no mostramos el paso del código). */
  fromInvite = signal(false);

  // Validaciones
  nameValid = computed(() => this.name().trim().length >= 2 && this.name().trim().length <= 20);
  codeValid = computed(() => /^[A-Z]{4}$/i.test(this.roomCode().trim()));

  private subs = new Subscription();

  constructor(
    private roomService: RoomService,
    private router: Router,
    private route: ActivatedRoute,
  ) {}

  ngOnInit(): void {
    // Escuchar errores del servidor
    this.subs.add(
      this.roomService.error$.subscribe(msg => {
        this.errorMsg.set(msg);
        this.loading.set(false);
      })
    );

    const invitedCode = this.readInviteCode();
    if (invitedCode) {
      void this.enterFromInvite(invitedCode);
      return;
    }

    // Si ya hay sesión activa, intentar reconectar
    if (this.roomService.localPlayer) {
      this.loading.set(true);
      this.roomService.connect().catch(() => undefined).finally(() => {
        this.loading.set(false);
      });
    }
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
  }

  // ── Navegación entre pasos ─────────────────────────────────────────────

  showCreate(): void {
    this.view.set('create');
    this.errorMsg.set('');
  }

  /** «Unirme»: primero el código, luego el nombre. */
  showJoin(): void {
    this.view.set('code');
    this.errorMsg.set('');
  }

  back(): void {
    // Desde el nombre se vuelve al código, salvo que el código venga en la URL.
    if (this.view() === 'name' && !this.fromInvite()) {
      this.view.set('code');
    } else {
      this.view.set('main');
      this.fromInvite.set(false);
    }
    this.errorMsg.set('');
  }

  // ── Acciones ───────────────────────────────────────────────────────────

  async createRoom(): Promise<void> {
    if (!this.nameValid() || this.loading()) return;

    this.loading.set(true);
    this.errorMsg.set('');

    try {
      await this.roomService.createRoom(this.name().trim(), this.maxRounds());
      // La navegación la gestiona AppComponent vía gameState$
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[Home] createRoom failed:', err);
      this.errorMsg.set(message || 'No se pudo crear la sala. Inténtalo de nuevo.');
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * Paso 1 del flujo normal: valida el código contra el servidor. Solo si la sala
   * existe pasamos a pedir el nombre, así el jugador no rellena datos en balde.
   */
  async checkCode(): Promise<void> {
    if (!this.codeValid() || this.loading()) return;

    this.loading.set(true);
    this.errorMsg.set('');

    try {
      const exists = await this.roomService.roomExists(this.roomCode().trim().toUpperCase());
      if (!exists) {
        this.errorMsg.set(`No existe ninguna sala con el código «${this.roomCode().toUpperCase()}».`);
        return;
      }
      this.view.set('name');
    } catch (err) {
      console.error('[Home] roomExists failed:', err);
      this.errorMsg.set('No se pudo comprobar el código. Revisa tu conexión.');
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
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[Home] joinRoom failed:', err);
      this.errorMsg.set(message || 'No se pudo unir a la sala. Inténtalo de nuevo.');
    } finally {
      this.loading.set(false);
    }
  }

  // ── Enlace directo ─────────────────────────────────────────────────────

  /** Código normalizado que viene en /join/:roomId, o '' si la ruta no lo trae. */
  private readInviteCode(): string {
    const raw = this.route.snapshot.paramMap.get('roomId') ?? '';
    return raw.trim().toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
  }

  /**
   * Entrada por invitación: fija el código y salta directo al nombre.
   * Si la sala no existe, cae al paso del código con el error explicado.
   */
  private async enterFromInvite(code: string): Promise<void> {
    this.fromInvite.set(true);
    this.roomCode.set(code);
    this.view.set('name');

    // Invitación a otra sala: soltamos la sesión previa o la reconexión
    // automática nos devolvería a la partida anterior.
    const session = this.roomService.localPlayer;
    if (session && session.roomCode && session.roomCode !== code) {
      this.roomService.forgetSession();
    }

    if (code.length !== 4) {
      this.fromInvite.set(false);
      this.view.set('code');
      this.errorMsg.set('El enlace de invitación no es válido. Escribe el código a mano.');
      return;
    }

    this.loading.set(true);
    try {
      const exists = await this.roomService.roomExists(code);
      if (!exists) {
        this.fromInvite.set(false);
        this.view.set('code');
        this.errorMsg.set(`La sala «${code}» ya no existe. Pide un código nuevo.`);
      }
    } catch (err) {
      console.warn('[Home] No se pudo validar el enlace de invitación:', err);
      // Sin conexión no bloqueamos: dejamos que lo intente al enviar el nombre.
    } finally {
      this.loading.set(false);
    }
  }

  // ── Inputs ─────────────────────────────────────────────────────────────

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
}

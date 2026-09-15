import { bootstrapApplication } from '@angular/platform-browser';
import { inject as injectVercelAnalytics } from '@vercel/analytics';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';
import { environment } from './environments/environment';

const SW_RESET_KEY = 'aproximados_sw_reset';
const SW_RESET_TOKEN = 'sw-reset-2026-09-12';

async function clearStaleServiceWorkers(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;

  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(registrations.map(registration => registration.unregister()));

  if ('caches' in window) {
    const keys = await caches.keys();
    await Promise.all(keys.map(key => caches.delete(key)));
  }
}

async function bootstrap(): Promise<void> {
  injectVercelAnalytics({
    framework: 'angular',
    disableAutoTrack: true,
    mode: environment.production ? 'production' : 'development',
  });

  const isProdHost = typeof location !== 'undefined' && !location.hostname.includes('localhost');

  if (isProdHost && localStorage.getItem(SW_RESET_KEY) !== SW_RESET_TOKEN) {
    console.warn('[PWA] Clearing stale service workers and caches');
    await clearStaleServiceWorkers();
    localStorage.setItem(SW_RESET_KEY, SW_RESET_TOKEN);
  }

  await bootstrapApplication(AppComponent, appConfig);
}

bootstrap().catch(err => console.error(err));
// Update trigger sáb 12 sep 2026 17:40:23 CEST

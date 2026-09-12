import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./components/home/home.component').then(m => m.HomeComponent),
  },
  {
    path: 'lobby',
    loadComponent: () =>
      import('./components/lobby/lobby.component').then(m => m.LobbyComponent),
  },
  {
    path: 'game',
    loadComponent: () =>
      import('./components/game/game.component').then(m => m.GameComponent),
  },
  {
    path: 'results',
    loadComponent: () =>
      import('./components/results/results.component').then(m => m.ResultsComponent),
  },
  {
    path: '**',
    redirectTo: '',
  },
];

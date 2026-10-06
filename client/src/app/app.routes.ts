import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    redirectTo: 'cruzamento',
  },
  {
    path: 'consulta',
    loadComponent: () => import('./features/consulta/consulta.page').then((m) => m.ConsultaPageComponent),
  },
  {
    path: 'cruzamento',
    loadComponent: () =>
      import('./features/cruzamento/cruzamento.page').then((m) => m.CruzamentoPageComponent),
  },
  {
    path: 'tutorial',
    loadComponent: () => import('./features/tutorial/tutorial.page').then((m) => m.TutorialPageComponent),
  },
  {
    path: 'sync',
    loadComponent: () => import('./features/sync/sync.page').then((m) => m.SyncPageComponent),
  },
  { path: '**', redirectTo: '' },
];

import { Routes } from '@angular/router';
import { PortalPage } from './portal-page';

export const routes: Routes = [
  { path: '', component: PortalPage },
  { path: 'admin', redirectTo: '', pathMatch: 'full' },
];

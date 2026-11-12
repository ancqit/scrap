import { Routes } from '@angular/router';
import { AdminPage } from './admin-page';
import { SlavePage } from './slave-page';

export const routes: Routes = [
  { path: '', component: SlavePage },
  { path: 'admin', component: AdminPage },
];

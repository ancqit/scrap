import { Component, inject } from '@angular/core';
import { AdminPage } from './admin-page';
import { LoginForm } from './login-form';
import { Session } from './session';
import { SlavePage } from './slave-page';

@Component({
  selector: 'app-portal-page',
  imports: [LoginForm, AdminPage, SlavePage],
  templateUrl: './portal-page.html',
})
export class PortalPage {
  protected readonly session = inject(Session);
}

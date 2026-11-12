import { Component, inject, signal } from '@angular/core';
import { SLAVE_PORTAL } from './portal-number';
import { Session } from './session';

@Component({
  selector: 'app-login-form',
  templateUrl: './login-form.html',
})
export class LoginForm {
  private readonly session = inject(Session);
  protected readonly slavePortal = SLAVE_PORTAL;
  protected readonly token = signal('');
  protected readonly busy = signal(false);
  protected readonly notice = signal<{ kind: 'ok' | 'err'; text: string } | null>(null);

  protected onToken(event: Event): void {
    const target = event.target;
    this.token.set(target instanceof HTMLInputElement ? target.value : '');
  }

  /** Click the slave number and drop it into the login, same gesture as herbant. */
  protected fillSlave(): void {
    this.token.set(this.slavePortal);
  }

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    const token = this.token().trim();
    if (!token || this.busy()) return;
    this.busy.set(true);
    this.notice.set(null);
    try {
      await this.session.login(token);
    } catch (error) {
      this.notice.set({ kind: 'err', text: error instanceof Error ? error.message : 'Login failed.' });
    } finally {
      this.busy.set(false);
    }
  }
}

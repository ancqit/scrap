import { Injectable, inject, signal } from '@angular/core';
import { R2Service } from './r2';

const ROLE_KEY = 'scrap.role';
const TOKEN_KEY = 'scrap.uploadToken';

export type PortalRole = 'admin' | 'slave';

@Injectable({ providedIn: 'root' })
export class Session {
  private readonly r2 = inject(R2Service);
  readonly role = signal<PortalRole | ''>(readRole());
  readonly token = signal(readFlag(TOKEN_KEY));

  async login(token: string): Promise<void> {
    const role = await this.r2.login(token);
    this.role.set(role);
    this.token.set(token);
    writeFlag(ROLE_KEY, role);
    writeFlag(TOKEN_KEY, token);
  }

  logout(): void {
    this.role.set('');
    this.token.set('');
    writeFlag(ROLE_KEY, '');
    writeFlag(TOKEN_KEY, '');
  }
}

function readRole(): PortalRole | '' {
  const value = readFlag(ROLE_KEY);
  return value === 'admin' || value === 'slave' ? value : '';
}

function readFlag(key: string): string {
  try {
    return sessionStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function writeFlag(key: string, value: string): void {
  try {
    if (!value) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {
    // The value still lives in memory for this page.
  }
}

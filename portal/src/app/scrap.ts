import { Injectable, signal } from '@angular/core';
import { SLAVE_PORTAL } from './portal-number';

export interface Scrap {
  id: string;
  title: string;
  portal: typeof SLAVE_PORTAL;
  key: string;
  contentType: string;
  createdAt: string;
}

const STORAGE_KEY = 'scrap.store.v1';

@Injectable({ providedIn: 'root' })
export class ScrapStore {
  private readonly scraps = signal<Scrap[]>(readScraps());
  readonly items = this.scraps.asReadonly();

  add(scrap: Scrap): void {
    this.scraps.update((items) => [scrap, ...items]);
    this.persist();
  }

  remove(id: string): void {
    this.scraps.update((items) => items.filter((item) => item.id !== id));
    this.persist();
  }

  private persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.scraps()));
    } catch {
      // Private mode can reject storage. The in-memory list still works.
    }
  }
}

function readScraps(): Scrap[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isScrap);
  } catch {
    return [];
  }
}

function isScrap(value: unknown): value is Scrap {
  if (!value || typeof value !== 'object') return false;
  const scrap = value as Record<string, unknown>;
  return (
    typeof scrap['id'] === 'string' &&
    typeof scrap['title'] === 'string' &&
    scrap['portal'] === SLAVE_PORTAL &&
    typeof scrap['key'] === 'string' &&
    scrap['key'].startsWith(`${SLAVE_PORTAL}/`) &&
    typeof scrap['contentType'] === 'string' &&
    typeof scrap['createdAt'] === 'string'
  );
}

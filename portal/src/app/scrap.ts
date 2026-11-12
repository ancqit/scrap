import { Injectable, inject, signal } from '@angular/core';
import { R2Service } from './r2';
import { SLAVE_PORTAL } from './portal-number';

export interface ScrapFile {
  objectKey: string;
  url: string;
  contentType: string;
  filename: string;
}

export interface Scrap {
  id: string;
  type: string;
  price: number;
  currency: 'INR';
  portal: typeof SLAVE_PORTAL;
  pictures: ScrapFile[];
  documents: ScrapFile[];
  createdAt: string;
}

const STORAGE_KEY = 'scrap.store.v1';

@Injectable({ providedIn: 'root' })
export class ScrapStore {
  private readonly r2 = inject(R2Service);
  private readonly scraps = signal<Scrap[]>(readScraps());
  readonly items = this.scraps.asReadonly();

  async refresh(): Promise<void> {
    try {
      const items = await this.r2.listScraps();
      this.scraps.set(items);
      this.persist();
    } catch {
      // Keep the last catalog when the worker is down.
    }
  }

  add(scrap: Scrap): void {
    this.scraps.update((items) => [scrap, ...items.filter((item) => item.id !== scrap.id)]);
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
    typeof scrap['type'] === 'string' &&
    typeof scrap['price'] === 'number' &&
    scrap['currency'] === 'INR' &&
    scrap['portal'] === SLAVE_PORTAL &&
    Array.isArray(scrap['pictures']) &&
    Array.isArray(scrap['documents']) &&
    scrap['pictures'].length <= 3 &&
    scrap['documents'].length <= 5 &&
    (scrap['pictures'].length > 0 || scrap['documents'].length > 0)
  );
}

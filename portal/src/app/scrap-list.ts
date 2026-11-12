import { Component, inject, input } from '@angular/core';
import { R2Service } from './r2';
import { ScrapCard } from './scrap-card';
import { ScrapStore } from './scrap';

const TOKEN_KEY = 'scrap.uploadToken';

@Component({
  selector: 'app-scrap-list',
  imports: [ScrapCard],
  templateUrl: './scrap-list.html',
})
export class ScrapList {
  readonly removable = input(false);
  protected readonly store = inject(ScrapStore);
  private readonly r2 = inject(R2Service);

  protected async onRemove(id: string): Promise<void> {
    if (this.removable()) {
      try {
        await this.r2.deleteScrap(id, sessionToken());
      } catch {
        // Still drop the card if the worker is unreachable.
      }
    }
    this.store.remove(id);
  }
}

function sessionToken(): string {
  try {
    return sessionStorage.getItem(TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
}

import { DatePipe } from '@angular/common';
import { Component, DestroyRef, effect, inject, input, output, signal } from '@angular/core';
import { R2Service } from './r2';
import { Scrap } from './scrap';

@Component({
  selector: 'app-scrap-card',
  imports: [DatePipe],
  templateUrl: './scrap-card.html',
})
export class ScrapCard {
  readonly scrap = input.required<Scrap>();
  readonly removable = input(false);
  readonly removed = output<string>();

  protected readonly imageUrl = signal<string | null>(null);
  protected readonly imageError = signal(false);

  private readonly r2 = inject(R2Service);
  private readonly destroyRef = inject(DestroyRef);
  private destroyed = false;

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.destroyed = true;
    });

    effect(() => {
      const key = this.scrap().key;
      this.imageUrl.set(null);
      this.imageError.set(false);
      void this.load(key);
    });
  }

  private async load(key: string): Promise<void> {
    try {
      const url = await this.r2.imageUrl(key);
      if (!this.destroyed && this.scrap().key === key) this.imageUrl.set(url);
    } catch {
      if (!this.destroyed && this.scrap().key === key) this.imageError.set(true);
    }
  }
}

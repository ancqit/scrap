import { CurrencyPipe, DatePipe } from '@angular/common';
import { Component, input, output, signal } from '@angular/core';
import { Scrap } from './scrap';

@Component({
  selector: 'app-scrap-card',
  imports: [CurrencyPipe, DatePipe],
  templateUrl: './scrap-card.html',
})
export class ScrapCard {
  readonly scrap = input.required<Scrap>();
  readonly removable = input(false);
  readonly removed = output<string>();

  protected readonly failed = signal<ReadonlySet<string>>(new Set());

  protected failedPicture(key: string): boolean {
    return this.failed().has(key);
  }

  protected onPictureError(key: string): void {
    this.failed.update((current) => new Set(current).add(key));
  }
}

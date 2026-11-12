import { Component, inject, input } from '@angular/core';
import { ScrapCard } from './scrap-card';
import { ScrapStore } from './scrap';

@Component({
  selector: 'app-scrap-list',
  imports: [ScrapCard],
  templateUrl: './scrap-list.html',
})
export class ScrapList {
  readonly removable = input(false);
  protected readonly store = inject(ScrapStore);
}

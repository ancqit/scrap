import { Component, inject } from '@angular/core';
import { PortalNumberField } from './portal-number-field';
import { ScrapList } from './scrap-list';
import { ScrapStore } from './scrap';

@Component({
  selector: 'app-slave-page',
  imports: [PortalNumberField, ScrapList],
  templateUrl: './slave-page.html',
})
export class SlavePage {
  private readonly store = inject(ScrapStore);

  constructor() {
    void this.store.refresh();
  }
}

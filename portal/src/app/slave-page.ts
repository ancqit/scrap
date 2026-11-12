import { Component } from '@angular/core';
import { PortalNumberField } from './portal-number-field';
import { ScrapList } from './scrap-list';

@Component({
  selector: 'app-slave-page',
  imports: [PortalNumberField, ScrapList],
  templateUrl: './slave-page.html',
})
export class SlavePage {}

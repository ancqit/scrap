import { Component, output, signal } from '@angular/core';
import { SLAVE_PORTAL } from './portal-number';

@Component({
  selector: 'app-portal-number-field',
  templateUrl: './portal-number-field.html',
})
export class PortalNumberField {
  protected readonly slavePortal = SLAVE_PORTAL;
  protected readonly value = signal('');
  readonly filled = output<string>();

  /** Click the slave number and drop it into the input, same gesture as herbant. */
  protected populate(): void {
    this.value.set(SLAVE_PORTAL);
    this.filled.emit(SLAVE_PORTAL);
  }
}

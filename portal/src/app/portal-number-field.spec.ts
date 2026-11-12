import { TestBed } from '@angular/core/testing';
import { PortalNumberField } from './portal-number-field';

describe('PortalNumberField', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PortalNumberField],
    }).compileComponents();
  });

  it('fills the input with the slave number when the number is clicked', async () => {
    const fixture = TestBed.createComponent(PortalNumberField);
    await fixture.whenStable();

    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    expect(input.value).toBe('');

    const button = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    expect(button.textContent?.trim()).toBe('2001');
    button.click();
    await fixture.whenStable();

    expect(input.value).toBe('2001');
    expect(fixture.nativeElement.textContent).not.toContain('1001');
  });
});

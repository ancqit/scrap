import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { PortalPage } from './portal-page';
import { R2Service } from './r2';

describe('PortalPage', () => {
  const r2 = {
    login: vi.fn(async (token: string) => (token === 'desk-token' ? 'admin' : 'slave')),
    scrapTypes: vi.fn(async () => ['bikes']),
    listScraps: vi.fn(async () => []),
    upload: vi.fn(),
    createScrap: vi.fn(),
    deleteScrap: vi.fn(),
  };

  beforeEach(async () => {
    localStorage.clear();
    sessionStorage.clear();
    r2.login.mockClear();
    await TestBed.configureTestingModule({
      imports: [PortalPage],
      providers: [{ provide: R2Service, useValue: r2 }],
    }).compileComponents();
  });

  it('logs the slave portal in from the 2001 button and hides the admin desk', async () => {
    const fixture = TestBed.createComponent(PortalPage);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('h1')?.textContent).toContain('Log in');
    expect(root.textContent).not.toContain('Create scrap');
    expect(root.textContent).not.toContain('1001');

    (root.querySelector('button[type="button"]') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect((root.querySelector('input[name="token"]') as HTMLInputElement).value).toBe('2001');
    (root.querySelector('button[type="submit"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(root.querySelector('h1')?.textContent).toContain('Scraps'));
    expect(root.textContent).not.toContain('Create scrap');
    expect(root.textContent).not.toContain('Delete');
  });

  it('opens the admin desk only for the admin token', async () => {
    const fixture = TestBed.createComponent(PortalPage);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    const token = root.querySelector('input[name="token"]') as HTMLInputElement;
    token.value = 'desk-token';
    token.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    (root.querySelector('button[type="submit"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(root.textContent).toContain('Create scrap'));
    expect(root.querySelector('fieldset.section legend')?.textContent).toBe('Scrap');
  });
});

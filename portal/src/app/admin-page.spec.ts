import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { AdminPage } from './admin-page';
import { routes } from './app.routes';
import { R2Service } from './r2';
import { Scrap, ScrapStore } from './scrap';

describe('AdminPage', () => {
  const picture = (slot: string): Scrap['pictures'][number] => ({
    objectKey: `2001/scraps/id/pictures/${slot}.jpg`,
    url: `https://cdn.example/${slot}.jpg`,
    contentType: 'image/jpeg',
    filename: `${slot}.jpg`,
  });

  const created: Scrap = {
    id: 's1',
    type: 'bikes',
    price: 18500,
    currency: 'INR',
    portal: '2001',
    pictures: [picture('1'), picture('2'), picture('3')],
    documents: [
      {
        objectKey: '2001/scraps/id/documents/rc.pdf',
        url: 'https://cdn.example/rc.pdf',
        contentType: 'application/pdf',
        filename: 'rc.pdf',
      },
    ],
    createdAt: '2026-11-12T00:00:00.000Z',
  };

  const r2 = {
    login: vi.fn(async () => undefined),
    scrapTypes: vi.fn(async () => ['bikes']),
    upload: vi.fn(async (_file: File, _token: string, kind: string, slot: number) => picture(`${kind}-${slot}`)),
    createScrap: vi.fn(
      async (
        _token: string,
        _draft: { type: string; price: number; pictures: unknown[]; documents: unknown[] },
      ) => created,
    ),
    deleteScrap: vi.fn(async () => undefined),
    listScraps: vi.fn(async () => []),
  };

  beforeEach(async () => {
    localStorage.clear();
    sessionStorage.clear();
    r2.login.mockClear();
    r2.upload.mockClear();
    r2.createScrap.mockClear();
    await TestBed.configureTestingModule({
      imports: [AdminPage],
      providers: [provideRouter(routes), { provide: R2Service, useValue: r2 }],
    }).compileComponents();
  });

  it('logs in, then creates a bike scrap with 3 pictures and a document', async () => {
    const fixture = TestBed.createComponent(AdminPage);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('select[name="scrap-type"]')).toBeNull();
    expect(root.textContent).not.toContain('1001');

    const token = root.querySelector('input[name="token"]') as HTMLInputElement;
    token.value = 'desk-token';
    token.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    (root.querySelector('button[type="submit"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(root.querySelector('select[name="scrap-type"]')).toBeTruthy());

    const select = root.querySelector('select[name="scrap-type"]') as HTMLSelectElement;
    expect(select.value).toBe('bikes');
    expect(select.textContent).toContain('bikes');
    expect(root.querySelectorAll('input[data-kind="picture"]')).toHaveLength(3);
    expect(root.querySelectorAll('input[data-kind="document"]')).toHaveLength(5);
    expect((root.querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(true);

    const price = root.querySelector('input[name="price"]') as HTMLInputElement;
    price.value = '18500';
    price.dispatchEvent(new Event('input'));
    attach(root, 'picture', 'image/jpeg', 'jpg');
    attach(root, 'document', 'application/pdf', 'pdf', 1);
    await fixture.whenStable();
    expect((root.querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(false);

    (root.querySelector('button[type="submit"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(root.textContent).toContain('Scrap created'));
    expect(r2.upload).toHaveBeenCalledTimes(4);
    expect(r2.createScrap).toHaveBeenCalledOnce();
    expect(r2.createScrap).toHaveBeenCalledWith(
      'desk-token',
      expect.objectContaining({
        type: 'bikes',
        price: 18500,
        pictures: expect.any(Array),
        documents: expect.any(Array),
      }),
    );
    const draft = r2.createScrap.mock.calls[0]?.[1];
    expect(draft.pictures).toHaveLength(3);
    expect(draft.documents).toHaveLength(1);
    expect(TestBed.inject(ScrapStore).items()[0]?.type).toBe('bikes');
    expect(root.textContent).toContain('bikes');
    expect(root.textContent).not.toContain('1001');
  });
});

function attach(root: HTMLElement, kind: string, type: string, extension: string, count = 3): void {
  const inputs = [...root.querySelectorAll(`input[data-kind="${kind}"]`)].slice(0, count);
  for (const input of inputs) {
    const file = new File(['abc'], `file.${extension}`, { type });
    Object.defineProperty(input, 'files', { value: fileList(file) });
    input.dispatchEvent(new Event('change'));
  }
}

function fileList(file: File): FileList {
  return {
    0: file,
    length: 1,
    item: (index: number) => (index === 0 ? file : null),
  } as unknown as FileList;
}

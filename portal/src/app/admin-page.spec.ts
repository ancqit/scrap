import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { AdminPage } from './admin-page';
import { routes } from './app.routes';
import { R2Service } from './r2';
import { ScrapStore } from './scrap';

describe('AdminPage', () => {
  const r2 = {
    upload: vi.fn(async () => ({ key: '2001/scraps/id-plate.jpg', contentType: 'image/jpeg' })),
    imageUrl: vi.fn(async (key: string) => `https://cdn.example/${key}`),
  };

  beforeEach(async () => {
    localStorage.clear();
    sessionStorage.clear();
    r2.upload.mockClear();
    await TestBed.configureTestingModule({
      imports: [AdminPage],
      providers: [provideRouter(routes), { provide: R2Service, useValue: r2 }],
    }).compileComponents();
  });

  it('uploads only after the slave number is clicked into the field', async () => {
    const fixture = TestBed.createComponent(AdminPage);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    const submit = root.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(root.textContent).not.toContain('1001');

    const title = root.querySelector('input[name="title"]') as HTMLInputElement;
    title.value = 'Brass tag';
    title.dispatchEvent(new Event('input'));

    const fileInput = root.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['abc'], 'plate.jpg', { type: 'image/jpeg' });
    Object.defineProperty(fileInput, 'files', { value: fileList(file) });
    fileInput.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    expect(submit.disabled).toBe(true);

    (root.querySelector('.portal-field button') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect((root.querySelector('input[name="portal"]') as HTMLInputElement).value).toBe('2001');
    expect(submit.disabled).toBe(false);

    submit.click();
    await vi.waitFor(() => expect(root.textContent).toContain('Uploaded.'));
    expect(r2.upload).toHaveBeenCalledOnce();
    expect(TestBed.inject(ScrapStore).items()[0]?.key).toBe('2001/scraps/id-plate.jpg');
    expect(root.textContent).not.toContain('1001');
  });
});

function fileList(file: File): FileList {
  return {
    0: file,
    length: 1,
    item: (index: number) => (index === 0 ? file : null),
  } as unknown as FileList;
}

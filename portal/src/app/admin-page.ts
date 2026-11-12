import { Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { PortalNumberField } from './portal-number-field';
import { SLAVE_PORTAL } from './portal-number';
import { R2Service } from './r2';
import { ScrapStore } from './scrap';
import { ScrapList } from './scrap-list';

const TOKEN_KEY = 'scrap.uploadToken';

@Component({
  selector: 'app-admin-page',
  imports: [PortalNumberField, ScrapList],
  templateUrl: './admin-page.html',
})
export class AdminPage {
  private readonly r2 = inject(R2Service);
  protected readonly store = inject(ScrapStore);
  private readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('fileInput');

  protected readonly portal = signal('');
  protected readonly title = signal('');
  protected readonly token = signal(readToken());
  protected readonly file = signal<File | null>(null);
  protected readonly busy = signal(false);
  protected readonly notice = signal<{ kind: 'ok' | 'err'; text: string } | null>(null);

  protected readonly canUpload = computed(
    () =>
      this.portal() === SLAVE_PORTAL &&
      this.title().trim().length > 0 &&
      this.file() !== null &&
      !this.busy(),
  );

  protected onTitle(event: Event): void {
    this.title.set(eventValue(event));
  }

  protected onToken(event: Event): void {
    const value = eventValue(event);
    this.token.set(value);
    try {
      sessionStorage.setItem(TOKEN_KEY, value);
    } catch {
      // The token still lives in memory for this page.
    }
  }

  protected onFile(event: Event): void {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    this.file.set(input.files?.item(0) ?? null);
  }

  protected async upload(event: Event): Promise<void> {
    event.preventDefault();
    const file = this.file();
    if (!file || !this.canUpload()) return;

    this.busy.set(true);
    this.notice.set(null);
    try {
      const stored = await this.r2.upload(file, this.token());
      this.store.add({
        id: crypto.randomUUID(),
        title: this.title().trim(),
        portal: SLAVE_PORTAL,
        key: stored.key,
        contentType: stored.contentType,
        createdAt: new Date().toISOString(),
      });
      this.title.set('');
      this.file.set(null);
      const input = this.fileInput()?.nativeElement;
      if (input) input.value = '';
      this.notice.set({ kind: 'ok', text: 'Uploaded.' });
    } catch (error) {
      const text = error instanceof Error ? error.message : 'Upload failed.';
      this.notice.set({ kind: 'err', text });
    } finally {
      this.busy.set(false);
    }
  }
}

function eventValue(event: Event): string {
  const target = event.target;
  return target instanceof HTMLInputElement ? target.value : '';
}

function readToken(): string {
  try {
    return sessionStorage.getItem(TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
}

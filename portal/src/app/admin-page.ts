import { Component, computed, inject, signal } from '@angular/core';
import { R2Service } from './r2';
import { ScrapList } from './scrap-list';
import { ScrapFile, ScrapStore } from './scrap';
import { Session } from './session';

const PICTURE_SLOTS = [0, 1, 2] as const;
const DOCUMENT_SLOTS = [0, 1, 2, 3, 4] as const;

@Component({
  selector: 'app-admin-page',
  imports: [ScrapList],
  templateUrl: './admin-page.html',
})
export class AdminPage {
  private readonly r2 = inject(R2Service);
  private readonly session = inject(Session);
  protected readonly store = inject(ScrapStore);

  protected readonly pictureSlots = PICTURE_SLOTS;
  protected readonly documentSlots = DOCUMENT_SLOTS;
  protected readonly types = signal<string[]>(['bikes']);
  protected readonly typeChoice = signal('bikes');
  protected readonly typeName = signal('bikes');
  protected readonly price = signal<number | null>(null);
  protected readonly pictures = signal<(File | null)[]>([null, null, null]);
  protected readonly documents = signal<(File | null)[]>([null, null, null, null, null]);
  protected readonly busy = signal(false);
  protected readonly notice = signal<{ kind: 'ok' | 'err'; text: string } | null>(null);

  protected readonly canCreate = computed(() => {
    const price = this.price();
    return (
      this.typeName().trim().length > 1 &&
      price !== null &&
      price >= 0 &&
      (this.pictures().some((file) => file !== null) || this.documents().some((file) => file !== null)) &&
      !this.busy()
    );
  });

  constructor() {
    void this.loadTypes();
  }

  protected onTypeChoice(event: Event): void {
    const value = eventValue(event);
    this.typeChoice.set(value);
    if (value !== 'other') this.typeName.set(value);
  }

  protected onTypeName(event: Event): void {
    const value = eventValue(event);
    this.typeName.set(value);
    this.typeChoice.set(this.types().includes(value) ? value : 'other');
  }

  protected onPrice(event: Event): void {
    const raw = eventValue(event);
    if (raw.trim() === '') {
      this.price.set(null);
      return;
    }
    const price = Number(raw);
    this.price.set(Number.isFinite(price) ? price : null);
  }

  protected onSlot(kind: 'picture' | 'document', index: number, event: Event): void {
    const input = event.target;
    const file = input instanceof HTMLInputElement ? (input.files?.item(0) ?? null) : null;
    const update = (slots: (File | null)[]) => slots.map((current, slot) => (slot === index ? file : current));
    if (kind === 'picture') this.pictures.update(update);
    else this.documents.update(update);
  }

  protected async create(event: Event): Promise<void> {
    event.preventDefault();
    if (!this.canCreate()) return;
    const price = this.price();
    if (price === null) return;
    const pictures = this.pictures().filter((file): file is File => file !== null);
    const documents = this.documents().filter((file): file is File => file !== null);
    this.busy.set(true);
    this.notice.set(null);
    try {
      const scrapId = crypto.randomUUID();
      const uploadedPictures = await this.uploadAll(pictures, 'picture', scrapId);
      const uploadedDocuments = await this.uploadAll(documents, 'document', scrapId);
      const scrap = await this.r2.createScrap(this.session.token(), {
        type: this.typeName().trim(),
        price,
        pictures: uploadedPictures,
        documents: uploadedDocuments,
      });
      this.store.add(scrap);
      if (!this.types().includes(scrap.type)) this.types.update((types) => [...types, scrap.type]);
      this.notice.set({ kind: 'ok', text: 'Scrap created. It is on the 2001 cards.' });
    } catch (error) {
      this.notice.set({ kind: 'err', text: error instanceof Error ? error.message : 'Could not create the scrap.' });
    } finally {
      this.busy.set(false);
    }
  }

  private async uploadAll(files: File[], kind: 'picture' | 'document', scrapId: string): Promise<ScrapFile[]> {
    const uploaded: ScrapFile[] = [];
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      if (!file) continue;
      uploaded.push(await this.r2.upload(file, this.session.token(), kind, index + 1, scrapId));
    }
    return uploaded;
  }

  private async loadTypes(): Promise<void> {
    try {
      const types = await this.r2.scrapTypes();
      const next = ['bikes'];
      for (const type of types) {
        const clean = type.trim();
        if (clean && !next.includes(clean)) next.push(clean);
      }
      this.types.set(next);
      if (!next.includes(this.typeName())) this.typeChoice.set('other');
    } catch {
      this.types.set(['bikes']);
    }
  }
}

function eventValue(event: Event): string {
  const target = event.target;
  return target instanceof HTMLInputElement || target instanceof HTMLSelectElement ? target.value : '';
}

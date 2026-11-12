import { Injectable } from '@angular/core';
import {
  isAllowedDocument,
  isAllowedImage,
  MAX_DOCUMENT_BYTES,
  MAX_IMAGE_BYTES,
  scrapFileKey,
} from './object-key';
import { SLAVE_PORTAL } from './portal-number';
import type { Scrap, ScrapFile } from './scrap';
import { WORKER_URL } from './worker-url';

type UploadKind = 'picture' | 'document';

interface SignedObject {
  url: string;
  key: string;
  headers?: Record<string, string>;
  contentType?: string;
}

@Injectable({ providedIn: 'root' })
export class R2Service {
  async login(token: string): Promise<void> {
    const response = await this.post('/admin/login', { token });
    if (!response.ok) throw new Error(await errorMessage(response));
  }

  async scrapTypes(): Promise<string[]> {
    const response = await this.post('/scrap-types', undefined, 'GET');
    if (!response.ok) throw new Error(await errorMessage(response));
    const body = (await response.json()) as { types?: unknown };
    if (!Array.isArray(body.types)) return ['bikes'];
    return body.types.filter((type): type is string => typeof type === 'string');
  }

  async upload(
    file: File,
    token: string,
    kind: UploadKind = 'picture',
    slot = 1,
    scrapId?: string,
  ): Promise<ScrapFile> {
    const picture = kind === 'picture';
    if (picture ? !isAllowedImage(file.type) : !isAllowedDocument(file.type)) {
      throw new Error(
        picture ? 'Pictures must be JPEG, PNG, WebP, or GIF.' : 'Documents must be PDF or an image.',
      );
    }
    const limit = picture ? MAX_IMAGE_BYTES : MAX_DOCUMENT_BYTES;
    if (file.size > limit) {
      throw new Error(picture ? 'Pictures must be 5 MB or smaller.' : 'Documents must be 10 MB or smaller.');
    }

    const signed = await this.sign(
      '/get-upload-url',
      {
        key: scrapFileKey(picture ? 'pictures' : 'documents', slot, file.name, scrapId || crypto.randomUUID()),
        contentType: file.type,
        kind,
      },
      token,
    );
    if (!signed.key.startsWith(`${SLAVE_PORTAL}/`)) {
      throw new Error('The upload worker returned an unexpected key.');
    }

    let put: Response;
    try {
      put = await fetch(signed.url, {
        method: 'PUT',
        headers: signed.headers ?? { 'Content-Type': file.type },
        body: file,
      });
    } catch {
      throw new Error('The bucket could not be reached.');
    }
    if (!put.ok) throw new Error('The bucket rejected the upload.');
    return {
      objectKey: signed.key,
      url: '',
      contentType: signed.contentType || file.type,
      filename: file.name,
    };
  }

  async createScrap(
    token: string,
    draft: { type: string; price: number; pictures: ScrapFile[]; documents: ScrapFile[] },
  ): Promise<Scrap> {
    const response = await this.post(
      '/scraps',
      {
        type: draft.type,
        price: draft.price,
        pictures: draft.pictures.map(wireFile),
        documents: draft.documents.map(wireFile),
      },
      'POST',
      token,
    );
    if (!response.ok) throw new Error(await errorMessage(response));
    const body = (await response.json()) as { scrap?: unknown };
    const scrap = asScrap(body.scrap);
    if (!scrap) throw new Error('The upload worker returned an unexpected response.');
    return scrap;
  }

  async listScraps(): Promise<Scrap[]> {
    const response = await this.post('/scraps', undefined, 'GET');
    if (!response.ok) throw new Error(await errorMessage(response));
    const body = (await response.json()) as { scraps?: unknown };
    if (!Array.isArray(body.scraps)) return [];
    return body.scraps.flatMap((item) => {
      const scrap = asScrap(item);
      return scrap ? [scrap] : [];
    });
  }

  async deleteScrap(id: string, token: string): Promise<void> {
    const response = await this.post(`/scraps/${encodeURIComponent(id)}`, undefined, 'DELETE', token);
    if (!response.ok && response.status !== 404) throw new Error(await errorMessage(response));
  }

  private async sign(path: string, body: object, token = ''): Promise<SignedObject> {
    const response = await this.post(path, body, 'POST', token);
    if (!response.ok) throw new Error(await errorMessage(response));
    const payload = (await response.json()) as {
      url?: unknown;
      upload_url?: unknown;
      key?: unknown;
      object_key?: unknown;
      headers?: Record<string, string>;
      content_type?: unknown;
    };
    const url = typeof payload.upload_url === 'string' ? payload.upload_url : payload.url;
    const key = typeof payload.object_key === 'string' ? payload.object_key : payload.key;
    if (typeof url !== 'string' || typeof key !== 'string') {
      throw new Error('The upload worker returned an unexpected response.');
    }
    return {
      url,
      key,
      headers: payload.headers,
      contentType: typeof payload.content_type === 'string' ? payload.content_type : undefined,
    };
  }

  private async post(path: string, body: object | undefined, method = 'POST', token = ''): Promise<Response> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers['Authorization'] = `Bearer ${token}`;
    try {
      return await fetch(`${WORKER_URL}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new Error('The upload worker is unreachable.');
    }
  }
}

function wireFile(file: ScrapFile): Record<string, string> {
  return { object_key: file.objectKey, content_type: file.contentType, filename: file.filename };
}

function asScrap(value: unknown): Scrap | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const pictures = asFiles(record['pictures']);
  const documents = asFiles(record['documents']);
  if (
    typeof record['id'] !== 'string' ||
    typeof record['type'] !== 'string' ||
    typeof record['price'] !== 'number' ||
    pictures.length !== 3
  ) {
    return null;
  }
  return {
    id: record['id'],
    type: record['type'],
    price: record['price'],
    currency: 'INR',
    portal: SLAVE_PORTAL,
    pictures,
    documents,
    createdAt: typeof record['created_at'] === 'string' ? record['created_at'] : new Date().toISOString(),
  };
}

function asFiles(value: unknown): ScrapFile[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const record = item as Record<string, unknown>;
    if (typeof record['object_key'] !== 'string' || typeof record['url'] !== 'string') return [];
    return [
      {
        objectKey: record['object_key'],
        url: record['url'],
        contentType: typeof record['content_type'] === 'string' ? record['content_type'] : '',
        filename: typeof record['filename'] === 'string' ? record['filename'] : 'file',
      },
    ];
  });
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === 'string' && body.error.length > 0 && body.error.length < 200) {
      return body.error;
    }
  } catch {
    // Fall through to the generic message.
  }
  return 'The bucket request failed.';
}

import { Injectable } from '@angular/core';
import { isAllowedImage, MAX_IMAGE_BYTES, scrapObjectKey } from './object-key';
import { SLAVE_PORTAL } from './portal-number';
import { WORKER_URL } from './worker-url';

interface SignedObject {
  url: string;
  key: string;
  headers?: Record<string, string>;
}

@Injectable({ providedIn: 'root' })
export class R2Service {
  async upload(file: File, token: string): Promise<{ key: string; contentType: string }> {
    if (!isAllowedImage(file.type)) {
      throw new Error('Use a JPEG, PNG, WebP, or GIF image.');
    }
    if (file.size > MAX_IMAGE_BYTES) {
      throw new Error('Images must be 10 MB or smaller.');
    }

    const contentType = file.type;
    const signed = await this.sign(
      '/get-upload-url',
      { key: scrapObjectKey(file.name, crypto.randomUUID()), contentType },
      token,
    );
    if (!signed.key.startsWith(`${SLAVE_PORTAL}/`)) {
      throw new Error('The upload worker returned an unexpected key.');
    }

    let put: Response;
    try {
      put = await fetch(signed.url, {
        method: 'PUT',
        headers: signed.headers ?? { 'Content-Type': contentType },
        body: file,
      });
    } catch {
      throw new Error('The bucket could not be reached.');
    }
    if (!put.ok) throw new Error('The bucket rejected the upload.');
    return { key: signed.key, contentType };
  }

  async imageUrl(key: string): Promise<string> {
    const signed = await this.sign('/get-download-url', { key, visibility: 'public' });
    return signed.url;
  }

  private async sign(path: string, body: object, token = ''): Promise<SignedObject> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    let response: Response;
    try {
      response = await fetch(`${WORKER_URL}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
    } catch {
      throw new Error('The upload worker is unreachable.');
    }
    if (!response.ok) throw new Error(await errorMessage(response));

    const payload = (await response.json()) as Partial<SignedObject>;
    if (typeof payload.url !== 'string' || typeof payload.key !== 'string') {
      throw new Error('The upload worker returned an unexpected response.');
    }
    return { url: payload.url, key: payload.key, headers: payload.headers };
  }
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

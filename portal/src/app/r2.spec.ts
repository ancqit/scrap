import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { R2Service } from './r2';
import { WORKER_URL } from './worker-url';

describe('R2Service', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('asks the worker for a signed url and puts the file straight to that url', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (calls.length === 1) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              url: 'https://account.r2.cloudflarestorage.com/scrap-images/2001/scraps/a.jpg?X-Amz-Signature=abc',
              key: '2001/scraps/a.jpg',
              headers: { 'content-type': 'image/jpeg' },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        );
      }
      return Promise.resolve(new Response(null, { status: 200 }));
    });

    const service = TestBed.inject(R2Service);
    const file = new File([new Uint8Array([1, 2, 3])], 'Photo.JPG', { type: 'image/jpeg' });
    const stored = await service.upload(file, 'desk-token');

    expect(stored.key).toBe('2001/scraps/a.jpg');
    expect(calls[0]?.url).toBe(`${WORKER_URL}/get-upload-url`);
    expect(calls[0]?.init?.method).toBe('POST');
    expect(new Headers(calls[0]?.init?.headers).get('authorization')).toBe('Bearer desk-token');
    expect(String(calls[0]?.init?.body)).not.toContain('test-secret');
    expect(calls[1]?.url).toContain('r2.cloudflarestorage.com');
    expect(calls[1]?.init?.method).toBe('PUT');
    expect(calls[1]?.init?.body).toBe(file);
  });

  it('refuses a file that is not an image before calling the worker', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const service = TestBed.inject(R2Service);
    const file = new File(['<svg></svg>'], 'icon.svg', { type: 'image/svg+xml' });
    await expect(service.upload(file, '')).rejects.toThrow(/JPEG, PNG, WebP, or GIF/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

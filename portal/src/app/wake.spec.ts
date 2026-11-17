import { HEALTH_EVERY_MS, armWake, HERBACK_HEALTH, type WakeTarget } from './wake';

function target(): WakeTarget & { visibilityState: DocumentVisibilityState; fire(): void } {
  let listener = (): void => undefined;
  return {
    visibilityState: 'visible',
    addEventListener(_type: 'visibilitychange', next: () => void) {
      listener = next;
    },
    fire() {
      listener();
    },
  };
}

describe('armWake', () => {
  beforeEach(() => {
    jasmine.clock().install();
  });

  afterEach(() => {
    jasmine.clock().uninstall();
  });

  it('calls herback health as soon as the page opens', async () => {
    const calls: Array<{ url: string; cache?: RequestCache }> = [];
    const stop = armWake(target(), async (url, init) => {
      calls.push({ url, cache: init?.cache });
      return new Response('ok');
    });
    stop();
    await Promise.resolve();
    expect(calls).toEqual([{ url: HERBACK_HEALTH, cache: 'no-store' }]);
  });

  it('calls herback health again after 60 seconds', async () => {
    const calls: string[] = [];
    const stop = armWake(target(), async (url) => {
      calls.push(url);
      return new Response('ok');
    });

    jasmine.clock().tick(HEALTH_EVERY_MS);
    stop();
    await Promise.resolve();
    expect(calls).toEqual([HERBACK_HEALTH, HERBACK_HEALTH]);
  });

  it('calls herback again when the page becomes visible', async () => {
    const calls: string[] = [];
    const page = target();
    const stop = armWake(page, async (url) => {
      calls.push(url);
      return new Response('ok');
    });
    page.visibilityState = 'hidden';
    page.fire();
    page.visibilityState = 'visible';
    page.fire();
    stop();
    await Promise.resolve();
    expect(calls).toEqual([HERBACK_HEALTH, HERBACK_HEALTH]);
  });

  it('keeps the page going when herback is still asleep', () => {
    const stop = armWake(target(), () => Promise.reject(new Error('offline')));
    expect(() => stop()).not.toThrow();
  });
});

import { TestBed } from '@angular/core/testing';
import { SLAVE_PORTAL } from './portal-number';
import { Scrap, ScrapStore } from './scrap';

const scrap: Scrap = {
  id: '1',
  title: 'Copper tag',
  portal: SLAVE_PORTAL,
  key: '2001/scraps/1-tag.jpg',
  contentType: 'image/jpeg',
  createdAt: '2026-11-12T00:00:00.000Z',
};

describe('ScrapStore', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('keeps scraps in local storage and drops records for any other portal', () => {
    localStorage.setItem(
      'scrap.store.v1',
      JSON.stringify([
        scrap,
        { ...scrap, id: '2', portal: '1001', key: '1001/scraps/hidden.jpg' },
      ]),
    );

    const store = TestBed.inject(ScrapStore);
    expect(store.items()).toEqual([scrap]);

    store.add({ ...scrap, id: '3', title: 'Brass' });
    store.remove('1');

    const saved = JSON.parse(localStorage.getItem('scrap.store.v1') ?? '[]') as Scrap[];
    expect(saved.map((item) => item.id)).toEqual(['3']);
  });
});

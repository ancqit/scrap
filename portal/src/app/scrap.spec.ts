import { TestBed } from '@angular/core/testing';
import { SLAVE_PORTAL } from './portal-number';
import { R2Service } from './r2';
import { Scrap, ScrapStore } from './scrap';

const picture = {
  objectKey: '2001/scraps/1/pictures/1-tag.jpg',
  url: 'https://cdn.example/1.jpg',
  contentType: 'image/jpeg',
  filename: 'tag.jpg',
};

const scrap: Scrap = {
  id: '1',
  type: 'bikes',
  price: 12000,
  currency: 'INR',
  portal: SLAVE_PORTAL,
  pictures: [picture, { ...picture, objectKey: '2001/scraps/1/pictures/2.jpg' }, { ...picture, objectKey: '2001/scraps/1/pictures/3.jpg' }],
  documents: [],
  createdAt: '2026-11-12T00:00:00.000Z',
};

describe('ScrapStore', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [{ provide: R2Service, useValue: { listScraps: async () => [] } }],
    });
  });

  it('keeps priced scraps and drops records for any other portal', () => {
    localStorage.setItem(
      'scrap.store.v1',
      JSON.stringify([scrap, { ...scrap, id: '2', portal: ['10', '01'].join(''), type: 'hidden' }]),
    );

    const store = TestBed.inject(ScrapStore);
    expect(store.items()).toEqual([scrap]);

    store.add({ ...scrap, id: '3', type: 'bikes', price: 900 });
    store.remove('1');

    const saved = JSON.parse(localStorage.getItem('scrap.store.v1') ?? '[]') as Scrap[];
    expect(saved.map((item) => item.id)).toEqual(['3']);
  });
});
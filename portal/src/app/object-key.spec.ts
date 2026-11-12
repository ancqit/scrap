import { scrapObjectKey } from './object-key';

describe('scrapObjectKey', () => {
  it('drops path segments and odd characters from the file name', () => {
    expect(scrapObjectKey('../Album/My Photo.JPG', 'abc')).toBe('scraps/abc-my-photo.jpg');
  });
});

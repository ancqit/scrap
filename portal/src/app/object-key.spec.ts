import { scrapFileKey } from './object-key';

describe('scrapFileKey', () => {
  it('drops path segments and odd characters from the file name', () => {
    expect(scrapFileKey('pictures', 1, '../Album/My Photo.JPG', 'abc')).toBe(
      'scraps/abc/pictures/1-my-photo.jpg',
    );
  });
});
import { RESERVED_SLUGS, SLUG_PATTERN, slugify } from './slugify';

describe('slugify', () => {
  it.each([
    ['Comédie romantique', 'comedie-romantique'],
    ['  Science-Fiction  ', 'science-fiction'],
    ['Drame & Crime!!', 'drame-crime'],
    ['Été 2026', 'ete-2026'],
    ['ÇA', 'ca'],
  ])('%s -> %s', (input, expected) => {
    expect(slugify(input)).toBe(expected);
    expect(slugify(input)).toMatch(SLUG_PATTERN);
  });

  it('treats names that differ only by case or accents as the same key', () => {
    expect(slugify('Comédie')).toBe(slugify('comedie'));
  });

  it('returns an empty string when nothing usable is left', () => {
    expect(slugify('!!!')).toBe('');
    expect(slugify('   ')).toBe('');
  });

  it('reserves the slugs used by static category routes', () => {
    expect(RESERVED_SLUGS).toEqual(expect.arrayContaining(['all', 'order']));
  });
});

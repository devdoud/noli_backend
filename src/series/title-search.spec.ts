import {
  accentInsensitivePattern,
  normalizeSearch,
  stripAccents,
} from './title-search';

// The pattern is run here with the same 'i' option Mongo receives.
const matches = (query: string, title: string) =>
  new RegExp(accentInsensitivePattern(query), 'i').test(title);

describe('title search (dashboard spec 0009, AC-2)', () => {
  it('ignores case', () => {
    expect(matches('mensah', 'Le Secret du Docteur Mensah')).toBe(true);
    expect(matches('MENSAH', 'Le Secret du Docteur Mensah')).toBe(true);
  });

  it('ignores accents both ways', () => {
    expect(matches('comedie', 'Comédie romantique')).toBe(true);
    expect(matches('comédie', 'Comedie romantique')).toBe(true);
    expect(matches('ÉPISODE', 'un épisode')).toBe(true);
    expect(matches('garcon', 'Le garçon')).toBe(true);
    expect(matches('noel', 'Noël à Lomé')).toBe(true);
  });

  it('finds a title stored with decomposed accents', () => {
    expect(matches('comedie', 'Comédie')).toBe(true);
    expect(matches('comédie', 'Comédie')).toBe(true);
  });

  it('is a contains search and does not match other words', () => {
    expect(matches('secret', 'Le Secret du Docteur')).toBe(true);
    expect(matches('drame', 'Le Secret du Docteur')).toBe(false);
  });

  it('treats special characters as plain text', () => {
    for (const special of [
      '(',
      ')',
      '*',
      '?',
      '\\',
      ']',
      '[',
      '.',
      '+',
      '$',
      '^',
      '|',
    ]) {
      expect(() => accentInsensitivePattern(special)).not.toThrow();
      expect(
        () => new RegExp(accentInsensitivePattern(special), 'i'),
      ).not.toThrow();
    }
    expect(matches('a.c', 'abc')).toBe(false);
    expect(matches('a.c', 'a.c')).toBe(true);
    expect(matches('(1)', 'Saison (1)')).toBe(true);
    expect(matches('a\\]e', 'a\\]e')).toBe(true);
  });

  it('never turns an escaped character into an accent class', () => {
    expect(accentInsensitivePattern('\\e')).toBe('\\\\[eéèêëEÉÈÊË][̀-ͯ]*');
  });

  it('never writes a \\u escape, which MongoDB (PCRE2) rejects', () => {
    expect(accentInsensitivePattern('Comédie à Cotonou (2)')).not.toContain(
      '\\u',
    );
  });

  it('collapses spaces and trims the ends', () => {
    expect(normalizeSearch('  le   secret ')).toBe('le secret');
    expect(matches('  le   secret ', 'Le secret')).toBe(true);
  });

  it('strips accents', () => {
    expect(stripAccents('Éléonore')).toBe('Eleonore');
  });
});

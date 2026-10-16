// Admin title search (dashboard spec 0009): "contains", ignoring case and
// accents. The typed text never acts as a regex: it is escaped first, then
// each letter that has accented forms becomes a class of those forms, in both
// cases so the match does not depend on how the database folds non ASCII
// letters. Every letter may be followed by combining marks, so a title stored
// in decomposed form (e + U+0301) matches too.

const ACCENTED: Readonly<Record<string, string>> = {
  a: 'aàâäáãåAÀÂÄÁÃÅ',
  c: 'cçCÇ',
  e: 'eéèêëEÉÈÊË',
  i: 'iîïíìIÎÏÍÌ',
  o: 'oôöóòõOÔÖÓÒÕ',
  u: 'uùûüúUÙÛÜÚ',
  y: 'yÿYŸ',
};

// Real characters in the pattern, never a \u escape: MongoDB's PCRE2 rejects it.
const COMBINING_MARKS = '[̀-ͯ]*';

export function normalizeSearch(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

export function stripAccents(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function escapeChar(char: string): string {
  return /[.*+?^${}()|[\]\\]/.test(char) ? `\\${char}` : char;
}

export function accentInsensitivePattern(query: string): string {
  return Array.from(stripAccents(normalizeSearch(query)))
    .map((char) => {
      const forms = ACCENTED[char.toLowerCase()];
      if (forms !== undefined) return `[${forms}]${COMBINING_MARKS}`;
      if (/[a-z]/i.test(char)) return `${char}${COMBINING_MARKS}`;
      return escapeChar(char);
    })
    .join('');
}

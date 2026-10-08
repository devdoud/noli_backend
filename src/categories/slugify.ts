export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// Slugs that would collide with static routes on the categories controller.
export const RESERVED_SLUGS = ['all', 'order'];

// "Comédie romantique" -> "comedie-romantique". Also used as the uniqueness key
// for names, so "Comédie" and "comedie" count as the same category.
export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// What the browser remembers between visits: the last project viewed and a picked theme.

export const LAST = 'codebase-trends:project';
export const THEME = 'codebase-trends:theme'; // the head of page.html and index.html reads it too, to apply a picked theme before the first paint
// Storage throws when the browser blocks it; remembering is optional. A null value forgets.
export const remembered = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
export const remember = (key: string, value: string | null): void => {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {}
};

// ---- three layers of explanation: one question on the page; a definition as the hover gloss of every label that uses
// it; and the help panel at the foot, listing the definitions and the data's provenance, opened by any jump into it ----
import { $, el, ext } from './dom.ts';
import { span } from './format.ts';
import { ROLL } from './metrics.ts';
import type { Model } from './model.ts';
import { required } from './required.ts';

export const FIX = 'Fixes %';
export const SIZE = 'Commit size';

/** A defined term: its name and its definition. */
export type Def = [name: string, text: string];
export type DefId = 'counted' | 'added' | 'fix' | 'versions' | 'lines' | 'window';
/** The terms this page defines; `versions` and `lines` depend on the basis. */
export type Defs = { [id in DefId]?: Def };
/** A link on `text` to the definition `id`: its gloss on hover, its help entry on click. */
export type Term = (id: DefId, text: string) => HTMLAnchorElement;

/** The page's one question, under the title. */
export function renderLede(m: Model): void {
  $('lede').textContent =
    `How much of ${m.summary.name}'s work each week is new capability, and how much is correction?`;
}

export function buildDefs({ changelog, noun, what, setAside, last, ref }: Model): Defs {
  const aside = changelog
    ? 'items that announce rather than change something'
    : 'maintenance commits (chores, tests, docs, CI) and unreadable subjects';
  const one = changelog ? 'A changelog item' : 'A commit';
  return {
    // id → [name, definition]; each is the gloss of its term links and one entry of the help dialog
    counted: [
      noun,
      `${one} counts when it added, fixed, changed (including improved) or removed something (including reverts). ` +
        `Not counted: ${setAside.toLocaleString('en-US')} ${aside}.`,
    ],
    added: ['New features / week', `${noun} that added something, per week.`],
    fix: [
      FIX,
      `(fixed + reverts) ÷ ${what}. On the chart, each week is pooled with the ${ROLL - 1} before it, so one quiet week does not swing the line.`,
    ],
    ...(changelog
      ? { versions: ['Versions released / week', 'npm releases of the package, per week.'] }
      : {
          lines: [
            SIZE,
            'Median lines added + deleted per commit, against its first parent. A median ignores one sweeping commit. Commits with no recorded size are left out.',
          ],
        }),
    window: [
      'Window and prior period',
      `Each tile covers the last ${last.length} complete week${last.length === 1 ? '' : 's'}${last.length ? ` (${span(last)})` : ''}; ` +
        `the line under it compares with the ${ROLL} weeks before${ref.length ? ` (${span(ref)})` : ''}. Weeks start Monday 00:00 UTC.`,
    ],
  };
}

export const termLink = (defs: Defs, id: DefId, text: string): HTMLAnchorElement => {
  const [name, def] = required(defs[id], `definition ${id}`);
  return el('a', { className: 'term', href: `#fn-${id}`, title: `${name}: ${def}`, textContent: text });
};

const isDefId = (defs: Defs, id: string): id is DefId => id in defs;

/** Opens the help dialog at the entry `id`, marked and scrolled to; without one, from the top. */
function openHelp(id?: string): void {
  const help = $('help', HTMLDialogElement);
  if (!help.open) help.showModal();
  for (const d of $('defs').children) d.classList.toggle('current', d.id === `fn-${id}`);
  if (id) $(`fn-${id}`).scrollIntoView({ block: 'center' });
  else help.scrollTop = 0;
}

/** Fills the help dialog's definitions and makes the (i) button, term links and #fn-… links open it. */
export function setUpHelp(defs: Defs): void {
  $('defs').replaceChildren(
    ...Object.entries(defs).map(([id, [name, text]]) =>
      el('div', { id: `fn-${id}` }, el('dt', { textContent: name }), el('dd', { textContent: text })),
    ),
  );
  const help = $('help', HTMLDialogElement);
  // A term link opens the dialog itself rather than jumping to its hash, so a day deep link (#YYYY-MM-DD) in the URL survives.
  document.addEventListener('click', (e) => {
    const a = e.target instanceof Element ? e.target.closest('a.term') : null;
    if (a instanceof HTMLAnchorElement) {
      e.preventDefault();
      openHelp(a.hash.slice(4));
    }
  });
  $('info').addEventListener('click', () => openHelp());
  $('help-close').addEventListener('click', () => help.close());
  help.addEventListener('click', (e) => {
    if (e.target === help) help.close();
  }); // the backdrop; the body fills the dialog, so only it is the target there
  help.addEventListener('close', () => {
    if (/^#fn-/.test(location.hash)) history.replaceState(null, '', location.pathname);
  }); // a shared #fn-… link, once read, should not reopen on reload
  const fromHelpHash = (): void => {
    const m = /^#fn-(\w+)$/.exec(location.hash);
    if (m && isDefId(defs, m[1])) openHelp(m[1]);
  };
  fromHelpHash(); // a shared #fn-… link: the entries exist only now
  addEventListener('hashchange', fromHelpHash);
}

// ---- provenance, the second half of the help panel ----
const repoName = (url: string): string => url.replace(/^https?:\/\/(www\.)?/, '').replace(/\.git$/, '');
const lead = (text: string): HTMLElement => el('b', { textContent: `${text} ` });

export function renderProvenance({ project, changelog, what }: Model): void {
  const source = project.source; // the one public URL the build publishes per project
  $('about-body').replaceChildren(
    el(
      'p',
      {},
      lead('Source.'),
      ...(changelog
        ? [
            'One item per bullet of ',
            source ? ext(source, 'CHANGELOG.md') : 'the changelog',
            ", dated by the version's npm publish time.",
          ]
        : [
            'One item per commit on the main branch of ',
            source ? ext(source, repoName(source)) : 'the repository',
            ', dated by commit time.',
          ]),
    ),
    el(
      'p',
      {},
      lead('Categories.'),
      `Each ${what.replace(/s$/, '')} gets one category from its wording: added, fixed, changed or removed. A language model decides when the wording does not say.`,
    ),
    el('p', {}, lead('Updates.'), 'Collected every six hours. The header shows when the data last changed.'),
  );
}

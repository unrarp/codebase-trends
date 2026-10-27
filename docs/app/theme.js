// The theme button: cycles auto → light → dark and remembers the pick.
import { $ } from './dom.ts';
import { remember, THEME } from './storage.ts';
// The button cycles through these; the current one is the root's data-theme, absent for auto (the OS decides).
// Icons are SVG in the text colour: font glyphs for them render tiny or as emoji, depending on the platform.
const icon = (body)=>`<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">${body}</svg>`;
const THEMES = [
    {
        key: 'auto',
        icon: icon('<circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 2a6 6 0 0 1 0 12z" fill="currentColor"/>')
    },
    {
        key: 'light',
        icon: icon('<circle cx="8" cy="8" r="3" fill="currentColor"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6 13 13M3 13l1.4-1.4M11.6 4.4 13 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>')
    },
    {
        key: 'dark',
        icon: icon('<path d="M13.5 9.8A5.8 5.8 0 0 1 6.2 2.5a5.8 5.8 0 1 0 7.3 7.3z" fill="currentColor"/>')
    }
];
const root = document.documentElement;
const current = ()=>THEMES.findIndex((t)=>t.key === (root.dataset.theme ?? 'auto'));
const nextTheme = ()=>THEMES[(current() + 1) % THEMES.length];
const showTheme = ()=>{
    const t = THEMES[current()];
    const label = `Theme: ${t.key}. Click for ${nextTheme().key}.`;
    Object.assign($('theme'), {
        innerHTML: t.icon,
        title: label,
        ariaLabel: label
    });
};
/** Shows the current theme on the button and makes a click switch to the next; `onChange` runs after each switch. */ export function setUpThemeButton(onChange) {
    showTheme();
    $('theme').addEventListener('click', ()=>{
        const { key } = nextTheme();
        if (key === 'auto') delete root.dataset.theme;
        else root.dataset.theme = key;
        remember(THEME, key === 'auto' ? null : key);
        showTheme();
        onChange();
    });
}
//# sourceMappingURL=theme.js.map

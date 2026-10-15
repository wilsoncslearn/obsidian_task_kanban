// Design parameters checked by the layout tests.
// Invariants (nothing overlaps, stays aligned, scrolls when needed, no horizontal overflow) stay in the tests;
// design choices live here, so a design change updates one place instead of literals spread across tests.
// Layout pages also receive these values as window.LUBI_DESIGN (see page.mjs) for checks that run in the browser.
export const DESIGN = Object.freeze({
  minFontPx: 11,           // smallest visible text
  minContrast: 4.5,        // WCAG AA text contrast in light and dark themes
  touchTargetPx: 44,       // personal time entries on the narrow timeline
  actionHeightPx: 32,      // review queue action buttons
  compactSettingRowPx: 52, // desktop category rows stay on one line
});

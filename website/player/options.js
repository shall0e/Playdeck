// Shared launch validation and settings choices for every game.
export const PERFORMANCE_OPTIONS = Object.freeze({
  full: 'Full resolution (default)',
  auto: 'Automatic performance',
  fast: 'Maximum speed (softer image)',
  native: 'Native rendering',
});
export const PERFORMANCE_MODES = Object.freeze(Object.keys(PERFORMANCE_OPTIONS));
export const DISPLAY_RATIOS = Object.freeze(['auto', '4:3', '16:9', '16:10', '21:9', '1:1']);

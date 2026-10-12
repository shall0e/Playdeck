import { DISPLAY_RATIOS } from './options.js';
import { iconMarkup } from './toolbar-icons.js';
export const displayCSS = `
.game-display {
  position: absolute;
  bottom: 12px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 4;
  font:
    15px system-ui,
    sans-serif;
  color: #e0e4dc;
  color-scheme: dark;
}
.game-display summary {
  cursor: pointer;
  list-style: none;
  border: 0;
  outline: 0;
  padding: 9px 13px;
  border-radius: 10px;
  background: rgba(25, 28, 25, 0.58);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  box-shadow: 0 4px 18px #0003;
  color: #e0e4dc;
  font-size: 12px;
  transition: background 0.18s;
}
.game-display summary:hover,
.game-display summary:focus-visible {
  background: rgba(45, 49, 43, 0.72);
}
.game-display summary::-webkit-details-marker {
  display: none;
}
.game-display .display-panel {
  position: absolute;
  bottom: 46px;
  left: 50%;
  transform: translateX(-50%);
  width: min(340px, calc(100vw - 24px));
  max-height: 80vh;
  overflow: auto;
  border: 0;
  border-radius: 14px;
  padding: 20px;
  background: rgba(25, 28, 25, 0.68);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
  box-shadow: 0 8px 30px #0004;
  scrollbar-width: thin;
  scrollbar-color: #ffffff30 transparent;
}
.game-display header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 12px;
}
.game-display h2 {
  font:
    700 15px system-ui,
    sans-serif;
  letter-spacing: normal;
  margin: 0;
}
.game-display label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin: 12px 0;
  font-size: 13px;
}
.game-display select,
.game-display button {
  font:
    13px system-ui,
    sans-serif;
  color: inherit;
  border: 0;
  border-radius: 10px;
  background: rgba(110, 120, 106, 0.19);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  padding: 9px 14px;
}
.game-display button {
  cursor: pointer;
}
.game-display button:hover {
  background: rgba(140, 150, 136, 0.3);
}
.game-display select {
  max-width: 160px;
}
.game-display option {
  background: #191c19;
  color: #e0e4dc;
}
.game-display :focus-visible {
  outline: 2px solid #bdc3b9;
  outline-offset: 2px;
}
`;
export const displayMarkup =
  '<summary aria-label="Game display settings">' +
  iconMarkup('monitor') +
  '<span>Display</span></summary><section class="display-panel" aria-label="Display settings"><header><h2>Game display</h2></header><label>Ratio<select aria-label="Game aspect ratio" data-display-ratio></select></label></section>';
export function displayConfig(value) {
  if (value === null || value === false || value === undefined) return null;
  if (value !== true && (typeof value !== 'object' || Array.isArray(value)))
    throw new Error('Invalid display configuration');
  const config = value === true ? {} : value,
    supported = DISPLAY_RATIOS,
    ratios = config.ratios || supported;
  if (!Array.isArray(ratios) || !ratios.length || ratios.some((r) => !supported.includes(r)))
    throw new Error('Invalid display ratios');
  const ratio =
      config.ratio || config.defaultRatio || (ratios.includes('16:9') ? '16:9' : ratios[0]),
    mode = 'stretch';
  if (!ratios.includes(ratio)) throw new Error('Invalid display selection');
  return { ratios: [...new Set(ratios)], ratio, mode };
}

export function canvasDisplayBox(width, height, ratio = '16:9') {
  if (ratio === '16:9' || ratio === 'auto') return { width, height, left: 0, top: 0 };
  const [x, y] = ratio.split(':').map(Number),
    aspect = x / y;
  if (!(aspect > 0)) return { width, height, left: 0, top: 0 };
  const h = Math.min(height, width / aspect),
    w = h * aspect;
  return { width: w, height: h, left: (width - w) / 2, top: (height - h) / 2 };
}

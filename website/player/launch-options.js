import { PERFORMANCE_MODES, DISPLAY_RATIOS } from './options.js';
import { displayConfig } from './display.js';
export function readLaunchOptions(params, referrer = '') {
  const flag = (key) => {
    if (!params.has(key)) return undefined;
    const value = params.get(key).toLowerCase();
    if (['', 'true', '1'].includes(value)) return true;
    if (['false', '0'].includes(value)) return false;
    throw new Error('Invalid ' + key);
  };
  const enumValue = (key, values) => {
    const value = params.get(key);
    if (value === null) return undefined;
    if (!values.includes(value)) throw new Error('Invalid ' + key);
    return value;
  };
  let displayOptions = null;
  if (params.has('displayOptions')) {
    const value = params.get('displayOptions');
    displayOptions = ['', 'true', '1'].includes(value)
      ? true
      : ['false', '0'].includes(value)
        ? false
        : JSON.parse(value);
  }
  displayConfig(displayOptions);
  let parentOrigin = null;
  if (params.has('parentOrigin')) {
    const url = new URL(params.get('parentOrigin'));
    if (
      !['https:', 'http:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.href !== url.origin + '/'
    )
      throw new Error('Invalid parentOrigin');
    parentOrigin = url.origin;
  } else if (referrer) {
    const url = new URL(referrer);
    if (['https:', 'http:'].includes(url.protocol)) parentOrigin = url.origin;
  }
  return {
    displayOptions,
    parentOrigin,
    nativeGamepad: flag('nativeGamepad') === true,
    forceController: flag('forceController'),
    hidePageExtras: flag('hidePageExtras'),
    performance: enumValue('performance', PERFORMANCE_MODES),
    toolbar: enumValue('toolbar', ['auto', 'visible']),
    ratio: enumValue('ratio', DISPLAY_RATIOS),
  };
}

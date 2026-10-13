// Panic preferences are global. Forced controller mapping is strictly per game.
const STORAGE = 'playdeck.settings.v1';
export const defaults = {
  forceController: false,
  appearance: 'glass',
  panicURL: 'https://docs.google.com/',
  panicBind: { code: 'Backquote', ctrl: false, alt: false, shift: false, meta: false },
};
export function validateSettings(value = {}) {
  const url = new URL(value.panicURL || defaults.panicURL);
  if (url.protocol !== 'https:' || url.username || url.password)
    throw new Error('Use an HTTPS panic destination.');
  const bind = value.panicBind || defaults.panicBind;
  if (
    typeof bind.code !== 'string' ||
    !/^(Key[A-Z]|Digit[0-9]|Backquote|Escape|F[1-9][0-2]?|Space|Tab|Backspace|Arrow(Up|Down|Left|Right)|Home|End|PageUp|PageDown|Insert|Delete|Minus|Equal|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Comma|Period|Slash)$/.test(
      bind.code,
    )
  )
    throw new Error('Choose a valid panic shortcut.');
  return {
    forceController: value.forceController === true,
    appearance: 'glass',
    panicURL: url.href,
    panicBind: {
      code: bind.code,
      ctrl: !!bind.ctrl,
      alt: !!bind.alt,
      shift: !!bind.shift,
      meta: !!bind.meta,
    },
  };
}
export function readSettings(seed = {}) {
  try {
    const stored = localStorage.getItem(STORAGE);
    if (stored) return { ...validateSettings(JSON.parse(stored)), forceController: false };
  } catch {}
  try {
    const migrated = { ...validateSettings(seed), forceController: false };
    localStorage.setItem(STORAGE, JSON.stringify(migrated));
    return migrated;
  } catch {
    return validateSettings();
  }
}
export function matchesBind(event, bind) {
  return (
    !event.repeat &&
    event.code === bind.code &&
    event.ctrlKey === bind.ctrl &&
    event.altKey === bind.alt &&
    event.shiftKey === bind.shift &&
    event.metaKey === bind.meta
  );
}
export function bindLabel(bind) {
  return [
    bind.ctrl && 'Ctrl',
    bind.alt && 'Alt',
    bind.shift && 'Shift',
    bind.meta && 'Meta',
    bind.code === 'Backquote' ? '\u0060' : bind.code.replace(/^Key|^Digit/, ''),
  ]
    .filter(Boolean)
    .join(' + ');
}
export function gameSettingsKey(gameURL) {
  const url = new URL(gameURL);
  if (url.protocol !== 'https:' || url.username || url.password)
    throw new Error('Invalid game URL');
  return 'playdeck.gameSettings.v1:' + url.href;
}
export function readGameSettings(gameURL) {
  try {
    return {
      forceController:
        JSON.parse(localStorage.getItem(gameSettingsKey(gameURL)) || '{}').forceController === true,
    };
  } catch {
    return { forceController: false };
  }
}
export function writeGameSettings(gameURL, value) {
  localStorage.setItem(
    gameSettingsKey(gameURL),
    JSON.stringify({ forceController: value.forceController === true }),
  );
}
export function installSettings(
  panel,
  settings,
  onSave,
  { gameURL = null, nativeGamepad = false } = {},
) {
  let draft = { ...settings, panicBind: { ...settings.panicBind } };
  const form = document.createElement('form');
  form.id = 'player-settings';
  form.innerHTML =
    '<h2>Settings</h2><label class="check-row" data-force-row><input name="forceController" type="checkbox">Force controller mapping</label><details class="deck-section" data-misc-settings><summary>Misc</summary><label class="shortcut-row">Panic key<input name="panicKey" readonly aria-label="Panic shortcut" title="Click and press a shortcut"></label><label>Panic destination<input name="panicURL" type="url" required aria-label="Panic destination"></label></details><p data-settings-status role="status"></p>';
  // The compatibility toggle is moved into the shared Compatibility section.
  // Keep the original element reference so auto-save works outside this form.
  const controls = Object.fromEntries([...form.querySelectorAll('[name]')].map(input => [input.name, input]));
  const field = (name) => controls[name],
    status = form.querySelector('[data-settings-status]');
  form.querySelector('[data-force-row]').hidden = nativeGamepad || !gameURL;
  field('forceController').checked = settings.forceController && !nativeGamepad;
  field('panicKey').value = bindLabel(settings.panicBind);
  field('panicURL').value = settings.panicURL;
  function save() {
    try {
      const next = validateSettings({
        ...draft,
        forceController: !nativeGamepad && !!gameURL && field('forceController').checked,
        appearance: 'glass',
        panicURL: field('panicURL').value,
      });
      let stored = true;
      try {
        localStorage.setItem(STORAGE, JSON.stringify({ ...next, forceController: false }));
        if (gameURL) writeGameSettings(gameURL, next);
      } catch {
        stored = false;
      }
      draft = next;
      onSave(next);
      status.textContent = stored
        ? ''
        : 'Applied for this session; browser storage is unavailable.';
    } catch (error) {
      status.textContent = error.message;
    }
  }
  field('forceController').addEventListener('change', save);
  field('panicURL').addEventListener('change', save);
  field('panicKey').addEventListener('keydown', (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (
      [
        'ControlLeft',
        'ControlRight',
        'ShiftLeft',
        'ShiftRight',
        'AltLeft',
        'AltRight',
        'MetaLeft',
        'MetaRight',
      ].includes(event.code)
    )
      return;
    const bind = {
      code: event.code,
      ctrl: event.ctrlKey,
      alt: event.altKey,
      shift: event.shiftKey,
      meta: event.metaKey,
    };
    try {
      validateSettings({ ...draft, panicBind: bind });
      draft.panicBind = bind;
      field('panicKey').value = bindLabel(bind);
      save();
    } catch {
      status.textContent = 'Choose a keyboard shortcut.';
    }
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    save();
  });
  panel.prepend(form);
}

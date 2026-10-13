// One owner for Game, Display, Settings and Controller menu visibility.
// Do not animate/transform toolbar children: they anchor the floating panels.
export const MENU_EXIT_MS = 210;
export function installToolbar(bar, settingsPanel, {getFrame, alwaysVisible = false}) {
  const edge = document.createElement('button');
  edge.id = 'toolbar-edge';
  edge.type = 'button';
  edge.setAttribute('aria-label', 'Show player controls');
  edge.setAttribute('aria-controls', bar.id);
  edge.setAttribute('aria-expanded', 'false');
  document.body.append(edge);
  let hideTimer, closeTimer, closing = null, pointerOver = false, blockHoverReveal = false;
  const reducedMotion = () =>
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const entries = () => [
    {
      name: 'sandbox',
      panel: settingsPanel,
      open: () => !settingsPanel.hidden,
      finish: () => {
        settingsPanel.hidden = true;
        bar.querySelector('#badge')?.setAttribute('aria-expanded', 'false');
      }
    },
    ...[...bar.querySelectorAll('details')].map(details => ({
      name: details.classList?.contains?.('game-display') ? 'display' : 'game',
      panel: details.querySelector('.display-panel,.game-menu-panel') || details,
      open: () => details.open,
      finish: () => {details.open = false;}
    })),
    ...[...bar.children].filter(node => node.shadowRoot).map(host => ({
      name: 'controller',
      panel: host.shadowRoot.querySelector('#panel'),
      open: () => !!host.shadowRoot.querySelector('#panel:not([hidden])'),
      finish: () => document.dispatchEvent(new Event('playdeck:game-interaction'))
    }))
  ].filter(entry => entry.panel);
  const hasOpen = () => entries().some(entry => entry.open());
  function reveal() {
    clearTimeout(hideTimer);
    bar.classList.add('is-visible');
    bar.inert = false;
    edge.setAttribute('aria-expanded', 'true');
  }
  function hide(force = false) {
    if(alwaysVisible || closing) return;
    if(!force && (hasOpen() || pointerOver || bar.matches(':focus-within'))) return;
    bar.classList.remove('is-visible');
    bar.inert = true;
    edge.setAttribute('aria-expanded', 'false');
  }
  function scheduleHide() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => hide(), 450);
  }
  function finishPending() {
    if(!closing) return;
    clearTimeout(closeTimer);
    const finish = closing;
    closing = null;
    finish();
  }
  function clearFocus() {
    const active = document.activeElement;
    active?.shadowRoot?.activeElement?.blur?.();
    if(bar.contains?.(active) || settingsPanel.contains?.(active)) active?.blur?.();
    bar.querySelector('#badge')?.blur?.();
  }
  function closePanels({except, only, hideToolbar = false} = {}) {
    clearTimeout(hideTimer);
    if(closing) {
      if(hideToolbar && closing.hideToolbar) return;
      finishPending();
    }
    if(hideToolbar) {
      blockHoverReveal = true;
      pointerOver = false;
      clearFocus();
    }
    const selected = entries().filter(entry =>
      entry.open() && entry.name !== except && (!only || entry.name === only));
    if(!selected.length) {
      if(hideToolbar) hide(true);
      else scheduleHide();
      return;
    }
    for(const entry of selected) entry.panel.classList?.add('playdeck-closing');
    const finish = () => {
      for(const entry of selected) {
        entry.panel.classList?.remove('playdeck-closing');
        entry.finish();
      }
      if(hideToolbar) {
        clearFocus();
        hide(true);
      }else scheduleHide();
    };
    finish.hideToolbar = hideToolbar;
    closing = finish;
    closeTimer = setTimeout(() => {
      if(closing !== finish) return;
      closing = null;
      finish();
    }, reducedMotion() ? 0 : MENU_EXIT_MS);
  }
  function show() {
    finishPending();
    blockHoverReveal = false;
    reveal();
  }
  function dismiss() {closePanels({hideToolbar:true});}
  function track(event, doc = document) {
    if(event.pointerType === 'touch' || doc.pointerLockElement) return;
    let y = event.clientY;
    if(doc !== document) {
      const rect = getFrame()?.getBoundingClientRect();
      if(!rect) return;
      y = rect.top + y * rect.height / (doc.defaultView.innerHeight || rect.height);
    }
    if(y < innerHeight - 76) blockHoverReveal = false;
    if(y >= innerHeight - 64 && !blockHoverReveal && !closing) reveal();
    else if(!pointerOver) scheduleHide();
  }
  edge.addEventListener('pointerenter', () => {
    if(!blockHoverReveal && !closing) reveal();
  });
  edge.addEventListener('pointerleave', scheduleHide);
  edge.addEventListener('click', () => {
    show();
    bar.querySelector('#badge')?.focus?.();
  });
  bar.addEventListener('pointerenter', () => {
    if(blockHoverReveal || closing) return;
    pointerOver = true;
    reveal();
  });
  bar.addEventListener('pointerleave', () => {
    pointerOver = false;
    scheduleHide();
  });
  bar.addEventListener('focusin', () => {
    if(!closing) reveal();
  });
  bar.addEventListener('focusout', scheduleHide);
  document.addEventListener('pointermove', event => track(event), {passive:true});
  document.addEventListener('timebomb:menu-open', event => {
    // Switching menus is allowed; finish the previous exit before opening the next.
    show();
    closePanels({except:event.detail});
  });
  document.addEventListener('playdeck:request-close', () => closePanels({only:'controller'}));
  bar.addEventListener('click', event => {
    const summary = event.target.closest?.('.game-menu > summary,.game-display > summary');
    if(summary?.parentElement?.open) {
      event.preventDefault();
      closePanels({only:summary.parentElement.classList.contains('game-display') ? 'display' : 'game'});
    }
  }, true);
  document.addEventListener('pointerdown', event => {
    const path = event.composedPath?.() || [];
    if(path.includes(bar) || path.includes(settingsPanel) || event.target === edge) return;
    dismiss();
  }, true);
  const watched = new WeakSet();
  function attach(doc) {
    if(!doc || watched.has(doc)) return;
    watched.add(doc);
    doc.addEventListener('pointermove', event => track(event,doc), {passive:true});
    doc.addEventListener('pointerdown', dismiss, {passive:true,capture:true});
    doc.addEventListener('pointerlockchange', () => {
      if(doc.pointerLockElement) dismiss();
    }, true);
  }
  // Focusing a game iframe doesn't dispatch a pointer event to its parent
  // when the document is cross-origin. Handle that case without trapping focus.
  if(typeof window !== 'undefined') window.addEventListener('blur', () => {
    setTimeout(() => {
      if(document.activeElement === getFrame?.()) dismiss();
    },0);
  });
  bar.inert = true;
  if(alwaysVisible) reveal();
  return {
    show, attach, dismiss,
    closeOthers: name => closePanels({except:name}),
    toggleSettings() {
      if(settingsPanel.hidden) {
        show();
        document.dispatchEvent(new CustomEvent('timebomb:menu-open',{detail:'sandbox'}));
        settingsPanel.hidden = false;
        bar.querySelector('#badge')?.setAttribute('aria-expanded','true');
      } else {
        closePanels({only:'sandbox'});
      }
    }
  };
}

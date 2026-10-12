// Keep the shell viewport separate from a game's CSS/layout coordinate space.
export function playerViewport(
  screenWidth,
  screenHeight,
  mode,
  budget,
  cast = null,
  fixed = null,
  fill = false,
  renderRatio = null,
) {
  if (!(screenWidth > 0 && screenHeight > 0)) return null;
  // Full resolution uses the actual viewport, never a detected low-resolution layout.
  if (mode === 'full') fixed = null;
  const aspect = renderRatio > 0 ? renderRatio : screenWidth / screenHeight;
  const width =
    cast?.[0] ||
    fixed?.width ||
    (mode === 'full'
      ? renderRatio > 0
        ? Math.max(screenWidth, screenHeight * aspect)
        : screenWidth
      : mode === 'native'
        ? Math.max(1280, screenWidth)
        : Math.max(1, Math.round(budget * Math.min(1, aspect))));
  const height = cast?.[1] || fixed?.height || Math.max(1, Math.round(width / aspect));
  const scale = Math.min(screenWidth / width, screenHeight / height);
  return {
    width,
    height,
    scale,
    scaleX: fill ? screenWidth / width : scale,
    scaleY: fill ? screenHeight / height : scale,
    left: fill ? 0 : Math.max(0, (screenWidth - width * scale) / 2),
    top: fill ? 0 : Math.max(0, (screenHeight - height * scale) / 2),
  };
}
export function fixedGameViewport(doc) {
  if (!doc?.querySelectorAll) return null;
  const pixels = (value) => (/^\d+(?:\.\d+)?px$/.test(value || '') ? parseFloat(value) : 0);
  let best = null;
  for (const node of doc.querySelectorAll('canvas,[style*="width"][style*="height"]')) {
    if (
      node.hasAttribute?.('data-timebomb-page-extra') ||
      /debug|stats|fps/i.test(node.id + ' ' + node.className)
    )
      continue;
    const isCanvas = node.tagName === 'CANVAS';
    const engineSurface =
      /^(?:game[-_]?container|unity[-_]?container|unity[-_]?canvas|canvas|MMFCanvas)$/i.test(
        node.id || '',
      );
    if (!isCanvas && !engineSurface && !node.querySelector?.('canvas')) continue;
    // Percent, viewport and auto declarations are responsive, not fixed surfaces.
    const authoredWidth = node.style?.width || '',
      authoredHeight = node.style?.height || '';
    let width = pixels(authoredWidth),
      height = pixels(authoredHeight);
    if (isCanvas && !authoredWidth && !authoredHeight) {
      width = Number(node.getAttribute('width'));
      height = Number(node.getAttribute('height'));
      const rect = node.getBoundingClientRect?.();
      // A high-DPI buffer or stylesheet-sized canvas is not a fixed page layout.
      if (rect && (Math.abs(rect.width - width) > 1 || Math.abs(rect.height - height) > 1))
        continue;
    }
    if (width < 320 || height < 180 || width > 8192 || height > 8192) continue;
    // Engines which already resize to the frame should keep normal viewport behavior.
    if (width === doc.defaultView?.innerWidth && height === doc.defaultView?.innerHeight) continue;
    if (!best || width * height > best.width * best.height) best = { width, height };
  }
  return best;
}

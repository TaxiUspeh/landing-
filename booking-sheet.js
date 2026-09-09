// The price/footer has its own grid row: dragging changes only map and form space.
export function createBookingSheet({ overlay, body, map, grip, content, footer, onResize = () => {} }) {
  let collapsed = false, enabled = true, drag = null, suppressClickUntil = 0, resizeFrame = 0;
  const mobile = () => window.innerWidth < 768;
  const bounds = () => {
    const height = body.getBoundingClientRect().height;
    const max = Math.max(0, height - footer.getBoundingClientRect().height - grip.getBoundingClientRect().height);
    return { max, form: Math.min(max, Math.max(window.innerHeight <= 520 ? 64 : 120, height * .26)) };
  };
  function resizeMap() {
    if (resizeFrame) return;
    resizeFrame = window.requestAnimationFrame(() => { resizeFrame = 0; onResize(); });
  }
  function render() {
    const folded = collapsed && enabled && mobile();
    overlay.classList.toggle('booking-collapsed', folded);
    grip.hidden = !enabled || !mobile();
    grip.setAttribute('aria-expanded', String(!folded));
    grip.setAttribute('aria-label', folded ? 'Показать адреса и услуги' : 'Свернуть поля и увеличить карту');
    grip.querySelector('span').textContent = folded ? 'Адреса и услуги · потяните вверх' : 'Больше карты · потяните вниз';
    content.inert = folded;
    content.setAttribute('aria-hidden', String(folded));
    if (!drag) body.style.removeProperty('--booking-map-size');
    resizeMap();
  }
  function setCollapsed(value) {
    if (value && content.contains(document.activeElement)) grip.focus({ preventScroll: true });
    collapsed = Boolean(value);
    render();
  }
  function endDrag(event, cancelled = false) {
    if (!drag || event.pointerId !== drag.id) return;
    const previous = drag;
    drag = null;
    overlay.classList.remove('booking-dragging');
    if (grip.hasPointerCapture?.(event.pointerId)) grip.releasePointerCapture(event.pointerId);
    if (cancelled) collapsed = previous.collapsed;
    else if (previous.moved) {
      const delta = event.clientY - previous.startY;
      const { form, max } = bounds();
      collapsed = Math.abs(delta) > 20 ? delta > 0 : previous.height > (form + max) / 2;
    }
    if (previous.moved || cancelled) suppressClickUntil = Date.now() + 400;
    render();
  }
  grip.addEventListener('click', event => {
    if (!enabled || !mobile() || (event.detail !== 0 && Date.now() < suppressClickUntil)) return;
    setCollapsed(!collapsed);
  });
    grip.addEventListener('pointerdown', event => {
    if (!enabled || !mobile() || event.isPrimary === false || event.button > 0) return;
    drag = { id: event.pointerId, startY: event.clientY, startHeight: map.getBoundingClientRect().height, height: 0, moved: false, collapsed };
    grip.setPointerCapture?.(event.pointerId);
  });
  grip.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.id) return;
    const delta = event.clientY - drag.startY;
    if (Math.abs(delta) < 6 && !drag.moved) return;
    drag.moved = true;
    const { form, max } = bounds();
    drag.height = Math.max(form, Math.min(max, drag.startHeight + delta));
    overlay.classList.add('booking-dragging');
    overlay.classList.remove('booking-collapsed');
    body.style.setProperty('--booking-map-size', `${drag.height}px`);
    event.preventDefault();
    resizeMap();
  });
  grip.addEventListener('pointerup', event => endDrag(event));
  grip.addEventListener('pointercancel', event => endDrag(event, true));
  grip.addEventListener('lostpointercapture', event => endDrag(event, true));
  function refresh() {
    if (drag) { drag = null; overlay.classList.remove('booking-dragging'); }
    render();
  }
  window.addEventListener('resize', refresh);
  window.visualViewport?.addEventListener('resize', refresh);
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resizeMap);
  observer?.observe(body); observer?.observe(footer);
  render();
  return {
    expand: () => setCollapsed(false),
    collapse: () => setCollapsed(true),
    setEnabled(value) { enabled = value; if (!enabled) collapsed = false; render(); },
    refresh
  };
}

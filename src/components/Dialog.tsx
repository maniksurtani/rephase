import { useEffect, useRef, type ReactNode } from 'react';

interface DialogLayer {
  backdrop: HTMLDivElement;
  panel: HTMLDivElement;
  close: () => void;
}

// All dialogs, including account conflicts rendered outside App, share one
// keyboard/focus owner and one scroll lock. Only the top layer is interactive.
const layers: DialogLayer[] = [];
let previousOverflow = '';
const topLayer = () => layers.at(-1);
const focusable = (panel: HTMLElement) =>
  Array.from(
    panel.querySelectorAll<HTMLElement>(
      'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), iframe, [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => element.getClientRects().length > 0 && !element.closest('[inert]'));

function focusFirst(layer: DialogLayer) {
  const preferred = layer.panel.querySelector<HTMLElement>('[data-initial-focus]');
  (preferred ?? focusable(layer.panel)[0] ?? layer.panel).focus();
}

function synchronizeLayers() {
  layers.forEach((layer, index) => {
    const active = index === layers.length - 1;
    layer.backdrop.inert = !active;
    layer.backdrop.style.zIndex = String(200 + index);
    layer.panel.setAttribute('aria-modal', String(active));
  });
}

function handleKey(event: KeyboardEvent) {
  const layer = topLayer();
  if (!layer || event.defaultPrevented) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    layer.close();
  } else if (event.key === 'Tab') {
    const elements = focusable(layer.panel);
    const first = elements[0],
      last = elements.at(-1);
    if (!first) {
      event.preventDefault();
      layer.panel.focus();
    } else if (
      event.shiftKey &&
      (document.activeElement === first || !layer.panel.contains(document.activeElement))
    ) {
      event.preventDefault();
      last?.focus();
    } else if (
      !event.shiftKey &&
      (document.activeElement === last || !layer.panel.contains(document.activeElement))
    ) {
      event.preventDefault();
      first.focus();
    }
  }
}

function handleFocus(event: FocusEvent) {
  const layer = topLayer();
  if (layer && !layer.panel.contains(event.target as Node)) focusFirst(layer);
}

export function Dialog({
  title,
  onClose,
  backdropClassName = 'modal-backdrop',
  className = 'modal',
  children,
}: {
  title: string;
  onClose: () => void;
  backdropClassName?: string;
  className?: string;
  children: ReactNode;
}) {
  const backdrop = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    if (!backdrop.current || !panel.current) return;
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const layer: DialogLayer = {
      backdrop: backdrop.current,
      panel: panel.current,
      close: () => close.current(),
    };
    if (!layers.length) {
      previousOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      document.addEventListener('keydown', handleKey);
      document.addEventListener('focusin', handleFocus);
    }
    layers.push(layer);
    synchronizeLayers();
    focusFirst(layer);
    return () => {
      const wasTop = topLayer() === layer;
      layers.splice(layers.indexOf(layer), 1);
      synchronizeLayers();
      if (!layers.length) {
        document.body.style.overflow = previousOverflow;
        document.removeEventListener('keydown', handleKey);
        document.removeEventListener('focusin', handleFocus);
      }
      if (wasTop) {
        const next = topLayer();
        if (previousFocus?.isConnected && (!next || next.panel.contains(previousFocus)))
          previousFocus.focus();
        else if (next) focusFirst(next);
      }
    };
  }, []);

  return (
    <div
      ref={backdrop}
      className={backdropClassName}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && topLayer()?.panel === panel.current)
          close.current();
      }}
    >
      <div
        ref={panel}
        tabIndex={-1}
        className={className}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        {children}
      </div>
    </div>
  );
}

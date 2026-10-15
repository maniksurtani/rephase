import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

export function Modal({ title, onClose, className = '', children }: { title: string; onClose: () => void; className?: string; children: React.ReactNode }) {
  const onCloseRef = useRef(onClose);
  const dialogRef = useRef<HTMLElement>(null);
  onCloseRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
      if (event.key === 'Tab') {
        const modal = dialogRef.current;
        const elements = modal?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]');
        if (!elements?.length) return;
        const first = elements[0], last = elements[elements.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', handleKey);
    const timer = window.setTimeout(() => { const first = dialogRef.current?.querySelector<HTMLElement>('[data-initial-focus]') ?? dialogRef.current?.querySelector<HTMLElement>('button'); first?.focus(); }, 0);
    return () => { document.removeEventListener('keydown', handleKey); window.clearTimeout(timer); previous?.focus(); };
  }, []);
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><section ref={dialogRef} className={`modal ${className}`} role="dialog" aria-modal="true" aria-label={title}><header className="modal-header"><h2>{title}</h2><button type="button" className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={20}/></button></header>{children}</section></div>;
}


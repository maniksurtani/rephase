import { X } from 'lucide-react';
import { Dialog } from './Dialog';

export function Modal({
  title,
  onClose,
  className = '',
  children,
}: {
  title: string;
  onClose: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Dialog title={title} onClose={onClose} className={`modal ${className}`}>
      <header className="modal-header">
        <h2>{title}</h2>
        <button type="button" className="icon-button" aria-label="Close dialog" onClick={onClose}>
          <X size={20} />
        </button>
      </header>
      {children}
    </Dialog>
  );
}

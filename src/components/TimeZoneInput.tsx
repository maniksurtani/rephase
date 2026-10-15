import { useEffect, useId, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { searchTimeZones, type TimeZoneOption } from '../lib/time-zones';

export interface TimeZoneInputProps {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  required?: boolean;
  placeholder?: string;
  disabled?: boolean;
}

/** A free-text IANA field with local city suggestions; only selection commits a suggestion. */
export function TimeZoneInput({ value, onChange, id, required, placeholder = 'Search a city or time zone', disabled }: TimeZoneInputProps) {
  const generatedId = useId();
  const inputId = id ?? `time-zone-${generatedId}`;
  const listId = `${inputId}-options`;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const options = useMemo(() => searchTimeZones(value), [value]);
  const container = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const gesture = useRef<{ id: number; value: string; x: number; y: number; moved: boolean } | null>(null);
  const suppressCompatibilityClick = useRef(false);
  useEffect(() => { setActive(-1); }, [value]);
  useEffect(() => { if (open && active >= 0) optionRefs.current[active]?.scrollIntoView({ block: 'nearest' }); }, [active, open]);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (!container.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);
  function select(option: TimeZoneOption) {
    onChange(option.value); input.current?.focus(); setOpen(false); setActive(-1);
  }
  function pointerDown(event: ReactPointerEvent<HTMLButtonElement>, option: TimeZoneOption) {
    // Keep the input focused until selection; Safari may suppress the later click.
    event.preventDefault(); suppressCompatibilityClick.current = false;
    gesture.current = event.pointerType === 'mouse' ? null : { id: event.pointerId, value: option.value, x: event.clientX, y: event.clientY, moved: false };
  }
  function pointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const start = gesture.current;
    if (start?.id === event.pointerId && (event.clientX - start.x) ** 2 + (event.clientY - start.y) ** 2 > 64) start.moved = true;
  }
  function pointerUp(event: ReactPointerEvent<HTMLButtonElement>, option: TimeZoneOption) {
    const start = gesture.current; gesture.current = null;
    if (!start || start.id !== event.pointerId) return;
    event.preventDefault(); suppressCompatibilityClick.current = true;
    // Panning cancels the pointer or exceeds the tap tolerance; neither selects.
    if (!start.moved && start.value === option.value) select(option);
  }
  return <div className="time-zone-input" ref={container} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) { setOpen(false); setActive(-1); }
  }}>
    <input id={inputId} ref={input} value={value} required={required} disabled={disabled} placeholder={placeholder} role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={open ? listId : undefined} aria-activedescendant={open && active >= 0 && options[active] ? `${listId}-${active}` : undefined} autoComplete="off" autoCapitalize="none" spellCheck={false}
      onFocus={() => setOpen(true)} onChange={event => { onChange(event.target.value); setActive(-1); setOpen(true); }} onKeyDown={event => {
        if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); setActive(-1); return; }
        if (event.key === 'Tab') { setOpen(false); setActive(-1); return; }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault(); setOpen(true);
          if (options.length) setActive(current => event.key === 'ArrowDown' ? (current + 1) % options.length : current < 0 ? options.length - 1 : (current - 1 + options.length) % options.length);
          return;
        }
        if (event.key === 'Enter' && open && options.length) {
          event.preventDefault(); select(options[Math.max(active, 0)]);
        }
      }}/>
    {open && <div className="time-zone-popup"><div id={listId} className="time-zone-options" role="listbox" aria-label="Time zones">
      {options.map((option, index) => <button key={option.value} id={`${listId}-${index}`} ref={element => { optionRefs.current[index] = element; }} type="button" role="option" tabIndex={-1} aria-selected={active === index} className={active === index ? 'active' : ''}
        onPointerDown={event => pointerDown(event, option)} onPointerMove={pointerMove} onPointerUp={event => pointerUp(event, option)} onPointerCancel={() => { gesture.current = null; suppressCompatibilityClick.current = true; }}
        onClick={event => {
          // Touch already committed on pointerup. Mouse and assistive clicks still work.
          if (event.detail > 0 && suppressCompatibilityClick.current) { event.preventDefault(); return; }
          select(option);
        }}><strong>{option.city}</strong><span>{option.value}</span></button>)}
    </div>{!options.length && <p className="time-zone-no-results" role="status">No matching time zones. You can still enter a valid IANA time zone.</p>}</div>}
  </div>;
}

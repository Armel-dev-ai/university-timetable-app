import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface Props {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
}

interface MenuPosition {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
}

export function Select({ value, options, onChange, ariaLabel, className = '', disabled = false }: Props) {
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(() => Math.max(0, options.findIndex((option) => option.value === value)));
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const selected = options.find((option) => option.value === value);
  const selectedIndex = options.findIndex((option) => option.value === value);

  const updatePosition = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const margin = 8;
    const spaceBelow = window.innerHeight - rect.bottom - margin;
    const spaceAbove = rect.top - margin;
    const maxHeight = Math.max(120, Math.min(280, Math.max(spaceBelow, spaceAbove)));
    const height = Math.min(maxHeight, options.length * 42 + 8);
    const top = spaceBelow >= height || spaceBelow >= spaceAbove
      ? Math.min(rect.bottom + 6, window.innerHeight - height - margin)
      : Math.max(margin, rect.top - height - 6);
    const width = Math.min(Math.max(rect.width, 168), window.innerWidth - margin * 2);
    const left = Math.min(Math.max(margin, rect.right - width), window.innerWidth - width - margin);
    setPosition({ left, top, width, maxHeight });
  }, [options.length]);

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
    const onPointerDown = (event: PointerEvent) => {
      if (triggerRef.current?.contains(event.target as Node) || menuRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>(`[data-option-index="${activeIndex}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  function toggle() {
    if (disabled) return;
    if (open) {
      setOpen(false);
      return;
    }
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
    setOpen(true);
  }

  function choose(option: SelectOption) {
    if (option.disabled) return;
    onChange(option.value);
    setOpen(false);
    triggerRef.current?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      setOpen(false);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
        setOpen(true);
        return;
      }
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      let nextIndex = activeIndex;
      for (let count = 0; count < options.length; count++) {
        nextIndex = (nextIndex + direction + options.length) % options.length;
        if (!options[nextIndex]?.disabled) break;
      }
      setActiveIndex(nextIndex);
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      const indexes = options.map((option, index) => option.disabled ? -1 : index).filter((index) => index >= 0);
      const nextIndex = event.key === 'Home' ? indexes[0] : indexes.at(-1);
      if (nextIndex !== undefined && nextIndex >= 0) setActiveIndex(nextIndex);
      setOpen(true);
      return;
    }
    if ((event.key === 'Enter' || event.key === ' ') && open) {
      event.preventDefault();
      const option = options[activeIndex];
      if (option) choose(option);
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        id={`${id}-trigger`}
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-listbox`}
        aria-activedescendant={open ? `${id}-option-${activeIndex}` : undefined}
        disabled={disabled}
        className={`styled-select ${className}`}
        onClick={toggle}
        onKeyDown={onKeyDown}
      >
        <span className="styled-select-value">{selected?.label ?? value}</span>
        <svg className={`styled-select-chevron ${open ? 'is-open' : ''}`} viewBox="0 0 12 12" aria-hidden="true">
          <path d="m3 4.5 3 3 3-3" />
        </svg>
      </button>
      {open && position && createPortal(
        <div
          ref={menuRef}
          id={`${id}-listbox`}
          role="listbox"
          aria-label={ariaLabel}
          className="styled-select-menu"
          style={{
            left: position.left,
            top: position.top,
            width: position.width,
            maxHeight: position.maxHeight,
          }}
        >
          {options.map((option, index) => (
            <button
              id={`${id}-option-${index}`}
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              aria-disabled={option.disabled || undefined}
              disabled={option.disabled}
              data-option-index={index}
              className={`styled-select-option ${option.value === value ? 'is-selected' : ''} ${index === activeIndex ? 'is-active' : ''}`}
              onPointerMove={() => setActiveIndex(index)}
              onClick={() => choose(option)}
            >
              <span>{option.label}</span>
              {option.value === value && <span className="styled-select-check" aria-hidden="true">✓</span>}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}

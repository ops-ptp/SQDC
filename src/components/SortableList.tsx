import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { moveItem } from '../lib/kpiOrder';

// ===========================================================================
// Drag-to-reorder list for "arrange" mode: items wiggle, follow the pointer
// (mouse, pen or finger) while dragged, and the others slide out of the way.
// Arrow keys move the focused item for keyboard users; screen readers hear
// the new position. No library — pointer events + the Web Animations API.
//
//  - Swaps happen when the pointer passes the MIDDLE of a neighbour in the
//    direction of travel, measured on layout positions (not mid-animation
//    ones), so items of different widths never flip back and forth.
//  - A 4px threshold keeps a plain tap/click from counting as a drag.
// ===========================================================================

interface Props<T> {
  items: T[];
  getKey: (item: T) => string;
  getLabel: (item: T) => string;
  onChange: (next: T[]) => void;
  renderItem: (item: T) => ReactNode;
  /** Main direction of the list: 'x' for a (wrapping) row, 'y' for a column. */
  axis?: 'x' | 'y';
  ariaLabel: string;
  className?: string;
  itemClassName?: string;
}

interface DragState {
  key: string;
  pointerId: number;
  startX: number;
  startY: number;
  grabX: number;
  grabY: number;
  x: number;
  y: number;
  active: boolean;
}

const THRESHOLD = 4;
const EDGE = 70;

export default function SortableList<T>({ items, getKey, getLabel, onChange, renderItem, axis = 'x', ariaLabel, className, itemClassName }: Props<T>) {
  const listRef = useRef<HTMLDivElement>(null);
  const els = useRef(new Map<string, HTMLDivElement>());
  const before = useRef<Map<string, { x: number; y: number }> | null>(null);
  const drag = useRef<DragState | null>(null);
  const scrollTimer = useRef<number | null>(null);
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const keys = items.map(getKey);
  const order = keys.join('\u0000');

  /** Remember where every item sits before a move, for the slide animation. */
  function snapshot() {
    const m = new Map<string, { x: number; y: number }>();
    for (const [k, el] of els.current) m.set(k, { x: el.offsetLeft, y: el.offsetTop });
    before.current = m;
  }

  /** Keep the dragged item under the pointer, wherever its slot now is. */
  function placeDragged() {
    const d = drag.current;
    if (!d?.active) return;
    const el = els.current.get(d.key);
    if (!el) return;
    el.style.transform = 'none';
    const r = el.getBoundingClientRect();
    el.style.transform = `translate(${d.x - d.grabX - r.left}px, ${d.y - d.grabY - r.top}px)`;
  }

  // After every reorder: slide the others from where they were (FLIP).
  useLayoutEffect(() => {
    const prev = before.current;
    before.current = null;
    if (prev) {
      for (const [k, el] of els.current) {
        if (k === drag.current?.key && drag.current.active) continue;
        const p = prev.get(k);
        if (!p) continue;
        const dx = p.x - el.offsetLeft;
        const dy = p.y - el.offsetTop;
        if (dx || dy) el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 200, easing: 'cubic-bezier(.2,.8,.2,1)' });
      }
    }
    placeDragged();
  }, [order]);

  useEffect(
    () => () => {
      if (scrollTimer.current) window.clearInterval(scrollTimer.current);
    },
    []
  );

  function layoutRect(el: HTMLElement) {
    const list = listRef.current!.getBoundingClientRect();
    const left = list.left + el.offsetLeft - listRef.current!.scrollLeft;
    const top = list.top + el.offsetTop - listRef.current!.scrollTop;
    return { left, top, right: left + el.offsetWidth, bottom: top + el.offsetHeight };
  }

  function hitTest(px: number, py: number) {
    const d = drag.current;
    if (!d) return;
    const from = keys.indexOf(d.key);
    const draggedEl = els.current.get(d.key);
    if (!draggedEl) return;
    const slot = layoutRect(draggedEl);
    for (let i = 0; i < keys.length; i++) {
      if (i === from) continue;
      const el = els.current.get(keys[i]);
      if (!el) continue;
      const r = layoutRect(el);
      if (px < r.left || px > r.right || py < r.top || py > r.bottom) continue;
      // A neighbour on another line (another row of a wrapping row or grid,
      // another column of a column list) swaps as soon as it's entered.
      const sameLine =
        axis === 'x'
          ? Math.abs(r.top - slot.top) < Math.min(r.bottom - r.top, slot.bottom - slot.top) / 2
          : Math.abs(r.left - slot.left) < Math.min(r.right - r.left, slot.right - slot.left) / 2;
      const mid = axis === 'x' ? (r.left + r.right) / 2 : (r.top + r.bottom) / 2;
      const p = axis === 'x' ? px : py;
      // Same line: only once past the neighbour's middle in the direction of
      // travel, so items of different sizes never flip back and forth.
      if (!sameLine || (i > from && p > mid) || (i < from && p < mid)) {
        snapshot();
        onChange(moveItem(items, from, i));
      }
      return;
    }
  }

  function autoScroll() {
    const d = drag.current;
    if (!d?.active) return;
    const dy = d.y < EDGE ? -12 : d.y > window.innerHeight - EDGE ? 12 : 0;
    if (dy) {
      window.scrollBy(0, dy);
      placeDragged();
    }
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>, key: string) {
    if (e.button !== 0 || drag.current) return;
    const r = e.currentTarget.getBoundingClientRect();
    drag.current = { key, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, grabX: e.clientX - r.left, grabY: e.clientY - r.top, x: e.clientX, y: e.clientY, active: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    d.x = e.clientX;
    d.y = e.clientY;
    if (!d.active) {
      if (Math.abs(d.x - d.startX) < THRESHOLD && Math.abs(d.y - d.startY) < THRESHOLD) return;
      d.active = true;
      setDraggingKey(d.key);
      scrollTimer.current = window.setInterval(autoScroll, 16);
    }
    e.preventDefault();
    placeDragged();
    hitTest(d.x, d.y);
  }

  function endDrag(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    drag.current = null;
    if (scrollTimer.current) {
      window.clearInterval(scrollTimer.current);
      scrollTimer.current = null;
    }
    const el = els.current.get(d.key);
    if (d.active && el) {
      const from = el.style.transform;
      el.style.transform = '';
      if (from && from !== 'none') el.animate([{ transform: from }, { transform: 'none' }], { duration: 180, easing: 'ease-out' });
      const pos = keys.indexOf(d.key);
      const item = items[pos];
      if (item !== undefined) setAnnouncement(`${getLabel(item)} dropped at position ${pos + 1} of ${items.length}.`);
    }
    setDraggingKey(null);
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>, index: number) {
    const back = e.key === 'ArrowLeft' || e.key === 'ArrowUp';
    const fwd = e.key === 'ArrowRight' || e.key === 'ArrowDown';
    if (!back && !fwd) return;
    e.preventDefault();
    const to = back ? index - 1 : index + 1;
    if (to < 0 || to >= items.length) return;
    snapshot();
    onChange(moveItem(items, index, to));
    setAnnouncement(`${getLabel(items[index])} moved to position ${to + 1} of ${items.length}.`);
  }

  return (
    <div ref={listRef} className={`sortable sortable-${axis}${draggingKey ? ' is-sorting' : ''} ${className ?? ''}`} role="list" aria-label={ariaLabel}>
      {items.map((item, i) => {
        const key = getKey(item);
        const style = { '--wiggle-delay': `${-((i * 137) % 500) / 1000}s` } as CSSProperties;
        return (
          <div
            key={key}
            ref={(el) => {
              if (el) els.current.set(key, el);
              else els.current.delete(key);
            }}
            role="listitem"
            tabIndex={0}
            aria-roledescription="movable item"
            aria-label={`${getLabel(item)}, position ${i + 1} of ${items.length}. Drag, or use the arrow keys, to move it.`}
            className={`sortable-item${draggingKey === key ? ' is-dragging' : ''} ${itemClassName ?? ''}`}
            style={style}
            onPointerDown={(e) => onPointerDown(e, key)}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            <div className="sortable-wiggle">
              <span className="sortable-grip" aria-hidden="true">
                ⠿
              </span>
              {renderItem(item)}
            </div>
          </div>
        );
      })}
      <span className="sr-only" aria-live="assertive">
        {announcement}
      </span>
    </div>
  );
}

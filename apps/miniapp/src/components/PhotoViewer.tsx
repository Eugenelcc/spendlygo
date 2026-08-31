import {
  useEffect,
  useRef,
  useState,
  type JSX,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { api } from '../lib/api';

export interface PhotoViewerProps {
  photoId: string;
  onClose: () => void;
}

const MIN_SCALE = 1;
const MAX_SCALE = 4;
const DOUBLE_TAP_MS = 280;

/**
 * Full-screen receipt viewer (PRD F4.5) — pinch to zoom, drag to pan once
 * zoomed, double-tap to toggle. Hand-rolled on pointer events rather than a
 * gesture library, matching this codebase's "no dependency for something a
 * couple hundred lines covers" approach (DESIGN.md, the hand-written charts).
 */
export function PhotoViewer({ photoId, onClose }: PhotoViewerProps): JSX.Element {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [scale, setScale] = useState(MIN_SCALE);
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    api
      .photoBlobUrl(photoId)
      .then((url) => {
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        objectUrl = url;
        setSrc(url);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [photoId]);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchStart = useRef<{ distance: number; scale: number } | null>(null);
  const dragStart = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null);
  const lastTap = useRef(0);

  const reset = () => {
    setScale(MIN_SCALE);
    setOffset({ x: 0, y: 0 });
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      if (a && b) pinchStart.current = { distance: Math.hypot(a.x - b.x, a.y - b.y), scale };
      dragStart.current = null;
      return;
    }

    dragStart.current = {
      x: event.clientX,
      y: event.clientY,
      offsetX: offset.x,
      offsetY: offset.y,
    };

    const now = Date.now();
    if (now - lastTap.current < DOUBLE_TAP_MS) {
      if (scale > MIN_SCALE) reset();
      else setScale(2.5);
    }
    lastTap.current = now;
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.current.size === 2 && pinchStart.current) {
      const [a, b] = [...pointers.current.values()];
      if (!a || !b) return;
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const next = Math.min(
        MAX_SCALE,
        Math.max(MIN_SCALE, pinchStart.current.scale * (distance / pinchStart.current.distance)),
      );
      setScale(next);
      return;
    }

    if (pointers.current.size === 1 && dragStart.current && scale > MIN_SCALE) {
      setOffset({
        x: dragStart.current.offsetX + (event.clientX - dragStart.current.x),
        y: dragStart.current.offsetY + (event.clientY - dragStart.current.y),
      });
    }
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinchStart.current = null;
    if (pointers.current.size === 0) dragStart.current = null;
    if (scale <= MIN_SCALE + 0.02) reset();
  };

  return (
    <div className="photo-viewer" role="dialog" aria-modal="true" aria-label="Receipt photo">
      <button type="button" className="photo-viewer__close" onClick={onClose} aria-label="Close">
        ×
      </button>
      <div
        className="photo-viewer__stage"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        {failed ? (
          <p className="photo-viewer__error">Couldn't load this photo.</p>
        ) : src ? (
          <img
            src={src}
            alt="Receipt"
            className="photo-viewer__image"
            style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }}
            draggable={false}
          />
        ) : (
          <div className="photo-viewer__loading" aria-label="Loading photo" />
        )}
      </div>
    </div>
  );
}

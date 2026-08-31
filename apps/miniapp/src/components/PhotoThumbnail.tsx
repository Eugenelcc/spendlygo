import { useEffect, useState, type JSX } from 'react';
import { api } from '../lib/api';
import { haptics } from '../lib/telegram';

export interface PhotoThumbnailProps {
  photoId: string;
  onOpen: (photoId: string) => void;
}

/**
 * A receipt thumbnail. There is no separate small-size endpoint — GUARDRAILS
 * section 7 rules out an image-processing dependency for one — so this is
 * the same authenticated full photo, just rendered small (PRD F4.5).
 */
export function PhotoThumbnail({ photoId, onOpen }: PhotoThumbnailProps): JSX.Element {
  const [src, setSrc] = useState<string | null>(null);

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
        /* A broken thumbnail just stays a skeleton; the full viewer will
           report the failure properly if tapped. */
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [photoId]);

  return (
    <button
      type="button"
      className="photo-thumb"
      disabled={!src}
      onClick={() => {
        haptics.tap();
        onOpen(photoId);
      }}
      aria-label="Open receipt photo"
    >
      {src ? <img src={src} alt="" /> : <div className="photo-thumb__skeleton skeleton" />}
    </button>
  );
}

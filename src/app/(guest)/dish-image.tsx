'use client';

import { useEffect, useRef, useState } from 'react';
import { mediaSrcSet } from '@/modules/media/paths';
import styles from './dish-image.module.css';

/**
 * A dish's photograph, laid over the arch it sits in.
 *
 * The arch (the menu card's `.thumb`, the dish page's `.hero`, the cart
 * line's `.thumb`) keeps drawing itself underneath. It is the shape and the
 * fallback in one: a dish with no photo, a photo still loading, and a URL
 * that 404s all show the same jharokha artwork the guest app always had,
 * never a broken-image icon. The photo fills the arch and is clipped by it.
 *
 * Until now the web guest screens drew only the arch, although `image_url`
 * has been on every dish and in every menu read. The app drew the photos and
 * the web did not, so the console's preview showed a menu with no pictures
 * while the board beside it showed every one.
 *
 * `alt=""`: the dish's name is always printed beside or under it, so the
 * picture is decoration to a screen reader, not a second reading of the name.
 */
export function DishImage({
  src,
  priority = false,
}: {
  src: string | null | undefined;
  /** The dish page's hero is the first thing on screen; a thumbnail in a
   *  long list is not, and waits until it is scrolled near. */
  priority?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLImageElement>(null);

  // An image that failed before hydration fired its error with nobody
  // listening. Ask it directly once we are.
  useEffect(() => {
    const img = ref.current;
    if (img && img.complete && img.naturalWidth === 0) setFailed(true);
  }, [src]);

  if (!src || failed) return null;

  return (
    // eslint-disable-next-line @next/next/no-img-element -- an upload, or a URL pasted before uploads (D-093)
    <img
      ref={ref}
      src={src}
      // An upload comes in three widths; the browser takes the smallest that
      // is sharp for the slot. A pasted URL has no set and renders as before.
      // The hero is the screen's width; every other slot is a thumbnail.
      srcSet={mediaSrcSet(src)}
      sizes={priority ? '(max-width: 640px) 100vw, 640px' : '160px'}
      alt=""
      className={styles.photo}
      loading={priority ? 'eager' : 'lazy'}
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}

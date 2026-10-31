/**
 * Geometry for the image cropper (components/uploads/image-cropper.tsx). The
 * crop frame stays still and the image moves and zooms under it, so the frame
 * is always covered. Pure functions, unit-tested.
 */

export type Size = { width: number; height: number };
export type Offset = { x: number; y: number };
export type CropRect = { x: number; y: number; width: number; height: number };

/** The frame for an aspect ratio, fitted inside a box (the editor's area). */
export function frameSize(box: Size, aspect: number): Size {
  return box.width / box.height > aspect
    ? { width: Math.round(box.height * aspect), height: box.height }
    : { width: box.width, height: Math.round(box.width / aspect) };
}

/** Scale at which the image just covers the frame (zoom 1). */
export function coverScale(image: Size, frame: Size): number {
  return Math.max(frame.width / image.width, frame.height / image.height);
}

/** Keeps the image covering the frame: offsets are the image's top-left corner relative to the frame's, so they are ≤ 0. */
export function clampOffset(offset: Offset, image: Size, frame: Size, scale: number): Offset {
  const minX = frame.width - image.width * scale;
  const minY = frame.height - image.height * scale;
  return { x: Math.min(0, Math.max(minX, offset.x)), y: Math.min(0, Math.max(minY, offset.y)) };
}

/** The offset that centres the image in the frame. */
export function centredOffset(image: Size, frame: Size, scale: number): Offset {
  return { x: (frame.width - image.width * scale) / 2, y: (frame.height - image.height * scale) / 2 };
}

/** Changes the scale keeping the point under the frame's centre still. */
export function zoomAroundCentre(offset: Offset, image: Size, frame: Size, from: number, to: number): Offset {
  const cx = frame.width / 2;
  const cy = frame.height / 2;
  const next = { x: cx - ((cx - offset.x) / from) * to, y: cy - ((cy - offset.y) / from) * to };
  return clampOffset(next, image, frame, to);
}

/** The part of the original image inside the frame, in the image's own pixels. */
export function cropRect(offset: Offset, image: Size, frame: Size, scale: number): CropRect {
  const width = Math.min(image.width, frame.width / scale);
  const height = Math.min(image.height, frame.height / scale);
  const x = Math.min(image.width - width, Math.max(0, -offset.x / scale));
  const y = Math.min(image.height - height, Math.max(0, -offset.y / scale));
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}

/** Output size for a crop, longest edge at most maxEdge. */
export function outputSize(rect: Size, maxEdge: number): Size {
  const s = Math.min(1, maxEdge / Math.max(rect.width, rect.height));
  return { width: Math.max(1, Math.round(rect.width * s)), height: Math.max(1, Math.round(rect.height * s)) };
}

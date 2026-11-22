import { lazy, Suspense } from 'react';
import type { Plot3DProps } from './Plot3DImpl';

// three.js is large, so it is only downloaded when a 3-D view is first opened.
const Impl = lazy(() => import('./Plot3DImpl'));

export function Plot3D(props: Plot3DProps) {
  return (
    <Suspense fallback={<div className="plot3d muted pad" style={{ height: props.height ?? 300 }}>Loading 3-D view…</div>}>
      <Impl {...props} />
    </Suspense>
  );
}
export type { Line3D, Marker3D, Plot3DProps, Surface3D, Vec3 } from './Plot3DImpl';

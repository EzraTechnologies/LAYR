import type { IconName } from './icons';

export const ROUTES = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'files', label: 'Files', icon: 'files' },
  { id: 'move', label: 'Move', icon: 'move' },
  { id: 'heat', label: 'Heat', icon: 'heat' },
  { id: 'extrude', label: 'Extrude', icon: 'filament' },
  { id: 'fans', label: 'Fans', icon: 'fan' },
  { id: 'macros', label: 'Macros', icon: 'bolt' },
  { id: 'console', label: 'Console', icon: 'terminal' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
] as const satisfies ReadonlyArray<{ id: string; label: string; icon: IconName }>;

export type RouteId = (typeof ROUTES)[number]['id'];

/** Parses `#/files` style hashes; unknown routes fall back to Home. */
export function parseRoute(hash: string): RouteId {
  const id = hash.replace(/^#\/?/, '').split(/[/?]/)[0] ?? '';
  return ROUTES.some((r) => r.id === id) ? (id as RouteId) : 'home';
}

export function navigate(route: RouteId): void {
  if (location.hash !== `#/${route}`) location.hash = `#/${route}`;
}

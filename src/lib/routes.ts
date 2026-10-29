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

/** Shown in the rail only after the printer lists an `mmu` object. Not part of `ROUTES`. */
export const MMU_ROUTE = { id: 'mmu', label: 'MMU', icon: 'mmu' } as const satisfies {
  id: string;
  label: string;
  icon: IconName;
};

export type RouteId = (typeof ROUTES)[number]['id'] | (typeof MMU_ROUTE)['id'];

/** Parses `#/files` style hashes; unknown routes fall back to Home. */
export function parseRoute(hash: string): RouteId {
  const id = hash.replace(/^#\/?/, '').split(/[/?]/)[0] ?? '';
  if (ROUTES.some((r) => r.id === id) || id === MMU_ROUTE.id) return id as RouteId;
  return 'home';
}

export function navigate(route: RouteId): void {
  if (location.hash !== `#/${route}`) location.hash = `#/${route}`;
}

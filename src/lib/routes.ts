import type { IconName } from './icons';

export const ROUTES = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'files', label: 'Files', icon: 'files' },
  { id: 'controls', label: 'Controls', icon: 'controls' },
  { id: 'filament', label: 'Filament', icon: 'filament' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
] as const satisfies ReadonlyArray<{ id: string; label: string; icon: IconName }>;

export type RouteId = (typeof ROUTES)[number]['id'];

/** Parses `#/files` style hashes; unknown routes fall back to Home. */
export function parseRoute(hash: string): RouteId {
  const id = hash.replace(/^#\/?/, '').split(/[/?]/)[0] ?? '';
  return ROUTES.some((r) => r.id === id) ? (id as RouteId) : 'home';
}

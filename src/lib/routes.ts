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

export type RouteId = (typeof ROUTES)[number]['id'] | 'afc' | 'mmu';

export interface NavItem {
  id: RouteId;
  label: string;
  icon: IconName;
}

/** Shown after Extrude only while the connected printer reports an `AFC` object and the switch is on. */
export const AFC_NAV = { id: 'afc', label: 'AFC', icon: 'filament' } as const satisfies NavItem;

/** Shown in the rail only after Happy Hare is on and the printer lists an `mmu` object. Not part of `ROUTES`. */
export const MMU_ROUTE = { id: 'mmu', label: 'MMU', icon: 'mmu' } as const satisfies NavItem;

const WITH_AFC: readonly NavItem[] = (() => {
  const index = ROUTES.findIndex((route) => route.id === 'extrude');
  return [...ROUTES.slice(0, index + 1), AFC_NAV, ...ROUTES.slice(index + 1)];
})();

/**
 * Rail entries. Printers without AFC or Happy Hare keep the original nine items.
 * `mmuInstalled` defaults off so existing AFC callers stay on the nine- or ten-item rail.
 */
export function navItems(afcInstalled: boolean, mmuInstalled = false): readonly NavItem[] {
  const items: NavItem[] = [...(afcInstalled ? WITH_AFC : ROUTES)];
  if (mmuInstalled) items.push(MMU_ROUTE);
  return items;
}

const ROUTE_IDS = new Set<string>([...ROUTES.map((route) => route.id), AFC_NAV.id, MMU_ROUTE.id]);

/** Parses `#/files` style hashes; unknown routes fall back to Home. */
export function parseRoute(hash: string): RouteId {
  const id = hash.replace(/^#\/?/, '').split(/[/?]/)[0] ?? '';
  return ROUTE_IDS.has(id) ? (id as RouteId) : 'home';
}

export function navigate(route: RouteId): void {
  if (location.hash !== `#/${route}`) location.hash = `#/${route}`;
}

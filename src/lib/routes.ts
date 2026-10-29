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

/** Shown only when that printer actually exposes the integration. */
export const INTEGRATION_ROUTES = [
  { id: 'filament', label: 'Spools', icon: 'spool', after: 'extrude' },
  { id: 'afc', label: 'AFC', icon: 'lanes', after: 'extrude' },
  { id: 'mmu', label: 'MMU', icon: 'gates', after: 'extrude' },
] as const satisfies ReadonlyArray<{ id: string; label: string; icon: IconName; after: string }>;

export type RouteId = (typeof ROUTES)[number]['id'] | (typeof INTEGRATION_ROUTES)[number]['id'];

export interface AppRoute {
  id: RouteId;
  label: string;
  icon: IconName;
}

const KNOWN = new Set<string>([...ROUTES.map((route) => route.id), ...INTEGRATION_ROUTES.map((route) => route.id)]);

/** Parses `#/files` style hashes; unknown routes fall back to Home. */
export function parseRoute(hash: string): RouteId {
  const id = hash.replace(/^#\/?/, '').split(/[/?]/)[0] ?? '';
  return KNOWN.has(id) ? (id as RouteId) : 'home';
}

export interface IntegrationFlags {
  spoolman: boolean;
  afc?: boolean;
  mmu?: boolean;
}

/** Core routes, plus integration entries the connected printer actually has. */
export function visibleRoutes(flags: IntegrationFlags): AppRoute[] {
  const extras: AppRoute[] = [];
  if (flags.spoolman) extras.push(INTEGRATION_ROUTES[0]);
  if (flags.afc) extras.push(INTEGRATION_ROUTES[1]);
  if (flags.mmu) extras.push(INTEGRATION_ROUTES[2]);
  const routes: AppRoute[] = ROUTES.map((route) => ({ id: route.id, label: route.label, icon: route.icon }));
  const after = routes.findIndex((route) => route.id === 'extrude');
  routes.splice(after + 1, 0, ...extras);
  return routes;
}

export function navigate(route: RouteId): void {
  if (location.hash !== `#/${route}`) location.hash = `#/${route}`;
}

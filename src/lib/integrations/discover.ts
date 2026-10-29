import type { IntegrationDiscovery } from './preferences';

type Call = (method: string, params?: Record<string, unknown>) => Promise<unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter((item): item is string => typeof item === 'string');
}

/**
 * Reads capability from a `server.info` body and a `printer.objects.list` body.
 * Omitted `components` stays unknown. It does not treat a failed request as "not installed".
 */
export function discoveryFromPayloads(info: unknown, list: unknown): IntegrationDiscovery {
  const infoRecord = isRecord(info) ? info : null;
  const listRecord = isRecord(list) ? list : null;
  return {
    objects: listRecord ? stringList(listRecord.objects) : null,
    components: infoRecord ? stringList(infoRecord.components) : null,
    failedComponents: infoRecord ? stringList(infoRecord.failed_components) : null,
  };
}

/**
 * One-shot reads used after a switch is turned on. These methods only report
 * what Moonraker already knows. They do not move the printer or change its config.
 */
export async function discoverIntegrations(call: Call): Promise<IntegrationDiscovery> {
  const [info, list] = await Promise.all([
    call('server.info').catch(() => null),
    call('printer.objects.list').catch(() => null),
  ]);
  return discoveryFromPayloads(info, list);
}

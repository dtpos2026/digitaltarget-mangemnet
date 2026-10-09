// Internal cost prices of catalog services are admin data (margins). They are
// kept in users/{ws}/serviceCosts/catalog, readable only by finance / invoice /
// settings roles — never in the settings doc that every member can read.
// Pure helpers; the Firestore side is in db.ts.

/** settings → settings without cost prices + { serviceId: cost }. */
export function splitServiceCosts(settings: any): { settings: any; costs: Record<string, number> } {
  const costs: Record<string, number> = {};
  if (!Array.isArray(settings?.services)) return { settings, costs };
  const services = settings.services.map((x: any) => {
    if (!x || x.costPrice === undefined || x.costPrice === null || x.costPrice === "") return x;
    if (x.id) costs[x.id] = Number(x.costPrice) || 0;
    const { costPrice: _drop, ...rest } = x;
    return rest;
  });
  return { settings: { ...settings, services }, costs };
}

export function mergeServiceCosts(settings: any, costs: Record<string, number> | undefined): any {
  if (!costs || !Array.isArray(settings?.services)) return settings;
  return { ...settings, services: settings.services.map((x: any) => (x?.id && costs[x.id] !== undefined ? { ...x, costPrice: costs[x.id] } : x)) };
}

/** Cost prices still inside the settings doc (saved before costs moved out). */
export const hasInlineCosts = (settings: any) => Array.isArray(settings?.services) && settings.services.some((x: any) => x && x.costPrice !== undefined && x.costPrice !== null && x.costPrice !== "");

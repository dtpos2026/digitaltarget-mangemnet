// Digital Target service catalog: business lines (categories) and the
// services sold under them, with default rates. Admins edit it in
// Settings → Services & Categories (stored as settings.services).

export const SERVICE_LINES = [
  "AI Software Development",
  "Digital Marketing",
  "Social Media Management",
  "Graphic Design",
  "Video Production",
  "Web Development",
  "Branding",
  "Other",
] as const;

export interface CatalogService {
  id: string;
  name: string;
  line: string;
  rate: number;
  unit?: string;
}

export const DEFAULT_SERVICES: CatalogService[] = [
  { id: "s-ai-app", name: "AI-based custom software / app", line: "AI Software Development", rate: 150000, unit: "project" },
  { id: "s-pos", name: "POS / management software", line: "AI Software Development", rate: 60000, unit: "license" },
  { id: "s-chatbot", name: "AI chatbot / WhatsApp automation", line: "AI Software Development", rate: 40000, unit: "project" },
  { id: "s-fb-ads", name: "Facebook & Instagram ads management", line: "Digital Marketing", rate: 20000, unit: "month" },
  { id: "s-google-ads", name: "Google Ads management", line: "Digital Marketing", rate: 25000, unit: "month" },
  { id: "s-seo", name: "SEO (monthly)", line: "Digital Marketing", rate: 30000, unit: "month" },
  { id: "s-smm", name: "Social media management (monthly)", line: "Social Media Management", rate: 35000, unit: "month" },
  { id: "s-content", name: "Content writing & captions", line: "Social Media Management", rate: 10000, unit: "month" },
  { id: "s-post", name: "Social media post design", line: "Graphic Design", rate: 500, unit: "post" },
  { id: "s-logo", name: "Logo design", line: "Graphic Design", rate: 15000, unit: "project" },
  { id: "s-reel", name: "Reel / short video editing", line: "Video Production", rate: 2500, unit: "video" },
  { id: "s-shoot", name: "Video shoot", line: "Video Production", rate: 20000, unit: "day" },
  { id: "s-website", name: "Business website", line: "Web Development", rate: 60000, unit: "project" },
  { id: "s-ecom", name: "E-commerce store", line: "Web Development", rate: 120000, unit: "project" },
  { id: "s-brand", name: "Brand identity package", line: "Branding", rate: 45000, unit: "project" },
];

export function servicesOf(settings: any): CatalogService[] {
  return Array.isArray(settings?.services) && settings.services.length ? settings.services : DEFAULT_SERVICES;
}

export function linesOf(settings: any): string[] {
  const fromCatalog = servicesOf(settings).map((s) => s.line);
  return Array.from(new Set([...SERVICE_LINES.filter((l) => l !== "Other"), ...fromCatalog, "Other"]));
}

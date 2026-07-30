export type ServiceCatalogEntry = {
  id: string;
  displayName: string;
  accent: string;
};

export const SERVICE_CATALOG = [
  { id: "openai", displayName: "OpenAI", accent: "#10A37F" },
  { id: "anthropic", displayName: "Anthropic", accent: "#D4A574" },
  { id: "aws", displayName: "AWS", accent: "#FF9900" },
  { id: "google-cloud", displayName: "Google Cloud", accent: "#4285F4" },
  { id: "azure", displayName: "Azure", accent: "#0078D4" },
  { id: "stripe", displayName: "Stripe", accent: "#635BFF" },
  { id: "github", displayName: "GitHub", accent: "#24292F" },
  { id: "cloudflare", displayName: "Cloudflare", accent: "#F38020" },
  { id: "vercel", displayName: "Vercel", accent: "#000000" },
  { id: "supabase", displayName: "Supabase", accent: "#3ECF8E" },
  { id: "custom", displayName: "Custom", accent: "#6B7280" },
] as const satisfies readonly ServiceCatalogEntry[];

export type ServiceId = (typeof SERVICE_CATALOG)[number]["id"];

const customService = SERVICE_CATALOG.find((service) => service.id === "custom")!;

export function getService(id: string): ServiceCatalogEntry {
  return SERVICE_CATALOG.find((service) => service.id === id) ?? customService;
}

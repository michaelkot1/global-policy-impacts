// The filter state of the /policies catalog and its URL parsing. Kept out of the client
// component so the server page can call parseView.

import { LEVEL_FILTERS, type LevelFilter } from "@/lib/policy-model";
import type { EvidenceTier } from "@/lib/state-model";

export const TIERS = ["A", "B", "C", "D"] as const;
export const STATUSES = ["enacted", "repealed", "blocked", "expired"] as const;

export const SORTS = [
  { id: "newest", label: "Newest first" },
  { id: "oldest", label: "Oldest first" },
  { id: "title", label: "Title A–Z" },
  { id: "effect", label: "Largest estimated effect" },
  { id: "evidence", label: "Strongest evidence" },
] as const;
export type SortId = (typeof SORTS)[number]["id"];

export interface CatalogView {
  q: string;
  level: LevelFilter | "all";
  status: (typeof STATUSES)[number] | "all";
  tier: EvidenceTier | "all";
  quantified: boolean;
  sort: SortId;
}

export const DEFAULT_VIEW: CatalogView = {
  q: "",
  level: "all",
  status: "all",
  tier: "all",
  quantified: false,
  sort: "newest",
};

export function parseView(raw: { [key: string]: string | string[] | undefined }): CatalogView {
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const level = first(raw.level);
  const status = first(raw.status);
  const tier = first(raw.tier);
  const sort = first(raw.sort);
  return {
    q: first(raw.q)?.slice(0, 100) ?? "",
    level: LEVEL_FILTERS.some((l) => l.id === level) ? (level as LevelFilter) : "all",
    status: (STATUSES as readonly string[]).includes(status ?? "")
      ? (status as CatalogView["status"])
      : "all",
    tier: (TIERS as readonly string[]).includes(tier ?? "") ? (tier as EvidenceTier) : "all",
    quantified: first(raw.quantified) === "1",
    sort: SORTS.some((s) => s.id === sort) ? (sort as SortId) : "newest",
  };
}

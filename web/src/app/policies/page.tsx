import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { getPolicyCatalog } from "@/lib/policy-data";
import { PolicyCatalog } from "./catalog";
import { parseView } from "./catalog-view";

export const metadata: Metadata = {
  title: "Climate and energy policy catalog",
  description:
    "Federal laws, regulations, executive orders, state programs and international agreements that bear on U.S. state CO₂ emissions, with the evidence for each one's effect.",
};

async function Catalog({ searchParams }: Pick<PageProps<"/policies">, "searchParams">) {
  const [policies, raw] = await Promise.all([getPolicyCatalog(), searchParams]);
  return <PolicyCatalog policies={policies} initial={parseView(raw)} />;
}

export default function PoliciesPage(props: PageProps<"/policies">) {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">
      <header className="mb-6 max-w-3xl">
        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Policies</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">
          Climate and energy policy catalog
        </h1>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          The laws, rules and agreements that applied to U.S. states, each with the evidence on
          what it did to energy-related CO₂ emissions. Evidence is graded A to D so a correlation
          is never presented as a cause;{" "}
          <Link href="/methodology#evidence-tiers" className="underline underline-offset-2">
            see how the grades work
          </Link>
          .
        </p>
      </header>

      <Suspense fallback={<CatalogSkeleton />}>
        <Catalog searchParams={props.searchParams} />
      </Suspense>
    </main>
  );
}

function CatalogSkeleton() {
  return (
    <div className="animate-pulse space-y-3" aria-busy="true" aria-label="Loading policies">
      <div className="h-24 rounded-lg bg-zinc-100 dark:bg-zinc-900" />
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="h-32 rounded-lg bg-zinc-100 dark:bg-zinc-900" />
      ))}
    </div>
  );
}

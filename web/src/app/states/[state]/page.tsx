import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getStatePageData, getStateSlugs } from "@/lib/state-data";
import { NORM_LABELS, NORM_UNITS, formatPercentChange, formatValue, type Norm } from "@/lib/co2-model";
import { KIND_LABELS, ordinal, type StatePageData } from "@/lib/state-model";
import { StateExplorer } from "./explorer";

export async function generateStaticParams() {
  return (await getStateSlugs()).map((state) => ({ state }));
}

export async function generateMetadata(props: PageProps<"/states/[state]">): Promise<Metadata> {
  const { state } = await props.params;
  const data = await getStatePageData(state);
  if (!data) return { title: "State not found" };
  return {
    title: `${data.name}: CO₂ emissions and climate policies`,
    description: `${data.name}'s energy-related CO₂ emissions since 1970 by sector, its rank among states, and the federal, state and international policies that applied to it, with evidence tiers.`,
  };
}

function lastIndex(values: (number | null)[]) {
  for (let i = values.length - 1; i >= 0; i--) if (values[i] != null) return i;
  return -1;
}

/** State value for one normalization (all sectors) in the year at `yi`. */
function valueFor(data: StatePageData, norm: Norm, yi: number): number | null {
  const mt = data.emissions.total[yi];
  if (mt == null) return null;
  if (norm === "total") return mt;
  const d = norm === "per_capita" ? data.population[yi] : data.gdp[yi];
  return d ? (mt * 1e6) / d : null;
}

function Facts({ data }: { data: StatePageData }) {
  const yi = lastIndex(data.emissions.total);
  const year = data.years[yi];
  const at = (y: number) => data.years.indexOf(y);
  const norms = (["total", "per_capita", "per_gdp"] as const).filter((n) => data.allowed[n]);

  return (
    <section aria-label={`${data.name} at a glance`}>
      <dl className="grid gap-3 sm:grid-cols-3">
        {norms.map((n) => {
          const v = valueFor(data, n, yi);
          const r = data.ranks[n].rank[yi];
          const base = at(2005) >= 0 ? valueFor(data, n, at(2005)) : null;
          const base90 = at(1990) >= 0 ? valueFor(data, n, at(1990)) : null;
          return (
            <div key={n} className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
              <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                {NORM_LABELS[n]}, {year}
              </dt>
              <dd className="mt-1">
                <span className="text-2xl font-semibold tabular-nums">{formatValue(v)}</span>{" "}
                <span className="text-sm text-zinc-500">{NORM_UNITS[n].short}</span>
                <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                  {r != null && (
                    <>
                      {ordinal(r)} of {data.ranks[n].of[yi]} highest
                    </>
                  )}
                  {n !== "per_gdp" && (
                    <>
                      {r != null && " · "}
                      {formatPercentChange(v, base)} vs 2005, {formatPercentChange(v, base90)} vs
                      1990
                    </>
                  )}
                </p>
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}

function NeverApplied({ data }: { data: StatePageData }) {
  if (data.neverApplied.length === 0) return null;
  return (
    <section aria-labelledby="never-h" className="mt-12 max-w-3xl">
      <h2 id="never-h" className="text-xl font-semibold">
        Policies that never took effect here
      </h2>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        These are in the catalog but never legally bound any state (for example because a court
        stayed them or the country never ratified), so they cannot explain {data.name}&apos;s
        emissions. They are listed so a missing marker is not mistaken for an omission.
      </p>
      <ul className="mt-3 space-y-2 text-sm">
        {data.neverApplied.map((p) => (
          <li key={p.id} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
            <p className="font-medium">
              {p.title}{" "}
              <span className="font-normal text-zinc-500">
                · {KIND_LABELS[p.kind] ?? p.kind} · {p.status}
              </span>
            </p>
            {p.summary && <p className="mt-1 text-zinc-600 dark:text-zinc-400">{p.summary}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}

async function StateContent({ params }: { params: PageProps<"/states/[state]">["params"] }) {
  const { state } = await params;
  const data = await getStatePageData(state);
  if (!data) notFound();

  return (
    <>
      <nav aria-label="Breadcrumb" className="text-sm text-zinc-500">
        <Link href="/metrics/co2" className="underline-offset-2 hover:underline">
          CO₂ emissions by state
        </Link>{" "}
        <span aria-hidden>/</span> <span className="text-foreground">{data.name}</span>
      </nav>

      <header className="mt-3 max-w-3xl">
        <h1 className="text-3xl font-semibold tracking-tight">{data.name}</h1>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          Energy-related CO₂ emissions from {data.years[0]} to {data.years[data.years.length - 1]},
          where {data.name} ranks among states, and the policies that applied to it.{" "}
          <Link
            href={`/metrics/co2?state=${data.code}`}
            className="underline underline-offset-2"
          >
            Show on the map
          </Link>
        </p>
      </header>

      <div className="mt-6">
        <Facts data={data} />
      </div>

      <StateExplorer data={data} />

      <NeverApplied data={data} />

      <section className="mt-12 max-w-3xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">
        <h2 className="text-base font-semibold text-foreground">How to read this page</h2>
        <ul className="mt-2 list-disc space-y-1.5 pl-5">
          <li>
            Emissions are energy-related CO₂ counted where fuel is burned (EIA); per capita uses
            Census population and per GDP uses BEA GDP in current dollars. See{" "}
            <Link href="/metrics/co2#sources" className="underline underline-offset-2">
              sources and method
            </Link>
            .
          </li>
          <li>
            A marker shows when a policy began to apply, not what it caused. Federal policies
            apply to every state at once, so they have no untreated comparison states; only
            estimates tagged tier A or B come from a method that tries to isolate an effect.
          </li>
          <li>
            Tier A is peer-reviewed quasi-experimental evidence, B is this site&apos;s own event
            study, C is an association or trend, and D is a plausible mechanism with no measured
            effect. Size (impact score) and strength (tier, confidence) are shown separately.
          </li>
        </ul>
      </section>
        </>
  );
}

export default function StatePage(props: PageProps<"/states/[state]">) {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">
      <Suspense fallback={<StateSkeleton />}>
        <StateContent params={props.params} />
      </Suspense>
    </main>
  );
}

function StateSkeleton() {
  return (
    <div className="animate-pulse space-y-6" aria-busy="true" aria-label="Loading state data">
      <div className="h-8 w-48 rounded bg-zinc-100 dark:bg-zinc-900" />
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="h-24 rounded-lg bg-zinc-100 dark:bg-zinc-900" />
        <div className="h-24 rounded-lg bg-zinc-100 dark:bg-zinc-900" />
        <div className="h-24 rounded-lg bg-zinc-100 dark:bg-zinc-900" />
      </div>
      <div className="h-96 rounded-lg bg-zinc-100 dark:bg-zinc-900" />
    </div>
  );
}

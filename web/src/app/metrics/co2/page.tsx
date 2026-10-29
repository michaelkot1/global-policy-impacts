import type { Metadata } from "next";
import { Suspense } from "react";
import { getCo2Dataset } from "@/lib/co2-data";
import { NORMS, SECTORS, type Co2Dataset, type Norm, type Sector } from "@/lib/co2-model";
import { Co2Explorer, type InitialView } from "./explorer";

export const metadata: Metadata = {
  title: "Energy-related CO₂ emissions by state",
  description:
    "Rank U.S. states by energy-related CO₂ emissions, 1970 to the latest year: total, per capita or per dollar of GDP, by sector.",
};

const METRIC_LABEL: Record<string, string> = {
  co2: "Emissions",
  population: "Population (per-capita measure)",
  gdp: "GDP (per-GDP measure)",
};

function first(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

function parseView(
  raw: { [key: string]: string | string[] | undefined },
  ds: Co2Dataset,
): InitialView {
  const view: InitialView = {};
  const norm = first(raw.norm);
  if ((NORMS as readonly string[]).includes(norm ?? "")) view.norm = norm as Norm;
  const sector = first(raw.sector);
  if ((SECTORS as readonly string[]).includes(sector ?? "")) view.sector = sector as Sector;
  const year = Number(first(raw.year));
  if (Number.isInteger(year) && ds.years.includes(year)) view.year = year;
  const state = first(raw.state);
  if (state && ds.states.some((s) => s.code === state)) view.state = state;
  return view;
}

async function Explorer({ searchParams }: Pick<PageProps<"/metrics/co2">, "searchParams">) {
  const [ds, raw] = await Promise.all([getCo2Dataset(), searchParams]);
  return <Co2Explorer ds={ds} initial={parseView(raw, ds)} />;
}

async function SourcesAndMethod() {
  const ds = await getCo2Dataset();
  return (
    <section id="sources" className="mt-12 max-w-3xl scroll-mt-6 text-sm leading-6">
      <h2 className="text-lg font-semibold">Sources and method</h2>
      {ds.metric.definition && <p className="mt-2">{ds.metric.definition}</p>}
      {ds.metric.methodology && <p className="mt-2 text-zinc-600 dark:text-zinc-400">{ds.metric.methodology}</p>}

      <ul className="mt-4 space-y-1.5">
        {ds.sources.map((s) => (
          <li key={`${s.metric}-${s.name}`}>
            <span className="text-zinc-500">{METRIC_LABEL[s.metric] ?? s.metric}: </span>
            {s.url ? (
              <a
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium underline underline-offset-2"
              >
                {s.name}
              </a>
            ) : (
              <span className="font-medium">{s.name}</span>
            )}
            {s.publisher && <span className="text-zinc-500">, {s.publisher}</span>}
          </li>
        ))}
      </ul>

      <h3 className="mt-6 font-semibold">Reading the numbers</h3>
      <ul className="mt-2 list-disc space-y-1.5 pl-5 text-zinc-600 dark:text-zinc-400">
        <li>
          Emissions are counted where the fuel is burned. A state that exports electricity is
          charged for the power plants inside it, not for the people who use the power.
        </li>
        <li>
          <strong className="font-medium text-foreground">Per capita</strong> divides by Census
          population. Before 2000, annual population is interpolated between decennial counts.
        </li>
        <li>
          <strong className="font-medium text-foreground">Per GDP</strong> divides by BEA state GDP
          in current (not inflation-adjusted) dollars, so it falls partly because prices rise. It is
          only available from 1997, and it is best used to compare states within one year.
        </li>
        <li>
          The United States figure on this page is the sum of the 50 states and DC. The pipeline
          checks that sum against EIA&apos;s national total every year.
        </li>
        <li>
          Each state-year is a rank among all states with data. Rankings show where emissions are,
          not what any policy caused.
        </li>
      </ul>
    </section>
  );
}

export default function Co2Page(props: PageProps<"/metrics/co2">) {
  return (
    <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6">
      <header className="mb-6 max-w-3xl">
        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Metric</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">
          Energy-related CO₂ emissions by state
        </h1>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          Compare states from 1970 to the latest year, as a total, per person or per dollar of
          GDP, for all sectors or one.{" "}
          <a href="#sources" className="underline underline-offset-2">
            Sources and method
          </a>
        </p>
      </header>

      <Suspense fallback={<ExplorerSkeleton />}>
        <Explorer searchParams={props.searchParams} />
      </Suspense>

      <Suspense fallback={null}>
        <SourcesAndMethod />
      </Suspense>
    </main>
  );
}

function ExplorerSkeleton() {
  return (
    <div
      className="grid animate-pulse gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]"
      aria-busy="true"
      aria-label="Loading emissions data"
    >
      <div className="aspect-[975/610] rounded-lg bg-zinc-100 dark:bg-zinc-900" />
      <div className="h-96 rounded-lg bg-zinc-100 dark:bg-zinc-900" />
    </div>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { EffectBlock, STATUS_LABELS } from "@/components/evidence";
import {
  getAllStateNames,
  getPolicyDetail,
  getPolicySlugs,
} from "@/lib/policy-data";
import {
  describeJurisdictions,
  formatDate,
  type PolicyDetail,
  type PolicyReference,
} from "@/lib/policy-model";
import { KIND_LABELS } from "@/lib/state-model";
import { EventStudyDetail } from "./event-study";
import { CoverageTimeline } from "./timeline";

export async function generateStaticParams() {
  return (await getPolicySlugs()).map((slug) => ({ slug }));
}

export async function generateMetadata(props: PageProps<"/policies/[slug]">): Promise<Metadata> {
  const { slug } = await props.params;
  const p = await getPolicyDetail(slug);
  if (!p) return { title: "Policy not found" };
  return {
    title: `${p.title}: evidence on CO₂ emissions`,
    description:
      p.summary ??
      `${p.title}: where and when it applied, and the evidence on its effect on energy-related CO₂ emissions.`,
  };
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</dt>
      <dd className="mt-0.5 text-sm">{children}</dd>
    </div>
  );
}

function ReferenceList({ items }: { items: PolicyReference[] }) {
  return (
    <ul className="space-y-2 text-sm">
      {items.map((c, i) => {
        const href = c.doi ? `https://doi.org/${c.doi}` : c.url;
        return (
          <li key={i} className="leading-snug">
            {c.authors && (
              <span className="text-zinc-600 dark:text-zinc-400">
                {c.authors}
                {c.year ? ` (${c.year}). ` : ". "}
              </span>
            )}
            {href ? (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium underline underline-offset-2"
              >
                {c.title}
              </a>
            ) : (
              <span className="font-medium">{c.title}</span>
            )}
            {c.publisher && <span className="text-zinc-500">, {c.publisher}</span>}
            {c.doi && <span className="text-zinc-500"> · DOI {c.doi}</span>}
            {c.accessed && <span className="text-zinc-500"> · accessed {formatDate(c.accessed)}</span>}
          </li>
        );
      })}
    </ul>
  );
}

function Evidence({ p }: { p: PolicyDetail }) {
  const federalLike = p.level === "federal" || p.level === "international";
  return (
    <section aria-labelledby="evidence-h" className="mt-10">
      <h2 id="evidence-h" className="text-xl font-semibold">
        Evidence on CO₂ emissions
      </h2>
      <p className="mt-1 max-w-3xl text-sm text-zinc-600 dark:text-zinc-400">
        The size of an effect (impact score) and how far to trust it (evidence tier and confidence)
        are always shown separately.{" "}
        <Link href="/methodology#evidence-tiers" className="underline underline-offset-2">
          How tiers and scores work
        </Link>
        .
      </p>
      {federalLike && p.groups.length > 0 && (
        <p className="mt-2 max-w-3xl text-sm text-zinc-600 dark:text-zinc-400">
          {p.level === "federal" ? "A federal policy" : "An international agreement"} applies to
          every state it covers at the same time, so there are no unaffected states to compare
          against. Without a
          comparison group this site cannot estimate its effect itself, and a tier A or B rating
          would need a published study that found another way to isolate it.
        </p>
      )}
      <div className="mt-4 max-w-3xl space-y-3">
        {p.effects.length === 0 ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">No evidence record for CO₂ yet.</p>
        ) : (
          p.effects.map((e) => <EffectBlock key={e.id} e={e} />)
        )}
      </div>
    </section>
  );
}

function Coverage({ p, allStateNames }: { p: PolicyDetail; allStateNames: string[] }) {
  return (
    <section aria-labelledby="coverage-h" className="mt-12">
      <h2 id="coverage-h" className="text-xl font-semibold">
        Where and when it applied
      </h2>
      {p.groups.length === 0 ? (
        <p className="mt-2 max-w-3xl text-sm text-zinc-600 dark:text-zinc-400">
          This policy never legally bound any state (see the summary above for why), so it cannot
          explain any state&apos;s emissions. It is in the catalog so that a missing marker on a
          state page is not mistaken for an omission.
        </p>
      ) : (
        <>
          <p className="mt-1 max-w-3xl text-sm text-zinc-600 dark:text-zinc-400">
            {p.statesCovered >= p.statesTotal
              ? "Every state and DC was covered"
              : p.statesCovered > 0
                ? `${p.statesCovered} of the ${p.statesTotal} jurisdictions (50 states and DC) ${
                    p.statesCovered === 1 ? "was" : "were"
                  } covered at some point`
                : "Covers the country as a whole"}
            . Dates can differ by state, and some states joined, left or returned.
          </p>
          <div className="mt-4">
            <CoverageTimeline
              groups={p.groups}
              allStateNames={allStateNames}
              dataEndYear={p.dataEndYear}
              fallbackStart={p.effective ?? p.enacted}
            />
          </div>
          {p.notes.length > 0 && (
            <details className="mt-4 max-w-3xl text-sm">
              <summary className="cursor-pointer text-zinc-600 underline-offset-2 hover:underline dark:text-zinc-400">
                Notes on the dates ({p.notes.length})
              </summary>
              <ul className="mt-2 space-y-2 text-xs leading-5 text-zinc-600 dark:text-zinc-400">
                {p.notes.map((n, i) => (
                  <li key={i}>
                    <span className="font-medium text-foreground">
                      {describeJurisdictions(n.names, allStateNames)}.
                    </span>{" "}
                    {n.text}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {p.datesApproximate && (
            <p className="mt-3 max-w-3xl text-xs text-zinc-500">
              Where the catalog knows only a year or month, a start date is set to the first day
              and an end date to the last day of that period.
            </p>
          )}
        </>
      )}
    </section>
  );
}

async function PolicyContent({ params }: { params: PageProps<"/policies/[slug]">["params"] }) {
  const { slug } = await params;
  const [p, allStateNames] = await Promise.all([getPolicyDetail(slug), getAllStateNames()]);
  if (!p) notFound();

  const dates: { label: string; value: string }[] = [];
  const enacted = formatDate(p.enacted);
  const effective = formatDate(p.effective);
  const repealed = formatDate(p.repealed);
  if (enacted) dates.push({ label: "Enacted", value: enacted });
  if (effective && effective !== enacted) dates.push({ label: "Effective", value: effective });
  if (repealed) dates.push({ label: p.status === "repealed" ? "Repealed" : "Ended", value: repealed });

  return (
    <>
      <nav aria-label="Breadcrumb" className="text-sm text-zinc-500">
        <Link href="/policies" className="underline-offset-2 hover:underline">
          Policies
        </Link>{" "}
        <span aria-hidden>/</span> <span className="text-foreground">{p.title}</span>
      </nav>

      <header className="mt-3 max-w-3xl">
        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
          {KIND_LABELS[p.kind] ?? p.kind}
          {p.issuer !== "United States" && ` · ${p.issuer}`}
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">{p.title}</h1>
        {p.summary && <p className="mt-3 text-zinc-700 dark:text-zinc-300">{p.summary}</p>}
      </header>

      <dl className="mt-5 grid max-w-3xl grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
        <Fact label="Status">{STATUS_LABELS[p.status] ?? p.status}</Fact>
        {dates.map((d) => (
          <Fact key={d.label} label={d.label}>
            <span className="tabular-nums">{d.value}</span>
          </Fact>
        ))}
        {p.officialUrl && (
          <Fact label="Official source">
            <a
              href={p.officialUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2"
            >
              Read the text
            </a>
          </Fact>
        )}
      </dl>

      <Evidence p={p} />
      <EventStudyDetail effects={p.effects} />
      <Coverage p={p} allStateNames={allStateNames} />

      <section aria-labelledby="refs-h" className="mt-12 max-w-3xl">
        <h2 id="refs-h" className="text-xl font-semibold">
          Citations
        </h2>
        {p.sources.length > 0 && (
          <>
            <h3 className="mt-3 text-sm font-semibold">Sources for the dates and legal text</h3>
            <div className="mt-2">
              <ReferenceList items={p.sources} />
            </div>
          </>
        )}
        {p.research.length > 0 ? (
          <>
            <h3 className="mt-5 text-sm font-semibold">Research and data behind the effect estimates</h3>
            <div className="mt-2">
              <ReferenceList items={p.research} />
            </div>
          </>
        ) : (
          <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">
            No research on this policy&apos;s effect on CO₂ is cited, because none was found that
            quantifies it.
          </p>
        )}
      </section>

      <p className="mt-12 text-sm">
        <Link href="/policies" className="underline underline-offset-2">
          ← All policies
        </Link>
      </p>
    </>
  );
}

export default function PolicyPage(props: PageProps<"/policies/[slug]">) {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">
      <Suspense fallback={<PolicySkeleton />}>
        <PolicyContent params={props.params} />
      </Suspense>
    </main>
  );
}

function PolicySkeleton() {
  return (
    <div className="animate-pulse space-y-6" aria-busy="true" aria-label="Loading policy">
      <div className="h-8 w-2/3 rounded bg-zinc-100 dark:bg-zinc-900" />
      <div className="h-20 max-w-3xl rounded-lg bg-zinc-100 dark:bg-zinc-900" />
      <div className="h-64 rounded-lg bg-zinc-100 dark:bg-zinc-900" />
    </div>
  );
}

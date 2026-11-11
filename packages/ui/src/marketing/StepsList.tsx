// Owner: 15-10 (P15-P1). StepsList: "How it works" as an <ol> (UI-SPEC Home section 4). The sequence
// carries information, so the <ol> numbers the steps (native markers, Anybody 700), never big numerals.
// Steps come from MK_COPY.HOME.STEPS via the page.

export type MkStep = { readonly title: string; readonly body: string };

export type StepsListProps = {
  steps: readonly MkStep[];
  className?: string;
};

export function StepsList({ steps, className }: StepsListProps) {
  return (
    <ol
      className={[
        "m-0 grid list-decimal grid-cols-1 gap-x-12 gap-y-8 pl-6 marker:font-mk-display marker:font-bold marker:text-mk-fg sm:grid-cols-2 lg:grid-cols-4",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {steps.map((step) => (
        <li key={step.title} className="pl-2 text-[18px] leading-[1.55]">
          <span className="block font-bold">{step.title}</span>
          <span className="mt-2 block [text-wrap:pretty] text-mk-muted">
            {step.body}
          </span>
        </li>
      ))}
    </ol>
  );
}

import type { LandingCopy } from "./landingCopy";

export function LandingHowItWorks({
  steps,
  showcase,
  onStart,
}: {
  readonly steps: LandingCopy["steps"];
  readonly showcase: LandingCopy["showcase"];
  readonly onStart: () => void;
}) {
  return (
    <>
      <section className="ob-landing-section" id="how">
        <div className="ob-landing-container">
          <div className="ob-landing-section-head">
            <h2>{steps.heading}</h2>
            <p>{steps.subheading}</p>
          </div>
          <ol className="ob-landing-timeline">
            {steps.items.map((step) => (
              <li className="ob-landing-timeline-item" key={step.title}>
                <span className="ob-landing-timeline-node" aria-hidden="true" />
                <div className="ob-landing-timeline-body">
                  <h3>{step.title}</h3>
                  <p>{step.desc}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="ob-landing-section" id="ideas">
        <div className="ob-landing-container">
          <div className="ob-landing-section-head">
            <h2>{showcase.heading}</h2>
            <p>{showcase.subheading}</p>
          </div>
          <div className="ob-landing-showcase-grid">
            {showcase.prompts.map((prompt) => (
              <button
                type="button"
                className="ob-landing-prompt"
                key={prompt}
                onClick={onStart}
              >
                {prompt}
              </button>
            ))}
          </div>
          <p className="ob-landing-showcase-hint">{showcase.hint}</p>
        </div>
      </section>
    </>
  );
}

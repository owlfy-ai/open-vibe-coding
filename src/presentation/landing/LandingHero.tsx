import { useEffect, useRef, useState } from "react";
import type { LandingCopy } from "./landingCopy";
import { Icon } from "../icons";

const DINO_GIF = "https://c.qidea.ai/static/images/dino1.gif";
// The single-play gif is mounted fresh when the preview phase begins, so it
// starts from the first frame, plays once and stops. Tune PREVIEW_PLAY_MS to
// roughly the gif's own duration; afterwards it lingers (on its last frame)
// for PREVIEW_LINGER_MS before the whole loop resets to the prompt.
const PREVIEW_PLAY_MS = 5200;
const PREVIEW_LINGER_MS = 3000;
// Cross-fade when the loop resets: the body fades out, then the next loop's
// prompt fades back in.
const FADE_MS = 450;
// How long the "Rendering…" loader shows between writing the files and the
// live gif preview.
const RENDER_MS = 1500;
// File names cycled under the "Coding…" label during the tools phase to suggest
// the agent actively writing code.
const EDITING_FILES = [
  "index.html",
  "App.jsx",
  "main.jsx",
  "index.jsx",
  "package.json",
  "styles.css",
  "game.css",
  "gameLogic.js",
  "dino.js",
  "cactus.js",
  "pterosaur.js",
  "scoreboard.js",
  "physics.js",
  "input.js",
  "utils.js",
  "config.json",
];

export function LandingHero({
  copy,
  onStart,
}: {
  readonly copy: LandingCopy["hero"];
  readonly onStart: () => void;
}) {
  return (
    <section className="ob-landing-hero" id="top">
      <div className="ob-landing-hero-glow" aria-hidden="true" />
      <div className="ob-landing-container ob-landing-hero-content">
        <h1>{copy.title}</h1>
        <p className="ob-landing-hero-sub">{copy.subtitle}</p>
        <div className="ob-landing-hero-actions">
          <button
            type="button"
            className="ob-landing-cta ob-landing-cta--lg"
            onClick={onStart}
          >
            {copy.primaryCta}
            <Icon name="chevronRight" size={18} />
          </button>
        </div>
      </div>

      <div className="ob-landing-container">
        <ProductMockup copy={copy.mockup} />
      </div>
    </section>
  );
}

/**
 * A static, pure-CSS/JSX stand-in for the studio (chat + live preview). It
 * loops a short demo: user prompt → typed agent reply → streaming tool calls
 * → live gif preview, then repeats. Decorative only — no Sandpack, no runtime.
 */
function ProductMockup({
  copy,
}: {
  readonly copy: LandingCopy["hero"]["mockup"];
}) {
  const { phase, typedText, visibleSteps } = useMockupTimeline(
    copy.agentMsg,
    copy.steps.length,
  );
  const showAgent = phase !== "prompt";
  // Resolve a gif URL that restarts the single-play gif on every preview entry.
  // Prefers a fresh object URL minted from a cached blob (no re-download each
  // loop); falls back to a cache-busting direct URL if CORS blocks the fetch.
  const gifUrl = useGifUrl(phase);

  return (
    <div className="ob-landing-mockup" aria-hidden="true">
      <div className="ob-landing-mockup-frame">
        <div className="ob-landing-mockup-chrome">
          <span className="ob-landing-mockup-dots">
            <span />
            <span />
            <span />
          </span>
          <span className="ob-landing-mockup-url">
            <Icon name="globe" size={13} />
            {copy.url}
          </span>
        </div>
        <div className={`ob-landing-mockup-body ${phase === "fading" ? "is-fading" : ""}`}>
          <div className="ob-landing-mockup-chat">
            <div className="ob-landing-mockup-bubble is-user">{copy.userMsg}</div>
            {showAgent ? (
              <div className="ob-landing-mockup-bubble is-agent">
                {typedText}
                {phase === "typing" ? (
                  <span className="ob-landing-mockup-caret" aria-hidden="true" />
                ) : null}
              </div>
            ) : null}
            <ul className="ob-landing-mockup-steps">
              {copy.steps.slice(0, visibleSteps).map((step) => (
                <li key={step}>
                  <span className="ob-landing-mockup-check" aria-hidden="true">
                    <Icon name="check" size={11} />
                  </span>
                  {step}
                </li>
              ))}
            </ul>
            <div className="ob-landing-mockup-composer">
              <span>{copy.composerPlaceholder}</span>
              <span className="ob-landing-mockup-send">
                <Icon name="send" size={13} />
              </span>
            </div>
          </div>
          <div className="ob-landing-mockup-preview">
            <PreviewPane phase={phase} codingLabel={copy.coding} gifUrl={gifUrl} editingPrefix={copy.editingPrefix} renderingLabel={copy.rendering} />
          </div>
        </div>
      </div>
    </div>
  );
}

function PreviewPane({
  phase,
  codingLabel,
  gifUrl,
  editingPrefix,
  renderingLabel,
}: {
  readonly phase: MockupPhase;
  readonly codingLabel: string;
  readonly gifUrl: string;
  readonly editingPrefix: string;
  readonly renderingLabel: string;
}) {
  const editingFile = useEditingFile(phase === "tools", EDITING_FILES);
  // Show the gif only during the preview phase. Otherwise a loader is shown:
  // "Coding…" while the agent works (cycling the file being edited during the
  // tools phase), then "Rendering…" once the code is done and the build is
  // being prepared.
  if (phase === "preview" || phase === "fading") {
    return (
      <img
        className="ob-landing-mockup-scene"
        src={gifUrl}
        alt=""
        loading="lazy"
      />
    );
  }
  return (
    <div className="ob-landing-mockup-coding">
      <span className="ob-landing-mockup-spinner" aria-hidden="true" />
      <span className="ob-landing-mockup-coding-label">
        {phase === "rendering" ? renderingLabel : codingLabel}
      </span>
      {editingFile ? (
        <span className="ob-landing-mockup-editing">
          {editingPrefix} <span className="ob-landing-mockup-editing-file">{editingFile}</span>…
        </span>
      ) : null}
    </div>
  );
}

type MockupPhase = "prompt" | "typing" | "tools" | "rendering" | "preview" | "fading";

/**
 * Drives the mockup loop. Phases advance on timers; typing and step reveal
 * progress one unit per tick. Under `prefers-reduced-motion` the loop is
 * skipped and the finished state is shown statically.
 */
function useMockupTimeline(agentMsg: string, stepCount: number) {
  const reduceMotion = usePrefersReducedMotion();
  const [phase, setPhase] = useState<MockupPhase>("prompt");
  const [typed, setTyped] = useState(0);
  const [visibleSteps, setVisibleSteps] = useState(0);

  useEffect(() => {
    if (!reduceMotion) return;
    setPhase("preview");
    setTyped(agentMsg.length);
    setVisibleSteps(stepCount);
  }, [reduceMotion, agentMsg.length, stepCount]);

  useEffect(() => {
    if (reduceMotion || phase !== "prompt") return;
    const t = window.setTimeout(() => setPhase("typing"), 1100);
    return () => window.clearTimeout(t);
  }, [reduceMotion, phase]);

  useEffect(() => {
    if (reduceMotion || phase !== "typing") return;
    if (typed >= agentMsg.length) {
      const t = window.setTimeout(() => setPhase("tools"), 450);
      return () => window.clearTimeout(t);
    }
    const t = window.setTimeout(() => setTyped((c) => c + 1), 22);
    return () => window.clearTimeout(t);
  }, [reduceMotion, phase, typed, agentMsg.length]);

  useEffect(() => {
    if (reduceMotion || phase !== "tools") return;
    if (visibleSteps >= stepCount) {
      const t = window.setTimeout(() => setPhase("rendering"), 750);
      return () => window.clearTimeout(t);
    }
    const t = window.setTimeout(() => setVisibleSteps((s) => s + 1), 680);
    return () => window.clearTimeout(t);
  }, [reduceMotion, phase, visibleSteps, stepCount]);

  // All files written → render the final build before showing the live result.
  useEffect(() => {
    if (reduceMotion || phase !== "rendering") return;
    const t = window.setTimeout(() => setPhase("preview"), RENDER_MS);
    return () => window.clearTimeout(t);
  }, [reduceMotion, phase]);

  useEffect(() => {
    if (reduceMotion || phase !== "preview") return;
    const t = window.setTimeout(() => setPhase("fading"), PREVIEW_PLAY_MS + PREVIEW_LINGER_MS);
    return () => window.clearTimeout(t);
  }, [reduceMotion, phase]);

  // Fade the body out, then reset the loop and let the next prompt fade in.
  useEffect(() => {
    if (reduceMotion || phase !== "fading") return;
    const t = window.setTimeout(() => {
      setTyped(0);
      setVisibleSteps(0);
      setPhase("prompt");
    }, FADE_MS);
    return () => window.clearTimeout(t);
  }, [reduceMotion, phase]);

  return {
    phase,
    typedText: agentMsg.slice(0, typed),
    visibleSteps,
  };
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true,
  );
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

function useGifUrl(phase: MockupPhase) {
  const blobRef = useRef<Blob | null>(null);
  const objUrlRef = useRef<string | null>(null);
  const [url, setUrl] = useState<string>(DINO_GIF);

  // Download the gif once and cache it as a blob.
  useEffect(() => {
    let cancelled = false;
    fetch(DINO_GIF)
      .then((r) => r.blob())
      .then((blob) => {
        if (cancelled) return;
        blobRef.current = blob;
      })
      .catch(() => {
        /* CORS or network error → keep falling back to the direct URL */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // On each preview entry, mint a fresh object URL from the cached blob. A new
  // URL makes the browser reload the gif (so the single-play gif restarts from
  // frame 0) without re-downloading the ~1MB payload every loop.
  useEffect(() => {
    if (phase === "preview") {
      const blob = blobRef.current;
      if (blob) {
        const objUrl = URL.createObjectURL(blob);
        objUrlRef.current = objUrl;
        setUrl(objUrl);
      } else {
        // Blob not ready yet or fetch was blocked: cache-bust the direct URL.
        setUrl(`${DINO_GIF}?r=${Date.now()}`);
      }
    }
    // Keep the URL through the fading phase (gif stays visible while fading
    // out); release it once the loop resets to prompt.
    if (phase === "prompt" && objUrlRef.current) {
      URL.revokeObjectURL(objUrlRef.current);
      objUrlRef.current = null;
    }
  }, [phase]);

  return url;
}

function useEditingFile(active: boolean, files: readonly string[]) {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (!active) return;
    setIndex(0);
    const id = window.setInterval(() => {
      setIndex((i) => (i + 1) % files.length);
    }, 300);
    return () => window.clearInterval(id);
  }, [active, files.length]);
  return active ? files[index] : null;
}

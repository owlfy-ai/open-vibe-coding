import { useEffect, useState } from "react";
import { getOperationsConfig } from "@/app/operations-config";
import { BackendClient, type PublishedGalleryItem } from "@/infrastructure/backend";
import type { LandingCopy } from "./landingCopy";

export function LandingGallery({ copy }: { readonly copy: LandingCopy["gallery"] }) {
  const [items, setItems] = useState<readonly PublishedGalleryItem[]>([]);

  useEffect(() => {
    let active = true;
    const client = new BackendClient(getOperationsConfig());
    client.listPublishedGallery(6).then(
      (gallery) => {
        if (active) setItems(gallery.list.filter((item) => item.thumbnailUrl));
      },
      () => {
        if (active) setItems([]);
      },
    );
    return () => {
      active = false;
    };
  }, []);

  if (items.length === 0) return null;

  return (
    <section className="ob-landing-section" id="gallery">
      <div className="ob-landing-container">
        <div className="ob-landing-section-head">
          <h2>{copy.heading}</h2>
          <p>{copy.subheading}</p>
        </div>
        <div className="ob-landing-gallery-grid">
          {items.map((item) => (
            <a className="ob-landing-gallery-card" href={item.url} target="_blank" rel="noreferrer" key={item.id}>
              <img src={item.thumbnailUrl} alt={item.title || copy.fallbackTitle} loading="lazy" />
              <span>
                <strong>{item.title || copy.fallbackTitle}</strong>
                <small>{copy.by} {item.authorName || copy.fallbackAuthor}</small>
              </span>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}

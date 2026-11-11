"use client";
// A&M fork: the map block's map. MapLibre GL with the OpenFreeMap dark style (no API key, no
// cookies, so no consent gate). Loaded only when the block scrolls near the viewport (dynamic
// import of maplibre-gl; only its stylesheet ships up front), so first paint stays light. Until then, and if
// it fails, the box shows the address. One marker; attribution stays visible (OSM / OpenFreeMap
// require it). The parent keeps a fixed-height box, so nothing shifts when the map arrives.
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";

const STYLE = "https://tiles.openfreemap.org/styles/dark";

export type LocationMapProps = {
  lat: number;
  lng: number;
  label: string;
  title: string;
};

export function LocationMap({ lat, lng, label, title }: LocationMapProps) {
  const box = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"idle" | "ready" | "failed">("idle");

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let map: { remove(): void } | null = null;
    let cancelled = false;
    const load = async () => {
      try {
        const { default: maplibregl } = await import("maplibre-gl");
        if (cancelled) return;
        const m = new maplibregl.Map({
          container: el,
          style: STYLE,
          center: [lng, lat],
          zoom: 15,
          cooperativeGestures: true,
          attributionControl: { compact: false },
        });
        m.addControl(
          new maplibregl.NavigationControl({ showCompass: false }),
          "top-right",
        );
        new maplibregl.Marker({ color: "#e0242b" })
          .setLngLat([lng, lat])
          .addTo(m);
        m.on("error", () => undefined);
        map = m;
        setState("ready");
      } catch {
        if (!cancelled) setState("failed");
      }
    };
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          void load();
        }
      },
      { rootMargin: "300px" },
    );
    io.observe(el);
    return () => {
      cancelled = true;
      io.disconnect();
      map?.remove();
    };
  }, [lat, lng]);

  return (
    <div
      ref={box}
      role="region"
      aria-label={title}
      className="relative h-[320px] w-full overflow-hidden rounded-site-media border border-site-border bg-site-surface-raised md:h-[400px]"
    >
      {state !== "ready" ? (
        <p className="absolute inset-0 flex items-center justify-center p-4 text-center font-semibold text-site-text">
          {label}
        </p>
      ) : null}
    </div>
  );
}

import { ChangeEvent, useEffect, useRef, useState } from "react";
import { loadGoogleMaps } from "../googleMapsLoader";
import type { SearchCircle } from "../types";

interface RadiusMapProps {
  onChange: (circle: SearchCircle, label?: string) => void;
}

const DEFAULT_CENTER = { lat: 39.8283, lng: -98.5795 }; // roughly the center of the US
const DEFAULT_RADIUS_METERS = 8046; // ~5 miles
const MIN_RADIUS_MILES = 1;
const MAX_RADIUS_MILES = 30; // Google's search circle caps out at 50km (~31 mi)

const metersToMiles = (m: number) => m / 1609.34;
const milesToMeters = (mi: number) => mi * 1609.34;

function getInitialCenter(): Promise<{ lat: number; lng: number }> {
  if (!navigator.geolocation) return Promise.resolve(DEFAULT_CENTER);
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(DEFAULT_CENTER), 3000);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(timeout);
        resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      () => {
        clearTimeout(timeout);
        resolve(DEFAULT_CENTER);
      },
      { timeout: 3000 }
    );
  });
}

export function RadiusMap({ onChange }: RadiusMapProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const searchContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const circleRef = useRef<google.maps.Circle | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [radiusMiles, setRadiusMiles] = useState(metersToMiles(DEFAULT_RADIUS_METERS));

  // Keep a stable ref to the latest onChange so the init effect below can
  // run exactly once (map/circle setup is expensive) without going stale.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      await loadGoogleMaps();
      if (cancelled || !mapContainerRef.current) return;

      const center = await getInitialCenter();
      if (cancelled) return;

      // With `loading=async`, Map/Circle aren't on the global `google.maps`
      // namespace until their library is explicitly imported.
      const { Map, Circle } = (await google.maps.importLibrary(
        "maps"
      )) as google.maps.MapsLibrary;

      const map = new Map(mapContainerRef.current, {
        center,
        zoom: 10,
        streetViewControl: false,
        mapTypeControl: false,
        fullscreenControl: false,
      });
      mapRef.current = map;

      const circle = new Circle({
        map,
        center,
        radius: DEFAULT_RADIUS_METERS,
        editable: true,
        draggable: true,
        strokeColor: "#8C6057",
        strokeOpacity: 0.8,
        strokeWeight: 2,
        fillColor: "#8C6057",
        fillOpacity: 0.12,
      });
      circleRef.current = circle;
      const bounds = circle.getBounds();
      if (bounds) map.fitBounds(bounds);

      const emitChange = (label?: string) => {
        const c = circle.getCenter();
        const r = circle.getRadius();
        if (!c) return;
        setRadiusMiles(metersToMiles(r));
        onChangeRef.current({ lat: c.lat(), lng: c.lng(), radiusMeters: r }, label);
      };

      circle.addListener("radius_changed", () => emitChange());
      circle.addListener("center_changed", () => emitChange());

      // Places Autocomplete (new-style web component) as a floating search
      // box over the map, matching the "search then draw an area" flow of
      // apps like Facebook Marketplace.
      if (searchContainerRef.current) {
        const placesLibrary = (await google.maps.importLibrary("places")) as any;
        const autocomplete = new placesLibrary.PlaceAutocompleteElement({});
        autocomplete.classList.add("lead-autocomplete");
        searchContainerRef.current.innerHTML = "";
        searchContainerRef.current.appendChild(autocomplete);

        autocomplete.addEventListener("gmp-select", async (event: any) => {
          const place = event.placePrediction.toPlace();
          await place.fetchFields({ fields: ["location", "formattedAddress"] });
          const location = place.location;
          if (!location) return;
          const newCenter = { lat: location.lat(), lng: location.lng() };
          map.setCenter(newCenter);
          circle.setCenter(newCenter);
          const newBounds = circle.getBounds();
          if (newBounds) map.fitBounds(newBounds);
          emitChange(place.formattedAddress ?? undefined);
        });
      }

      emitChange();
      setStatus("ready");
    }

    init().catch((err) => {
      if (cancelled) return;
      setErrorMessage(err instanceof Error ? err.message : "Couldn't load the map.");
      setStatus("error");
    });

    return () => {
      cancelled = true;
    };
    // Intentionally empty: the map/circle should only be created once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSliderChange(event: ChangeEvent<HTMLInputElement>) {
    const miles = Number(event.target.value);
    setRadiusMiles(miles);
    const circle = circleRef.current;
    const map = mapRef.current;
    if (!circle || !map) return;
    const meters = milesToMeters(miles);
    circle.setRadius(meters);
    const c = circle.getCenter();
    const bounds = circle.getBounds();
    if (bounds) map.fitBounds(bounds);
    if (c) onChange({ lat: c.lat(), lng: c.lng(), radiusMeters: meters });
  }

  if (status === "error") {
    return (
      <div className="mt-3 border border-signal/40 bg-signal-soft px-4 py-3 text-sm text-ink-soft">
        Map search isn't available right now ({errorMessage}). You can still search using the
        location field above.
      </div>
    );
  }

  return (
    <div className="mt-3 border border-rule">
      <div ref={searchContainerRef} className="border-b border-rule p-2 [&_gmp-place-autocomplete]:w-full" />
      <div ref={mapContainerRef} className="h-64 w-full bg-rule/40" />
      <div className="flex items-center gap-3 border-t border-rule px-3 py-2.5">
        <label htmlFor="radius-slider" className="text-sm text-ink-soft whitespace-nowrap">
          Search radius
        </label>
        <input
          id="radius-slider"
          type="range"
          min={MIN_RADIUS_MILES}
          max={MAX_RADIUS_MILES}
          step={1}
          value={Math.round(radiusMiles)}
          onChange={handleSliderChange}
          disabled={status !== "ready"}
          className="flex-1 accent-signal"
        />
        <span className="font-mono text-sm text-ink w-16 text-right">
          {Math.round(radiusMiles)} mi
        </span>
      </div>
      {status === "loading" && (
        <p className="px-3 pb-2.5 text-xs text-ink-soft">Loading map…</p>
      )}
    </div>
  );
}

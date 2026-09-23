// Loads the Maps JavaScript API script exactly once, however many
// components ask for it. Returns the same promise on repeat calls.
let loadPromise: Promise<void> | null = null;

export function loadGoogleMaps(): Promise<void> {
  if (loadPromise) return loadPromise;

  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

  loadPromise = new Promise((resolve, reject) => {
    if (typeof window === "undefined") {
      reject(new Error("Google Maps can only load in the browser."));
      return;
    }
    if (window.google?.maps) {
      resolve();
      return;
    }
    if (!apiKey) {
      reject(
        new Error(
          "VITE_GOOGLE_MAPS_API_KEY is not set. Add it to client/.env to use radius map search."
        )
      );
      return;
    }

    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(
      apiKey
    )}&libraries=places&loading=async`;
    script.async = true;
    script.onerror = () => reject(new Error("Failed to load the Google Maps script."));
    script.onload = () => resolve();
    document.head.appendChild(script);
  });

  return loadPromise;
}

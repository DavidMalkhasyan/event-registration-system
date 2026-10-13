import { useEffect, useRef, useState } from 'react';
import { MapPinOff } from 'lucide-react';
import { Alert } from './ui';
import { addressLine, directionsUrl, type Location } from './location';

// The participant map (K-714, PD-96): a real OpenStreetMap map of the venue for confirmed participants.
// Tiles come from our own origin (/map-tiles/…), so the page's CSP and its `no-referrer` policy stay as
// they are and no request leaves our origin; the server identifies itself to the tile service and
// caches (see apps/server/src/modules/maps/tiles.ts). Leaflet (BSD-2-Clause) is bundled, not loaded
// from a CDN, and only loaded on pages that show a map. The marker is where the organizer put it;
// nothing is geocoded.

export interface MapData {
  tileUrl: string;
  center: { latitude: number; longitude: number };
  bounds: [[number, number], [number, number]];
  minZoom: number;
  maxZoom: number;
  zoom: number;
  attribution: string;
}

export function ParticipantMap({ location, map }: { location: Location; map: MapData | null | undefined }) {
  const holder = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!map || !holder.current) return;
    let disposed = false;
    let instance: { remove(): void } | undefined;
    let observer: ResizeObserver | undefined;
    void Promise.all([import('leaflet'), import('leaflet/dist/leaflet.css')]).then(([{ default: L }]) => {
      if (disposed || !holder.current) return;
      const center: [number, number] = [map.center.latitude, map.center.longitude];
      const leaflet = L.map(holder.current, {
        center,
        zoom: map.zoom,
        minZoom: map.minZoom,
        maxZoom: map.maxZoom,
        maxBounds: map.bounds,
        maxBoundsViscosity: 1,
        scrollWheelZoom: false, // the page keeps scrolling; zoom with the buttons, keys or pinch
        attributionControl: false,
      });
      L.control.attribution({ prefix: false, position: 'bottomright' }).addTo(leaflet);
      const tiles = L.tileLayer(map.tileUrl, {
        minZoom: map.minZoom,
        maxZoom: map.maxZoom,
        bounds: map.bounds,
        keepBuffer: 1, // modest look-ahead only (OSM tile policy: no prefetching)
        attribution:
          '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
      }).addTo(leaflet);
      let errors = 0;
      tiles.on('tileerror', () => {
        errors += 1;
        if (errors >= 2) setFailed(true);
      });
      L.marker(center, {
        title: location.venueName,
        alt: location.venueName,
        keyboard: true,
        icon: L.divIcon({ className: 'map-pin', html: '', iconSize: [26, 26], iconAnchor: [13, 26] }),
      }).addTo(leaflet);
      // Leaflet measures its container once; when the layout settles or changes (a phone's narrower map,
      // a rotated screen) it must measure again, or the venue drifts off-centre (K-714 review).
      observer = new ResizeObserver(() => leaflet.invalidateSize());
      observer.observe(holder.current);
      instance = leaflet;
    });
    return () => {
      disposed = true;
      observer?.disconnect();
      instance?.remove();
    };
  }, [map, location.venueName]);

  if (!location.coordinates)
    return (
      <p className="map-fallback">
        <MapPinOff size={16} aria-hidden="true" /> The organizer has not placed this venue on a map. Use the
        address and the directions link above.
      </p>
    );
  if (!map)
    return (
      <p className="map-fallback">
        <MapPinOff size={16} aria-hidden="true" /> A map is not available here. Use the address and the
        directions link above.
      </p>
    );
  return (
    <figure className="participant-map">
      <div
        ref={holder}
        className="map-canvas"
        role="region"
        aria-label={`Map of ${location.venueName}`}
        data-latitude={map.center.latitude}
        data-longitude={map.center.longitude}
      />
      {failed && (
        <Alert kind="warning">
          Some of the map could not be loaded. The address is {addressLine(location)};{' '}
          <a href={directionsUrl(location)} target="_blank" rel="noopener noreferrer">
            get directions
          </a>
          .
        </Alert>
      )}
      <figcaption>
        <strong>{location.venueName}</strong>, {addressLine(location)}.{' '}
        <a href="https://www.openstreetmap.org/fixthemap" target="_blank" rel="noopener noreferrer">
          Report a map issue
        </a>
      </figcaption>
    </figure>
  );
}

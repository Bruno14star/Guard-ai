import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const IS_PROD = process.env.NODE_ENV === 'production';

function getMapsApiKey(): string {
  return (
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.VITE_GOOGLE_MAPS_API_KEY ||
    ''
  );
}

interface AddressResult {
  formattedAddress: string;
  streetName: string;
  area: string;
  city: string;
  state: string;
  landmark: string;
  source: 'google_geocoding' | 'nominatim_fallback' | 'unavailable';
}

function normalizeNigerianState(raw: string): string {
  const s = raw.replace(/\s+State$/i, '').trim();
  if (/federal capital territory|abuja|fct/i.test(s)) return 'FCT Abuja';
  if (/akwa\s*ibom/i.test(s)) return 'Akwa Ibom';
  if (/cross\s*river/i.test(s)) return 'Cross River';
  return s;
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, time: new Date().toISOString() });
  });

  app.get('/api/maps-config', (_req, res) => {
    const key = getMapsApiKey();
    res.json({
      apiKey: key,
      hasKey: Boolean(key),
    });
  });

  // Server-side proxy for Google Maps Geocoding API (avoids browser CORS CF1)
  app.get('/api/geocode/reverse', async (req, res) => {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      res.status(400).json({ error: 'Valid lat and lng are required' });
      return;
    }

    const key = getMapsApiKey();
    if (key) {
      try {
        const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
        url.searchParams.set('latlng', `${lat},${lng}`);
        url.searchParams.set('key', key);

        const gRes = await fetch(url.toString());
        if (gRes.status === 429) {
          res.status(429).json({ error: 'RESOURCE_EXHAUSTED', status: 'RESOURCE_EXHAUSTED' });
          return;
        }
        const data: any = await gRes.json();
        if (data.status === 'OVER_QUERY_LIMIT') {
          res.status(429).json({ error: 'OVER_QUERY_LIMIT', status: 'RESOURCE_EXHAUSTED' });
          return;
        }
        if (data.status === 'OK' && Array.isArray(data.results) && data.results.length > 0) {
          const primary = data.results[0];
          const comps: any[] = primary.address_components || [];
          const findComp = (types: string[]) =>
            comps.find((c) => types.some((t) => c.types?.includes(t)))?.long_name || '';

          const route = findComp(['route', 'street_address']);
          const streetNum = findComp(['street_number']);
          const sublocality = findComp(['sublocality_level_1', 'sublocality', 'neighborhood']);
          const locality = findComp(['locality', 'administrative_area_level_2']);
          const admin1 = findComp(['administrative_area_level_1']);
          const landmark = findComp(['point_of_interest', 'establishment', 'premise']) || sublocality || locality;

          const streetName = [streetNum, route].filter(Boolean).join(' ') || sublocality || locality || 'Current Street';
          const state = normalizeNigerianState(admin1 || locality);
          const result: AddressResult = {
            formattedAddress: primary.formatted_address || `${streetName}, ${locality}, ${state}`,
            streetName,
            area: sublocality || locality || state,
            city: locality || sublocality || state,
            state,
            landmark,
            source: 'google_geocoding',
          };
          res.json(result);
          return;
        }
      } catch (err) {
        console.error('Google Geocoding proxy error:', err);
      }
    }

    // Fallback to OpenStreetMap Nominatim only if Google Geocoding key is unavailable or unactivated
    try {
      const nomUrl = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(
        lat
      )}&lon=${encodeURIComponent(lng)}&addressdetails=1`;
      const nRes = await fetch(nomUrl, {
        headers: { 'User-Agent': 'GuardAI-SafetyApp/1.0' },
      });
      if (nRes.ok) {
        const data: any = await nRes.json();
        const addr = data.address || {};
        const streetName = addr.road || addr.pedestrian || addr.suburb || addr.neighbourhood || 'Current Road';
        const area = addr.suburb || addr.neighbourhood || addr.city_district || addr.town || addr.city || 'Area';
        const city = addr.city || addr.town || addr.county || addr.state || 'City';
        const state = normalizeNigerianState(addr.state || city);
        const landmark = addr.amenity || addr.building || addr.shop || area;
        const formattedAddress = [streetName, area, state].filter(Boolean).join(', ');
        const result: AddressResult = {
          formattedAddress: formattedAddress || data.display_name || 'Location detected',
          streetName,
          area,
          city,
          state,
          landmark,
          source: 'nominatim_fallback',
        };
        res.json(result);
        return;
      }
    } catch (err) {
      console.error('Nominatim reverse geocode fallback error:', err);
    }

    const fallback: AddressResult = {
      formattedAddress: 'Location active (address lookup unavailable)',
      streetName: 'Current Street',
      area: 'Local Area',
      city: 'Detected City',
      state: '',
      landmark: 'Nearby Landmark',
      source: 'unavailable',
    };
    res.json(fallback);
  });

  if (!IS_PROD) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Guard AI server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();

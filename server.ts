import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const IS_PROD = process.env.NODE_ENV === 'production';

interface AddressResult {
  formattedAddress: string;
  streetName: string;
  area: string;
  city: string;
  state: string;
  landmark: string;
  source: 'nominatim' | 'unavailable';
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

  // Free OpenStreetMap Nominatim reverse geocoding proxy (no API key required)
  app.get('/api/geocode/reverse', async (req, res) => {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      res.status(400).json({ error: 'Valid lat and lng are required' });
      return;
    }

    const coordFallback = `Lat: ${lat.toFixed(5)}, Lng: ${lng.toFixed(5)}`;

    try {
      const nomUrl = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${encodeURIComponent(
        lat
      )}&lon=${encodeURIComponent(lng)}&addressdetails=1`;
      const nRes = await fetch(nomUrl, {
        headers: {
          'User-Agent': 'GuardAI-SafetyApp/1.0',
          'Accept-Language': 'en',
        },
      });
      if (nRes.ok) {
        const data: any = await nRes.json();
        const addr = data.address || {};
        const road =
          addr.road ||
          addr.street ||
          addr.pedestrian ||
          addr.residential ||
          addr.footway ||
          addr.path ||
          '';
        const housePrefix = addr.house_number ? `${addr.house_number} ` : '';
        const suburb =
          addr.suburb ||
          addr.neighbourhood ||
          addr.quarter ||
          addr.city_district ||
          '';
        const city =
          addr.city ||
          addr.town ||
          addr.village ||
          addr.municipality ||
          addr.county ||
          '';
        const state = normalizeNigerianState(addr.state || '');
        const displayFirstPart =
          typeof data.display_name === 'string' && data.display_name.trim()
            ? data.display_name.split(',')[0].trim()
            : '';

        const streetName =
          (road ? `${housePrefix}${road}` : '') ||
          suburb ||
          displayFirstPart ||
          coordFallback;
        const area = suburb || city || '';
        const landmark =
          addr.amenity ||
          addr.shop ||
          addr.building ||
          addr.office ||
          addr.commercial ||
          suburb ||
          city ||
          '';

        const parts = Array.from(
          new Set([road ? `${housePrefix}${road}` : '', suburb, city, state].filter(Boolean))
        );
        const formattedAddress =
          parts.join(', ') ||
          (typeof data.display_name === 'string' && data.display_name.trim()) ||
          coordFallback;

        const result: AddressResult = {
          formattedAddress,
          streetName,
          area,
          city,
          state,
          landmark,
          source: 'nominatim',
        };
        res.json(result);
        return;
      }
    } catch (err) {
      console.error('Nominatim reverse geocode error:', err);
    }

    const fallback: AddressResult = {
      formattedAddress: coordFallback,
      streetName: coordFallback,
      area: '',
      city: '',
      state: '',
      landmark: '',
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

// Server-side mirror of src/lib/weatherService.js's fetchWeather - the
// frontend version reads import.meta.env.VITE_OPENWEATHER_KEY, which only
// exists inside the browser bundle (baked in at Vite build time), so
// lineAlertWatchdog.js (a plain Node process with no browser) needs its own
// copy of the same OpenWeatherMap key as a real server env var
// (OPENWEATHER_KEY) - see server/.env.example. Same API, same account/key
// value works for both - OpenWeatherMap keys aren't origin-restricted.
const API_KEY = process.env.OPENWEATHER_KEY;
const BASE_URL = "https://api.openweathermap.org/data/2.5/weather";

export function isWeatherConfigured() {
  return !!API_KEY;
}

/**
 * @param {number} latitude
 * @param {number} longitude
 * @returns {Promise<{ locationName: string, condition: string, temperature: number, rainMm: number }>}
 */
export async function fetchWeather(latitude, longitude) {
  if (!API_KEY) throw new Error("NO_API_KEY");
  const url = `${BASE_URL}?lat=${latitude}&lon=${longitude}&units=metric&lang=th&appid=${API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("API_ERROR");
  const data = await res.json();
  return {
    locationName: data.name || "-",
    condition: data.weather?.[0]?.main ?? "Clear",
    temperature: data.main?.temp,
    rainMm: data.rain?.["1h"] ?? 0,
  };
}

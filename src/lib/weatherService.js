// OpenWeatherMap integration - real API, no mock/placeholder data. The key
// is a Vite VITE_ env var (baked into the client bundle at build time,
// same as the Firebase web config already in this app) since OpenWeatherMap's
// free tier is designed for exactly this kind of direct browser call.
const API_KEY = import.meta.env.VITE_OPENWEATHER_KEY;
const BASE_URL = "https://api.openweathermap.org/data/2.5/weather";

export const WEATHER_ICONS = {
  Clear: "☀️",
  Clouds: "☁️",
  Rain: "🌧️",
  Drizzle: "🌦️",
  Thunderstorm: "⛈️",
  Snow: "❄️",
  Mist: "🌫️",
  Fog: "🌫️",
  Haze: "🌫️",
};

export function weatherIcon(condition) {
  return WEATHER_ICONS[condition] ?? "🌤️";
}

export function isWeatherConfigured() {
  return !!API_KEY;
}

/**
 * @param {number} latitude
 * @param {number} longitude
 * @returns {Promise<{ locationName: string, country: string, condition: string, description: string, temperature: number, humidity: number, windSpeed: number, rainMm: number, updatedAt: number }>}
 */
export async function fetchWeather(latitude, longitude) {
  if (!API_KEY) {
    throw new Error("NO_API_KEY");
  }
  const url = `${BASE_URL}?lat=${latitude}&lon=${longitude}&units=metric&lang=th&appid=${API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error("API_ERROR");
  }
  const data = await res.json();
  return {
    locationName: data.name || "-",
    country: data.sys?.country ?? "",
    condition: data.weather?.[0]?.main ?? "Clear",
    description: data.weather?.[0]?.description ?? "",
    temperature: data.main?.temp,
    humidity: data.main?.humidity,
    windSpeed: data.wind?.speed,
    rainMm: data.rain?.["1h"] ?? 0,
    updatedAt: Date.now(),
  };
}

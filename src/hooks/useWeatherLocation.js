import { useState } from "react";
import { fetchWeather } from "../lib/weatherService.js";
import { api } from "../lib/apiClient.js";

const ERROR_MESSAGES = {
  NO_API_KEY: "ยังไม่ได้ตั้งค่า Weather API key",
  API_ERROR: "โหลดข้อมูลสภาพอากาศไม่สำเร็จ",
};

/**
 * Weather for the BMS/solar installation's fixed location - saved once per
 * hub (account) to Firebase at JK_BMS_HUB/{hubId}/location, not the
 * viewer's own device GPS. `savedLocation` is sourced by the caller from
 * the normal hub tree (HubDataContext/useHubData), the same live data
 * every other Configuration value already flows through - a different
 * device opening the same dashboard sees the same installation weather,
 * never wherever THAT device happens to be.
 *
 * @param {string|null} hubId
 * @param {{name:string, lat:number, lng:number}|null} savedLocation
 */
export function useWeatherLocation(hubId, savedLocation) {
  const [showSetupModal, setShowSetupModal] = useState(false);
  const [weather, setWeather] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  async function loadWeather(loc = savedLocation) {
    if (!loc) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchWeather(loc.lat, loc.lng);
      setWeather(data);
    } catch (err) {
      setError(ERROR_MESSAGES[err.message] ?? ERROR_MESSAGES.API_ERROR);
    } finally {
      setLoading(false);
    }
  }

  // First-ever open with no saved location yet -> setup modal instead of
  // silently falling back to device GPS. Already set up -> just fetch.
  function openWeather() {
    if (!savedLocation) {
      setShowSetupModal(true);
      return;
    }
    loadWeather();
  }

  async function saveLocation({ name, lat, lng }) {
    if (!hubId) return false;
    setSaving(true);
    try {
      await api.saveHubLocation(hubId, { name, lat, lng });
      setShowSetupModal(false);
      await loadWeather({ name, lat, lng });
      return true;
    } catch {
      return false;
    } finally {
      setSaving(false);
    }
  }

  return {
    showSetupModal,
    setShowSetupModal,
    weather,
    loading,
    error,
    saving,
    openWeather,
    loadWeather,
    saveLocation,
  };
}

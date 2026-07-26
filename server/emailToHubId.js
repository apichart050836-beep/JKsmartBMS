// Firebase RTDB keys can't contain a literal "." (or "#", "$", "[", "]") -
// the real hub id under JK_BMS_HUB is the login email with every "." turned
// into "_" (e.g. login "Suntreehouse287@gmail.com" -> hub
// "Suntreehouse287@gmail_com"). Centralized here so every place that needs
// to go from "what someone typed to log in" to "the real Firebase key" uses
// the exact same rule instead of each guessing/hardcoding it separately.
export function emailToHubId(email) {
  return String(email).trim().replace(/\./g, "_");
}

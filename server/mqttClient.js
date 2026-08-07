import "dotenv/config";
import mqtt from "mqtt";

// Replaces Firebase as the OTA signal transport (per explicit request) - the
// admin publish panel and the "trigger update" button now PUBLISH a command
// message directly to this device's own MQTT topic instead of writing to
// Firebase. The ESP32 side needs its own firmware update to subscribe here;
// existing devices still running Firebase-polling firmware won't see OTA
// signals until reflashed - a known, accepted tradeoff of this switch.
const MQTT_URL = process.env.MQTT_URL;
const MQTT_USERNAME = process.env.MQTT_USERNAME;
const MQTT_PASSWORD = process.env.MQTT_PASSWORD;

export const isMqttConfigured = !!(MQTT_URL && MQTT_USERNAME && MQTT_PASSWORD);

if (!isMqttConfigured) {
  console.warn(
    "\nMQTT broker not configured (MQTT_URL/MQTT_USERNAME/MQTT_PASSWORD missing from server/.env)\n" +
      "OTA publish/trigger-update will respond with 503 until these are set.\n"
  );
}

let client = null;
function getClient() {
  if (!isMqttConfigured) return null;
  if (client) return client;
  client = mqtt.connect(MQTT_URL, {
    username: MQTT_USERNAME,
    password: MQTT_PASSWORD,
    // Every server instance (and every dev machine running the backend
    // locally) needs its own stable-but-unique client id, or HiveMQ Cloud
    // will boot whichever connection loses the race on collision.
    clientId: `bms-backend-${Math.random().toString(16).slice(2, 10)}`,
    reconnectPeriod: 5000,
  });
  client.on("connect", () => console.log("MQTT: connected to broker"));
  client.on("error", (err) => console.error("MQTT: connection error:", err.message));
  client.on("close", () => console.warn("MQTT: connection closed, will retry"));
  return client;
}

// Same key each device already uses as its own Firebase path segment
// (bmsKey - the ESP32's own chip id, not the JK BMS chip's separate
// Bluetooth jk_mac_address) - it's the one identifier that's always this
// specific ESP32, which is the thing actually subscribed to MQTT.
function commandTopic(hubId, mac) {
  return `jk_bms_hub/${hubId}/${mac}/command`;
}

// Resolves once the broker has acknowledged the publish (QoS 1) - callers
// should treat a rejected promise as "the device did not get this message",
// same as a failed Firebase write did before.
export function publishOtaCommand(hubId, mac, payload) {
  return new Promise((resolve, reject) => {
    const c = getClient();
    if (!c) return reject(new Error("MQTT not configured"));
    c.publish(commandTopic(hubId, mac), JSON.stringify(payload), { qos: 1 }, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

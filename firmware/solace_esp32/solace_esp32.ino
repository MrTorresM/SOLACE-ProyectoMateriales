// ─────────────────────────────────────────────────────────────────────────────
//  SOLACE — Power when it matters.
//  Firmware ESP32 DevKit V1
//
//  · INA3221: CH1 batería (2S2P Li-ion) · CH2 step-down 5 V (USB) · CH3 step-down 3 V (radio)
//  · BH1750: luz ambiente → modo automático de la tira LED
//  · DHT11: temperatura y humedad
//  · WS2812B: tira LED interna (modo Automático / Manual desde la app)
//  · Telemetría JSON por MQTT al hub del Mac (descubierto sin IP fija)
//
//  Librerías (Gestor de librerías del Arduino IDE):
//    Adafruit NeoPixel · BH1750 (Christopher Laws) · DHT sensor library (Adafruit)
//    Adafruit Unified Sensor · PubSubClient (Nick O'Leary) · ArduinoJson 7
//  Placa: "ESP32 Dev Module" (core esp32 de Espressif 2.x o 3.x)
// ─────────────────────────────────────────────────────────────────────────────
#include <Arduino.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include <WiFi.h>
#include <Wire.h>

#include "config.h"
#include "hub_link.h"
#include "light.h"
#include "logic.h"
#include "sensors.h"

#if !__has_include("secrets.h")
#warning "Falta secrets.h: copia secrets.example.h como secrets.h y escribe tu WiFi."
#endif

using solace::Rgb;

// ─── Estado ───────────────────────────────────────────────────────────────────
enum class Mode : uint8_t { Auto = 0, Manual = 1 };

struct Settings {
  Mode mode = Mode::Auto;
  bool on = false;                   // manual
  Rgb color = {255, 255, 255};       // manual
  uint8_t brightness = 80;           // manual (%)
  float luxOn = AUTO_LUX_ON;
  float luxOff = AUTO_LUX_OFF;
};

Settings settings;
bool settingsDirty = false;
uint32_t settingsChangedAt = 0;

Sensors sensors;
LightController light;
HubLink hub;

solace::AutoLightState autoState = {false, 0, false};
float ambientLux = NAN;          // luz ambiente usada por el modo automático
bool ambientFresh = false;       // false = desconocida (tira encendida en manual)
uint32_t lastAmbientSample = 0;
bool forceAmbientSample = false;

char deviceId[20];
uint32_t seq = 0;
uint32_t lastTelemetry = 0;
bool telemetryNow = false;

// Estado efectivo de la tira (lo que realmente se muestra).
struct Effective {
  bool on;
  Rgb color;
  uint8_t brightness;
} effective = {false, {255, 255, 255}, 0};

// ─── Persistencia ─────────────────────────────────────────────────────────────
void loadSettings() {
  Preferences p;
  p.begin("solace", true);
  settings.mode = (Mode)p.getUChar("mode", (uint8_t)Mode::Auto);
  settings.on = p.getBool("on", false);
  const uint32_t c = p.getULong("color", 0xFFFFFF);
  settings.color = {(uint8_t)(c >> 16), (uint8_t)(c >> 8), (uint8_t)c};
  settings.brightness = p.getUChar("bri", 80);
  settings.luxOn = p.getFloat("luxOn", AUTO_LUX_ON);
  settings.luxOff = p.getFloat("luxOff", AUTO_LUX_OFF);
  p.end();
  if (settings.luxOff <= settings.luxOn) {
    settings.luxOn = AUTO_LUX_ON;
    settings.luxOff = AUTO_LUX_OFF;
  }
}

void saveSettings() {
  Preferences p;
  p.begin("solace", false);
  p.putUChar("mode", (uint8_t)settings.mode);
  p.putBool("on", settings.on);
  p.putULong("color", ((uint32_t)settings.color.r << 16) | ((uint32_t)settings.color.g << 8) | settings.color.b);
  p.putUChar("bri", settings.brightness);
  p.putFloat("luxOn", settings.luxOn);
  p.putFloat("luxOff", settings.luxOff);
  p.end();
  settingsDirty = false;
}

void markDirty() {
  settingsDirty = true;
  settingsChangedAt = millis();
}

// ─── Luz ──────────────────────────────────────────────────────────────────────
void updateAmbient(uint32_t now) {
  const SensorData& d = sensors.data();
  const bool lit = light.isLit();
  if (!lit) {
    // Con la tira apagada, el BH1750 mide directamente la luz ambiente.
    ambientFresh = d.luxOk && !isnan(d.luxRaw);
    if (ambientFresh) ambientLux = d.luxRaw;
    lastAmbientSample = now;
    forceAmbientSample = false;
    return;
  }
  if (settings.mode == Mode::Auto && AMBIENT_SAMPLE_MS > 0 &&
      (forceAmbientSample || now - lastAmbientSample >= AMBIENT_SAMPLE_MS)) {
    // La tira ilumina el sensor: se apaga ~30 ms para leer la luz real.
    light.blank();
    const float lux = sensors.sampleLuxQuick();
    light.restore();
    lastAmbientSample = now;
    forceAmbientSample = false;
    if (lux >= 0) {
      ambientLux = lux;
      ambientFresh = true;
    }
  } else if (settings.mode == Mode::Manual) {
    ambientFresh = false;  // no se interrumpe la luz que eligió el usuario
  }
}

void applyLight(uint32_t now) {
  if (settings.mode == Mode::Auto) {
    const solace::AutoLightConfig cfg = {settings.luxOn, settings.luxOff, AUTO_MIN_DWELL_MS};
    const bool wasOn = autoState.on;
    autoState = solace::autoLightStep(autoState, ambientLux, ambientFresh, now, cfg);
    if (autoState.on != wasOn) {
      Serial.printf("[luz] auto → %s (%.1f lx)\n", autoState.on ? "ENCENDIDA" : "apagada", ambientLux);
      telemetryNow = true;
    }
    Rgb white;
    solace::parseHexColor(AUTO_COLOR_HEX, white);
    effective = {autoState.on, white, (uint8_t)AUTO_BRIGHTNESS_PCT};
  } else {
    effective = {settings.on, settings.color, settings.brightness};
  }
  light.setTarget(effective.on, effective.color, effective.brightness);
}

// ─── Comandos desde la app (vía hub) ──────────────────────────────────────────
void sendAck(const char* id, bool ok, const char* error = nullptr) {
  JsonDocument doc;
  doc["id"] = id;
  doc["ok"] = ok;
  if (error) doc["error"] = error;
  char buf[160];
  serializeJson(doc, buf, sizeof(buf));
  hub.publish(TOPIC_ACK, buf);
}

void onCommand(const char* payload, size_t len) {
  JsonDocument doc;
  if (deserializeJson(doc, payload, len) != DeserializationError::Ok) {
    sendAck("desconocido", false, "JSON inválido");
    return;
  }
  char id[65];
  strlcpy(id, doc["id"] | "desconocido", sizeof(id));
  const char* type = doc["type"] | "";
  const uint32_t now = millis();
  Serial.printf("[cmd] %s (%s)\n", type, id);

  if (strcmp(type, "setMode") == 0) {
    const char* mode = doc["mode"] | "";
    if (strcmp(mode, "auto") == 0) {
      settings.mode = Mode::Auto;
      autoState.changedOnce = false;  // decide de inmediato
      forceAmbientSample = true;
    } else if (strcmp(mode, "manual") == 0) {
      settings.mode = Mode::Manual;
    } else {
      return sendAck(id, false, "Modo inválido");
    }
  } else if (strcmp(type, "setLight") == 0) {
    settings.mode = Mode::Manual;  // tocar la luz desde la app pasa a manual
    const bool hasOn = doc["on"].is<bool>();
    if (hasOn) settings.on = doc["on"].as<bool>();
    bool touched = false;
    if (doc["color"].is<const char*>()) {
      Rgb c;
      if (!solace::parseHexColor(doc["color"].as<const char*>(), c)) return sendAck(id, false, "Color inválido");
      settings.color = c;
      touched = true;
    }
    if (doc["brightness"].is<int>()) {
      settings.brightness = (uint8_t)constrain(doc["brightness"].as<int>(), 0, 100);
      touched = true;
    }
    if (touched && !hasOn) settings.on = true;
  } else if (strcmp(type, "setAuto") == 0) {
    const float on = doc["luxOn"] | -1.0f;
    const float off = doc["luxOff"] | -1.0f;
    if (on < 0 || off <= on) return sendAck(id, false, "Umbrales inválidos (luxOff > luxOn)");
    settings.luxOn = on;
    settings.luxOff = off;
  } else if (strcmp(type, "identify") == 0) {
    light.identify(now);
  } else {
    return sendAck(id, false, "Comando desconocido");
  }

  markDirty();
  applyLight(now);
  sendAck(id, true);
  telemetryNow = true;  // la app ve el cambio sin esperar al siguiente segundo
}

// ─── Telemetría ───────────────────────────────────────────────────────────────
static float rd(float x, int decimals) {
  const float f = powf(10.0f, decimals);
  return roundf(x * f) / f;
}

void setNullable(JsonObject o, const char* key, float value, bool valid, int decimals) {
  if (valid && !isnan(value)) o[key] = rd(value, decimals);
  else o[key] = nullptr;
}

void publishTelemetry() {
  const SensorData& d = sensors.data();
  const bool charging = d.inaOk && d.bat.i < CHARGING_THRESHOLD_A;
  const float soc = d.inaOk ? solace::estimateSoc(d.bat.v, d.bat.i) : 0.0f;
  const float ledW = solace::estimateLedPowerW(effective.on, effective.color, effective.brightness, LED_COUNT);

  solace::AlertInputs ai = {soc, charging, d.tempC, d.dhtOk && !isnan(d.tempC), d.usb.v, d.usb.i, d.luxOk, d.dhtOk, d.inaOk};
  const uint8_t alerts = solace::evaluateAlerts(ai);

  JsonDocument doc;
  doc["v"] = 1;
  doc["id"] = deviceId;
  doc["seq"] = seq++;
  doc["uptime"] = millis() / 1000;

  JsonObject env = doc["env"].to<JsonObject>();
  setNullable(env, "lux", d.luxRaw, d.luxOk, 1);
  setNullable(env, "luxAmbient", ambientLux, ambientFresh, 1);
  setNullable(env, "tempC", d.tempC, d.dhtOk, 1);
  setNullable(env, "hum", d.hum, d.dhtOk, 0);

  JsonObject power = doc["power"].to<JsonObject>();
  auto channel = [&](const char* key, const ChannelReading& c) {
    JsonObject o = power[key].to<JsonObject>();
    o["v"] = rd(c.v, 3);
    o["i"] = rd(c.i, 3);
    o["p"] = rd(c.p, 3);
  };
  channel("bat", d.bat);
  channel("usb", d.usb);
  channel("radio", d.radio);
  JsonObject led = power["led"].to<JsonObject>();
  led["p"] = ledW;
  led["est"] = true;

  JsonObject bat = doc["bat"].to<JsonObject>();
  bat["soc"] = soc;
  bat["charging"] = charging;

  JsonObject l = doc["light"].to<JsonObject>();
  char hex[8];
  solace::formatHexColor(effective.color, hex);
  l["mode"] = settings.mode == Mode::Auto ? "auto" : "manual";
  l["on"] = effective.on;
  l["color"] = hex;
  l["brightness"] = effective.brightness;
  l["luxOn"] = settings.luxOn;
  l["luxOff"] = settings.luxOff;

  JsonArray arr = doc["alerts"].to<JsonArray>();
  for (uint8_t b = 0; b < solace::ALERT_COUNT; b++)
    if (alerts & (1 << b)) arr.add(solace::alertCode(b));

  JsonObject net = doc["net"].to<JsonObject>();
  net["rssi"] = WiFi.RSSI();
  net["ip"] = WiFi.localIP().toString();

  char buf[MQTT_BUFFER_SIZE];
  const size_t n = serializeJson(doc, buf, sizeof(buf));
  if (n >= sizeof(buf) - 1) {
    Serial.println("[telemetría] JSON demasiado grande");
    return;
  }
  hub.publish(TOPIC_TELEMETRY, buf);
}

// ─── LED de estado (GPIO2) ────────────────────────────────────────────────────
//  parpadeo rápido = sin WiFi · doble destello = buscando hub · fijo = en línea
void updateStatusLed(uint32_t now) {
  bool on = false;
  switch (hub.state()) {
    case HubLink::State::WifiConnecting: on = (now / 150) % 2; break;
    case HubLink::State::Discovering:
    case HubLink::State::MqttConnecting: on = (now % 1200) < 100 || ((now % 1200) > 250 && (now % 1200) < 350); break;
    case HubLink::State::Online: on = true; break;
  }
  digitalWrite(PIN_STATUS_LED, on);
}

// ─── Arduino ──────────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(200);
  pinMode(PIN_STATUS_LED, OUTPUT);

  const uint64_t mac = ESP.getEfuseMac();
  snprintf(deviceId, sizeof(deviceId), "solace-%02x%02x%02x", (uint8_t)(mac >> 24), (uint8_t)(mac >> 32), (uint8_t)(mac >> 40));
  Serial.printf("\n=== SOLACE · Power when it matters. ===\nID: %s\n", deviceId);

  loadSettings();
  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);
  Wire.setClock(400000);
  sensors.begin();
  light.begin();
  hub.begin(deviceId, onCommand);
}

void loop() {
  const uint32_t now = millis();

  hub.loop(now);
  sensors.loop(now);
  updateAmbient(now);
  applyLight(now);
  light.loop(now);
  updateStatusLed(now);

  if (telemetryNow || now - lastTelemetry >= TELEMETRY_MS) {
    telemetryNow = false;
    lastTelemetry = now;
    publishTelemetry();
  }

  if (settingsDirty && now - settingsChangedAt >= SETTINGS_SAVE_DELAY_MS) saveSettings();
}

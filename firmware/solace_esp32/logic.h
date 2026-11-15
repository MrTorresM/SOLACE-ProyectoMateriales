// SOLACE — lógica pura del dispositivo (sin dependencias de Arduino).
// Es el espejo de shared/deviceLogic.ts y se prueba en el computador con
// `npm run test:firmware` (firmware/test/test_logic.cpp).
#pragma once

#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <cctype>

namespace solace {

// ─── Colores ──────────────────────────────────────────────────────────────────
struct Rgb {
  uint8_t r, g, b;
};

inline bool operator==(const Rgb& a, const Rgb& b) { return a.r == b.r && a.g == b.g && a.b == b.b; }

inline int hexNibble(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  c = (char)std::tolower((unsigned char)c);
  if (c >= 'a' && c <= 'f') return 10 + (c - 'a');
  return -1;
}

// Acepta "#RRGGBB" (o "RRGGBB"). Devuelve false si el formato no es válido.
inline bool parseHexColor(const char* s, Rgb& out) {
  if (!s) return false;
  if (*s == '#') s++;
  if (std::strlen(s) != 6) return false;
  int v[6];
  for (int k = 0; k < 6; k++) {
    v[k] = hexNibble(s[k]);
    if (v[k] < 0) return false;
  }
  out.r = (uint8_t)(v[0] * 16 + v[1]);
  out.g = (uint8_t)(v[2] * 16 + v[3]);
  out.b = (uint8_t)(v[4] * 16 + v[5]);
  return true;
}

// Escribe "#RRGGBB" (en mayúsculas) en out[8].
inline void formatHexColor(const Rgb& c, char out[8]) { std::snprintf(out, 8, "#%02X%02X%02X", c.r, c.g, c.b); }

// ─── Batería 2S2P Li-ion (18650, 2500 mAh, 3.7 V) ─────────────────────────────
constexpr int kBatSeries = 2;
constexpr float kPackInternalOhm = 0.08f;

struct OcvPoint {
  float v, soc;
};
constexpr OcvPoint kOcvTable[] = {
    {3.00f, 0},  {3.30f, 5},  {3.50f, 10}, {3.60f, 20}, {3.68f, 30},  {3.74f, 40},
    {3.78f, 50}, {3.83f, 60}, {3.89f, 70}, {3.95f, 80}, {4.05f, 90}, {4.20f, 100},
};
constexpr int kOcvLen = sizeof(kOcvTable) / sizeof(kOcvTable[0]);

inline float socFromCellVoltage(float v) {
  if (!std::isfinite(v) || v <= kOcvTable[0].v) return 0.0f;
  if (v >= kOcvTable[kOcvLen - 1].v) return 100.0f;
  for (int k = 1; k < kOcvLen; k++) {
    if (v <= kOcvTable[k].v) {
      const OcvPoint& a = kOcvTable[k - 1];
      const OcvPoint& b = kOcvTable[k];
      return a.soc + (v - a.v) * (b.soc - a.soc) / (b.v - a.v);
    }
  }
  return 100.0f;
}

// packV en voltios, currentA positivo = descarga. Compensa la caída I·R interna.
inline float estimateSoc(float packV, float currentA) {
  const float ocv = packV + currentA * kPackInternalOhm;
  return std::round(socFromCellVoltage(ocv / kBatSeries) * 10.0f) / 10.0f;
}

// ─── Luz automática: histéresis + permanencia mínima ──────────────────────────
struct AutoLightConfig {
  float luxOn;          // por debajo → enciende
  float luxOff;         // por encima → apaga
  uint32_t minDwellMs;  // tiempo mínimo entre cambios
};

struct AutoLightState {
  bool on;
  uint32_t lastChangeMs;
  bool changedOnce;  // false = aún no hubo cambios (no aplica la permanencia)
};

inline AutoLightState autoLightStep(AutoLightState s, float lux, bool luxValid, uint32_t nowMs,
                                    const AutoLightConfig& cfg) {
  if (!luxValid || !std::isfinite(lux)) return s;
  if (s.changedOnce && (uint32_t)(nowMs - s.lastChangeMs) < cfg.minDwellMs) return s;
  if (!s.on && lux < cfg.luxOn) return {true, nowMs, true};
  if (s.on && lux > cfg.luxOff) return {false, nowMs, true};
  return s;
}

// ─── Modelo de consumo de la tira WS2812B (5 V) ───────────────────────────────
constexpr float kLedSupplyV = 5.0f;
constexpr float kLedMaPerChannel = 20.0f;
constexpr float kLedIdleMaPerLed = 1.0f;

inline float estimateLedPowerW(bool on, const Rgb& c, uint8_t brightnessPct, uint16_t numLeds) {
  const float idle = numLeds * kLedIdleMaPerLed;
  if (!on || brightnessPct == 0) return idle * kLedSupplyV / 1000.0f;
  const float scale = (brightnessPct > 100 ? 100 : brightnessPct) / 100.0f;
  const float drive = numLeds * kLedMaPerChannel * ((c.r + c.g + c.b) / 255.0f) * scale;
  return std::round((idle + drive) * kLedSupplyV / 10.0f) / 100.0f;
}

// ─── Alertas (mismo orden y nombres que shared/protocol.ts) ───────────────────
enum AlertBit : uint8_t {
  ALERT_BAT_LOW = 0,
  ALERT_BAT_CRITICAL,
  ALERT_TEMP_HIGH,
  ALERT_USB_OUT_OF_SPEC,
  ALERT_SENSOR_LUX,
  ALERT_SENSOR_DHT,
  ALERT_SENSOR_POWER,
  ALERT_COUNT
};

inline const char* alertCode(uint8_t bit) {
  static const char* const names[ALERT_COUNT] = {"BAT_LOW",     "BAT_CRITICAL", "TEMP_HIGH",   "USB_OUT_OF_SPEC",
                                                 "SENSOR_LUX",  "SENSOR_DHT",   "SENSOR_POWER"};
  return bit < ALERT_COUNT ? names[bit] : "";
}

constexpr float kSocLow = 20.0f;
constexpr float kSocCritical = 10.0f;
constexpr float kTempHighC = 45.0f;
constexpr float kUsbMinV = 4.75f;
constexpr float kUsbMaxV = 5.25f;
constexpr float kUsbActiveA = 0.05f;

struct AlertInputs {
  float soc;
  bool charging;
  float tempC;
  bool tempValid;
  float usbV;
  float usbI;
  bool luxOk, dhtOk, inaOk;
};

inline uint8_t evaluateAlerts(const AlertInputs& x) {
  uint8_t m = 0;
  if (x.inaOk && !x.charging) {
    if (x.soc < kSocCritical) m |= 1 << ALERT_BAT_CRITICAL;
    else if (x.soc < kSocLow) m |= 1 << ALERT_BAT_LOW;
  }
  if (x.tempValid && x.tempC >= kTempHighC) m |= 1 << ALERT_TEMP_HIGH;
  if (x.inaOk && x.usbI > kUsbActiveA && (x.usbV < kUsbMinV || x.usbV > kUsbMaxV)) m |= 1 << ALERT_USB_OUT_OF_SPEC;
  if (!x.luxOk) m |= 1 << ALERT_SENSOR_LUX;
  if (!x.dhtOk) m |= 1 << ALERT_SENSOR_DHT;
  if (!x.inaOk) m |= 1 << ALERT_SENSOR_POWER;
  return m;
}

// ─── INA3221: conversión de registros ─────────────────────────────────────────
// Registro de shunt: bits 15..3 en complemento a 2, LSB = 40 µV.
inline float ina3221ShuntMilliVolts(uint16_t raw) { return (float)((int16_t)raw >> 3) * 0.040f; }
// Registro de bus: bits 15..3, LSB = 8 mV. Valores negativos se recortan a 0.
inline float ina3221BusVolts(uint16_t raw) {
  const int v = (int16_t)raw >> 3;
  return v < 0 ? 0.0f : v * 0.008f;
}
// Corriente en A a partir del voltaje de shunt (mV) y la resistencia (Ω).
inline float shuntCurrentA(float shuntMv, float shuntOhm) { return shuntOhm > 0 ? (shuntMv / 1000.0f) / shuntOhm : 0.0f; }

}  // namespace solace

// SOLACE — lógica pura del dispositivo (sin dependencias de Arduino).
// Es el espejo de shared/deviceLogic.ts y se prueba en el computador con
// `npm run test:firmware` (firmware/test/test_logic.cpp). La paridad C++ ↔ TS
// se comprueba en tests/shared/firmwareParity.test.ts.
//
// Los coeficientes, umbrales y tiempos vienen del firmware caracterizado y
// probado en la ESP32 (INA3221, BMP280 y BH1750).
#pragma once

#include <cctype>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>

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

// ─── INA3221 calibrado (caracterización) ──────────────────────────────────────
// CH1 batería (neto, negativo al cargar) · CH2 salida USB · CH3 tira LED.
constexpr int CH_BAT = 0, CH_USB = 1, CH_LED = 2;

// V = a·código_bus + b
constexpr float kCoefV[3][2] = {
    {0.00799865637f, -0.00205369055f},
    {0.00800014727f, -0.00203808233f},
    {0.007996608f, -0.000413497283f},
};
// I (mA) = b2·c·|c| + b1·c + b0   (término cuadrático impar)
constexpr float kCoefI[3][3] = {
    {-1.7400143e-06f, 0.401885828f, -0.220387929f},
    {-1.56502541e-06f, 0.403911333f, -0.124747574f},
    {-1.63262281e-06f, 0.402235087f, -0.233115302f},
};
constexpr float kInaCalMaxMa = 1500.0f;
constexpr int16_t kInaCodeSat = 4095;

enum InaRange : uint8_t { INA_OK = 0, INA_OUT_OF_CAL, INA_SATURATED };
inline const char* inaRangeName(uint8_t r) {
  static const char* const n[] = {"OK", "FUERA_CAL", "SATURADO"};
  return r < 3 ? n[r] : "";
}

// Los registros de shunt y bus usan los bits 15..3 en complemento a 2.
inline int16_t inaCode(uint16_t reg) { return (int16_t)((int16_t)reg >> 3); }
inline bool inaCodeSaturated(int16_t code) { return code >= kInaCodeSat || code <= -kInaCodeSat; }
inline float inaVolts(int ch, float busCodeAvg) { return kCoefV[ch][0] * busCodeAvg + kCoefV[ch][1]; }
inline float inaMilliAmps(int ch, float shuntCodeAvg) {
  const float c = shuntCodeAvg;
  return (kCoefI[ch][0] * std::fabs(c) + kCoefI[ch][1]) * c + kCoefI[ch][2];
}
inline InaRange inaRange(bool saturated, float mA) {
  if (saturated) return INA_SATURATED;
  if (std::fabs(mA) > kInaCalMaxMa) return INA_OUT_OF_CAL;
  return INA_OK;
}

// ─── Batería 2S2P Li-ion: estado de carga y energía ───────────────────────────
constexpr float kUsableWh = 31.5f;     // reemplazar por la capacidad medida (EL8)
constexpr float kRestPowerW = 0.3f;    // bajo esto se considera "en reposo"
constexpr float kChargingMa = -20.0f;  // I1 por debajo de esto = cargando
constexpr float kAvgTauS = 30.0f;      // suavizado de la potencia para la autonomía
constexpr float kFullV = 8.30f;        // banco lleno: V ≥ esto e |I| < kFullMa durante 1 min
constexpr float kFullMa = 80.0f;
constexpr uint32_t kFullHoldMs = 60000;

constexpr float kOcvV[] = {3.30f, 3.45f, 3.55f, 3.62f, 3.68f, 3.73f, 3.78f, 3.84f, 3.91f, 3.99f, 4.08f, 4.20f};
constexpr float kOcvSoc[] = {0, 5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100};
constexpr int kOcvLen = sizeof(kOcvV) / sizeof(kOcvV[0]);

// Curva típica NMC por celda; vBank es el voltaje en reposo del banco 2S.
inline float socFromPackVoltage(float vBank) {
  if (!std::isfinite(vBank)) return 0.0f;
  const float v = vBank / 2.0f;
  if (v <= kOcvV[0]) return 0.0f;
  if (v >= kOcvV[kOcvLen - 1]) return 100.0f;
  for (int i = 1; i < kOcvLen; i++) {
    if (v <= kOcvV[i]) {
      const float f = (v - kOcvV[i - 1]) / (kOcvV[i] - kOcvV[i - 1]);
      return kOcvSoc[i - 1] + f * (kOcvSoc[i] - kOcvSoc[i - 1]);
    }
  }
  return 100.0f;
}

// Conteo de energía: resta la potencia del CH1 (W, + descarga) durante dt (s).
inline float energyStep(float eWh, float pW, float dtS) {
  eWh -= pW * dtS / 3600.0f;
  if (eWh < 0) eWh = 0;
  if (eWh > kUsableWh) eWh = kUsableWh;
  return eWh;
}
inline float avgPowerStep(float avgW, float pW, float dtS) { return avgW + (pW - avgW) * dtS / (kAvgTauS + dtS); }

// Minutos restantes. Códigos especiales: -1 en reposo, -2 cargando, NAN sin dato.
constexpr float kAutonomyResting = -1.0f;
constexpr float kAutonomyCharging = -2.0f;
inline float autonomyMin(bool valid, float i1mA, float eWh, float avgW) {
  if (!valid) return NAN;
  if (i1mA < kChargingMa) return kAutonomyCharging;
  if (!std::isfinite(avgW) || avgW < kRestPowerW) return kAutonomyResting;
  return eWh / avgW * 60.0f;
}

// Estado de la batería según la medición instantánea del CH1 (la autonomía usa la
// potencia media; el estado no, para que cambie en cuanto cambia la corriente).
enum BatMode : uint8_t { BAT_UNKNOWN = 0, BAT_CHARGING, BAT_RESTING, BAT_DISCHARGING };
inline const char* batModeName(BatMode m) {
  static const char* const n[] = {"unknown", "charging", "resting", "discharging"};
  return n[m];
}
inline BatMode batMode(bool valid, float i1mA, float pW) {
  if (!valid || !std::isfinite(i1mA) || !std::isfinite(pW)) return BAT_UNKNOWN;
  if (i1mA < kChargingMa) return BAT_CHARGING;
  if (pW < kRestPowerW) return BAT_RESTING;
  return BAT_DISCHARGING;
}

// ─── Protección térmica (BMP280 pegado al banco) ──────────────────────────────
constexpr float kTempAlarmC = 45.0f;
constexpr float kTempCutC = 50.0f;
constexpr float kTempRearmC = 40.0f;  // para salir de CORTE
constexpr float kTempAlarmHyst = 2.0f;
constexpr uint32_t kTempNoDataMs = 5000;

enum TempState : uint8_t { TEMP_NORMAL = 0, TEMP_ALARM, TEMP_CUTOFF, TEMP_NO_DATA };
inline const char* tempStateName(uint8_t s) {
  static const char* const n[] = {"NORMAL", "ALARMA", "CORTE", "SIN_DATO"};
  return s < 4 ? n[s] : "";
}

inline TempState tempStep(TempState prev, float t, bool hasData) {
  if (!hasData || !std::isfinite(t)) return TEMP_NO_DATA;
  if (t >= kTempCutC) return TEMP_CUTOFF;
  if ((prev == TEMP_CUTOFF || prev == TEMP_NO_DATA) && t >= kTempRearmC) return TEMP_CUTOFF;
  if (t >= kTempAlarmC) return TEMP_ALARM;
  if (prev == TEMP_ALARM && t >= kTempAlarmC - kTempAlarmHyst) return TEMP_ALARM;
  return TEMP_NORMAL;
}
// La salida USB solo funciona en NORMAL o ALARMA (falla segura). La tira LED no
// tiene cortes de protección: obedece siempre a la app y al modo automático.
inline bool usbAllowedByTemp(TempState s) { return s == TEMP_NORMAL || s == TEMP_ALARM; }

// Protecciones del USB, seleccionables desde la app:
//   automática (por defecto, siempre al arrancar): temperatura (BMP280), INA3221 presente,
//     batería baja y sobrecorriente pueden apagar el USB;
//   manual: no se evalúa ninguna protección; el USB obedece solo al interruptor o a la app.
enum TempGuard : uint8_t { GUARD_AUTO = 0, GUARD_MANUAL };
inline const char* tempGuardName(TempGuard g) { return g == GUARD_MANUAL ? "manual" : "auto"; }

// Estado real de la salida USB: lo pedido (interruptor o app); en automático, menos las protecciones.
inline bool usbOutput(bool requested, TempState t, TempGuard guard, bool inaOk, bool batOk, bool blocked) {
  if (guard == GUARD_MANUAL) return requested;
  return requested && usbAllowedByTemp(t) && inaOk && batOk && !blocked;
}

// ─── Corte del USB por batería baja (histéresis sobre V1) ────────────────────
constexpr float kUsbOffV = 6.6f, kUsbOnV = 7.0f;
constexpr uint32_t kInaNoDataMs = 3000;

inline bool batteryHyst(bool ok, float v, float offV, float onV) {
  if (ok && v < offV) return false;
  if (!ok && v > onV) return true;
  return ok;
}

// CH1 saturado durante kSatCutUsbMs con el USB encendido → USB bloqueado kUsbBlockMs.
constexpr uint32_t kSatCutUsbMs = 3000;
constexpr uint32_t kUsbBlockMs = 30000;

// Nivel aplicado a la tira (0..255) a partir del brillo en %.
inline uint8_t ledLevel(int brightnessPct) {
  if (brightnessPct < 0) brightnessPct = 0;
  if (brightnessPct > 100) brightnessPct = 100;
  return (uint8_t)((brightnessPct * 255 + 50) / 100);
}

// ─── Origen de la carga de la batería ─────────────────────────────────────────
// La dirección de la corriente del CH1 dice si la batería se carga (I1 < -20 mA).
// El origen se determina así:
//  1. Si está cableado el detector de la entrada USB (PIN_USB_IN): USB o panel solar.
//  2. Si no, por la luz: cargar en la oscuridad (< kSolarMinLux) solo puede ser por USB.
//  3. Si hay luz y no hay detector, puede ser cualquiera de los dos: "desconocido".
enum ChargeSource : uint8_t { CHG_NONE = 0, CHG_SOLAR, CHG_USB, CHG_UNKNOWN };
constexpr float kSolarMinLux = 50.0f;

inline const char* chargeSourceName(ChargeSource s) {
  static const char* const n[] = {"none", "solar", "usb", "unknown"};
  return n[s];
}

inline ChargeSource chargeSource(bool charging, bool hasUsbDetector, bool usbPresent, bool luxValid, float lux) {
  if (!charging) return CHG_NONE;
  if (hasUsbDetector) return usbPresent ? CHG_USB : CHG_SOLAR;
  if (luxValid && std::isfinite(lux) && lux < kSolarMinLux) return CHG_USB;
  return CHG_UNKNOWN;
}

// ─── Interruptores de enclavamiento (a GND, pull-up interno) ──────────────────
// No son pulsadores: cada interruptor queda cerrado (LOW) o abierto (HIGH). Lo que
// cuenta es el CAMBIO de posición: cerrar enciende y abrir apaga, igual que los
// botones de la app. Así la última acción, física o virtual, es la que manda.
constexpr uint32_t kSwitchDebounceMs = 50;
struct SwitchState {
  bool stable;   // posición aceptada (true = cerrado)
  bool last;     // última lectura
  uint32_t tChange;
};
// closed = lectura actual (true = pin en LOW). Devuelve true si la posición estable cambió.
inline bool switchStep(SwitchState& s, bool closed, uint32_t nowMs) {
  if (closed != s.last) {
    s.last = closed;
    s.tChange = nowMs;
  }
  if (closed == s.stable || nowMs - s.tChange < kSwitchDebounceMs) return false;
  s.stable = closed;
  return true;
}

// ─── LEDs indicadores (true = encendido) ──────────────────────────────────────
// Testigo USB: fijo = salida de 5 V activa; parpadeo rápido = se pidió (interruptor o app)
// pero una protección la mantiene apagada; apagado = no se pidió.
inline bool usbLedOn(bool requested, bool on, uint32_t nowMs) {
  if (on) return true;
  if (requested) return (nowMs / 125) % 2 == 0;
  return false;
}

// LED de sistema: fijo = sistema encendido y en operación;
// "respiración" (sube y baja en 2 s) = la batería se está cargando (panel o USB);
// doble destello = sin datos del INA3221 (no se sabe el estado de la batería).
// Devuelve el brillo 0..255 para analogWrite.
inline uint8_t systemLedLevel(bool inaOk, bool charging, uint32_t nowMs) {
  if (!inaOk) {
    const uint32_t f = nowMs % 1200;
    return (f < 100 || (f > 250 && f < 350)) ? 255 : 0;
  }
  if (!charging) return 255;
  const uint32_t f = nowMs % 2000;
  const uint32_t tri = f < 1000 ? f : 2000 - f;  // 0..1000..0
  return (uint8_t)(20 + tri * 235 / 1000);
}

// ─── Luz automática (BH1750): oscuridad sostenida enciende, día sostenido apaga ─
// Con la tira encendida solo la apaga la luz de día (> luxOff), para que la luz de
// la propia tira no la apague. El sensor debe mirar hacia afuera.
constexpr float kAutoLuxOn = 10.0f;
constexpr float kAutoLuxOff = 200.0f;
constexpr uint32_t kAutoDarkMs = 500;     // oscuridad sostenida 0,5 s → enciende (≈1 s en total con el promedio)
constexpr uint32_t kAutoBrightMs = 3000;   // día sostenido 3 s → apaga (evita parpadeos por sombras)
constexpr uint32_t kLuxFreshMs = 5000;

struct AutoLightConfig {
  float luxOn;   // por debajo → enciende (tras darkMs)
  float luxOff;  // por encima → apaga (tras brightMs)
  uint32_t darkMs;
  uint32_t brightMs;
};

struct AutoLightState {
  bool on;
  bool darkTiming;
  uint32_t darkSince;
  bool brightTiming;
  uint32_t brightSince;
};

inline AutoLightState autoLightStep(AutoLightState s, float lux, bool luxValid, uint32_t nowMs,
                                    const AutoLightConfig& cfg) {
  if (!luxValid || !std::isfinite(lux)) return s;  // sin sensor: se mantiene el estado
  if (!s.on) {
    s.brightTiming = false;
    if (lux < cfg.luxOn) {
      if (!s.darkTiming) {
        s.darkTiming = true;
        s.darkSince = nowMs;
      } else if ((uint32_t)(nowMs - s.darkSince) >= cfg.darkMs) {
        s.on = true;
        s.darkTiming = false;
      }
    } else {
      s.darkTiming = false;
    }
  } else {
    s.darkTiming = false;
    if (lux > cfg.luxOff) {
      if (!s.brightTiming) {
        s.brightTiming = true;
        s.brightSince = nowMs;
      } else if ((uint32_t)(nowMs - s.brightSince) >= cfg.brightMs) {
        s.on = false;
        s.brightTiming = false;
      }
    } else {
      s.brightTiming = false;
    }
  }
  return s;
}

// ─── Alertas (mismo orden y nombres que shared/protocol.ts) ───────────────────
enum AlertBit : uint8_t {
  ALERT_BAT_LOW = 0,
  ALERT_BAT_CRITICAL,
  ALERT_TEMP_HIGH,
  ALERT_TEMP_CUTOFF,
  ALERT_SENSOR_TEMP,
  ALERT_USB_LOW_BAT,
  ALERT_USB_BLOCKED,
  ALERT_INA_RANGE,
  ALERT_USB_OUT_OF_SPEC,
  ALERT_SENSOR_LUX,
  ALERT_SENSOR_POWER,
  ALERT_TEMP_GUARD_OFF,
  ALERT_COUNT
};

inline const char* alertCode(uint8_t bit) {
  static const char* const names[ALERT_COUNT] = {"BAT_LOW",     "BAT_CRITICAL", "TEMP_HIGH",       "TEMP_CUTOFF",
                                                 "SENSOR_TEMP", "USB_LOW_BAT",  "USB_BLOCKED",     "INA_RANGE",
                                                 "USB_OUT_OF_SPEC", "SENSOR_LUX", "SENSOR_POWER",
                                                 "TEMP_GUARD_OFF"};
  return bit < ALERT_COUNT ? names[bit] : "";
}

constexpr float kSocLow = 20.0f;
constexpr float kSocCritical = 10.0f;
constexpr float kUsbMinV = 4.75f;
constexpr float kUsbMaxV = 5.25f;
constexpr float kUsbActiveA = 0.05f;

struct AlertInputs {
  float soc;  // NAN si aún no se conoce
  bool charging;
  TempState temp;
  bool inaOk;
  bool usbLowBat;
  bool usbBlocked;
  bool inaRangeBad;
  bool usbOn;
  float usbV;
  float usbA;
  bool luxOk;
  TempGuard guard;
};

inline uint16_t evaluateAlerts(const AlertInputs& x) {
  uint16_t m = 0;
  auto set = [&m](AlertBit b) { m |= (uint16_t)(1u << b); };
  if (x.inaOk && !x.charging && std::isfinite(x.soc)) {
    if (x.soc < kSocCritical) set(ALERT_BAT_CRITICAL);
    else if (x.soc < kSocLow) set(ALERT_BAT_LOW);
  }
  // En manual nada corta el USB: un CORTE se informa como temperatura alta y no hay
  // alertas de USB apagado por batería baja ni bloqueado.
  if (x.temp == TEMP_ALARM || (x.temp == TEMP_CUTOFF && x.guard == GUARD_MANUAL)) set(ALERT_TEMP_HIGH);
  if (x.temp == TEMP_CUTOFF && x.guard == GUARD_AUTO) set(ALERT_TEMP_CUTOFF);
  if (x.temp == TEMP_NO_DATA) set(ALERT_SENSOR_TEMP);
  if (x.guard == GUARD_AUTO && x.inaOk && x.usbLowBat) set(ALERT_USB_LOW_BAT);
  if (x.guard == GUARD_AUTO && x.usbBlocked) set(ALERT_USB_BLOCKED);
  if (x.inaOk && x.inaRangeBad) set(ALERT_INA_RANGE);
  if (x.inaOk && x.usbOn && x.usbA > kUsbActiveA && (x.usbV < kUsbMinV || x.usbV > kUsbMaxV)) set(ALERT_USB_OUT_OF_SPEC);
  if (!x.luxOk) set(ALERT_SENSOR_LUX);
  if (!x.inaOk) set(ALERT_SENSOR_POWER);
  if (x.guard == GUARD_MANUAL) set(ALERT_TEMP_GUARD_OFF);
  return m;
}

}  // namespace solace

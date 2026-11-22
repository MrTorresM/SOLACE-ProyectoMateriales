// Pruebas nativas (en el computador) de firmware/solace_esp32/logic.h
//   make -C firmware/test     (o: npm run test:firmware)
#include <cmath>
#include <cstdio>
#include <string_view>

#include "../solace_esp32/logic.h"

using namespace solace;

static int failures = 0, checks = 0;

#define CHECK(cond)                                              \
  do {                                                           \
    checks++;                                                    \
    if (!(cond)) {                                               \
      failures++;                                                \
      std::printf("  ✗ %s:%d  %s\n", __FILE__, __LINE__, #cond); \
    }                                                            \
  } while (0)
#define CHECK_NEAR(a, b, eps) CHECK(std::fabs((a) - (b)) <= (eps))

static void testColors() {
  Rgb c{};
  CHECK(parseHexColor("#FF8000", c));
  CHECK(c.r == 255 && c.g == 128 && c.b == 0);
  CHECK(parseHexColor("00ff7f", c));
  CHECK(c.g == 255 && c.b == 127);
  CHECK(!parseHexColor("#FFF", c));
  CHECK(!parseHexColor("#GG0000", c));
  CHECK(!parseHexColor(nullptr, c));
  char out[8];
  formatHexColor({226, 166, 75}, out);
  CHECK(std::string_view(out) == "#E2A64B");
}

static void testIna() {
  // Registro → código (bits 15..3, complemento a 2)
  CHECK(inaCode(0x0C80) == 400);
  CHECK(inaCode(0xFFF8) == -1);
  CHECK(inaCode(0x7FF8) == 4095);
  CHECK(inaCodeSaturated(4095) && inaCodeSaturated(-4095) && !inaCodeSaturated(4094));
  // Calibración de la caracterización
  CHECK_NEAR(inaVolts(CH_BAT, 1000), 7.99660, 1e-4);
  CHECK_NEAR(inaMilliAmps(CH_BAT, 0), -0.2204, 1e-3);
  CHECK_NEAR(inaMilliAmps(CH_BAT, 1000), 399.925, 1e-2);
  CHECK_NEAR(inaMilliAmps(CH_BAT, -1000), -400.366, 1e-2);  // término cuadrático impar
  CHECK_NEAR(inaMilliAmps(CH_USB, 1000), 402.222, 1e-2);
  CHECK_NEAR(inaMilliAmps(CH_LED, 1000), 400.369, 1e-2);
  // Estado de rango
  CHECK(inaRange(false, 1499) == INA_OK);
  CHECK(inaRange(false, -1499) == INA_OK);
  CHECK(inaRange(false, 1600) == INA_OUT_OF_CAL);
  CHECK(inaRange(true, 10) == INA_SATURATED);
  CHECK(std::string_view(inaRangeName(INA_OUT_OF_CAL)) == "FUERA_CAL");
}

static void testBattery() {
  CHECK_NEAR(socFromPackVoltage(8.40f), 100, 0.01);
  CHECK_NEAR(socFromPackVoltage(8.60f), 100, 0.01);
  CHECK_NEAR(socFromPackVoltage(6.60f), 0, 0.01);
  CHECK_NEAR(socFromPackVoltage(6.00f), 0, 0.01);
  CHECK_NEAR(socFromPackVoltage(7.56f), 50, 0.01);   // 3.78 V por celda
  CHECK_NEAR(socFromPackVoltage(7.62f), 55, 0.01);   // interpolación lineal
  CHECK_NEAR(socFromPackVoltage(NAN), 0, 0.01);
  float prev = -1;
  for (float v = 6.0f; v <= 8.6f; v += 0.02f) {
    const float s = socFromPackVoltage(v);
    CHECK(s >= prev);
    prev = s;
  }
  // Conteo de energía
  CHECK_NEAR(energyStep(10, 36, 100), 9, 1e-4);        // 36 W durante 100 s = 1 Wh
  CHECK_NEAR(energyStep(10, -36, 100), 11, 1e-4);      // cargando
  CHECK_NEAR(energyStep(0.5f, 36, 100), 0, 1e-6);      // no baja de 0
  CHECK_NEAR(energyStep(31, -36, 100), kUsableWh, 1e-6);  // ni sube del máximo
  CHECK_NEAR(avgPowerStep(2, 4, 30), 3, 1e-5);         // dt = tau → mitad del camino
  // Autonomía
  CHECK_NEAR(autonomyMin(true, 500, 10, 2), 300, 1e-3);
  CHECK(autonomyMin(true, -30, 10, 2) == kAutonomyCharging);
  CHECK(autonomyMin(true, 100, 10, 0.2f) == kAutonomyResting);
  CHECK(std::isnan(autonomyMin(false, 100, 10, 2)));
}

static void testBatMode() {
  CHECK(batMode(false, 500, 4) == BAT_UNKNOWN);
  CHECK(batMode(true, NAN, 4) == BAT_UNKNOWN);
  CHECK(batMode(true, -21, -0.17f) == BAT_CHARGING);
  CHECK(batMode(true, -19, -0.15f) == BAT_RESTING);  // ruido cerca de cero
  CHECK(batMode(true, 30, 0.25f) == BAT_RESTING);
  CHECK(batMode(true, 1900, 14) == BAT_DISCHARGING);  // aunque la media siga negativa tras una carga
  CHECK(std::string_view(batModeName(BAT_CHARGING)) == "charging");
}

static void testTemp() {
  CHECK(tempStep(TEMP_NORMAL, 30, true) == TEMP_NORMAL);
  CHECK(tempStep(TEMP_NORMAL, 45, true) == TEMP_ALARM);
  CHECK(tempStep(TEMP_ALARM, 43.5f, true) == TEMP_ALARM);   // histéresis de 2 °C
  CHECK(tempStep(TEMP_ALARM, 42.9f, true) == TEMP_NORMAL);
  CHECK(tempStep(TEMP_NORMAL, 50, true) == TEMP_CUTOFF);
  CHECK(tempStep(TEMP_CUTOFF, 45, true) == TEMP_CUTOFF);    // solo sale bajo 40 °C
  CHECK(tempStep(TEMP_CUTOFF, 39.9f, true) == TEMP_NORMAL);
  CHECK(tempStep(TEMP_NO_DATA, 41, true) == TEMP_CUTOFF);   // tras perder el sensor, igual que CORTE
  CHECK(tempStep(TEMP_NO_DATA, 25, true) == TEMP_NORMAL);
  CHECK(tempStep(TEMP_NORMAL, 25, false) == TEMP_NO_DATA);
  CHECK(tempStep(TEMP_NORMAL, NAN, true) == TEMP_NO_DATA);
  CHECK(usbAllowedByTemp(TEMP_NORMAL) && usbAllowedByTemp(TEMP_ALARM));
  CHECK(!usbAllowedByTemp(TEMP_CUTOFF) && !usbAllowedByTemp(TEMP_NO_DATA));
}

static void testUsbOutput() {
  // requested, temp, guard, inaOk, batOk, blocked
  CHECK(usbOutput(true, TEMP_NORMAL, GUARD_AUTO, true, true, false));
  CHECK(!usbOutput(false, TEMP_NORMAL, GUARD_AUTO, true, true, false));
  CHECK(usbOutput(true, TEMP_ALARM, GUARD_AUTO, true, true, false));
  CHECK(!usbOutput(true, TEMP_CUTOFF, GUARD_AUTO, true, true, false));
  CHECK(!usbOutput(true, TEMP_NO_DATA, GUARD_AUTO, true, true, false));
  // Automático: cada protección corta
  CHECK(!usbOutput(true, TEMP_NORMAL, GUARD_AUTO, false, true, false));
  CHECK(!usbOutput(true, TEMP_NORMAL, GUARD_AUTO, true, false, false));
  CHECK(!usbOutput(true, TEMP_NORMAL, GUARD_AUTO, true, true, true));
  // Manual: no se evalúa ninguna protección, solo lo pedido
  CHECK(usbOutput(true, TEMP_CUTOFF, GUARD_MANUAL, true, true, false));
  CHECK(usbOutput(true, TEMP_NO_DATA, GUARD_MANUAL, false, false, true));
  CHECK(!usbOutput(false, TEMP_NORMAL, GUARD_MANUAL, true, true, false));
  CHECK(std::string_view(tempGuardName(GUARD_MANUAL)) == "manual");
  CHECK(std::string_view(tempGuardName(GUARD_AUTO)) == "auto");
}

static void testSwitches() {
  SwitchState s{false, false, 0};
  CHECK(!switchStep(s, false, 10));         // sin cambio
  CHECK(!switchStep(s, true, 100));         // se cierra: espera el antirrebote
  CHECK(!switchStep(s, false, 120));        // rebote
  CHECK(!switchStep(s, true, 130));
  CHECK(!switchStep(s, true, 179));         // 49 ms estable: todavía no
  CHECK(switchStep(s, true, 180) && s.stable);  // 50 ms estable: cerrado
  CHECK(!switchStep(s, true, 500));         // sigue cerrado: no repite la acción
  CHECK(!switchStep(s, false, 1000));
  CHECK(switchStep(s, false, 1050) && !s.stable);  // abierto
  CHECK(!switchStep(s, false, 5000));
}

static void testBatteryCuts() {
  CHECK(!batteryHyst(true, 6.59f, kUsbOffV, kUsbOnV));
  CHECK(batteryHyst(true, 6.7f, kUsbOffV, kUsbOnV));
  CHECK(!batteryHyst(false, 6.9f, kUsbOffV, kUsbOnV));  // en la banda: se mantiene apagado
  CHECK(batteryHyst(false, 7.01f, kUsbOffV, kUsbOnV));
}

static void testLedLevel() {
  CHECK(ledLevel(100) == 255);
  CHECK(ledLevel(50) == 128);
  CHECK(ledLevel(0) == 0);
  CHECK(ledLevel(150) == 255);
  CHECK(ledLevel(-5) == 0);
}

static void testChargeSource() {
  CHECK(chargeSource(false, false, false, true, 1000) == CHG_NONE);
  CHECK(chargeSource(false, true, true, true, 1000) == CHG_NONE);
  // con detector de la entrada USB: decide el detector
  CHECK(chargeSource(true, true, true, true, 5000) == CHG_USB);
  CHECK(chargeSource(true, true, false, true, 2) == CHG_SOLAR);
  // sin detector: cargar a oscuras solo puede ser USB; con luz, no se sabe
  CHECK(chargeSource(true, false, false, true, 3) == CHG_USB);
  CHECK(chargeSource(true, false, false, true, 49.9f) == CHG_USB);
  CHECK(chargeSource(true, false, false, true, 50) == CHG_UNKNOWN);
  CHECK(chargeSource(true, false, false, false, 3) == CHG_UNKNOWN);  // sin sensor de luz
  CHECK(chargeSource(true, false, false, true, NAN) == CHG_UNKNOWN);
  CHECK(std::string_view(chargeSourceName(CHG_SOLAR)) == "solar");
  CHECK(std::string_view(chargeSourceName(CHG_UNKNOWN)) == "unknown");
}

static void testIndicatorLeds() {
  // Testigo USB
  CHECK(usbLedOn(true, true, 0) && usbLedOn(false, true, 999));  // encendido real: fijo
  CHECK(!usbLedOn(false, false, 0) && !usbLedOn(false, false, 130));
  CHECK(usbLedOn(true, false, 0) && !usbLedOn(true, false, 130) && usbLedOn(true, false, 250));  // bloqueado: parpadea
  // LED de sistema
  CHECK(systemLedLevel(true, false, 0) == 255 && systemLedLevel(true, false, 777) == 255);  // en operación: fijo
  CHECK(systemLedLevel(true, true, 0) == 20);     // cargando: respira (mínimo)
  CHECK(systemLedLevel(true, true, 1000) == 255);  // máximo a mitad del ciclo
  CHECK(systemLedLevel(true, true, 500) == systemLedLevel(true, true, 1500));
  CHECK(systemLedLevel(true, true, 2000) == 20);
  CHECK(systemLedLevel(false, false, 50) == 255 && systemLedLevel(false, false, 200) == 0 &&
        systemLedLevel(false, false, 300) == 255 && systemLedLevel(false, false, 600) == 0);  // sin INA: doble destello
}

static void testAutoLight() {
  CHECK(kAutoDarkMs == 500 && kAutoBrightMs == 3000);  // reacción ≈1 s (con la media de 3 lecturas del BH1750)
  const AutoLightConfig cfg{kAutoLuxOn, kAutoLuxOff, 3000, 10000};  // la lógica, con tiempos largos para medirla
  AutoLightState s{false, false, 0, false, 0};
  s = autoLightStep(s, 5, true, 1000, cfg);  // empieza a contar la oscuridad
  CHECK(!s.on && s.darkTiming);
  s = autoLightStep(s, 5, true, 3999, cfg);
  CHECK(!s.on);
  s = autoLightStep(s, 5, true, 4000, cfg);  // 3 s de oscuridad → enciende
  CHECK(s.on);
  s = autoLightStep(s, 150, true, 5000, cfg);  // la propia tira ilumina el sensor: no apaga
  CHECK(s.on);
  s = autoLightStep(s, 300, true, 6000, cfg);  // luz de día
  s = autoLightStep(s, 300, true, 15999, cfg);
  CHECK(s.on);
  s = autoLightStep(s, 300, true, 16000, cfg);  // 10 s de día → apaga
  CHECK(!s.on);
  // Una muestra clara reinicia la cuenta de oscuridad
  AutoLightState r{false, false, 0, false, 0};
  r = autoLightStep(r, 5, true, 0, cfg);
  r = autoLightStep(r, 50, true, 1000, cfg);
  r = autoLightStep(r, 5, true, 2000, cfg);
  r = autoLightStep(r, 5, true, 4500, cfg);
  CHECK(!r.on);
  r = autoLightStep(r, 5, true, 5000, cfg);
  CHECK(r.on);
  // Sensor inválido: no cambia nada
  const AutoLightState before = r;
  r = autoLightStep(r, 1000, false, 90000, cfg);
  CHECK(r.on == before.on && r.brightTiming == before.brightTiming);
  // desbordamiento de millis()
  AutoLightState w{false, true, 4294966000u, false, 0};
  w = autoLightStep(w, 1, true, 1000, cfg);  // pasaron ~2.3 s
  CHECK(!w.on);
  w = autoLightStep(w, 1, true, 1800, cfg);
  CHECK(w.on);
}

static void testAlerts() {
  const AlertInputs ok{80, false, TEMP_NORMAL, true, false, false, false, true, 5.0f, 1.0f, true, GUARD_AUTO};
  CHECK(evaluateAlerts(ok) == 0);
  AlertInputs x = ok;
  x.soc = 15;
  CHECK(evaluateAlerts(x) == (1 << ALERT_BAT_LOW));
  x.soc = 5;
  CHECK(evaluateAlerts(x) == (1 << ALERT_BAT_CRITICAL));
  x.charging = true;
  CHECK(evaluateAlerts(x) == 0);
  x = ok;
  x.soc = NAN;  // SoC aún desconocido
  CHECK(evaluateAlerts(x) == 0);
  x = ok;
  x.temp = TEMP_ALARM;
  CHECK(evaluateAlerts(x) == (1 << ALERT_TEMP_HIGH));
  x.temp = TEMP_CUTOFF;
  CHECK(evaluateAlerts(x) == (1 << ALERT_TEMP_CUTOFF));
  x.temp = TEMP_NO_DATA;
  CHECK(evaluateAlerts(x) == (1 << ALERT_SENSOR_TEMP));
  x = ok;
  x.usbLowBat = true;
  CHECK(evaluateAlerts(x) == (1 << ALERT_USB_LOW_BAT));
  x = ok;
  x.usbBlocked = x.inaRangeBad = true;
  CHECK(evaluateAlerts(x) == ((1 << ALERT_USB_BLOCKED) | (1 << ALERT_INA_RANGE)));
  x = ok;
  x.usbV = 4.6f;
  CHECK(evaluateAlerts(x) == (1 << ALERT_USB_OUT_OF_SPEC));
  x.usbA = 0.01f;  // sin carga conectada no se evalúa
  CHECK(evaluateAlerts(x) == 0);
  x.usbA = 1;
  x.usbOn = false;  // salida apagada: no se evalúa
  CHECK(evaluateAlerts(x) == 0);
  x = ok;
  x.inaOk = false;
  x.luxOk = false;
  x.soc = 0;
  x.usbLowBat = true;
  CHECK(evaluateAlerts(x) == ((1 << ALERT_SENSOR_LUX) | (1 << ALERT_SENSOR_POWER)));
  // Protección térmica en manual: el corte se informa como temperatura alta + aviso
  x = ok;
  x.guard = GUARD_MANUAL;
  CHECK(evaluateAlerts(x) == (1 << ALERT_TEMP_GUARD_OFF));
  x.temp = TEMP_CUTOFF;
  CHECK(evaluateAlerts(x) == ((1 << ALERT_TEMP_HIGH) | (1 << ALERT_TEMP_GUARD_OFF)));
  x.temp = TEMP_NO_DATA;
  CHECK(evaluateAlerts(x) == ((1 << ALERT_SENSOR_TEMP) | (1 << ALERT_TEMP_GUARD_OFF)));
  // En manual no hay alertas de USB cortado ni bloqueado
  x = ok;
  x.guard = GUARD_MANUAL;
  x.usbLowBat = true;
  x.usbBlocked = true;
  CHECK(evaluateAlerts(x) == (1 << ALERT_TEMP_GUARD_OFF));
  CHECK(std::string_view(alertCode(ALERT_TEMP_GUARD_OFF)) == "TEMP_GUARD_OFF");
  CHECK(std::string_view(alertCode(ALERT_TEMP_CUTOFF)) == "TEMP_CUTOFF");
  CHECK(std::string_view(alertCode(ALERT_COUNT)) == "");
  CHECK(std::string_view(tempStateName(TEMP_NO_DATA)) == "SIN_DATO");
}

int main() {
  std::printf("SOLACE firmware · pruebas de logic.h\n");
  testColors();
  testIna();
  testBattery();
  testBatMode();
  testTemp();
  testBatteryCuts();
  testUsbOutput();
  testSwitches();
  testLedLevel();
  testChargeSource();
  testIndicatorLeds();
  testAutoLight();
  testAlerts();
  std::printf("%s %d/%d verificaciones\n", failures ? "✗" : "✓", checks - failures, checks);
  return failures ? 1 : 0;
}

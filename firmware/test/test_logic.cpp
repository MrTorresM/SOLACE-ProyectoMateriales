// Pruebas nativas (en el computador) de firmware/solace_esp32/logic.h
//   make -C firmware/test     (o: npm run test:firmware)
#include <cstdio>
#include <cmath>
#include <string_view>

#include "../solace_esp32/logic.h"

using namespace solace;

static int failures = 0, checks = 0;

#define CHECK(cond)                                                     \
  do {                                                                  \
    checks++;                                                           \
    if (!(cond)) {                                                      \
      failures++;                                                       \
      std::printf("  ✗ %s:%d  %s\n", __FILE__, __LINE__, #cond);        \
    }                                                                   \
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

static void testSoc() {
  CHECK_NEAR(socFromCellVoltage(4.20f), 100, 0.01);
  CHECK_NEAR(socFromCellVoltage(4.30f), 100, 0.01);
  CHECK_NEAR(socFromCellVoltage(3.00f), 0, 0.01);
  CHECK_NEAR(socFromCellVoltage(2.50f), 0, 0.01);
  CHECK_NEAR(socFromCellVoltage(3.78f), 50, 0.01);
  CHECK_NEAR(socFromCellVoltage(3.805f), 55, 0.01);  // interpolación lineal
  CHECK(socFromCellVoltage(NAN) == 0);
  // 2S: 8.4 V lleno, 6.0 V vacío; con corriente se compensa la caída I·R
  CHECK_NEAR(estimateSoc(8.4f, 0), 100, 0.01);
  CHECK_NEAR(estimateSoc(6.0f, 0), 0, 0.01);
  CHECK(estimateSoc(7.5f, 1.0f) > estimateSoc(7.5f, 0.0f));
  // monotonía
  float prev = -1;
  for (float v = 6.0f; v <= 8.4f; v += 0.05f) {
    const float s = estimateSoc(v, 0);
    CHECK(s >= prev);
    prev = s;
  }
}

static void testAutoLight() {
  const AutoLightConfig cfg{15, 40, 5000};
  AutoLightState s{false, 0, false};
  s = autoLightStep(s, 100, true, 1000, cfg);
  CHECK(!s.on);
  s = autoLightStep(s, 10, true, 1100, cfg);  // oscuro → enciende de inmediato (sin cambios previos)
  CHECK(s.on && s.lastChangeMs == 1100);
  s = autoLightStep(s, 100, true, 3000, cfg);  // aún dentro de la permanencia mínima
  CHECK(s.on);
  s = autoLightStep(s, 30, true, 9000, cfg);  // en la banda de histéresis: se mantiene
  CHECK(s.on);
  s = autoLightStep(s, 41, true, 9000, cfg);  // por encima de luxOff → apaga
  CHECK(!s.on);
  s = autoLightStep(s, 1, false, 20000, cfg);  // sensor inválido: no cambia
  CHECK(!s.on);
  // desbordamiento de millis(): 4294967000 → 200 sigue contando bien
  AutoLightState w{false, 4294967000u, true};
  w = autoLightStep(w, 1, true, 200, cfg);
  CHECK(!w.on);  // solo pasaron ~496 ms
  w = autoLightStep(w, 1, true, 5000, cfg);
  CHECK(w.on);
}

static void testLedModel() {
  CHECK_NEAR(estimateLedPowerW(false, {255, 255, 255}, 100, 30), 0.15, 0.001);  // reposo 30 mA
  CHECK_NEAR(estimateLedPowerW(true, {255, 255, 255}, 100, 30), 9.15, 0.01);    // 1.83 A
  CHECK_NEAR(estimateLedPowerW(true, {255, 0, 0}, 100, 30), 3.15, 0.01);
  CHECK_NEAR(estimateLedPowerW(true, {255, 255, 255}, 50, 30), 4.65, 0.01);
  CHECK_NEAR(estimateLedPowerW(true, {255, 255, 255}, 0, 30), 0.15, 0.001);
}

static void testAlerts() {
  AlertInputs ok{80, false, 25, true, 5.0f, 1.0f, true, true, true};
  CHECK(evaluateAlerts(ok) == 0);
  AlertInputs low = ok;
  low.soc = 15;
  CHECK(evaluateAlerts(low) == (1 << ALERT_BAT_LOW));
  low.soc = 5;
  CHECK(evaluateAlerts(low) == (1 << ALERT_BAT_CRITICAL));
  low.charging = true;
  CHECK(evaluateAlerts(low) == 0);
  AlertInputs hot = ok;
  hot.tempC = 45;
  CHECK(evaluateAlerts(hot) & (1 << ALERT_TEMP_HIGH));
  hot.tempValid = false;
  CHECK(evaluateAlerts(hot) == 0);
  AlertInputs usb = ok;
  usb.usbV = 4.6f;
  CHECK(evaluateAlerts(usb) == (1 << ALERT_USB_OUT_OF_SPEC));
  usb.usbI = 0.01f;  // sin carga conectada no se evalúa
  CHECK(evaluateAlerts(usb) == 0);
  AlertInputs dead = ok;
  dead.inaOk = false;
  dead.soc = 0;
  CHECK(evaluateAlerts(dead) == (1 << ALERT_SENSOR_POWER));
  CHECK(std::string_view(alertCode(ALERT_USB_OUT_OF_SPEC)) == "USB_OUT_OF_SPEC");
}

static void testIna3221() {
  // 0x0C80 = 400 << 3 → 400 × 40 µV = 16 mV → 0.16 A con 0.1 Ω
  CHECK_NEAR(ina3221ShuntMilliVolts(0x0C80), 16.0, 1e-4);
  CHECK_NEAR(shuntCurrentA(16.0f, 0.1f), 0.16, 1e-5);
  // Negativo (cargando): -400 << 3
  CHECK_NEAR(ina3221ShuntMilliVolts((uint16_t)(-400 * 8)), -16.0, 1e-4);
  // Bus: 1000 << 3 → 8.000 V
  CHECK_NEAR(ina3221BusVolts(1000 << 3), 8.0, 1e-4);
  CHECK(ina3221BusVolts((uint16_t)(-5 * 8)) == 0);
  CHECK(shuntCurrentA(10, 0) == 0);
}

int main() {
  std::printf("SOLACE firmware · pruebas de logic.h\n");
  testColors();
  testSoc();
  testAutoLight();
  testLedModel();
  testAlerts();
  testIna3221();
  std::printf("%s %d/%d verificaciones\n", failures ? "✗" : "✓", checks - failures, checks);
  return failures ? 1 : 0;
}

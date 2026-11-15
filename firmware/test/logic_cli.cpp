// Puente de línea de comandos para la prueba de paridad C++ ↔ TypeScript
// (tests/shared/firmwareParity.test.ts). Lee comandos por stdin, uno por línea:
//   soc <packV> <currentA>
//   led <on 0|1> <#RRGGBB> <brightness> <numLeds>
//   auto <on 0|1> <lastChangeMs> <changedOnce 0|1> <lux> <luxValid 0|1> <nowMs> <luxOn> <luxOff> <dwellMs>
//   alerts <soc> <charging> <tempC> <tempValid> <usbV> <usbI> <luxOk> <dhtOk> <inaOk>
// y escribe una línea de resultado por comando.
#include <iostream>
#include <sstream>
#include <string>

#include "../solace_esp32/logic.h"

using namespace solace;

int main() {
  std::string line;
  while (std::getline(std::cin, line)) {
    std::istringstream in(line);
    std::string cmd;
    in >> cmd;
    if (cmd == "soc") {
      float v, i;
      in >> v >> i;
      std::printf("%.1f\n", estimateSoc(v, i));
    } else if (cmd == "led") {
      int on, bri, n;
      std::string hex;
      in >> on >> hex >> bri >> n;
      Rgb c{0, 0, 0};
      parseHexColor(hex.c_str(), c);
      std::printf("%.2f\n", estimateLedPowerW(on, c, (uint8_t)bri, (uint16_t)n));
    } else if (cmd == "auto") {
      int on, changed, valid;
      unsigned long last, now, dwell;
      float lux, lon, loff;
      in >> on >> last >> changed >> lux >> valid >> now >> lon >> loff >> dwell;
      AutoLightState s{(bool)on, (uint32_t)last, (bool)changed};
      s = autoLightStep(s, lux, valid, (uint32_t)now, {lon, loff, (uint32_t)dwell});
      std::printf("%d %lu\n", s.on ? 1 : 0, (unsigned long)s.lastChangeMs);
    } else if (cmd == "alerts") {
      AlertInputs a{};
      int charging, tv, lo, dok, iok;
      in >> a.soc >> charging >> a.tempC >> tv >> a.usbV >> a.usbI >> lo >> dok >> iok;
      a.charging = charging;
      a.tempValid = tv;
      a.luxOk = lo;
      a.dhtOk = dok;
      a.inaOk = iok;
      const uint8_t m = evaluateAlerts(a);
      std::string out;
      for (uint8_t b = 0; b < ALERT_COUNT; b++)
        if (m & (1 << b)) out += std::string(out.empty() ? "" : ",") + alertCode(b);
      std::printf("%s\n", out.empty() ? "-" : out.c_str());
    } else {
      std::printf("?\n");
    }
  }
  return 0;
}

// Puente de línea de comandos para la prueba de paridad C++ ↔ TypeScript
// (tests/shared/firmwareParity.test.ts). Lee comandos por stdin, uno por línea:
//   soc <vBank>
//   temp <prev 0..3> <tC> <hasData 0|1>
//   hyst <ok 0|1> <v> <offV> <onV>
//   level <brightnessPct>
//   bat <valid> <i1mA> <pW>
//   src <charging> <hasDetector> <usbPresent> <luxValid> <lux|nan>
//   aut <valid 0|1> <i1mA> <eWh> <avgW>
//   auto <on> <darkTiming> <darkSince> <brightTiming> <brightSince> <lux> <valid> <now> <luxOn> <luxOff> <darkMs> <brightMs>
//   alerts <soc|nan> <charging> <temp 0..3> <inaOk> <usbLowBat> <usbBlocked> <inaRangeBad> <usbOn> <usbV> <usbA> <luxOk> <guard 0|1>
//   usb <requested> <temp 0..3> <guard 0|1> <inaOk> <batOk> <blocked>
// y escribe una línea de resultado por comando.
#include <iostream>
#include <sstream>
#include <string>

#include "../solace_esp32/logic.h"

using namespace solace;

static float readFloat(std::istringstream& in) {
  std::string s;
  in >> s;
  return s == "nan" ? NAN : std::stof(s);
}

int main() {
  std::string line;
  while (std::getline(std::cin, line)) {
    std::istringstream in(line);
    std::string cmd;
    in >> cmd;
    if (cmd == "soc") {
      const float v = readFloat(in);
      std::printf("%.3f\n", socFromPackVoltage(v));
    } else if (cmd == "temp") {
      int prev, has;
      in >> prev;
      const float t = readFloat(in);
      in >> has;
      std::printf("%d\n", (int)tempStep((TempState)prev, t, has));
    } else if (cmd == "hyst") {
      int ok;
      float v, off, on;
      in >> ok >> v >> off >> on;
      std::printf("%d\n", batteryHyst(ok, v, off, on) ? 1 : 0);
    } else if (cmd == "level") {
      int b;
      in >> b;
      std::printf("%d\n", (int)ledLevel(b));
    } else if (cmd == "bat") {
      int valid;
      float i, p;
      in >> valid >> i >> p;
      std::printf("%s\n", batModeName(batMode(valid, i, p)));
    } else if (cmd == "src") {
      int ch, det, usb, lv;
      in >> ch >> det >> usb >> lv;
      const float lux = readFloat(in);
      std::printf("%s\n", chargeSourceName(chargeSource(ch, det, usb, lv, lux)));
    } else if (cmd == "aut") {
      int valid;
      float i, e, w;
      in >> valid >> i >> e >> w;
      const float a = autonomyMin(valid, i, e, w);
      if (std::isnan(a)) std::printf("nan\n");
      else std::printf("%.2f\n", a);
    } else if (cmd == "auto") {
      int on, dt, bt, valid;
      unsigned long ds, bs, now, dms, bms;
      float lux, lon, loff;
      in >> on >> dt >> ds >> bt >> bs >> lux >> valid >> now >> lon >> loff >> dms >> bms;
      AutoLightState s{(bool)on, (bool)dt, (uint32_t)ds, (bool)bt, (uint32_t)bs};
      s = autoLightStep(s, lux, valid, (uint32_t)now, {lon, loff, (uint32_t)dms, (uint32_t)bms});
      std::printf("%d %d %lu %d %lu\n", s.on, s.darkTiming, (unsigned long)s.darkSince, s.brightTiming,
                  (unsigned long)s.brightSince);
    } else if (cmd == "alerts") {
      AlertInputs a{};
      int ch, temp, inaOk, ulb, ub, rb, uon, lok, guard;
      a.soc = readFloat(in);
      in >> ch >> temp >> inaOk >> ulb >> ub >> rb >> uon >> a.usbV >> a.usbA >> lok >> guard;
      a.guard = (TempGuard)guard;
      a.charging = ch;
      a.temp = (TempState)temp;
      a.inaOk = inaOk;
      a.usbLowBat = ulb;
      a.usbBlocked = ub;
      a.inaRangeBad = rb;
      a.usbOn = uon;
      a.luxOk = lok;
      const uint16_t m = evaluateAlerts(a);
      std::string out;
      for (uint8_t b = 0; b < ALERT_COUNT; b++)
        if (m & (1u << b)) out += std::string(out.empty() ? "" : ",") + alertCode(b);
      std::printf("%s\n", out.empty() ? "-" : out.c_str());
    } else if (cmd == "usb") {
      int r, t, g, io, bo, bl;
      in >> r >> t >> g >> io >> bo >> bl;
      std::printf("%d\n", usbOutput(r, (TempState)t, (TempGuard)g, io, bo, bl) ? 1 : 0);
    } else {
      std::printf("?\n");
    }
  }
  return 0;
}

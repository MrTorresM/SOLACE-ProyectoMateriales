#include "sensors.h"

#include <BH1750.h>
#include <DHT.h>

#include "config.h"
#include "logic.h"

// ─── INA3221 ──────────────────────────────────────────────────────────────────
namespace {
constexpr uint8_t REG_CONFIG = 0x00;
constexpr uint8_t REG_MANUFACTURER = 0xFE;
constexpr uint16_t MANUFACTURER_TI = 0x5449;
// 3 canales activos | promedio 16 muestras | conversión bus 1.1 ms | shunt 1.1 ms | continuo shunt+bus
constexpr uint16_t CONFIG_VALUE = 0x7000 | (0b010 << 9) | (0b100 << 6) | (0b100 << 3) | 0b111;
constexpr float EMA_ALPHA = 0.35f;  // suavizado de las lecturas de potencia

BH1750 lightMeter(BH1750_ADDR);
DHT dht(PIN_DHT, DHT11);
}  // namespace

bool Ina3221::begin(uint8_t addr, TwoWire& wire) {
  addr_ = addr;
  wire_ = &wire;
  uint16_t id = 0;
  if (!readReg(REG_MANUFACTURER, id) || id != MANUFACTURER_TI) return false;
  return writeReg(REG_CONFIG, CONFIG_VALUE);
}

bool Ina3221::readReg(uint8_t reg, uint16_t& value) {
  wire_->beginTransmission(addr_);
  wire_->write(reg);
  if (wire_->endTransmission(false) != 0) return false;
  if (wire_->requestFrom((int)addr_, 2) != 2) return false;
  value = ((uint16_t)wire_->read() << 8) | wire_->read();
  return true;
}

bool Ina3221::writeReg(uint8_t reg, uint16_t value) {
  wire_->beginTransmission(addr_);
  wire_->write(reg);
  wire_->write(value >> 8);
  wire_->write(value & 0xFF);
  return wire_->endTransmission() == 0;
}

bool Ina3221::readChannel(uint8_t ch, float shuntOhm, ChannelReading& out) {
  uint16_t shuntRaw = 0, busRaw = 0;
  const uint8_t base = 0x01 + ch * 2;  // CH1: 0x01/0x02, CH2: 0x03/0x04, CH3: 0x05/0x06
  if (!readReg(base, shuntRaw) || !readReg(base + 1, busRaw)) return false;
  out.v = solace::ina3221BusVolts(busRaw);
  out.i = solace::shuntCurrentA(solace::ina3221ShuntMilliVolts(shuntRaw), shuntOhm);
  out.p = out.v * out.i;
  return true;
}

// ─── Sensors ──────────────────────────────────────────────────────────────────
void Sensors::begin() {
  inaPresent_ = ina_.begin(INA3221_ADDR, Wire);
  luxPresent_ = lightMeter.begin(BH1750::CONTINUOUS_HIGH_RES_MODE, BH1750_ADDR, &Wire);
  dht.begin();
  d_.inaOk = inaPresent_;
  d_.luxOk = luxPresent_;
  d_.dhtOk = true;  // se confirma con la primera lectura
  Serial.printf("[sensores] INA3221 %s · BH1750 %s · DHT11 en GPIO%d\n", inaPresent_ ? "OK" : "NO DETECTADO",
                luxPresent_ ? "OK" : "NO DETECTADO", PIN_DHT);
}

void Sensors::loop(uint32_t now) {
  if (now - lastIna_ >= INA_READ_MS) {
    lastIna_ = now;
    readIna();
  }
  readLux();
  if (now - lastDht_ >= DHT_READ_MS) {
    lastDht_ = now;
    readDht();
  }
}

static void ema(ChannelReading& acc, const ChannelReading& x, bool first) {
  if (first) {
    acc = x;
    return;
  }
  acc.v += EMA_ALPHA * (x.v - acc.v);
  acc.i += EMA_ALPHA * (x.i - acc.i);
  acc.p = acc.v * acc.i;
}

void Sensors::readIna() {
  if (!inaPresent_) {
    // Reintenta detectar el sensor de vez en cuando (conector suelto, etc.).
    static uint32_t lastProbe = 0;
    if (millis() - lastProbe > 5000) {
      lastProbe = millis();
      inaPresent_ = ina_.begin(INA3221_ADDR, Wire);
      inaFirst_ = true;
    }
    d_.inaOk = inaPresent_;
    return;
  }
  ChannelReading bat, usb, radio;
  const bool ok = ina_.readChannel(INA_CH_BAT, SHUNT_OHM_BAT, bat) && ina_.readChannel(INA_CH_USB, SHUNT_OHM_USB, usb) &&
                  ina_.readChannel(INA_CH_RADIO, SHUNT_OHM_RADIO, radio);
  if (!ok) {
    if (++inaFails_ >= SENSOR_FAIL_LIMIT) {
      d_.inaOk = false;
      inaPresent_ = false;
    }
    return;
  }
  inaFails_ = 0;
  d_.inaOk = true;
  ema(d_.bat, bat, inaFirst_);
  ema(d_.usb, usb, inaFirst_);
  ema(d_.radio, radio, inaFirst_);
  inaFirst_ = false;
}

void Sensors::readLux() {
  if (!luxPresent_) {
    static uint32_t lastProbe = 0;
    if (millis() - lastProbe > 5000) {
      lastProbe = millis();
      luxPresent_ = lightMeter.begin(BH1750::CONTINUOUS_HIGH_RES_MODE, BH1750_ADDR, &Wire);
    }
    d_.luxOk = luxPresent_;
    return;
  }
  if (!lightMeter.measurementReady()) return;
  const float lux = lightMeter.readLightLevel();
  if (lux < 0) {
    if (++luxFails_ >= SENSOR_FAIL_LIMIT) {
      d_.luxOk = false;
      luxPresent_ = false;
    }
    return;
  }
  luxFails_ = 0;
  d_.luxOk = true;
  d_.luxRaw = lux;
}

float Sensors::sampleLuxQuick() {
  if (!luxPresent_) return -1;
  lightMeter.configure(BH1750::ONE_TIME_LOW_RES_MODE);
  delay(24);  // tiempo máximo de integración en baja resolución
  const float lux = lightMeter.readLightLevel();
  lightMeter.configure(BH1750::CONTINUOUS_HIGH_RES_MODE);
  return lux;
}

void Sensors::readDht() {
  const float t = dht.readTemperature();
  const float h = dht.readHumidity();
  if (isnan(t) || isnan(h)) {
    if (++dhtFails_ >= SENSOR_FAIL_LIMIT) {
      d_.dhtOk = false;
      d_.tempC = NAN;
      d_.hum = NAN;
    }
    return;
  }
  dhtFails_ = 0;
  d_.dhtOk = true;
  d_.tempC = t;
  d_.hum = h;
}

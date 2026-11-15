// SOLACE — lectura de sensores: INA3221 (potencia 3 canales), BH1750 (luz), DHT11 (T/H).
#pragma once

#include <Arduino.h>
#include <Wire.h>

struct ChannelReading {
  float v = 0, i = 0, p = 0;
};

struct SensorData {
  bool luxOk = false, dhtOk = false, inaOk = false;
  float luxRaw = NAN;  // lectura directa del BH1750
  float tempC = NAN, hum = NAN;
  ChannelReading bat, usb, radio;
};

// Driver mínimo del INA3221 (sin librerías externas).
class Ina3221 {
 public:
  bool begin(uint8_t addr, TwoWire& wire);
  // Lee bus y shunt de un canal (0..2). Devuelve false si falla el I2C.
  bool readChannel(uint8_t ch, float shuntOhm, ChannelReading& out);

 private:
  bool readReg(uint8_t reg, uint16_t& value);
  bool writeReg(uint8_t reg, uint16_t value);
  uint8_t addr_ = 0x40;
  TwoWire* wire_ = nullptr;
};

class Sensors {
 public:
  void begin();
  void loop(uint32_t nowMs);
  // Medición rápida (~24 ms, baja resolución) para muestrear la luz ambiente con la tira apagada.
  float sampleLuxQuick();
  const SensorData& data() const { return d_; }

 private:
  void readIna();
  void readLux();
  void readDht();

  SensorData d_;
  Ina3221 ina_;
  bool inaPresent_ = false;
  bool luxPresent_ = false;
  uint8_t inaFails_ = 0, luxFails_ = 0, dhtFails_ = 0;
  uint32_t lastIna_ = 0, lastDht_ = 0;
  bool inaFirst_ = true;
};

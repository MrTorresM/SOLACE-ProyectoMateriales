/*
  SOLACE (ARES) — firmware unificado para ESP32 DevKit V1
  =======================================================
  Base: firmware caracterizado y probado en la ESP32 (INA3221, BMP280 y BH1750),
  con la conexión al hub del Mac (MQTT) para la interfaz web /listener y /mainUser.

  ─────────────────────────────────────────────────────────────────────────────
  CONEXIONES (todas las tierras unidas: ESP32, sensores, batería, step-down,
  tira, MOSFET, LEDs e interruptores)
  ─────────────────────────────────────────────────────────────────────────────
  Elemento                     Pin del elemento        → Conectar a
  ───────────────────────────  ──────────────────────  ─────────────────────────
  Bus I2C (los 3 sensores)     SDA                     → GPIO21
                               SCL                     → GPIO22
  INA3221 (0x40, A0 a GND)     VS / GND                → 3V3 / GND
    CH1 batería                IN+ → IN−               en serie con el NODO DE LA
                                                       BATERÍA (IN+ lado batería).
                                                       Mide voltaje, consumo y
                                                       carga (corriente negativa =
                                                       la batería se está cargando
                                                       por el panel o por USB).
    CH2 salida USB (celular)   IN+ → IN−               en serie con la salida de
                                                       5 V hacia el puerto USB,
                                                       después del MOSFET.
    CH3 tira LED               IN+ → IN−               en serie con el 5 V de la tira.
  BMP280 (0x76/0x77)           VCC / GND               → 3V3 / GND (nunca 5 V)
                               CSB                     sin conectar
                               ubicación               pegado al banco de baterías
  BH1750 (0x23)                VCC / GND / ADDR        → 3V3 / GND / GND
                               ubicación               mirando hacia afuera, sin
                                                       luz directa de la tira
  Tira RGB WS2812B (5 V,       DIN                     → GPIO25 a través de 330 Ω
  3 pines)                     5V                      → 5 V del step-down (pasando
                                                       por CH3). 1000 µF entre 5 V
                                                       y GND. Siempre alimentada:
                                                       se enciende/apaga por datos.
                               GND                     → GND común
  MOSFET salida USB (Q2)       compuerta (o base del   → GPIO26. HIGH = USB encendido
                               driver)                 (USB_ACTIVO_ALTO en config.h)
  Interruptor USB              un terminal / el otro   → GPIO32 / GND (pull-up interno).
  (enclavamiento, no pulsador)                           Cerrado = pide el USB encendido.
  Interruptor de la luz        un terminal / el otro   → GPIO27 / GND (pull-up interno).
  (enclavamiento, no pulsador)                           Cerrado = blanco 100 %; abierto = apagada.
  LED testigo USB (antes       ánodo → 330 Ω → GPIO4,  fijo = 5 V USB activo
  LED de alarma)               cátodo → GND            parpadeo rápido = pedido pero
                                                       bloqueado por protección
  LED de sistema / carga       ánodo → 330 Ω → GPIO33, fijo = sistema en operación
  (va donde estaba S2)         cátodo → GND            respiración = cargando batería
                                                       doble destello = sin INA3221
  LED azul integrado           GPIO2 (en la placa)     conexión WiFi / app
  Detector entrada USB de      divisor 5 V → 3,3 V     → GPIO34 y PIN_USB_IN 34 en
  carga (OPCIONAL)             (p. ej. 10 kΩ / 20 kΩ)  config.h. Sin él, el origen de
                                                       la carga se deduce por la luz.

  ─────────────────────────────────────────────────────────────────────────────
  FUNCIONES
  ─────────────────────────────────────────────────────────────────────────────
  - Salida USB de 5 V para cargar el celular (MOSFET en GPIO26). Se enciende y apaga
    desde la app o con el interruptor de GPIO32. Cada movimiento del interruptor
    ALTERNA el estado (como un interruptor de escalera), así la app y el interruptor
    comparten un único estado. Al arrancar: interruptor cerrado = encendido.
    El LED testigo (GPIO4) muestra el estado real.
  - Interruptor de la luz (GPIO27): cada movimiento alterna la luz (encendida = blanco
    al 100 %, manual). La app y el interruptor manejan el MISMO estado.
  - MODO MANUAL POR DEFECTO (siempre al arrancar): el USB y la luz siguen a sus
    interruptores y funcionan sin WiFi ni app. La app es un extra: puede cambiarlos
    y activar el modo automático (luz por lux, protecciones del USB) hasta reiniciar.
  - Interruptores, protecciones y salidas se evalúan cada 0,5 s; la app recibe la
    telemetría cada 3 s (los cambios se envían al instante).
  - Protecciones de la salida USB (la tira LED no tiene cortes):
      Solo en modo AUTOMÁTICO (se elige en la app):
      BMP280: T >= 45 °C alarma; T >= 50 °C corta el USB hasta que T < 40 °C.
              Sin dato del sensor por 5 s también corta (falla segura).
      En modo MANUAL (por defecto) NO se evalúa ninguna protección: el USB
      obedece solo al interruptor o a la app (la temperatura solo avisa).
      Batería baja: corta bajo 6,6 V y vuelve sobre 7,0 V.
      Sin datos del INA3221: USB apagado.
      CH1 saturado 3 s con el USB encendido: USB bloqueado 30 s.
  - Tira RGB (WS2812B): encendido, color y brillo desde la app. En automático (se elige en la app) se
    enciende en blanco con < 10 lx durante 0,5 s (≈1 s en total) y se apaga con > 200 lx durante 3 s
    (umbrales ajustables desde la app).
  - Carga de la batería: CH1 negativo = cargando. El LED de sistema "respira" y la
    app muestra la animación de carga con su origen (panel solar o USB).
  - Energía restante y autonomía: estado de carga inicial por voltaje en reposo y
    luego conteo de energía con la potencia del CH1.
  - WiFi eficiente: escanea antes de conectar, se une a la red conocida de mejor señal
    y, si falla, APAGA la radio y espera 5, 10, 20, 40… hasta 60 s antes de reintentar.
    En línea usa modem sleep. LED azul (GPIO2): parpadeo rápido = intentando WiFi,
    destello corto cada 2 s = radio en reposo esperando reintento, doble destello =
    buscando el Mac, fijo = en línea.

  Diagnóstico del USB por el Monitor Serie (115200): cada cambio imprime una línea
  "# [usb] … · GPIO26=HIGH/LOW" con el motivo (p. ej. "BLOQUEADO: sin datos del INA3221").
  Escribir "q2" + Enter fuerza GPIO26 encendido 10 s sin protecciones (prueba del MOSFET).

  Sensores I2C: si alguno no responde, se reintenta solo cada 2 s (ver tareaI2C). Si ninguno
  responde, se libera el bus y se baja la velocidad. El Serial imprime "# [i2c] …" con qué
  direcciones responden y el nivel de SDA/SCL, para encontrar la falla de cableado.

  Red: escribe tu WiFi en secrets.h (copia de secrets.example.h). La ESP32 encuentra
  el Mac sola (no hace falta escribir IPs). Envía la telemetría por MQTT cada 3 s.

  Salida serial (115200 baudios), una línea CSV cada 3 s:
    t_ms,V1,I1_mA,P1_mW,V2,I2_mA,P2_mW,V3,I3_mA,P3_mW,E1,E2,E3,
    T_C,P_hPa,lux,est_lux,modo_led,pwm_led,usb_pedido,usb,est_temp,carga,soc_pct,E_Wh,P_prom_W,autonomia_min
    carga = none / solar / usb / unknown. autonomia_min = -1 en reposo, -2 cargando, nan sin dato.
    Las líneas que empiezan con "#" son mensajes (WiFi, hub, errores).

  Librerías (Gestor de librerías): Adafruit NeoPixel · PubSubClient · ArduinoJson 7
  Placa: "ESP32 Dev Module" (core de Espressif 3.x)
*/

#include <Adafruit_NeoPixel.h>
#include <Arduino.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include <WiFi.h>
#include <Wire.h>
#include <math.h>

#include "config.h"
#include "hub_link.h"
#include "logic.h"

// Cada pin debe tener una sola función: un LED o un interruptor en el mismo pin que SDA/SCL
// corrompe el bus I2C (los sensores leen unas veces y luego se pierden).
#define SOLACE_PIN_UNICO(p)                                                                        \
  static_assert((p) != PIN_SDA && (p) != PIN_SCL, "Pin " #p " choca con SDA/SCL del I2C");
SOLACE_PIN_UNICO(PIN_LED_STRIP)
SOLACE_PIN_UNICO(PIN_USB_Q2)
SOLACE_PIN_UNICO(PIN_SW_USB)
SOLACE_PIN_UNICO(PIN_SW_LUZ)
SOLACE_PIN_UNICO(PIN_LED_USB)
SOLACE_PIN_UNICO(PIN_LED_SISTEMA)
SOLACE_PIN_UNICO(PIN_STATUS_LED)
static_assert(PIN_SDA != PIN_SCL, "SDA y SCL deben ser pines distintos");
static_assert(PIN_USB_IN < 0 || (PIN_USB_IN != PIN_SDA && PIN_USB_IN != PIN_SCL), "PIN_USB_IN choca con SDA/SCL");

#if !__has_include("secrets.h")
#warning "Falta secrets.h: copia secrets.example.h como secrets.h y escribe tu WiFi."
#endif

// Interruptores de enclavamiento (estado con antirrebote en logic.h)
solace::SwitchState swUsb = {false, false, 0};
solace::SwitchState swLuz = {false, false, 0};

// =====================================================================
// INA3221 (de ina3221_lectura.ino)
// =====================================================================
#define CONFIG_INA 0x7127  // igual a la caracterización
#define N_PROMEDIO 16

struct {
  float V[3] = {NAN, NAN, NAN};
  float I[3] = {NAN, NAN, NAN};  // mA
  solace::InaRange E[3] = {solace::INA_OK, solace::INA_OK, solace::INA_OK};
  bool alguna = false;
  uint32_t tUlt = 0;
} ina;
bool inaListo = false;   // el supervisor I2C lo reconecta si se pierde
uint8_t fallosIna = 0;   // lecturas fallidas seguidas

bool inaEscribir(uint8_t reg, uint16_t valor) {
  Wire.beginTransmission(INA_ADDR);
  Wire.write(reg);
  Wire.write((uint8_t)(valor >> 8));
  Wire.write((uint8_t)(valor & 0xFF));
  return Wire.endTransmission() == 0;
}

bool inaLeer(uint8_t reg, uint16_t &valor) {
  Wire.beginTransmission(INA_ADDR);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom((uint8_t)INA_ADDR, (uint8_t)2) != 2) return false;
  uint8_t msb = Wire.read();
  uint8_t lsb = Wire.read();
  valor = ((uint16_t)msb << 8) | lsb;
  return true;
}

bool inaEsperarConversion() {
  uint32_t t0 = millis();
  uint16_t me;
  while (millis() - t0 < 100) {
    if (!inaLeer(0x0F, me)) return false;
    if (me & 0x0001) return true;
    delay(1);  // cede la CPU mientras convierte (≈6,6 ms por ciclo de 3 canales)
  }
  return false;
}

// Comprueba que en 0x40 haya un INA3221 (ID de fabricante 0x5449 = "TI") y lo configura.
bool inaIniciar() {
  // ID de fabricante (0xFE) = 0x5449 "TI" o ID del chip (0xFF) = 0x3220. Algunos módulos
  // (clones) devuelven 0x3220 en ambos registros: se acepta cualquiera de los dos.
  uint16_t idFab = 0, idChip = 0;
  const bool okFab = inaLeer(0xFE, idFab);
  const bool okChip = inaLeer(0xFF, idChip);
  if (!okFab && !okChip) return false;
  if (idFab != 0x5449 && idFab != 0x3220 && idChip != 0x3220) {
    Serial.printf("# [i2c] en 0x40 hay algo que no es un INA3221 (0xFE=0x%04X, 0xFF=0x%04X)\n", idFab, idChip);
    return false;
  }
  if (!inaEscribir(0x00, 0x8000)) return false;  // reset
  delay(10);
  uint16_t cfg = 0;
  return inaEscribir(0x00, CONFIG_INA) && inaLeer(0x00, cfg) && (cfg & 0x7FFF) == (CONFIG_INA & 0x7FFF);
}

bool inaMedir() {
  long sumaSh[3] = {0, 0, 0}, sumaBus[3] = {0, 0, 0};
  bool sat[3] = {false, false, false};
  uint16_t v;
  for (int k = 0; k < N_PROMEDIO; k++) {
    if (!inaEsperarConversion()) return false;
    for (int c = 0; c < 3; c++) {
      if (!inaLeer(0x01 + 2 * c, v)) return false;
      int16_t cod = solace::inaCode(v);
      if (solace::inaCodeSaturated(cod)) sat[c] = true;
      sumaSh[c] += cod;
      if (!inaLeer(0x02 + 2 * c, v)) return false;
      sumaBus[c] += solace::inaCode(v);
    }
  }
  for (int c = 0; c < 3; c++) {
    float cs = (float)sumaSh[c] / N_PROMEDIO;
    float cb = (float)sumaBus[c] / N_PROMEDIO;
    ina.V[c] = solace::inaVolts(c, cb);
    ina.I[c] = solace::inaMilliAmps(c, cs);  // b2*cs*|cs| + b1*cs + b0
    ina.E[c] = solace::inaRange(sat[c], ina.I[c]);
  }
  return true;
}

// =====================================================================
// BMP280 (de bmp280_lectura.ino), sin bloqueos largos
// =====================================================================
const float OFFSET_P = +0.723f;  // hPa
const float OFFSET_T = -3.517f;  // °C
const uint8_t OS_P = 16;
const uint8_t OS_T = 2;
const uint8_t BMP_N_PROM = 5;
const uint32_t BMP_PERIODO_MS = PERIODO_BMP_MS;

#define REG_CALIB 0x88
#define REG_ID 0xD0
#define REG_RESET 0xE0
#define REG_STATUS 0xF3
#define REG_CTRL 0xF4
#define REG_CONFIG 0xF5
#define REG_DATA 0xF7

uint8_t bmpAddr = 0x76;
bool bmpListo = false;
uint16_t dig_T1, dig_P1;
int16_t dig_T2, dig_T3, dig_P2, dig_P3, dig_P4, dig_P5, dig_P6, dig_P7, dig_P8, dig_P9;
int32_t t_fine;

struct {
  float T = NAN;  // °C corregida
  float P = NAN;  // hPa corregida
  bool alguna = false;
  uint32_t tUlt = 0;
} bmp;

void bmpEscribir(uint8_t reg, uint8_t val) {
  Wire.beginTransmission(bmpAddr);
  Wire.write(reg);
  Wire.write(val);
  Wire.endTransmission();
}

bool bmpLeer(uint8_t reg, uint8_t *buf, uint8_t len) {
  Wire.beginTransmission(bmpAddr);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom((int)bmpAddr, (int)len) != len) return false;
  for (uint8_t i = 0; i < len; i++) buf[i] = Wire.read();
  return true;
}

uint8_t codigoOS(uint8_t os) {
  switch (os) {
    case 1: return 1;
    case 2: return 2;
    case 4: return 3;
    case 8: return 4;
    case 16: return 5;
  }
  return 0;
}

bool bmpIniciar() {
  const uint8_t dirs[2] = {0x76, 0x77};
  uint8_t id = 0;
  bool hallado = false;
  for (uint8_t i = 0; i < 2 && !hallado; i++) {
    bmpAddr = dirs[i];
    Wire.beginTransmission(bmpAddr);
    if (Wire.endTransmission() == 0 && bmpLeer(REG_ID, &id, 1) && (id == 0x58 || id == 0x60)) hallado = true;
  }
  if (!hallado) return false;
  bmpEscribir(REG_RESET, 0xB6);
  delay(10);
  uint8_t c[24];
  if (!bmpLeer(REG_CALIB, c, 24)) return false;
  dig_T1 = (uint16_t)(c[1] << 8 | c[0]);
  dig_T2 = (int16_t)(c[3] << 8 | c[2]);
  dig_T3 = (int16_t)(c[5] << 8 | c[4]);
  dig_P1 = (uint16_t)(c[7] << 8 | c[6]);
  dig_P2 = (int16_t)(c[9] << 8 | c[8]);
  dig_P3 = (int16_t)(c[11] << 8 | c[10]);
  dig_P4 = (int16_t)(c[13] << 8 | c[12]);
  dig_P5 = (int16_t)(c[15] << 8 | c[14]);
  dig_P6 = (int16_t)(c[17] << 8 | c[16]);
  dig_P7 = (int16_t)(c[19] << 8 | c[18]);
  dig_P8 = (int16_t)(c[21] << 8 | c[20]);
  dig_P9 = (int16_t)(c[23] << 8 | c[22]);
  bmpEscribir(REG_CTRL, 0x00);    // sleep
  bmpEscribir(REG_CONFIG, 0x00);  // filtro IIR apagado, como en la caracterización
  return dig_T1 != 0 && dig_P1 != 0;
}

void bmpDisparar() {
  bmpEscribir(REG_CTRL, (codigoOS(OS_T) << 5) | (codigoOS(OS_P) << 2) | 0x01);  // modo forzado
}

uint32_t bmpTiempoConvMs() { return (uint32_t)(1.25f + 2.3f * OS_T + 2.3f * OS_P + 0.575f) + 2; }

// Devuelve 1 = dato listo, 0 = aún convirtiendo, -1 = error
int bmpRecoger(int32_t &adcT, int32_t &adcP) {
  uint8_t st;
  if (!bmpLeer(REG_STATUS, &st, 1)) return -1;
  if (st & 0x08) return 0;
  uint8_t b[6];
  if (!bmpLeer(REG_DATA, b, 6)) return -1;
  adcP = ((int32_t)b[0] << 12) | ((int32_t)b[1] << 4) | (b[2] >> 4);
  adcT = ((int32_t)b[3] << 12) | ((int32_t)b[4] << 4) | (b[5] >> 4);
  return (adcP != 0x80000 && adcT != 0x80000) ? 1 : -1;
}

// Compensación entera de Bosch (datasheet BST-BMP280-DS001, sec. 8.2)
int32_t compensarT(int32_t adc_T) {
  int32_t var1 = ((((adc_T >> 3) - ((int32_t)dig_T1 << 1))) * ((int32_t)dig_T2)) >> 11;
  int32_t var2 = (((((adc_T >> 4) - ((int32_t)dig_T1)) * ((adc_T >> 4) - ((int32_t)dig_T1))) >> 12) * ((int32_t)dig_T3)) >> 14;
  t_fine = var1 + var2;
  return (t_fine * 5 + 128) >> 8;  // 0.01 °C
}

uint32_t compensarP(int32_t adc_P) {
  int64_t var1, var2, p;
  var1 = ((int64_t)t_fine) - 128000;
  var2 = var1 * var1 * (int64_t)dig_P6;
  var2 = var2 + ((var1 * (int64_t)dig_P5) << 17);
  var2 = var2 + (((int64_t)dig_P4) << 35);
  var1 = ((var1 * var1 * (int64_t)dig_P3) >> 8) + ((var1 * (int64_t)dig_P2) << 12);
  var1 = (((((int64_t)1) << 47) + var1)) * ((int64_t)dig_P1) >> 33;
  if (var1 == 0) return 0;
  p = 1048576 - adc_P;
  p = (((p << 31) - var2) * 3125) / var1;
  var1 = (((int64_t)dig_P9) * (p >> 13) * (p >> 13)) >> 25;
  var2 = (((int64_t)dig_P8) * p) >> 19;
  p = ((p + var1 + var2) >> 8) + (((int64_t)dig_P7) << 4);
  return (uint32_t)p;  // Pa * 256
}

void tareaBMP(uint32_t ahora) {
  static uint32_t tDisparo = 0, tReintento = 0;
  static bool esperando = false;
  static double sumaT = 0, sumaP = 0;
  static uint8_t n = 0;

  if (!bmpListo) {
    if (ahora - tReintento >= 2000) {
      tReintento = ahora;
      bmpListo = bmpIniciar();
      if (bmpListo) Serial.printf("# [i2c] BMP280 conectado en 0x%02X\n", bmpAddr);
      esperando = false;
      n = 0;
      sumaT = 0;
      sumaP = 0;
    }
    return;
  }
  if (!esperando) {
    if (ahora - tDisparo >= BMP_PERIODO_MS) {
      tDisparo = ahora;
      bmpDisparar();
      esperando = true;
    }
    return;
  }
  if (ahora - tDisparo < bmpTiempoConvMs()) return;

  int32_t adcT, adcP;
  int r = bmpRecoger(adcT, adcP);
  if (r == 0) {
    if (ahora - tDisparo > 100) bmpListo = false;  // no terminó: reiniciar sensor
    return;
  }
  esperando = false;
  if (r < 0) {
    bmpListo = false;
    return;
  }

  sumaT += compensarT(adcT) / 100.0;  // primero T: P usa t_fine
  sumaP += compensarP(adcP) / 25600.0;
  if (++n >= BMP_N_PROM) {
    bmp.T = sumaT / n + OFFSET_T;
    bmp.P = sumaP / n + OFFSET_P;
    bmp.alguna = true;
    bmp.tUlt = ahora;
    n = 0;
    sumaT = 0;
    sumaP = 0;
  }
}

// =====================================================================
// BH1750 (de bh1750_lectura.ino), sin bloqueos largos
// =====================================================================
#define MTREG 69  // el mismo de la caracterización

const float CAL_A = 1.7573f;
const float CAL_B = -39.21f;
const float LUX_NOM_MIN = 54.0f;
const float LUX_NOM_MAX = 4242.0f;
#define N_PROM_BH 3  // ventana corta: la luz automática reacciona en ~1 s

const uint8_t CMD_POWER_ON = 0x01;
const uint8_t CMD_RESET = 0x07;
const uint8_t CMD_ONE_TIME_H = 0x20;
const uint16_t RAW_SAT = 65535;

uint16_t tConvBhMs;
uint16_t bufBh[N_PROM_BH];
uint8_t idxBh = 0, llenasBh = 0;
uint32_t sumaBh = 0;
bool bhListo = false;
bool luxNuevo = false;  // hay una lectura nueva: evaluar la luz automática ya

struct {
  float lux = NAN;  // lux corregido (nominal bajo 54 lx)
  const char *estado = "SIN_DATO";
  bool alguna = false;
  uint32_t tUlt = 0;
} luz;

bool bhCmd(uint8_t cmd) {
  Wire.beginTransmission(BH1750_ADDR);
  Wire.write(cmd);
  return Wire.endTransmission() == 0;
}

bool bhSetMTreg(uint8_t mt) { return bhCmd(0x40 | (mt >> 5)) && bhCmd(0x60 | (mt & 0x1F)); }

bool bhIniciar() {
  Wire.beginTransmission(BH1750_ADDR);
  if (Wire.endTransmission() != 0) return false;
  return bhCmd(CMD_POWER_ON) && bhCmd(CMD_RESET) && bhSetMTreg(MTREG);
}

float rawALuxNominal(float raw) { return raw / 1.2f * (69.0f / MTREG); }

float corregirLux(float luxNom) {
  if (luxNom < LUX_NOM_MIN) return luxNom;  // bajo el rango calibrado: lectura nominal
  return CAL_A * luxNom + CAL_B;
}

float mediaMovilBh(uint16_t raw) {
  if (llenasBh == N_PROM_BH) sumaBh -= bufBh[idxBh];
  else llenasBh++;
  bufBh[idxBh] = raw;
  sumaBh += raw;
  idxBh = (idxBh + 1) % N_PROM_BH;
  return (float)sumaBh / llenasBh;
}

void tareaBH(uint32_t ahora) {
  static uint32_t tSolicitud = 0, tReintento = 0, tLectura = 0;
  static bool esperando = false;

  if (!bhListo) {
    if (ahora - tReintento >= 2000) {
      tReintento = ahora;
      bhListo = bhIniciar();
      if (bhListo) Serial.println("# [i2c] BH1750 conectado");
      esperando = false;
      if (!bhListo) luz.estado = "ERROR";
    }
    return;
  }
  if (!esperando) {
    if (ahora - tLectura < PERIODO_BH_MS) return;
    tLectura = ahora;
    if (bhCmd(CMD_POWER_ON) && bhCmd(CMD_ONE_TIME_H)) {
      tSolicitud = ahora;
      esperando = true;
    } else {
      bhListo = false;
      luz.estado = "ERROR";
    }
    return;
  }
  if (ahora - tSolicitud < tConvBhMs) return;
  esperando = false;

  if (Wire.requestFrom((uint8_t)BH1750_ADDR, (uint8_t)2) != 2) {
    bhListo = false;
    luz.estado = "ERROR";
    return;
  }
  uint8_t hi = Wire.read();
  uint8_t lo = Wire.read();
  uint16_t raw = ((uint16_t)hi << 8) | lo;

  float rawProm = mediaMovilBh(raw);
  float luxNom = rawALuxNominal(rawProm);
  luz.lux = corregirLux(luxNom);
  if (raw >= RAW_SAT) luz.estado = "SATURADO";
  else if (luxNom < LUX_NOM_MIN) luz.estado = "BAJO_RANGO";
  else if (luxNom > LUX_NOM_MAX) luz.estado = "SOBRE_RANGO";
  else luz.estado = "OK";
  luz.alguna = true;
  luz.tUlt = ahora;
  luxNuevo = true;
}

// =====================================================================
// Supervisor del bus I2C (ruido de la baquela, sensores que se sueltan)
// =====================================================================
// - Cada sensor que no responde se reintenta cada I2C_REVISION_MS, sin tocar a los demás.
// - Si NINGUNO responde, el problema es el bus: se libera (9 pulsos de SCL + STOP, por si
//   un sensor quedó reteniendo SDA), se reinicia el periférico y, si sigue sin responder,
//   se baja la velocidad (100 → 50 → 25 kHz).
// - Cada 10 s, mientras falte algo, imprime qué direcciones responden y el nivel de SDA/SCL.
uint32_t i2cHz = I2C_HZ;

void i2cLiberarBus() {
  Wire.end();
  pinMode(PIN_SDA, INPUT_PULLUP);
  pinMode(PIN_SCL, INPUT_PULLUP);
  delayMicroseconds(10);
  if (digitalRead(PIN_SDA) == LOW && digitalRead(PIN_SCL) == HIGH) {
    digitalWrite(PIN_SCL, HIGH);
    pinMode(PIN_SCL, OUTPUT_OPEN_DRAIN);
    for (int k = 0; k < 9 && digitalRead(PIN_SDA) == LOW; k++) {
      digitalWrite(PIN_SCL, LOW);
      delayMicroseconds(10);
      digitalWrite(PIN_SCL, HIGH);
      delayMicroseconds(10);
    }
    // Condición de STOP: SDA sube mientras SCL está en alto
    digitalWrite(PIN_SDA, LOW);
    pinMode(PIN_SDA, OUTPUT_OPEN_DRAIN);
    delayMicroseconds(10);
    digitalWrite(PIN_SDA, HIGH);
    delayMicroseconds(10);
    pinMode(PIN_SDA, INPUT_PULLUP);
    pinMode(PIN_SCL, INPUT_PULLUP);
    Serial.printf("# [i2c] SDA estaba retenida por un sensor: bus liberado (SDA ahora %s)\n",
                  digitalRead(PIN_SDA) ? "HIGH" : "LOW");
  }
  Wire.begin(PIN_SDA, PIN_SCL, i2cHz);
  Wire.setTimeOut(50);  // una transacción fallida devuelve error en vez de colgar la ESP32
}

void i2cEscanear() {
  const bool sda = digitalRead(PIN_SDA), scl = digitalRead(PIN_SCL);
  char lista[96] = "";
  uint8_t n = 0;
  if (sda && scl) {  // con una línea pegada a LOW no tiene sentido escanear
    for (uint8_t a = 0x08; a < 0x78; a++) {
      Wire.beginTransmission(a);
      if (Wire.endTransmission() == 0 && strlen(lista) < sizeof(lista) - 6) {
        snprintf(lista + strlen(lista), sizeof(lista) - strlen(lista), " 0x%02X", a);
        n++;
      }
    }
  }
  Serial.printf("# [i2c] %lu kHz · SDA=%s SCL=%s · responden:%s\n", (unsigned long)(i2cHz / 1000), sda ? "HIGH" : "LOW",
                scl ? "HIGH" : "LOW", n ? lista : " ninguno");
  if (!sda || !scl)
    Serial.println("# [i2c] una línea está en LOW sin tráfico: módulo sin 3V3/GND (lo tira a GND), corto o SDA/SCL cruzados");
  else if (!n)
    Serial.println("# [i2c] nadie responde: revisa 3V3 y GND de los módulos, SDA→GPIO21, SCL→GPIO22 y las soldaduras");
  else
    Serial.println("# [i2c] esperados: INA3221 0x40 · BMP280 0x76/0x77 · BH1750 0x23 (otra dirección = pin de dirección distinto)");
}

void tareaI2C(uint32_t ahora) {
  static uint32_t tRev = 0, tEscaneo = 0;
  static uint8_t rondasSinNada = 0;
  if (ahora - tRev < I2C_REVISION_MS) return;
  tRev = ahora;
  if (inaListo && bmpListo && bhListo) {
    rondasSinNada = 0;
    return;
  }
  if (!inaListo && !bmpListo && !bhListo) {
    if (++rondasSinNada % 3 == 0 && i2cHz > I2C_HZ_MIN) {
      i2cHz /= 2;
      Serial.printf("# [i2c] ningún sensor responde: bajo la velocidad a %lu kHz\n", (unsigned long)(i2cHz / 1000));
    }
    i2cLiberarBus();
  }
  if (!inaListo) {
    inaListo = inaIniciar();
    fallosIna = 0;
    if (inaListo) Serial.printf("# [i2c] INA3221 conectado (%lu kHz)\n", (unsigned long)(i2cHz / 1000));
  }
  // El BMP280 y el BH1750 se reintentan en sus propias tareas cada 2 s.
  if (ahora - tEscaneo >= 10000) {
    tEscaneo = ahora;
    i2cEscanear();
  }
}

// =====================================================================
// Estado del sistema
// =====================================================================
enum ModoLed : uint8_t { LED_AUTO, LED_MANUAL_ON, LED_MANUAL_OFF };
const char *NOMBRE_MODO[] = {"AUTO", "MANUAL_ON", "MANUAL_OFF"};
ModoLed modoLed = LED_MANUAL_OFF;  // arranca en manual: la luz sigue al interruptor (la app es un extra)
solace::AutoLightState autoLuz = {false, false, 0, false, 0};

solace::TempState estTemp = solace::TEMP_NO_DATA;

bool usbBateriaOK = false;
bool inaVigente = false;
bool usbBloqueado = false;
uint32_t tBloqueoUsb = 0;
uint32_t tSatDesde = 0;
uint8_t pwmLed = 0;       // nivel aplicado a la tira (0..255)
bool usbPedido = false;   // lo que pidieron el interruptor o la app (arranca apagado)
solace::TempGuard guardaTemp = solace::GUARD_MANUAL;  // arranca en manual: el USB obedece al interruptor (no se guarda)
bool usbOn = false;       // estado real de la salida
bool cargando = false;    // CH1 negativo: la batería recibe carga
solace::BatMode modoBat = solace::BAT_UNKNOWN;
solace::ChargeSource origenCarga = solace::CHG_NONE;

// Energía y autonomía
bool socIniciado = false;
float eWh = NAN;
float pPromW = NAN;
uint32_t tLleno = 0;

// Ajustes que se cambian desde la app (se guardan en flash)
struct Ajustes {
  solace::Rgb color = {255, 255, 255};  // color en manual
  uint8_t brillo = 80;                  // brillo en manual (%)
  float luxOn = solace::kAutoLuxOn;
  float luxOff = solace::kAutoLuxOff;
} ajustes;
bool ajustesPendientes = false;
uint32_t tAjustes = 0;

// Red
HubLink hub;
char deviceId[20];
uint32_t seq = 0;
uint32_t tTelemetria = 0;
bool telemetriaYa = false;
uint32_t identificarHasta = 0;
uint32_t pruebaQ2Hasta = 0;  // "q2" por Serial: fuerza GPIO26 10 s (prueba del MOSFET)

// =====================================================================
// Ajustes en flash
// =====================================================================
void cargarAjustes() {
  Preferences p;
  p.begin("solace", true);
  const uint32_t c = p.getULong("color", 0xFFFFFF);
  ajustes.color = {(uint8_t)(c >> 16), (uint8_t)(c >> 8), (uint8_t)c};
  ajustes.brillo = p.getUChar("bri", 80);
  ajustes.luxOn = p.getFloat("luxOn", solace::kAutoLuxOn);
  ajustes.luxOff = p.getFloat("luxOff", solace::kAutoLuxOff);
  p.end();
  if (!(ajustes.luxOff > ajustes.luxOn) || ajustes.luxOn < 0) {
    ajustes.luxOn = solace::kAutoLuxOn;
    ajustes.luxOff = solace::kAutoLuxOff;
  }
}

void guardarAjustes() {
  Preferences p;
  p.begin("solace", false);
  p.putULong("color", ((uint32_t)ajustes.color.r << 16) | ((uint32_t)ajustes.color.g << 8) | ajustes.color.b);
  p.putUChar("bri", ajustes.brillo);
  p.putFloat("luxOn", ajustes.luxOn);
  p.putFloat("luxOff", ajustes.luxOff);
  p.end();
  ajustesPendientes = false;
}

void marcarAjustes() {
  ajustesPendientes = true;
  tAjustes = millis();
}

// =====================================================================
// Tareas
// =====================================================================
void tareaINA(uint32_t ahora) {
  static uint32_t tPeriodo = 0;
  if (ahora - tPeriodo < PERIODO_INA_MS) return;
  tPeriodo = ahora;

  if (!inaListo) return;  // lo reconecta tareaI2C
  if (!inaMedir()) {
    // Un fallo aislado (ruido) se tolera; 3 seguidos = sensor perdido. No se reinicia el bus
    // aquí: eso cortaría también al BMP280 y al BH1750. Lo hace el supervisor si hace falta.
    if (++fallosIna >= 3) {
      inaListo = false;
      Serial.println("# [i2c] INA3221 perdido: reintentando cada 2 s");
    }
    return;
  }
  fallosIna = 0;
  uint32_t t = millis();
  float pW = ina.V[0] * ina.I[0] / 1000.0f;  // + descarga, − carga

  // Energía restante
  if (!socIniciado) {
    if (t > 2000) {  // la batería está en reposo: las salidas arrancan apagadas
      eWh = solace::kUsableWh * solace::socFromPackVoltage(ina.V[0]) / 100.0f;
      pPromW = pW;
      socIniciado = true;
    }
  } else {
    float dt = (t - ina.tUlt) / 1000.0f;
    if (dt > 0 && dt < 10) {
      eWh = solace::energyStep(eWh, pW, dt);
      pPromW = solace::avgPowerStep(pPromW, pW, dt);
    }
    // Banco lleno: voltaje de fin de carga y corriente casi nula durante 1 min
    if (ina.V[0] >= solace::kFullV && fabsf(ina.I[0]) < solace::kFullMa) {
      if (tLleno == 0) tLleno = t;
      else if (t - tLleno > solace::kFullHoldMs) eWh = solace::kUsableWh;
    } else {
      tLleno = 0;
    }
  }

  // CH1 saturado con el USB encendido: cortar el USB un rato (solo en automático)
  if (guardaTemp == solace::GUARD_AUTO && ina.E[0] == solace::INA_SATURATED && usbOn) {
    if (tSatDesde == 0) tSatDesde = t;
    else if (t - tSatDesde > solace::kSatCutUsbMs) {
      usbBloqueado = true;
      tBloqueoUsb = t;
      tSatDesde = 0;
    }
  } else {
    tSatDesde = 0;
  }

  ina.alguna = true;
  ina.tUlt = t;
}

void logicaProtecciones(uint32_t ahora) {
  // Temperatura
  const bool hayDato = bmp.alguna && (ahora - bmp.tUlt <= solace::kTempNoDataMs);
  const solace::TempState antes = estTemp;
  estTemp = solace::tempStep(estTemp, bmp.T, hayDato);
  if (estTemp != antes) {
    Serial.printf("# [temp] %s → %s\n", solace::tempStateName(antes), solace::tempStateName(estTemp));
    telemetriaYa = true;
  }

  // INA vigente
  inaVigente = ina.alguna && (ahora - ina.tUlt <= solace::kInaNoDataMs);

  // Batería baja con histéresis (solo afecta al USB). La primera lectura decide con el umbral
  // de corte: antes arrancaba en "baja" y, con la batería entre 6,6 y 7,0 V, el USB nunca encendía.
  static bool bateriaEvaluada = false;
  if (!inaVigente) {
    usbBateriaOK = false;
    bateriaEvaluada = false;
  } else if (!bateriaEvaluada) {
    usbBateriaOK = ina.V[0] >= solace::kUsbOffV;
    bateriaEvaluada = true;
  } else {
    usbBateriaOK = solace::batteryHyst(usbBateriaOK, ina.V[0], solace::kUsbOffV, solace::kUsbOnV);
  }

  // Fin del bloqueo de USB
  if (usbBloqueado && ahora - tBloqueoUsb > solace::kUsbBlockMs) usbBloqueado = false;

  // Carga de la batería: dirección de la corriente del CH1 y origen
  const bool cargabaAntes = cargando;
  modoBat = solace::batMode(inaVigente, ina.I[0], ina.V[0] * ina.I[0] / 1000.0f);
  cargando = modoBat == solace::BAT_CHARGING;
  const bool luxVigente = luz.alguna && (ahora - luz.tUlt < solace::kLuxFreshMs);
#if PIN_USB_IN >= 0
  const bool hayDetector = true, usbEntrada = digitalRead(PIN_USB_IN) == HIGH;
#else
  const bool hayDetector = false, usbEntrada = false;
#endif
  origenCarga = solace::chargeSource(cargando, hayDetector, usbEntrada, luxVigente, luz.lux);
  if (cargando != cargabaAntes) {
    Serial.printf("# [bat] %s\n", cargando ? "cargando" : "en operación");
    telemetriaYa = true;
  }
}

void logicaLuz(uint32_t ahora) {
  if (modoLed != LED_AUTO) {
    autoLuz.darkTiming = false;
    autoLuz.brightTiming = false;
    return;
  }
  const bool luxVigente = luz.alguna && (ahora - luz.tUlt < solace::kLuxFreshMs);
  const solace::AutoLightConfig cfg = {ajustes.luxOn, ajustes.luxOff, solace::kAutoDarkMs, solace::kAutoBrightMs};
  const bool antes = autoLuz.on;
  autoLuz = solace::autoLightStep(autoLuz, luz.lux, luxVigente, ahora, cfg);
  if (autoLuz.on != antes) {
    Serial.printf("# [luz] auto → %s (%.1f lx)\n", autoLuz.on ? "ENCENDIDA" : "apagada", luz.lux);
    telemetriaYa = true;
  }
}

bool ledPedido() {
  if (modoLed == LED_MANUAL_ON) return true;
  if (modoLed == LED_MANUAL_OFF) return false;
  return autoLuz.on;
}

// Color y brillo pedidos.
solace::Rgb colorPedido() {
  if (modoLed == LED_AUTO) {
    solace::Rgb c;
    solace::parseHexColor(AUTO_COLOR_HEX, c);
    return c;
  }
  return ajustes.color;
}
uint8_t brilloPedido() { return modoLed == LED_AUTO ? AUTO_BRIGHTNESS_PCT : ajustes.brillo; }

// ─── Tira RGB con transiciones suaves ─────────────────────────────────────────
Adafruit_NeoPixel tira(LED_COUNT, PIN_LED_STRIP, NEO_GRB + NEO_KHZ800);
float tiraR = 255, tiraG = 255, tiraB = 255, tiraNivel = 0;  // estado actual (nivel 0..255)

void pintarTira(float r, float g, float b, float nivel) {
  const float k = constrain(nivel, 0.0f, 255.0f) / 255.0f;
  tira.fill(tira.Color((uint8_t)(r * k), (uint8_t)(g * k), (uint8_t)(b * k)));
  tira.show();
}

void tareaTira(uint32_t ahora) {
  static uint32_t tPaso = 0;
  static bool forzar = true;
  if (ahora - tPaso < 16) return;  // ~60 fps
  const float dt = (float)(ahora - tPaso);
  tPaso = ahora;

  // Identificar: 3 destellos ámbar
  if ((int32_t)(identificarHasta - ahora) > 0) {
    const bool fase = ((identificarHasta - ahora) / 250) % 2 == 0;
    pintarTira(226, 166, 75, fase ? 255 : 0);
    forzar = true;
    return;
  }

  const solace::Rgb c = colorPedido();
  const float k = min(1.0f, dt / (float)LED_FADE_MS * 3.0f);  // ~95 % en LED_FADE_MS
  const float antes = tiraNivel + tiraR + tiraG + tiraB;
  tiraR += k * (c.r - tiraR);
  tiraG += k * (c.g - tiraG);
  tiraB += k * (c.b - tiraB);
  tiraNivel += k * (pwmLed - tiraNivel);
  if (fabsf(tiraNivel - pwmLed) < 0.5f) tiraNivel = pwmLed;
  const float despues = tiraNivel + tiraR + tiraG + tiraB;
  if (fabsf(despues - antes) > 0.05f || forzar) {
    pintarTira(tiraR, tiraG, tiraB, tiraNivel);
    forzar = false;
  }
}

void aplicarSalidas(uint32_t ahora) {
  // Salida USB: interruptor o app + protecciones
  usbOn = solace::usbOutput(usbPedido, estTemp, guardaTemp, inaVigente, usbBateriaOK, usbBloqueado);
  const bool pruebaQ2 = (int32_t)(pruebaQ2Hasta - ahora) > 0;  // prueba de hardware por Serial
  const bool q2 = usbOn || pruebaQ2;
  digitalWrite(PIN_USB_Q2, (q2 == (USB_ACTIVO_ALTO == 1)) ? HIGH : LOW);
  digitalWrite(PIN_LED_USB, (pruebaQ2 || solace::usbLedOn(usbPedido, usbOn, ahora)) ? HIGH : LOW);

  // Diagnóstico: por qué GPIO26 está como está (se imprime solo cuando cambia)
  static const char *motivoAnt = nullptr;
  const char *motivo = pruebaQ2                                                         ? "PRUEBA: GPIO26 forzado 10 s"
                       : !usbPedido                                                     ? "apagado (no pedido)"
                       : usbOn && guardaTemp == solace::GUARD_MANUAL                    ? "ENCENDIDO (manual, sin protecciones)"
                       : usbOn                                                          ? "ENCENDIDO"
                       : guardaTemp == solace::GUARD_AUTO && !solace::usbAllowedByTemp(estTemp) ? "BLOQUEADO: protección térmica (BMP280 caliente o sin dato)"
                       : !inaVigente                                                    ? "BLOQUEADO: sin datos del INA3221"
                       : !usbBateriaOK                                                  ? "BLOQUEADO: batería baja (V1 < 6,6 V)"
                                                                                        : "BLOQUEADO: sobrecorriente (30 s)";
  if (motivo != motivoAnt) {
    Serial.printf("# [usb] %s · GPIO26=%s · V1=%.2f V · T=%.1f °C · protección %s\n", motivo,
                  digitalRead(PIN_USB_Q2) ? "HIGH" : "LOW", ina.V[0], bmp.T, solace::tempGuardName(guardaTemp));
    motivoAnt = motivo;
  }

  // Tira: sin cortes, solo lo que piden la app o el modo automático
  pwmLed = ledPedido() ? solace::ledLevel(brilloPedido()) : 0;

  // LED de sistema / carga
  analogWrite(PIN_LED_SISTEMA, solace::systemLedLevel(inaVigente, cargando, ahora));
}

// =====================================================================
// Acciones compartidas por los interruptores físicos y la app
// =====================================================================
void volverAAuto() {
  modoLed = LED_AUTO;
  autoLuz = {false, false, 0, false, 0};
}

void pedirUsb(bool on, const char *origen) {
  if (usbPedido != on) Serial.printf("# [usb] %s → %s\n", origen, on ? "ENCENDER" : "apagar");
  usbPedido = on;
  telemetriaYa = true;
}

// Luz desde el interruptor: encender = blanco al 100 % (manual); apagar = apagada (manual).
void luzInterruptor(bool encender) {
  const bool cerrado = encender;
  if (cerrado) {
    ajustes.color = {255, 255, 255};
    ajustes.brillo = 100;
    modoLed = LED_MANUAL_ON;
  } else {
    modoLed = LED_MANUAL_OFF;
  }
  marcarAjustes();
  Serial.printf("# [luz] interruptor → %s\n", cerrado ? "BLANCO 100 %" : "apagada");
  telemetriaYa = true;
}

// =====================================================================
// Interruptores de enclavamiento (a GND con INPUT_PULLUP; cerrado = LOW)
// Solo actúan cuando cambian de posición.
// =====================================================================
// Se leen cada PERIODO_CONTROL_MS; si una lectura difiere, se vuelve a leer a los 50 ms
// para confirmar (antirrebote y ruido) y se actúa enseguida. Devuelve true si algo cambió.
// CADA MOVIMIENTO ALTERNA el estado (como un interruptor de escalera): si la app lo
// encendió, mover el interruptor lo apaga, sin importar hacia qué lado. Así el
// interruptor y la app manejan un único estado y siempre se puede apagar a mano.
bool tareaInterruptores(uint32_t ahora) {
  static uint32_t tLectura = 0;
  const bool confirmando = swUsb.last != swUsb.stable || swLuz.last != swLuz.stable;
  if (ahora - tLectura < (confirmando ? solace::kSwitchDebounceMs : (uint32_t)PERIODO_CONTROL_MS)) return false;
  tLectura = ahora;
  bool cambio = false;
  if (solace::switchStep(swUsb, digitalRead(PIN_SW_USB) == LOW, ahora)) {
    Serial.printf("# [sw] USB (GPIO%d) %s\n", PIN_SW_USB, swUsb.stable ? "cerrado" : "abierto");
    pedirUsb(!usbPedido, "interruptor");
    cambio = true;
  }
  if (solace::switchStep(swLuz, digitalRead(PIN_SW_LUZ) == LOW, ahora)) {
    Serial.printf("# [sw] luz (GPIO%d) %s\n", PIN_SW_LUZ, swLuz.stable ? "cerrado" : "abierto");
    luzInterruptor(!ledPedido());
    cambio = true;
  }
  return cambio;
}

// =====================================================================
// Comandos desde la app (vía hub)
// =====================================================================
void enviarAck(const char *id, bool ok, const char *error = nullptr) {
  JsonDocument doc;
  doc["id"] = id;
  doc["ok"] = ok;
  if (error) doc["error"] = error;
  char buf[200];
  serializeJson(doc, buf, sizeof(buf));
  hub.publish(TOPIC_ACK, buf);
}

void alRecibirComando(const char *payload, size_t len) {
  JsonDocument doc;
  if (deserializeJson(doc, payload, len) != DeserializationError::Ok) {
    enviarAck("desconocido", false, "JSON inválido");
    return;
  }
  char id[65];
  strlcpy(id, doc["id"] | "desconocido", sizeof(id));
  const char *tipo = doc["type"] | "";
  Serial.printf("# [cmd] %s (%s)\n", tipo, id);

  if (strcmp(tipo, "setMode") == 0) {
    const char *modo = doc["mode"] | "";
    if (strcmp(modo, "auto") == 0) volverAAuto();
    else if (strcmp(modo, "manual") == 0) {
      if (modoLed == LED_AUTO) modoLed = ledPedido() ? LED_MANUAL_ON : LED_MANUAL_OFF;  // conserva lo que se ve
    } else return enviarAck(id, false, "Modo inválido");
  } else if (strcmp(tipo, "setLight") == 0) {
    const bool traeOn = doc["on"].is<bool>();
    bool toco = false;
    if (doc["color"].is<const char *>()) {
      solace::Rgb c;
      if (!solace::parseHexColor(doc["color"].as<const char *>(), c)) return enviarAck(id, false, "Color inválido");
      ajustes.color = c;
      toco = true;
    }
    if (doc["brightness"].is<int>()) {
      ajustes.brillo = (uint8_t)constrain(doc["brightness"].as<int>(), 0, 100);
      toco = true;
    }
    // Tocar la luz desde la app pasa a manual; cambiar color o brillo la enciende.
    if (traeOn) modoLed = doc["on"].as<bool>() ? LED_MANUAL_ON : LED_MANUAL_OFF;
    else if (toco) modoLed = LED_MANUAL_ON;
    marcarAjustes();
  } else if (strcmp(tipo, "setAuto") == 0) {
    const float on = doc["luxOn"] | -1.0f;
    const float off = doc["luxOff"] | -1.0f;
    if (on < 0 || off <= on) return enviarAck(id, false, "Umbrales inválidos (luxOff > luxOn)");
    ajustes.luxOn = on;
    ajustes.luxOff = off;
    marcarAjustes();
  } else if (strcmp(tipo, "setUsb") == 0) {
    if (!doc["on"].is<bool>()) return enviarAck(id, false, "setUsb necesita on");
    pedirUsb(doc["on"].as<bool>(), "app");
  } else if (strcmp(tipo, "setTempGuard") == 0) {
    const char *modo = doc["mode"] | "";
    if (strcmp(modo, "auto") == 0) guardaTemp = solace::GUARD_AUTO;
    else if (strcmp(modo, "manual") == 0) {
      guardaTemp = solace::GUARD_MANUAL;
      usbBloqueado = false;  // en manual no hay bloqueos
      tSatDesde = 0;
    }
    else return enviarAck(id, false, "Modo de protección inválido");
    Serial.printf("# [usb] protecciones: %s\n", guardaTemp == solace::GUARD_MANUAL ? "MANUAL (sin protecciones)" : "automáticas");
  } else if (strcmp(tipo, "identify") == 0) {
    identificarHasta = millis() + 1500;
  } else {
    return enviarAck(id, false, "Comando desconocido");
  }

  aplicarSalidas(millis());
  enviarAck(id, true);
  telemetriaYa = true;  // la app ve el cambio sin esperar al siguiente segundo
}

// =====================================================================
// Telemetría (JSON, ver shared/protocol.ts)
// =====================================================================
float socPct() { return socIniciado ? 100.0f * eWh / solace::kUsableWh : NAN; }

static float rd(float x, int dec) {
  const float f = powf(10.0f, dec);
  return roundf(x * f) / f;
}

void numONull(JsonObject o, const char *clave, float v, int dec) {
  if (isnan(v)) o[clave] = nullptr;
  else o[clave] = rd(v, dec);
}

void publicarTelemetria() {
  const uint32_t ahora = millis();
  const float soc = socPct();
  const float aut = solace::autonomyMin(socIniciado && inaVigente, ina.I[0], eWh, pPromW);
  const bool luxVigente = luz.alguna && (ahora - luz.tUlt < solace::kLuxFreshMs);
  const bool tempVigente = bmp.alguna && (ahora - bmp.tUlt <= solace::kTempNoDataMs);
  const bool rangoMalo = ina.E[0] != solace::INA_OK || ina.E[1] != solace::INA_OK || ina.E[2] != solace::INA_OK;

  solace::AlertInputs ai = {inaVigente ? soc : NAN, cargando, estTemp, inaVigente, inaVigente && !usbBateriaOK,
                            usbBloqueado, rangoMalo, usbOn,
                            isnan(ina.V[1]) ? 0.0f : ina.V[1], isnan(ina.I[1]) ? 0.0f : ina.I[1] / 1000.0f, luxVigente, guardaTemp};
  const uint16_t alertas = solace::evaluateAlerts(ai);

  JsonDocument doc;
  doc["v"] = 4;
  doc["id"] = deviceId;
  doc["seq"] = seq++;
  doc["uptime"] = ahora / 1000;

  JsonObject env = doc["env"].to<JsonObject>();
  numONull(env, "lux", luxVigente ? luz.lux : NAN, 1);
  env["luxState"] = luxVigente ? luz.estado : (bhListo ? "SIN_DATO" : "ERROR");
  numONull(env, "tempC", tempVigente ? bmp.T : NAN, 1);
  numONull(env, "pressHpa", tempVigente ? bmp.P : NAN, 1);

  JsonObject power = doc["power"].to<JsonObject>();
  const char *claves[3] = {"bat", "usb", "led"};
  for (int c = 0; c < 3; c++) {
    JsonObject o = power[claves[c]].to<JsonObject>();
    const float v = isnan(ina.V[c]) ? 0 : ina.V[c];
    const float a = isnan(ina.I[c]) ? 0 : ina.I[c] / 1000.0f;
    o["v"] = rd(v, 3);
    o["i"] = rd(a, 3);
    o["p"] = rd(v * a, 3);
    o["st"] = solace::inaRangeName(ina.E[c]);
  }

  JsonObject bat = doc["bat"].to<JsonObject>();
  numONull(bat, "soc", soc, 1);
  bat["state"] = socIniciado ? solace::batModeName(modoBat) : "unknown";
  if (cargando) bat["source"] = solace::chargeSourceName(origenCarga);
  else bat["source"] = nullptr;
  numONull(bat, "chargeW", cargando ? -ina.V[0] * ina.I[0] / 1000.0f : NAN, 3);
  numONull(bat, "remainingWh", socIniciado ? eWh : NAN, 2);
  numONull(bat, "avgPowerW", pPromW, 3);
  numONull(bat, "autonomyMin", aut >= 0 ? aut : NAN, 0);
  bat["capacityWh"] = solace::kUsableWh;

  JsonObject l = doc["light"].to<JsonObject>();
  char hex[8];
  solace::formatHexColor(ajustes.color, hex);
  l["mode"] = modoLed == LED_AUTO ? "auto" : "manual";
  l["on"] = ledPedido();
  if (modoLed == LED_AUTO) l["color"] = AUTO_COLOR_HEX;
  else l["color"] = hex;
  l["brightness"] = brilloPedido();
  l["luxOn"] = rd(ajustes.luxOn, 1);
  l["luxOff"] = rd(ajustes.luxOff, 1);
  l["outPct"] = (int)lroundf(pwmLed * 100.0f / 255.0f);

  JsonObject pr = doc["protect"].to<JsonObject>();
  pr["temp"] = solace::tempStateName(estTemp);
  pr["usbRequested"] = usbPedido;
  pr["usbOn"] = usbOn;
  pr["usbLowBat"] = guardaTemp == solace::GUARD_AUTO && inaVigente && !usbBateriaOK;
  pr["usbBlocked"] = guardaTemp == solace::GUARD_AUTO && usbBloqueado;
  pr["tempGuard"] = solace::tempGuardName(guardaTemp);

  JsonObject sw = doc["switches"].to<JsonObject>();
  sw["usb"] = swUsb.stable;
  sw["light"] = swLuz.stable;

  JsonArray arr = doc["alerts"].to<JsonArray>();
  for (uint8_t b = 0; b < solace::ALERT_COUNT; b++)
    if (alertas & (1u << b)) arr.add(solace::alertCode(b));

  JsonObject net = doc["net"].to<JsonObject>();
  net["rssi"] = WiFi.RSSI();
  net["ip"] = WiFi.localIP().toString();

  char buf[MQTT_BUFFER_SIZE];
  const size_t n = serializeJson(doc, buf, sizeof(buf));
  if (n >= sizeof(buf) - 1) {
    Serial.println("# [telemetría] JSON demasiado grande");
    return;
  }
  hub.publish(TOPIC_TELEMETRY, buf);
}

// LED azul: parpadeo rápido = buscando WiFi · doble destello = buscando el Mac ·
// fijo = en línea. Al identificar parpadea.
void tareaLedEstado(uint32_t ahora) {
  bool on = false;
  if ((int32_t)(identificarHasta - ahora) > 0) on = (ahora / 125) % 2;
  else switch (hub.state()) {
      case HubLink::State::WifiConnecting: on = hub.wifiResting() ? (ahora % 2000) < 60 : (ahora / 150) % 2; break;
      case HubLink::State::Discovering:
      case HubLink::State::MqttConnecting: on = (ahora % 1200) < 100 || ((ahora % 1200) > 250 && (ahora % 1200) < 350); break;
      case HubLink::State::Online: on = true; break;
    }
  digitalWrite(PIN_STATUS_LED, on);
}

// =====================================================================
// Salida serial
// =====================================================================
void tareaSerial(uint32_t ahora) {
  static uint32_t tUlt = 0;
  if (ahora - tUlt < PERIODO_SERIAL_MS) return;
  tUlt = ahora;
  const float aut = solace::autonomyMin(socIniciado && inaVigente, ina.I[0], eWh, pPromW);
  Serial.printf("%lu", (unsigned long)ahora);
  for (int c = 0; c < 3; c++) Serial.printf(",%.3f,%.1f,%.1f", ina.V[c], ina.I[c], ina.V[c] * ina.I[c]);
  for (int c = 0; c < 3; c++) Serial.printf(",%s", solace::inaRangeName(ina.E[c]));
  Serial.printf(",%.2f,%.3f,%.2f,%s,%s,%u,%d,%d,%s,%s,%.1f,%.2f,%.3f,%.0f\n", bmp.T, bmp.P, luz.lux, luz.estado,
                NOMBRE_MODO[modoLed], pwmLed, usbPedido ? 1 : 0, usbOn ? 1 : 0, solace::tempStateName(estTemp),
                solace::chargeSourceName(origenCarga), socPct(), eWh, pPromW, aut);
}

// =====================================================================
// setup y loop
// =====================================================================
void setup() {
  // Salidas apagadas antes que nada
  pinMode(PIN_USB_Q2, OUTPUT);
  digitalWrite(PIN_USB_Q2, USB_ACTIVO_ALTO ? LOW : HIGH);  // USB apagado
  pinMode(PIN_LED_USB, OUTPUT);
  digitalWrite(PIN_LED_USB, LOW);
  pinMode(PIN_LED_SISTEMA, OUTPUT);
  analogWrite(PIN_LED_SISTEMA, 0);
  pinMode(PIN_STATUS_LED, OUTPUT);
  digitalWrite(PIN_STATUS_LED, LOW);
  tira.begin();
  tira.setBrightness(255);  // el brillo se aplica por software
  tira.clear();
  tira.show();
  pinMode(PIN_SW_USB, INPUT_PULLUP);
  pinMode(PIN_SW_LUZ, INPUT_PULLUP);
#if PIN_USB_IN >= 0
  pinMode(PIN_USB_IN, INPUT);
#endif

  Serial.begin(115200);
  btStop();
  setCpuFrequencyMhz(CPU_MHZ);  // menos calor y consumo; el WiFi y los periféricos funcionan igual

  const uint64_t mac = ESP.getEfuseMac();
  snprintf(deviceId, sizeof(deviceId), "solace-%02x%02x%02x", (uint8_t)(mac >> 24), (uint8_t)(mac >> 32), (uint8_t)(mac >> 40));
  Serial.printf("\n# === SOLACE · Power when it matters. === ID: %s\n", deviceId);
  cargarAjustes();

  // Al arrancar todo está en MANUAL y sigue la posición de los interruptores:
  // cerrado = USB encendido / luz blanca 100 %; abierto = apagado. Sin WiFi funciona igual.
  const bool usbCerrado = digitalRead(PIN_SW_USB) == LOW, luzCerrado = digitalRead(PIN_SW_LUZ) == LOW;
  swUsb = {usbCerrado, usbCerrado, 0};
  swLuz = {luzCerrado, luzCerrado, 0};
  if (usbCerrado) pedirUsb(true, "interruptor (arranque)");
  if (luzCerrado) luzInterruptor(true);
  else modoLed = LED_MANUAL_OFF;

  i2cLiberarBus();  // por si un sensor quedó a medias tras un reinicio y retiene SDA
  delay(200);

  tConvBhMs = (uint16_t)((180UL * MTREG + 68) / 69) + 10;
  inaListo = inaIniciar();
  bmpListo = bmpIniciar();
  bhListo = bhIniciar();
  Serial.printf("# [sensores] INA3221 %s · BMP280 %s · BH1750 %s\n", inaListo ? "OK" : "NO DETECTADO",
                bmpListo ? "OK" : "NO DETECTADO", bhListo ? "OK" : "NO DETECTADO");
  if (!inaListo || !bmpListo || !bhListo) {
    i2cEscanear();
    Serial.println("# [i2c] los sensores que faltan se reintentan solos cada 2 s");
  }

  hub.begin(deviceId, alRecibirComando);  // enciende el WiFi (siempre encendido)

  Serial.println("t_ms,V1,I1_mA,P1_mW,V2,I2_mA,P2_mW,V3,I3_mA,P3_mW,E1,E2,E3,"
                 "T_C,P_hPa,lux,est_lux,modo_led,pwm_led,usb_pedido,usb,est_temp,carga,soc_pct,E_Wh,P_prom_W,autonomia_min");
}

// Comandos por el Monitor Serie: "q2" fuerza GPIO26 encendido 10 s, sin protecciones,
// para probar el MOSFET y el cableado sin sensores.
void tareaSerialEntrada() {
  static char buf[8];
  static uint8_t n = 0;
  while (Serial.available()) {
    const char c = (char)Serial.read();
    if (c == '\n' || c == '\r') {
      buf[n] = 0;
      if (strcmp(buf, "q2") == 0) {
        pruebaQ2Hasta = millis() + 10000;
        Serial.println("# [prueba] GPIO26 forzado 10 s: mide entre G y GND (≈ 3,3 V) y entre S y D");
      }
      n = 0;
    } else if (n < sizeof(buf) - 1) {
      buf[n++] = c;
    }
  }
}

void loop() {
  uint32_t ahora = millis();
  tareaSerialEntrada();
  const bool cambioInterruptor = tareaInterruptores(ahora);
  tareaI2C(ahora);
  tareaINA(ahora);
  tareaBMP(ahora);
  tareaBH(ahora);
  ahora = millis();
  // Control cada 0,5 s (y al instante si se movió un interruptor). Los comandos de la app
  // aplican las salidas en cuanto llegan (alRecibirComando).
  static uint32_t tControl = 0;
  if (cambioInterruptor || luxNuevo || ahora - tControl >= PERIODO_CONTROL_MS) {
    tControl = ahora;
    luxNuevo = false;
    logicaProtecciones(ahora);
    logicaLuz(ahora);
    aplicarSalidas(ahora);
  }
  tareaTira(ahora);

  hub.loop(ahora);
  tareaLedEstado(ahora);
  if (hub.online() && ((telemetriaYa && ahora - tTelemetria >= TELEMETRY_MIN_MS) || ahora - tTelemetria >= TELEMETRY_MS)) {
    telemetriaYa = false;
    tTelemetria = ahora;
    publicarTelemetria();
  }
  tareaSerial(ahora);
  if (ajustesPendientes && ahora - tAjustes >= SETTINGS_SAVE_DELAY_MS) guardarAjustes();
  delay(LOOP_PAUSA_MS);  // cede la CPU: el lazo no necesita girar sin parar
}

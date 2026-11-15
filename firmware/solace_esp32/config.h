// SOLACE — configuración de hardware y comportamiento del firmware (ESP32 DevKit V1).
#pragma once

// ─── Pines ────────────────────────────────────────────────────────────────────
//  BH1750  ─┐
//  INA3221 ─┴─ I2C: SDA=GPIO21, SCL=GPIO22 (pull-ups de 4.7 kΩ suelen venir en los módulos)
//  DHT11      : datos en GPIO4 (pull-up 10 kΩ a 3.3 V si el módulo no la trae)
//  WS2812B    : datos en GPIO13 → resistencia 330 Ω → DIN de la tira.
//               Recomendado: level shifter 3.3→5 V (74AHCT125) y condensador 1000 µF en 5 V.
//  LED estado : GPIO2 (LED azul integrado del DevKit)
#define PIN_I2C_SDA 21
#define PIN_I2C_SCL 22
#define PIN_DHT 4
#define PIN_LED_STRIP 13
#define PIN_STATUS_LED 2

// ─── Tira LED WS2812B ─────────────────────────────────────────────────────────
#define LED_COUNT 30
// Límite de brillo (%) para no exceder la corriente del step-down de 5 V.
// 30 LEDs en blanco al 100 % ≈ 1.8 A.
#define LED_MAX_BRIGHTNESS_PCT 100
// Duración de las transiciones de color/brillo (ms).
#define LED_FADE_MS 350

// ─── Sensores ─────────────────────────────────────────────────────────────────
#define BH1750_ADDR 0x23  // ADDR a GND (0x5C si ADDR a VCC)
#define INA3221_ADDR 0x40 // A0 a GND

// Resistencias de shunt del INA3221 (Ω). Los módulos CJMCU-3221 traen 0.1 Ω (R100),
// lo que limita la medición a ±1.63 A por canal. Si la batería o el USB superan eso,
// cambia la resistencia (p. ej. 0.05 Ω → ±3.2 A) y actualiza el valor aquí.
#define INA_CH_BAT 0    // CH1: salida de la batería (bidireccional: negativo = cargando)
#define INA_CH_USB 1    // CH2: step-down 5 V (carga de celular)
#define INA_CH_RADIO 2  // CH3: step-down 3 V (radio AM)
#define SHUNT_OHM_BAT 0.1f
#define SHUNT_OHM_USB 0.1f
#define SHUNT_OHM_RADIO 0.1f

// Corriente de batería (A) por debajo de la cual se considera que está cargando.
#define CHARGING_THRESHOLD_A -0.02f

#define INA_READ_MS 250       // lectura del INA3221
#define DHT_READ_MS 2000      // el DHT11 no admite más de ~1 Hz
#define SENSOR_FAIL_LIMIT 3   // lecturas fallidas seguidas antes de marcar el sensor como caído

// ─── Luz automática ───────────────────────────────────────────────────────────
#define AUTO_LUX_ON 15.0f      // enciende por debajo de este nivel
#define AUTO_LUX_OFF 40.0f     // apaga por encima de este nivel (histéresis)
#define AUTO_MIN_DWELL_MS 5000 // tiempo mínimo entre cambios automáticos
#define AUTO_COLOR_HEX "#FFFFFF"
#define AUTO_BRIGHTNESS_PCT 100

// La tira ilumina al propio BH1750. Con la luz automática encendida, cada
// AMBIENT_SAMPLE_MS se apaga la tira ~30 ms para medir la luz ambiente real
// (imperceptible). Pon 0 para desactivarlo si el sensor está aislado de la tira.
#define AMBIENT_SAMPLE_MS 30000

// ─── Red / hub ────────────────────────────────────────────────────────────────
#define TELEMETRY_MS 1000           // periodo de publicación
#define DISCOVERY_UDP_PORT 47474    // beacon que emite el hub del Mac
#define DISCOVERY_LISTEN_MS 3000    // cuánto esperar el beacon antes de probar mDNS
#define MDNS_SERVICE "solace"       // _solace._tcp
#define MQTT_DEFAULT_PORT 1883
#define MQTT_FAILS_BEFORE_REDISCOVER 3
#define MQTT_BUFFER_SIZE 1024

#define TOPIC_TELEMETRY "solace/device/telemetry"
#define TOPIC_STATUS "solace/device/status"
#define TOPIC_ACK "solace/device/ack"
#define TOPIC_CMD "solace/device/cmd"

// Guardar ajustes en flash este tiempo después del último cambio (evita desgaste
// cuando se arrastra el selector de color en la app).
#define SETTINGS_SAVE_DELAY_MS 3000

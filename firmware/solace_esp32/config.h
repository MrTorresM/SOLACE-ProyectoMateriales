// SOLACE — pines, hardware y red (ESP32 DevKit V1).
// Los umbrales de protección, la calibración y la luz automática están en logic.h.
#pragma once

// ─── Pines (la lista completa de conexiones está al inicio de solace_esp32.ino) ─
// I2C en GPIO21/22. NO usar GPIO2 ni GPIO4: son el LED azul de estado y el testigo USB, que el
// firmware escribe en cada vuelta y corromperían el bus (además GPIO2 tiene el LED de la placa
// a GND y es pin de arranque). Si cambias pines, el compilador avisa si chocan con otro.
#define PIN_SDA 21
#define PIN_SCL 22
#define I2C_HZ 100000UL      // 100 kHz: más tolerante al ruido y a cables largos (baquela)
#define I2C_HZ_MIN 25000UL   // si nada responde, el supervisor baja la velocidad hasta aquí
#define I2C_REVISION_MS 2000 // cada cuánto se intenta reconectar un sensor que no responde
#define PIN_LED_STRIP 25    // DIN de la tira RGB (a través de 330 Ω)
#define PIN_USB_Q2 26       // compuerta del MOSFET de la salida USB de 5 V
#define USB_ACTIVO_ALTO 1   // 1: GPIO26 en HIGH enciende el USB. 0 si tu etapa invierte (p. ej. P-MOSFET directo)
#define PIN_SW_USB 32       // interruptor (enclavamiento) de la salida USB: a GND, pull-up interno
#define PIN_SW_LUZ 27       // interruptor (enclavamiento) de la luz: a GND, pull-up interno
#define PIN_LED_USB 4       // testigo de la salida USB (antes LED de alarma)
#define PIN_LED_SISTEMA 33  // LED de sistema / carga (antes S2): LED + 330 Ω a GND
#define PIN_STATUS_LED 2    // LED azul integrado: conexión WiFi / app
// Detector opcional de la entrada USB de carga (divisor 5 V → 3,3 V). -1 = no cableado:
// el origen de la carga se deduce por la luz (ver chargeSource en logic.h).
#define PIN_USB_IN -1       // p. ej. 34 (solo entrada)

// ─── Tira RGB WS2812B ─────────────────────────────────────────────────────────
#define LED_COUNT 30          // número de LEDs de la tira
#define LED_FADE_MS 350       // duración de las transiciones de color y brillo
#define AUTO_COLOR_HEX "#FFFFFF"  // color del modo automático
#define AUTO_BRIGHTNESS_PCT 100   // brillo del modo automático

// ─── Sensores ─────────────────────────────────────────────────────────────────
#define INA_ADDR 0x40       // A0 a GND
#define BH1750_ADDR 0x23    // ADDR a GND
// BMP280: se detecta solo en 0x76 o 0x77.

#define PERIODO_INA_MS 1000     // una medición promediada (16 muestras) por segundo
#define PERIODO_SERIAL_MS 3000  // una línea CSV cada 3 s
#define PERIODO_BMP_MS 500      // disparo del BMP280 (promedio de 5 → un dato cada 2,5 s)
#define PERIODO_BH_MS 250       // lectura del BH1750 (≈ su tiempo de conversión; media móvil de 3 → ventana de 0,75 s)

// ─── Control (lo que debe sentirse inmediato) ─────────────────────────────────
// Interruptores, protecciones y salidas (USB y luz) se evalúan cada 0,5 s. Si un
// interruptor cambia, se confirma 50 ms después (antirrebote) y actúa en el acto.
#define PERIODO_CONTROL_MS 500

// ─── Consumo y temperatura de la ESP32 ────────────────────────────────────────
#define CPU_MHZ 80              // 80 MHz basta (WiFi, I2C, tira); 240 MHz calienta y gasta ~2×
#define WIFI_TX_DBM 11          // potencia de transmisión (dBm). Sube a 15–19 si la señal es débil
#define LOOP_PAUSA_MS 10        // pausa por vuelta del lazo: la CPU duerme ~90 % del tiempo

// ─── Red / hub ────────────────────────────────────────────────────────────────
#define TELEMETRY_MS 3000           // periodo de publicación a la app
#define TELEMETRY_MIN_MS 500        // un cambio (interruptor, comando) se publica al instante, máx. 1 cada 0,5 s

// WiFi con espera creciente: tras un intento fallido la radio se APAGA y espera
// 5 s, 10 s, 20 s, 40 s… hasta WIFI_ESPERA_MAX_MS. Antes de cada intento se escanea
// (≈2 s) y solo se conecta si una red conocida está a la vista (la de mejor señal).
#define WIFI_TRY_MS 10000           // tiempo para asociarse a una red
#define WIFI_ESPERA_MIN_MS 5000
#define WIFI_ESPERA_MAX_MS 60000
#define WIFI_TX_DBM_DEBIL 17        // potencia si la señal es débil o tras 2 fallos seguidos
#define MQTT_ESPERA_MIN_MS 2000     // reintentos al hub: 2, 4, 8, 16, 30 s
#define MQTT_ESPERA_MAX_MS 30000
#define DISCOVERY_UDP_PORT 47474    // beacon que emite el hub del Mac
#define DISCOVERY_LISTEN_MS 3000    // cuánto esperar el beacon antes de probar mDNS
#define MDNS_SERVICE "solace"       // _solace._tcp
#define MQTT_DEFAULT_PORT 1883
#define MQTT_FAILS_BEFORE_REDISCOVER 3
#define MQTT_BUFFER_SIZE 1536

#define TOPIC_TELEMETRY "solace/device/telemetry"
#define TOPIC_STATUS "solace/device/status"
#define TOPIC_ACK "solace/device/ack"
#define TOPIC_CMD "solace/device/cmd"

// Guardar ajustes en flash este tiempo después del último cambio (evita desgaste
// cuando se arrastra el selector de color en la app).
#define SETTINGS_SAVE_DELAY_MS 3000

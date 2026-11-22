#include "hub_link.h"

#include <ArduinoJson.h>
#include <ESPmDNS.h>
#include <Preferences.h>
#include <PubSubClient.h>
#include <WiFi.h>
#include <WiFiUdp.h>

#include "config.h"

#if __has_include("secrets.h")
#include "secrets.h"
#else
#include "secrets.example.h"
#endif

namespace {
WiFiClient tcp;
PubSubClient mqtt(tcp);
WiFiUDP udp;
HubLink::CommandHandler gHandler = nullptr;

enum DiscoveryStep : uint8_t { STEP_CACHED = 0, STEP_BEACON, STEP_MDNS, STEP_FALLBACK, STEP_COUNT };

void onMqttMessage(char* topic, uint8_t* payload, unsigned int len) {
  if (gHandler && strcmp(topic, TOPIC_CMD) == 0) gHandler((const char*)payload, len);
}
}  // namespace

constexpr uint8_t kNetCount = sizeof(WIFI_REDES) / sizeof(WIFI_REDES[0]);

void HubLink::begin(const char* deviceId, CommandHandler onCommand) {
  deviceId_ = deviceId;
  gHandler = onCommand;
  mqtt.setBufferSize(MQTT_BUFFER_SIZE);
  mqtt.setCallback(onMqttMessage);
  mqtt.setKeepAlive(10);
  mqtt.setSocketTimeout(3);

  WiFi.persistent(false);       // no reescribe la clave en flash en cada intento
  WiFi.setAutoReconnect(false); // la reconexión la maneja este módulo (con espera creciente)
  WiFi.setHostname(deviceId_);

  // Arranque rápido: la última red que funcionó, directo y sin escanear.
  Preferences prefs;
  prefs.begin("solace", true);
  netGuardada_ = prefs.getUChar("wifiIdx", 0);
  prefs.end();
  netIndex_ = netGuardada_ < kNetCount ? netGuardada_ : 0;
  radioOn();
  associate(millis(), netIndex_);
}

void HubLink::radioOn() {
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(true);  // modem sleep: la radio duerme entre balizas del router
  WiFi.setTxPower((wifi_power_t)((txAlto_ ? WIFI_TX_DBM_DEBIL : WIFI_TX_DBM) * 4));  // unidades de 0,25 dBm
}

void HubLink::radioOff() {
  WiFi.scanDelete();
  WiFi.disconnect(true);
  WiFi.mode(WIFI_OFF);  // sin radio no hay consumo ni calor del WiFi mientras espera
}

void HubLink::associate(uint32_t now, uint8_t idx) {
  state_ = State::WifiConnecting;
  fase_ = WifiFase::Asociando;
  tFase_ = now;
  netIndex_ = idx;
  if (kNetCount == 0 || !WIFI_REDES[idx].ssid[0]) {
    Serial.println("# [wifi] no hay redes en secrets.h");
    fail(now);
    return;
  }
  WiFi.begin(WIFI_REDES[idx].ssid, WIFI_REDES[idx].password);
  Serial.printf("# [wifi] conectando a \"%s\"%s...\n", WIFI_REDES[idx].ssid, txAlto_ ? " (potencia alta)" : "");
}

void HubLink::startScan(uint32_t now) {
  fase_ = WifiFase::Escaneando;
  tFase_ = now;
  // Escaneo activo corto (~120 ms por canal ≈ 1,6 s) y asíncrono: no frena interruptores ni protecciones.
  if (WiFi.scanNetworks(/*async=*/true, /*hidden=*/false, /*passive=*/false, /*ms por canal=*/120) != WIFI_SCAN_RUNNING) {
    associate(now, netIndex_);  // el escaneo no arrancó: intenta directo
  }
}

// Tras un fallo: apaga la radio y espera 5, 10, 20, 40… s (máx. WIFI_ESPERA_MAX_MS).
void HubLink::fail(uint32_t now) {
  if (fallosWifi_ < 255) fallosWifi_++;
  if (fallosWifi_ >= 2 && !txAlto_) txAlto_ = true;  // quizá la señal es débil: sube la potencia
  const uint8_t k = fallosWifi_ > 5 ? 4 : fallosWifi_ - 1;
  espera_ = min((uint32_t)WIFI_ESPERA_MAX_MS, (uint32_t)WIFI_ESPERA_MIN_MS << k);
  radioOff();
  fase_ = WifiFase::Reposo;
  tFase_ = now;
  Serial.printf("# [wifi] radio en reposo %lu s (intento %u)\n", (unsigned long)(espera_ / 1000), fallosWifi_);
}

// Elige la red conocida visible con mejor señal; imprime qué se ve si no hay ninguna.
int HubLink::pickNetwork(int n) {
  int mejor = -1, rssiMejor = -1000;
  for (int k = 0; k < n; k++) {
    const String ssid = WiFi.SSID(k);
    for (uint8_t r = 0; r < kNetCount; r++) {
      if (WIFI_REDES[r].ssid[0] && ssid == WIFI_REDES[r].ssid && WiFi.RSSI(k) > rssiMejor) {
        mejor = r;
        rssiMejor = WiFi.RSSI(k);
      }
    }
  }
  if (mejor >= 0) {
    Serial.printf("# [wifi] \"%s\" a la vista (%d dBm)\n", WIFI_REDES[mejor].ssid, rssiMejor);
    if (rssiMejor < -75) txAlto_ = true;
    return mejor;
  }
  Serial.printf("# [wifi] ninguna red conocida a la vista (%d redes 2.4 GHz):", n);
  for (int k = 0; k < n && k < 6; k++) Serial.printf(" \"%s\"(%d)", WiFi.SSID(k).c_str(), WiFi.RSSI(k));
  Serial.println();
  if (fallosWifi_ == 0 || fallosWifi_ % 5 == 4)
    Serial.println("# [wifi] si es un hotspot de iPhone: activa \"Maximizar compatibilidad\" (2.4 GHz) y deja abierta "
                   "la pantalla de Compartir Internet. Revisa el nombre exacto en secrets.h.");
  return -1;
}

void HubLink::wifiLoop(uint32_t now) {
  if (state_ != State::WifiConnecting) {
    // Se cayó estando conectado: un reintento inmediato a la misma red, sin escanear.
    Serial.println("# [wifi] conexión perdida");
    mqtt.disconnect();
    udp.stop();
    associate(now, netIndex_);
    return;
  }
  switch (fase_) {
    case WifiFase::Asociando: {
      const wl_status_t st = WiFi.status();
      // Clave mala: falla al instante. Red ausente: no tiene sentido esperar los 10 s completos.
      const bool rendirse = st == WL_CONNECT_FAILED || (st == WL_NO_SSID_AVAIL && now - tFase_ > 4000);
      if (!rendirse && now - tFase_ < WIFI_TRY_MS) return;
      Serial.printf("# [wifi] no se pudo conectar a \"%s\" (%s)\n", WIFI_REDES[netIndex_].ssid,
                    st == WL_NO_SSID_AVAIL    ? "no veo esa red"
                    : st == WL_CONNECT_FAILED ? "clave incorrecta o seguridad no compatible"
                                              : "sin respuesta");
      fail(now);
      return;
    }
    case WifiFase::Escaneando: {
      const int n = WiFi.scanComplete();
      if (n == WIFI_SCAN_RUNNING && now - tFase_ < 6000) return;
      const int r = n >= 0 ? pickNetwork(n) : -1;
      WiFi.scanDelete();
      if (r >= 0) {
        if (txAlto_) WiFi.setTxPower((wifi_power_t)(WIFI_TX_DBM_DEBIL * 4));
        associate(now, (uint8_t)r);
      } else {
        fail(now);
      }
      return;
    }
    case WifiFase::Reposo:
      if (now - tFase_ < espera_) return;
      radioOn();
      startScan(now);
      return;
  }
}

void HubLink::onWifiConnected(uint32_t now) {
  const int rssi = WiFi.RSSI();
  Serial.printf("# [wifi] conectado a \"%s\" · IP %s · RSSI %d dBm\n", WiFi.SSID().c_str(), WiFi.localIP().toString().c_str(), rssi);
  fallosWifi_ = 0;
  // Potencia adaptativa: baja si la señal sobra (menos calor), sube si es débil.
  const bool alto = rssi < -75 ? true : rssi > -67 ? false : txAlto_;
  if (alto != txAlto_) {
    txAlto_ = alto;
    WiFi.setTxPower((wifi_power_t)((txAlto_ ? WIFI_TX_DBM_DEBIL : WIFI_TX_DBM) * 4));
  }
  if (netIndex_ != netGuardada_) {  // recuerda la red para el próximo arranque (solo si cambió)
    Preferences prefs;
    prefs.begin("solace", false);
    prefs.putUChar("wifiIdx", netIndex_);
    prefs.end();
    netGuardada_ = netIndex_;
  }
  discoveryRound_ = 0;
  startDiscovery(now);
}

void HubLink::setHub(const String& host, uint16_t port, const char* how) {
  host_ = host;
  port_ = port;
  Serial.printf("# [hub] %s → %s:%u\n", how, host.c_str(), port);
  state_ = State::MqttConnecting;
  mqttFails_ = 0;
  lastMqttTry_ = 0;
  mqttEspera_ = 0;  // primer intento inmediato
}

void HubLink::startDiscovery(uint32_t now) {
  state_ = State::Discovering;
  discoveryStep_ = STEP_CACHED;
  stepStarted_ = now;
  udp.stop();
  udp.begin(DISCOVERY_UDP_PORT);
}

bool HubLink::pollBeacon() {
  const int size = udp.parsePacket();
  if (size <= 0) return false;
  char buf[160];
  const int n = udp.read(buf, sizeof(buf) - 1);
  if (n <= 0) return false;
  buf[n] = '\0';
  JsonDocument doc;
  if (deserializeJson(doc, buf) != DeserializationError::Ok) return false;
  if (strcmp(doc["svc"] | "", "solace-hub") != 0) return false;
  const uint16_t port = doc["mqtt"] | MQTT_DEFAULT_PORT;
  setHub(udp.remoteIP().toString(), port, "beacon UDP");
  return true;
}

bool HubLink::queryMdns() {
  if (!mdnsStarted_) mdnsStarted_ = MDNS.begin(deviceId_);
  if (!mdnsStarted_) return false;
  const int n = MDNS.queryService(MDNS_SERVICE, "tcp");
  if (n <= 0) return false;
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  const IPAddress ip = MDNS.address(0);
#else
  const IPAddress ip = MDNS.IP(0);
#endif
  setHub(ip.toString(), MDNS.port(0), "mDNS");
  return true;
}

void HubLink::tryMqtt(uint32_t now) {
  if (lastMqttTry_ != 0 && now - lastMqttTry_ < mqttEspera_) return;
  lastMqttTry_ = now;
  mqtt.setServer(host_.c_str(), port_);
  Serial.printf("# [mqtt] conectando a %s:%u...\n", host_.c_str(), port_);
  // username "device" = rol del dispositivo en el hub. LWT: "offline" retenido.
  if (mqtt.connect(deviceId_, "device", "", TOPIC_STATUS, 1, true, "offline")) {
    mqtt.publish(TOPIC_STATUS, "online", true);
    mqtt.subscribe(TOPIC_CMD, 1);
    state_ = State::Online;
    mqttFails_ = 0;
    mqttEspera_ = MQTT_ESPERA_MIN_MS;
    udp.stop();
    Preferences prefs;
    prefs.begin("solace", false);
    prefs.putString("hubHost", host_);
    prefs.putUShort("hubPort", port_);
    prefs.end();
    Serial.println("# [mqtt] en línea ✓");
    return;
  }
  // Espera creciente: 2, 4, 8, 16, 30 s (connect() puede bloquear hasta 3 s si el Mac no está).
  mqttEspera_ = mqttEspera_ < MQTT_ESPERA_MIN_MS ? MQTT_ESPERA_MIN_MS : min((uint32_t)MQTT_ESPERA_MAX_MS, mqttEspera_ * 2);
  Serial.printf("# [mqtt] falló (estado %d) · reintento en %lu s\n", mqtt.state(), (unsigned long)(mqttEspera_ / 1000));
  if (++mqttFails_ >= MQTT_FAILS_BEFORE_REDISCOVER) {
    Serial.println("# [hub] volviendo a buscar el hub...");
    startDiscovery(now);
    discoveryStep_ = STEP_BEACON;  // la IP guardada ya no sirve
  }
}

void HubLink::loop(uint32_t now) {
  if (WiFi.status() != WL_CONNECTED || state_ == State::WifiConnecting) {
    if (WiFi.status() == WL_CONNECTED) {
      onWifiConnected(now);
    } else {
      wifiLoop(now);
      return;
    }
  }

  switch (state_) {
    case State::WifiConnecting:
      break;

    case State::Discovering:
      if (discoveryStep_ == STEP_CACHED) {
        Preferences prefs;
        prefs.begin("solace", true);
        const String cached = prefs.getString("hubHost", "");
        const uint16_t cport = prefs.getUShort("hubPort", MQTT_DEFAULT_PORT);
        prefs.end();
        discoveryStep_ = STEP_BEACON;
        stepStarted_ = now;
        if (cached.length()) {
          setHub(cached, cport, "IP guardada");
          mqttFails_ = MQTT_FAILS_BEFORE_REDISCOVER - 1;  // un solo intento
        }
      } else if (discoveryStep_ == STEP_BEACON) {
        if (pollBeacon()) break;
        if (now - stepStarted_ > DISCOVERY_LISTEN_MS) {
          discoveryStep_ = STEP_MDNS;
          stepStarted_ = now;
        }
      } else if (discoveryStep_ == STEP_MDNS) {
        // mDNS bloquea ~3 s: solo en la primera ronda y luego una de cada 5 (el beacon es pasivo y gratis).
        const bool tocaMdns = discoveryRound_ % 5 == 0;
        discoveryRound_++;
        if (tocaMdns && queryMdns()) break;
        discoveryStep_ = STEP_FALLBACK;
      } else {
        if (strlen(HUB_HOST_FALLBACK) > 0) {
          setHub(HUB_HOST_FALLBACK, MQTT_DEFAULT_PORT, "IP de respaldo (secrets.h)");
        } else {
          discoveryStep_ = STEP_BEACON;  // vuelve a escuchar el beacon
          stepStarted_ = now;
        }
      }
      break;

    case State::MqttConnecting:
      tryMqtt(now);
      break;

    case State::Online:
      if (!mqtt.connected()) {
        Serial.println("# [mqtt] desconectado");
        state_ = State::MqttConnecting;
        lastMqttTry_ = 0;
        break;
      }
      mqtt.loop();
      break;
  }
}

bool HubLink::publish(const char* topic, const char* payload, bool retain) {
  if (state_ != State::Online) return false;
  return mqtt.publish(topic, payload, retain);
}

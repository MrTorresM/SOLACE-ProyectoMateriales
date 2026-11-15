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

void HubLink::begin(const char* deviceId, CommandHandler onCommand) {
  deviceId_ = deviceId;
  onCommand_ = onCommand;
  gHandler = onCommand;
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);  // menor latencia para los comandos de la app
  WiFi.setAutoReconnect(true);
  WiFi.setHostname(deviceId);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  mqtt.setBufferSize(MQTT_BUFFER_SIZE);
  mqtt.setCallback(onMqttMessage);
  mqtt.setKeepAlive(10);
  mqtt.setSocketTimeout(3);
  Serial.printf("[wifi] conectando a \"%s\"...\n", WIFI_SSID);
}

void HubLink::setHub(const String& host, uint16_t port, const char* how) {
  host_ = host;
  port_ = port;
  Serial.printf("[hub] %s → %s:%u\n", how, host.c_str(), port);
  state_ = State::MqttConnecting;
  mqttFails_ = 0;
  lastMqttTry_ = 0;
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
  if (now - lastMqttTry_ < 2000 && lastMqttTry_ != 0) return;
  lastMqttTry_ = now;
  mqtt.setServer(host_.c_str(), port_);
  Serial.printf("[mqtt] conectando a %s:%u...\n", host_.c_str(), port_);
  // username "device" = rol del dispositivo en el hub. LWT: "offline" retenido.
  if (mqtt.connect(deviceId_, "device", "", TOPIC_STATUS, 1, true, "offline")) {
    mqtt.publish(TOPIC_STATUS, "online", true);
    mqtt.subscribe(TOPIC_CMD, 1);
    state_ = State::Online;
    mqttFails_ = 0;
    udp.stop();
    Preferences prefs;
    prefs.begin("solace", false);
    prefs.putString("hubHost", host_);
    prefs.putUShort("hubPort", port_);
    prefs.end();
    Serial.println("[mqtt] en línea ✓");
    return;
  }
  Serial.printf("[mqtt] falló (estado %d)\n", mqtt.state());
  if (++mqttFails_ >= MQTT_FAILS_BEFORE_REDISCOVER) {
    Serial.println("[hub] volviendo a buscar el hub...");
    startDiscovery(now);
    discoveryStep_ = STEP_BEACON;  // la IP guardada ya no sirve
  }
}

void HubLink::loop(uint32_t now) {
  if (WiFi.status() != WL_CONNECTED) {
    if (state_ != State::WifiConnecting) {
      Serial.println("[wifi] conexión perdida");
      mqtt.disconnect();
    }
    state_ = State::WifiConnecting;
    return;
  }

  switch (state_) {
    case State::WifiConnecting:
      Serial.printf("[wifi] conectado · IP %s · RSSI %d dBm\n", WiFi.localIP().toString().c_str(), WiFi.RSSI());
      startDiscovery(now);
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
        if (queryMdns()) break;
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
        Serial.println("[mqtt] desconectado");
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

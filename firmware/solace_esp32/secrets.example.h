// Copia este archivo como secrets.h (no se sube a git) y escribe tu red WiFi.
// La ESP32 y el Mac deben estar en la MISMA red (2.4 GHz: la ESP32 no ve redes de 5 GHz).
#pragma once

#define WIFI_SSID "MiRedWiFi"
#define WIFI_PASSWORD "MiClave"

// Opcional: IP fija del hub. Solo se usa si el beacon UDP y mDNS fallan
// (por ejemplo en redes universitarias que bloquean broadcast). Deja "" para no usarla.
#define HUB_HOST_FALLBACK ""

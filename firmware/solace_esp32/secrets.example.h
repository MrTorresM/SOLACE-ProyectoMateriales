// Copia este archivo como secrets.h (no se sube a git) y escribe tus redes WiFi.
// - La ESP32 y el Mac deben estar en la MISMA red.
// - Solo redes de 2.4 GHz: la ESP32 no ve redes de 5 GHz.
// - No hace falta escribir ninguna IP: la ESP32 encuentra el Mac sola.
#pragma once

struct WifiCred {
  const char* ssid;
  const char* password;
};

// Puedes poner varias redes (por ejemplo, el hotspot del celular y el WiFi del laboratorio).
// La ESP32 prueba una por una hasta conectarse.
static const WifiCred WIFI_REDES[] = {
    {"MiRedWiFi", "MiClave"},
    // {"OtraRed", "OtraClave"},
};

// Opcional: IP fija del hub. Solo se usa si el beacon UDP y mDNS fallan
// (por ejemplo en redes que bloquean broadcast). Deja "" para no usarla.
#define HUB_HOST_FALLBACK ""

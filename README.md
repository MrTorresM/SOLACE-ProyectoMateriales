# SOLACE — Power when it matters.

Sistema de telemetría y control del prototipo **SOLACE** (proyecto ARES, Materiales IEE 2026-20).
La ESP32 lee batería, consumo por subsistema, luz, temperatura y humedad, controla la tira LED
interna y envía todo al Mac, que lo publica en la red WiFi para que cualquiera lo vea desde el celular.

```
                    MQTT/TCP :1883                         MQTT/WebSocket  /mqtt
 ┌───────────┐  (descubre el hub solo)  ┌─────────────────────────┐   ┌──────────────────────┐
 │  ESP32    │ ───────────────────────▶ │  Mac (hub)              │──▶│ /listener  (QR)      │ × n
 │ INA3221   │   telemetría JSON 1 Hz   │  · broker MQTT (Aedes)  │   │ solo lectura         │
 │ BH1750    │ ◀─────────────────────── │  · valida y enriquece   │   └──────────────────────┘
 │ DHT11     │   comandos validados     │  · historial + CSV      │   ┌──────────────────────┐
 │ WS2812B   │                          │  · web (Vite/React)     │◀─▶│ /mainUser            │
 └───────────┘                          └─────────────────────────┘   │ lectura + control    │
                                                                       └──────────────────────┘
```

Es una arquitectura **publish/subscribe**: la ESP32 publica una sola vez y el broker reparte a todos
los suscriptores, así que da igual si miran 2 o 50 personas: la ESP32 no se entera.

| Ruta | Quién | Puede |
|---|---|---|
| `http://<IP>:8080/listener` | quien escanee el QR | ver los datos en vivo |
| `http://<IP>:8080/mainUser` | quien controla | ver, cambiar modo Auto/Manual, color, brillo, umbrales, identificar |
| `http://<IP>:8080/` | — | portada con ambos accesos |

Los permisos los hace cumplir **el broker**, no solo la interfaz: un cliente `listener` que intente
publicar es desconectado, y `main` solo puede publicar en `solace/ui/cmd`. El hub valida cada comando
antes de reenviarlo a la ESP32. Por decisión del equipo, `/mainUser` no pide clave.

---

## Puesta en marcha

Requisitos: Node.js 20 o superior y el Mac conectado a la misma red WiFi que la ESP32 (y que los celulares).

```bash
npm install
npm run dev          # hub + web con recarga en caliente; imprime el QR
npm run simulate     # en otra terminal: una ESP32 falsa durante 20 s
```

`npm run dev` muestra en la terminal un QR que lleva a `/listener`, el enlace de `/mainUser`, el puerto
MQTT y una línea de estado en vivo (SoC, potencia, lux, temperatura, número de espectadores).

| Comando | Qué hace |
|---|---|
| `npm run dev` | Hub en modo desarrollo (Vite + HMR) |
| `npm start` | Compila la web y la sirve en modo producción |
| `npm run simulate` | Simula la ESP32 por 20 s con valores pseudoaleatorios. Opciones: `-- --duration 60 --rate 2 --seed 42 --host 192.168.1.10` |
| `npm test` | Pruebas de front y back (Vitest) |
| `npm run test:firmware` | Pruebas nativas de la lógica del firmware (C++) |
| `npm run test:e2e` | Pruebas E2E en navegador real (Playwright, escritorio y móvil) |
| `npm run test:all` | Todo lo anterior + typecheck |

Variables opcionales: `PORT` (8080), `MQTT_PORT` (1883), `SOLACE_HOST_IP` (forzar la IP si el Mac tiene varias redes).

El simulador encuentra el hub igual que la ESP32: escucha el beacon UDP. Cada vez que corre genera
un escenario distinto: SoC inicial aleatorio, un celular que se conecta y la luz ambiente que cae a
oscuridad a mitad de la corrida, lo que dispara el modo automático. También responde a los comandos
de `/mainUser` y los muestra en la terminal.

### Registro de datos (para EL8 y la prueba de autonomía)

Cada sesión del hub se guarda en `data/sesion-AAAA-MM-DD-HH-MM-SS.csv`, con una fila por segundo: voltajes,
corrientes y potencias de los 3 canales, LED estimado, lux, temperatura, humedad, estado de la luz,
energía acumulada y alertas. Desde la web, el botón de descarga entrega el historial reciente.

---

## Firmware (ESP32 DevKit V1)

Está en `firmware/solace_esp32/`. Se abre `solace_esp32.ino` en el Arduino IDE.

1. **Placa:** *ESP32 Dev Module* (core de Espressif 2.x o 3.x; probado compilando con 3.3.8).
2. **Librerías** (Gestor de librerías): `Adafruit NeoPixel`, `BH1750` (Christopher Laws),
   `DHT sensor library` + `Adafruit Unified Sensor` (Adafruit), `PubSubClient` (Nick O'Leary), `ArduinoJson` 7.
   El INA3221 usa un driver propio incluido, sin librería externa.
3. Copia `secrets.example.h` como `secrets.h` y escribe tu WiFi (**2.4 GHz**). `secrets.h` no se sube a git.
4. Ajusta pines, shunts y umbrales en `config.h` si hace falta, y sube el sketch.

No hay que escribir ninguna IP. La ESP32 busca el hub en este orden: última IP guardada → beacon UDP
del Mac (puerto 47474) → mDNS `_solace._tcp` → `HUB_HOST_FALLBACK` opcional en `secrets.h`.

### Conexiones

| Módulo | Pin módulo | ESP32 |
|---|---|---|
| BH1750 | SDA / SCL / VCC / GND | GPIO21 / GPIO22 / 3V3 / GND (ADDR a GND → 0x23) |
| INA3221 | SDA / SCL / VS / GND | GPIO21 / GPIO22 / 3V3 / GND (A0 a GND → 0x40) |
| INA3221 CH1 | IN+ → IN− | en serie con la **salida de la batería** (IN+ lado batería) |
| INA3221 CH2 | IN+ → IN− | en serie con la salida del **step-down 5 V** (USB celular) |
| INA3221 CH3 | IN+ → IN− | en serie con la salida del **step-down 3 V** (radio AM) |
| DHT11 | DATA | GPIO4 (pull-up 10 kΩ a 3V3 si el módulo no la trae) |
| WS2812B | DIN | GPIO13 → resistencia de 330 Ω → DIN (ideal con *level shifter* 74AHCT125) |
| LED de estado | — | GPIO2 (LED integrado): parpadeo rápido = sin WiFi, doble destello = buscando hub, fijo = en línea |

La tira está siempre alimentada y la enciende la señal de datos. Conviene un condensador de 1000 µF entre 5 V y GND de la tira y unir las tierras.

### Qué hace

- **INA3221:** CH1 mide el voltaje de la batería para estimar el SoC (curva OCV de Li-ion, con
  compensación I·R para el paquete 2S2P de 18650: 7.4 V, 5 Ah, 37 Wh) y el consumo total. Es bidireccional:
  una corriente negativa se interpreta como *cargando*. CH2 y CH3 miden los subsistemas de 5 V y 3 V.
- **Tira LED (consumo estimado):** se calcula con el modelo WS2812B (≈20 mA por canal y LED, más el reposo)
  según color y brillo. En la web aparece marcada como *est.*, igual que "ESP32 y pérdidas" (batería
  menos todo lo demás).
- **Modo automático:** con poca luz enciende la tira en blanco al 100 %. Usa histéresis (enciende bajo 15 lx
  y apaga sobre 40 lx, configurables desde la app) y una permanencia mínima de 5 s para evitar parpadeos.
  Como la propia tira ilumina al BH1750, cada 30 s se apaga unos 30 ms para medir la luz ambiente real
  (imperceptible). Si el sensor está aislado de la tira, se desactiva con `AMBIENT_SAMPLE_MS 0`.
- **Modo manual:** encendido, color y brillo desde `/mainUser`. Tocar cualquier control de luz pasa a manual.
  Los ajustes se guardan en flash y sobreviven a un reinicio.
- **Alertas:** batería baja (< 20 %) o crítica (< 10 %), temperatura ≥ 45 °C, USB fuera de 4,75–5,25 V
  (rango del enunciado) y sensores sin respuesta.

### Protocolo (resumen)

| Topic | Sentido | Contenido |
|---|---|---|
| `solace/device/telemetry` | ESP32 → hub | JSON de telemetría (ver `shared/protocol.ts`) |
| `solace/device/status` | ESP32 → hub | `online` / `offline` (retenido, LWT) |
| `solace/device/cmd` | hub → ESP32 | `{"id","type":"setMode"\|"setLight"\|"setAuto"\|"identify",…}` |
| `solace/device/ack` | ESP32 → hub | `{"id","ok","error?"}` |
| `solace/ui/cmd` | mainUser → hub | `{"id","cmd":{…}}` |
| `solace/live/#` | hub → navegadores | telemetría enriquecida, dispositivo, acks, actividad, estadísticas |

`shared/protocol.ts` es el contrato. El firmware, el simulador y la web siguen ese esquema, y las pruebas lo verifican.

---

## Pruebas

| Suite | Cubre |
|---|---|
| `tests/shared` | SoC, luz automática, modelo LED, alertas, esquema del protocolo; **paridad C++ ↔ TS**: compila `logic.h` y compara con la lógica del simulador en 1600 casos aleatorios |
| `tests/server` | Broker y roles (listener bloqueado, main sin acceso directo al dispositivo), retenidos para quien llega tarde, validación de comandos, acks y timeouts, API HTTP, beacon UDP, CSV, simulador contra el hub real |
| `tests/web` | Store, cliente MQTT, vista listener sin controles, cada control de mainUser, errores, desconexión; integración real con 3 listeners + 1 main + ESP32 simulada |
| `tests/e2e` | Navegador real, escritorio y móvil: datos en vivo, mainUser cambia el color y el listener lo ve, desconexión |
| `firmware/test` | 95 verificaciones nativas de `logic.h` (incluye desbordamiento de `millis()` y registros del INA3221) |

Para la E2E hay que instalar el navegador una vez: `npx playwright install chromium`.

---

## Problemas comunes

- **El celular no abre la página o la ESP32 no conecta:** la primera vez, macOS pregunta si `node` puede
  aceptar conexiones entrantes; hay que aceptar. Si no, se cambia en *Ajustes → Red → Firewall*.
- **Red de la universidad:** muchas redes aíslan a los clientes entre sí (*AP isolation*) y bloquean el
  broadcast. En ese caso conviene usar el hotspot del celular o un router propio.
- **La ESP32 no encuentra la red:** solo funciona en 2.4 GHz.
- **Corrientes saturadas en ~1.6 A:** los módulos INA3221 traen shunts de 0.1 Ω (máximo ±1.63 A). La tira en
  blanco al 100 % consume ~1.8 A; para medir más hay que cambiar el shunt y actualizar `SHUNT_OHM_*` en `config.h`.

---

## Estructura

```
firmware/solace_esp32/   sketch Arduino (logic.h es la lógica pura y se prueba en el PC)
firmware/test/           pruebas nativas C++ y puente para la paridad
shared/                  protocolo y lógica del dispositivo (TS)
server/                  hub: broker MQTT, descubrimiento, historial, API, QR
scripts/                 simulador de la ESP32
web/                     app React (Vite): /listener, /mainUser
tests/                   Vitest (shared, server, web) y Playwright (e2e)
BRAND/                   identidad visual
```

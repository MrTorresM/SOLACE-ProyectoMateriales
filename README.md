# SOLACE — Power when it matters.

Sistema de telemetría y control del prototipo **SOLACE** (proyecto ARES, Materiales IEE 2026-20).
La ESP32 lee la batería, el consumo de cada subsistema, la luz, la temperatura y la presión. También controla
la tira LED interna y envía todo al Mac, que lo publica en la red WiFi para que cualquiera lo vea desde el celular.

> **¿Vas a conectar el sistema?** Sigue la [Guía de conexión](#guía-de-conexión-paso-a-paso) de abajo.
> Si ya lo dejaste configurado antes, basta con el [Encendido rápido](#encendido-rápido-cada-vez-que-lo-uses).

---

## Encendido rápido (cada vez que lo uses)

Sirve si el código ya está cargado en la ESP32 y el Mac ya tiene el proyecto instalado.

1. **Celular:** activa el **hotspot** (la red guardada en `secrets.h`). En iPhone, activa *Maximizar compatibilidad*.
2. **Mac:** conéctalo a ese mismo hotspot. Abre la carpeta del proyecto en VS Code, abre una terminal (*Terminal → New Terminal*) y escribe:
   ```bash
   npm run dev
   ```
3. **SOLACE:** enciende la ESP32 (funciona con los interruptores aunque no haya WiFi). En unos segundos el LED azul de la placa queda **fijo** y la terminal muestra `ESP32 conectada`.
4. **Celulares:** escanean el QR que aparece en la terminal. Quien controla el sistema abre el enlace `/mainUser`.

Para apagar el hub: `Ctrl + C` en la terminal. SOLACE sigue funcionando sin el Mac: la luz automática, los interruptores y las protecciones viven en la ESP32.

**Interruptores físicos** (de enclavamiento, no pulsadores; cada uno entre su pin y GND):

| Interruptor | Pin | Cada movimiento (hacia cualquier lado) |
|---|---|---|
| Carga de celular (USB 5 V) | **GPIO32** | enciende o apaga el USB (MOSFET en GPIO26) |
| Luz | **GPIO27** | enciende la tira en **blanco al 100 %** o la apaga (manual) |

**Un único estado**: cada movimiento del interruptor **alterna** (como un interruptor de escalera) y el botón de la app hace lo mismo.
Lo que enciendes con el interruptor aparece encendido en la app y viceversa, y siempre puedes apagar a mano con un solo movimiento.
**Todo arranca en manual**; al encender, un interruptor cerrado enciende su salida (abierto = apagada). Funciona con o sin WiFi:
la carga de celular y la luz no dependen de la app. La app es un extra: puede cambiarlas y activar los modos automáticos hasta el próximo reinicio.
Los interruptores se leen cada 0,5 s (y se confirman 50 ms después del cambio), así que responden en menos de medio segundo;
la app recibe el cambio al instante.

Desde `/mainUser` también se enciende y apaga la **carga de celular** y se eligen las **protecciones del USB**:
- **Automáticas** (se eligen en la app): el USB se apaga solo con temperatura ≥ 50 °C o sin BMP280 (vuelve bajo 40 °C),
  sin datos del INA3221, batería bajo 6,6 V (vuelve sobre 7,0 V) o sobrecorriente (bloqueo de 30 s).
- **Manual** (por defecto, siempre al arrancar): **no se evalúa ninguna protección**. El USB se enciende si lo dice el interruptor o la app (el último que actúe), aunque
  falten los sensores. Las alertas siguen avisando (temperatura alta, sin sensores) y aparece "USB en manual: sin protecciones".

| LED testigo USB (GPIO4) | Significa |
|---|---|
| Apagado | Salida USB apagada |
| Fijo | Salida USB **encendida** (5 V en el puerto) |
| Parpadeo rápido | Se pidió (interruptor o app), pero una protección la mantiene apagada (temperatura, batería baja, sobrecorriente o sin sensores). La app dice cuál |

| LED de sistema (GPIO33) | Significa |
|---|---|
| Fijo | Sistema encendido y **en operación** (la batería alimenta todo) |
| "Respira" (sube y baja en 2 s) | La batería se está **cargando** (panel solar o cargador USB) |
| Doble destello | Sin datos del INA3221: no se sabe el estado de la batería |

| LED azul de la ESP32 (GPIO2) | Significa | Qué hacer |
|---|---|---|
| Parpadeo rápido | Intentando conectarse al WiFi | Revisa que el hotspot esté encendido y sea de **2.4 GHz** |
| Destello corto cada 2 s | No encontró la red: la radio descansa y reintenta sola (5, 10, 20, 40 s… hasta 60 s) | Enciende el hotspot; se conecta en el siguiente intento |
| Doble destello | Tiene WiFi pero no encuentra el Mac | Revisa que `npm run dev` esté corriendo y que el Mac esté en el mismo hotspot |
| Fijo | En línea ✓ | Listo |

---

## Guía de conexión paso a paso

Hazla completa **la primera vez** o cuando cambies de computador o de red WiFi.

### Paso 0 · Qué necesitas

- **Arduino IDE 2** ([arduino.cc/en/software](https://www.arduino.cc/en/software)). Con él se carga el código a la ESP32.
- **VS Code** y **Node.js 20 o superior** ([nodejs.org](https://nodejs.org)). Con ellos corre el hub en el Mac.
- Un **cable USB de datos**. Muchos cables solo cargan: si el Mac no detecta la ESP32, prueba con otro cable.

> **¿Arduino IDE o VS Code?** Usa los dos, cada uno para su parte:
> - **Arduino IDE** para cargar el firmware a la ESP32. Es lo más sencillo, porque instala la placa y las librerías con un par de clics.
> - **VS Code** para el hub del Mac (`npm run dev`) y para editar el código.

### Paso 1 · Preparar el Arduino IDE (solo la primera vez)

1. Abre Arduino IDE y ve al **Boards Manager** (segundo ícono de la barra izquierda, o *Tools → Board → Boards Manager*).
   Busca **`esp32`** e instala **"esp32 by Espressif Systems"** (versión 3.x).
2. Ve al **Library Manager** (tercer ícono de la barra izquierda). Busca e instala estas **tres** librerías.
   Si pregunta *"Install all dependencies?"*, elige **INSTALL ALL**.

   | Busca | Instala | Autor |
   |---|---|---|
   | `Adafruit NeoPixel` | **Adafruit NeoPixel** | Adafruit |
   | `PubSubClient` | **PubSubClient** | Nick O'Leary |
   | `ArduinoJson` | **ArduinoJson** (versión 7) | Benoit Blanchon |

   El INA3221, el BMP280 y el BH1750 **no necesitan librería**: el firmware trae sus propios drivers calibrados.

### Paso 2 · Cablear (con todo desconectado)

Los tres sensores (INA3221, BMP280 y BH1750) usan el bus **I2C**, así que van a los **mismos dos pines**: SDA y SCL.

```
                    ESP32 DevKit V1
                 ┌──────────────────┐
  3V3  ──────────┤ 3V3        GPIO21├────── SDA  (INA3221, BMP280, BH1750)
  GND  ──────────┤ GND        GPIO22├────── SCL  (INA3221, BMP280, BH1750)
                 │            GPIO25├──330Ω── DIN  tira RGB WS2812B (5 V, 3 pines)
                 │            GPIO26├──────── MOSFET de la salida USB (5 V celular)
                 │             GPIO4├──330Ω── LED testigo USB ── GND
                 │            GPIO33├──330Ω── LED de sistema / carga ── GND
  Interr. USB ─GND┤GPIO32      GPIO2│  (LED azul integrado = estado WiFi)
  Interr. luz ─GND┤GPIO27           │
                 │ GPIO34 (opcional)│◀─ divisor 5 V→3,3 V de la entrada USB de carga
                 └──────────────────┘
```

| Módulo | Pin del módulo | Va a | Nota |
|---|---|---|---|
| **INA3221** (potencia, 0x40) | VS / GND | 3V3 / GND | |
| | SCL / SDA | GPIO22 / GPIO21 | |
| | **CH1** IN+ → IN− | en serie con el **nodo de la batería** | IN+ del lado de la batería. Mide voltaje, consumo y **carga**: corriente negativa = la batería se carga (panel o USB) |
| | **CH2** IN+ → IN− | en serie con la **salida USB de 5 V**, después del MOSFET | carga del celular |
| | **CH3** IN+ → IN− | en serie con el **5 V de la tira LED** | mide el consumo real de la tira |
| **BMP280** (temperatura y presión) | VCC / GND | **3V3** / GND | No lo conectes a 5 V. Se detecta solo en 0x76 o 0x77 |
| | SCL / SDA | GPIO22 / GPIO21 | CSB sin conectar (a GND lo pasa a SPI) |
| | ubicación | **pegado al banco de baterías** | es el sensor de la protección térmica |
| **BH1750** (luz, 0x23) | VCC / GND / SCL / SDA | 3V3 / GND / GPIO22 / GPIO21 | ADDR a GND. Ponlo donde **no lo ilumine la tira** |
| **Tira RGB WS2812B** (5 V, 3 pines) | **DIN** (verde/blanco) | GPIO25 **a través de 330 Ω** | resistencia lo más cerca posible de la tira |
| | **5V** (rojo) | 5 V del step-down, pasando por CH3 del INA3221 | condensador de 1000 µF entre 5 V y GND |
| | **GND** (blanco/negro) | GND común | |
| **MOSFET de la salida USB** (Q2) | compuerta (o base del driver) | GPIO26 | HIGH = USB encendido. Si tu etapa invierte, pon `USB_ACTIVO_ALTO 0` en `config.h` |
| **Interruptor USB** (enclavamiento, donde estaba S1) | un lado / otro lado | GPIO32 / GND | pull-up interno. Cerrado = USB encendido |
| **Interruptor de la luz** (enclavamiento) | un lado / otro lado | **GPIO27** / GND | pull-up interno. Cerrado = blanco 100 %, abierto = apagada |
| **LED testigo USB** (antes LED de alarma) | ánodo / cátodo | GPIO4 por 330 Ω / GND | |
| **LED de sistema / carga** (va donde estaba S2) | ánodo / cátodo | GPIO33 por 330 Ω / GND | ⚠️ **quita el botón S2 antes de cargar el firmware**: GPIO33 ahora es salida |
| **Detector de entrada USB** (opcional) | divisor 10 kΩ / 20 kΩ desde el 5 V de entrada | GPIO34 | y `PIN_USB_IN 34` en `config.h`. Sin él, la carga en la oscuridad se reconoce como USB y con luz aparece "panel solar o USB" |

> ⚠️ **Todas las tierras (GND) deben estar unidas:** ESP32, sensores, batería, step-down, tira, MOSFET, LEDs e interruptores.
> Si falta la tierra común, aparecen lecturas raras y la tira muestra colores aleatorios.
>
> La tira **no** se alimenta del pin 5V/VIN de la ESP32: 30 LEDs en blanco piden ~1,8 A. El cable de 5 V
> debe ir directo al step-down.

### Paso 3 · Escribir el WiFi (solo la primera vez o si cambias de red)

1. En la carpeta `firmware/solace_esp32/`, haz una copia de `secrets.example.h` y nómbrala **`secrets.h`**:
   ```bash
   cp firmware/solace_esp32/secrets.example.h firmware/solace_esp32/secrets.h
   ```
2. Abre `secrets.h` y escribe tus redes. Puedes poner **varias**: la ESP32 prueba cada una 12 s y pasa a la siguiente.
   ```cpp
   static const WifiCred WIFI_REDES[] = {
       {"NombreDelHotspot", "ClaveDelHotspot"},
       {"WiFiDeLaCasa", "OtraClave"},
   };
   ```
   - Las redes deben ser de **2.4 GHz**, porque la ESP32 no ve redes de 5 GHz. El hotspot del celular sirve. En iPhone, activa *Maximizar compatibilidad*.
   - El Mac y los celulares tienen que estar conectados **a esa misma red**.
   - No hace falta escribir ninguna IP: la ESP32 encuentra el Mac sola.
   - `secrets.h` **no se sube a GitHub** (está en `.gitignore`), así que las claves quedan solo en tu computador.

### Paso 4 · Cargar el código a la ESP32

1. Conecta la ESP32 al Mac con el cable USB.
2. En Arduino IDE: *File → Open…* → abre **`firmware/solace_esp32/solace_esp32.ino`**. Las demás pestañas (`config.h`, `logic.h`, `hub_link.cpp`, …) se abren solas.
3. *Tools → Board → esp32 →* **ESP32 Dev Module**.
4. *Tools → Port →* elige el puerto que se llame parecido a **`/dev/cu.usbserial-XXXX`**, `/dev/cu.SLAB_USBtoUART` o `/dev/cu.wchusbserial-XXXX`.
   No elijas `Bluetooth-Incoming-Port`.
5. Pulsa **Upload** (botón de la flecha →). Compila durante uno o dos minutos y luego carga el código.
   - Si se queda en `Connecting.....` y falla, vuelve a pulsar Upload y **mantén presionado el botón BOOT** de la ESP32
     hasta que aparezca `Writing at 0x...`. Entonces lo sueltas.
6. Cuando diga **`Hard resetting via RTS pin...`**, el código ya está cargado. Solo hay que repetir este paso si cambias el código o el WiFi.

### Paso 5 · Comprobar los sensores en el Serial Monitor

1. En Arduino IDE abre *Tools → Serial Monitor* y en la esquina elige **115200 baud**.
2. Pulsa el botón **EN** (reset) de la ESP32. Deberías ver algo así:
   ```
   # === SOLACE · Power when it matters. === ID: solace-a1b2c3
   # [sensores] INA3221 OK · BMP280 OK · BH1750 OK
   # [wifi] conectando a "NombreDelHotspot"...
   t_ms,V1,I1_mA,P1_mW,V2,I2_mA,P2_mW,V3,I3_mA,P3_mW,E1,E2,E3,T_C,P_hPa,lux,est_lux,modo_led,...
   # [wifi] conectado a "NombreDelHotspot" · IP 172.20.10.4 · RSSI -48 dBm
   # [hub] beacon → 172.20.10.2:1883
   # [mqtt] en línea ✓
   1234,7.412,842.0,6241.0,5.052,950.0,4799.4,...
   ```
   - Las líneas que empiezan con **`#`** son mensajes. Las demás son **CSV**, una cada 3 s, igual que en el firmware de prueba.
     Se pueden copiar a Excel o abrir con el *Serial Plotter*.
3. Si algún sensor dice **NO DETECTADO**, revisa sus 4 cables (VCC, GND, SDA, SCL). Lo más común es tener **SDA y SCL invertidos**.
   El firmware vuelve a buscar el BMP280 y el BH1750 cada 2 s.
4. Prueba rápida sin el Mac (con la luz en automático desde la app): tapa el BH1750 con el dedo. En **~1 s** la tira se enciende en blanco y aparece
   `# [luz] auto → ENCENDIDA`. Destápalo y, con luz de día (> 200 lx), se apaga tras **3 s**.
5. Cierra el Serial Monitor antes de volver a cargar código, porque mientras está abierto ocupa el puerto.

### Paso 6 · Encender el hub en el Mac

1. Conecta el Mac al **mismo hotspot** que la ESP32.
2. Abre la carpeta del proyecto en **VS Code** y abre una terminal (*Terminal → New Terminal*).
3. **Solo la primera vez**, instala las dependencias:
   ```bash
   npm install
   ```
4. Arranca el hub:
   ```bash
   npm run dev
   ```
5. La primera vez, macOS pregunta si `node` puede aceptar conexiones entrantes. Responde **Permitir**.
6. La terminal muestra un **QR**, el enlace de `/mainUser` y una línea de estado. Cuando la ESP32 se conecta aparece `ESP32 conectada desde …`
   y el LED azul de la placa queda fijo.

### Paso 7 · Abrir la app en el celular

- **Público (solo ver):** escanea el QR, que abre `http://<IP-del-Mac>:8080/listener`.
- **Quien controla la luz:** abre `http://<IP-del-Mac>:8080/mainUser`. El enlace exacto aparece en la terminal.

Desde `/mainUser` se elige el modo (automático o manual), el color, el brillo y los umbrales de luz del modo automático.
Esos ajustes se guardan en la flash de la ESP32 y sobreviven a un reinicio. El modo siempre arranca en **automático**.

En la app se ve:
- **Estado de carga** (arriba): *Cargando batería* con una animación del panel solar (ámbar) o del cargador USB (verde azulado)
  hacia la batería, o *En operación* con la energía saliendo de la batería hacia el USB, la luz y la ESP32. Sirve para comprobar
  que el panel y el cargador funcionan: si los conectas y no aparece *Cargando*, no está entrando corriente al nodo de la batería.
- **Batería:** SoC, autonomía estimada y energía restante, calculados por la ESP32 (31,5 Wh útiles).
- **Flujo de energía:** la batería (CH1) arriba, con una barra que reparte su potencia, y un cable animado hacia cada rama:
  salida USB (CH2), tira (CH3) y ESP32 + pérdidas (la diferencia). Más potencia = cable más grueso y flujo más rápido.
  Si el USB se pidió pero está bloqueado, dice **por qué** (batería baja, protección térmica, sobrecorriente, sin sensores).
- **Sin dispositivo:** si la ESP32 se desconecta o deja de enviar datos 10 s, toda la app vuelve a "sin datos" (—) hasta que regrese.
- **Ambiente:** temperatura del banco con la marca de alarma (45 °C) y de corte (50 °C), presión (≈ 750 hPa en Bogotá) y luz.

> **¿Sin la ESP32 a mano?** Con `npm run simulate`, en otra terminal, aparece una ESP32 falsa durante 120 s que se comporta igual que el firmware.

---

## Problemas comunes

| Problema | Solución |
|---|---|
| El Mac no muestra ningún puerto `cu.usbserial…` | Cambia el cable, porque muchos solo cargan. Si sigue sin aparecer, instala el driver **CP210x** (Silicon Labs) o **CH340** (WCH), según el chip USB de la placa |
| `Failed to connect to ESP32` al cargar | Mantén presionado **BOOT** mientras dice `Connecting...` |
| `secrets.h: No such file` | Haz el Paso 3 |
| `Adafruit_NeoPixel.h`, `PubSubClient.h` o `ArduinoJson.h: No such file` | Instala esa librería (Paso 1) |
| `INA3221 NO DETECTADO` | Sin el INA3221 el USB queda **bloqueado por seguridad** (alerta `SENSOR_POWER`) y el LED de sistema hace doble destello. La luz sí funciona. Revisa VS, GND, SDA y SCL |
| `BMP280 NO DETECTADO` y el testigo USB parpadea al encender el USB | Con la protección térmica en automática, sin dato de temperatura por 5 s el USB no enciende (falla segura). Revisa VCC a **3V3**, SDA, SCL y que CSB no esté a GND. Para probar sin el sensor, pon las protecciones en **Manual** en la app |
| Ningún sensor responde (`INA3221 / BMP280 / BH1750 NO DETECTADO`) | La ESP32 los reintenta sola cada 2 s; si ninguno responde, libera el bus I2C y baja la velocidad (100 → 50 → 25 kHz). Cada 10 s el Serial imprime `# [i2c] … SDA=… SCL=… · responden: …`: **una línea en LOW** = un módulo sin 3V3/GND, un corto o SDA/SCL cruzados; **nadie responde con líneas en HIGH** = revisa alimentación, soldaduras y que SDA vaya a GPIO21 y SCL a GPIO22; **otra dirección** = pin de dirección distinto |
| La tira muestra colores al azar o parpadea | Falta la tierra común entre la tira y la ESP32, o falta la resistencia de 330 Ω en DIN |
| El USB se bloquea 30 s con la tira en blanco al 100 % y un celular | La batería entrega ~1,9 A y el INA3221 se satura a ~1,64 A (shunt de 0,1 Ω). Baja `AUTO_BRIGHTNESS_PCT` en `config.h` (≈ 60 %) o el brillo desde la app, o cambia los shunts |
| El MOSFET del USB no enciende (mV entre G y GND) | En el Monitor Serie busca la línea `# [usb] …`: dice si está apagado o bloqueado y por qué. Escribe `q2` + Enter para forzar GPIO26 10 s: si entonces mides ≈ 3,3 V entre G y GND pero la salida no da 5 V, el problema es el MOSFET o su cableado; si sigue en mV, revisa que el cable esté en **D26** |
| El testigo USB parpadea y la app dice "bloqueada" | Una protección mantiene el USB apagado: la app dice cuál (temperatura, batería baja, sobrecorriente o sin sensores) |
| La app se queda en "Esperando al dispositivo" y el Serial dice `"…" NO se ve` | El hotspot está en **5 GHz**. En el iPhone: *Ajustes → Compartir Internet →* activa **Maximizar compatibilidad**, y deja esa pantalla abierta mientras la ESP32 se conecta. El Serial lista las redes 2.4 GHz que sí ve |
| El Serial dice `"…" SÍ se ve: revisa la clave` | La clave de `secrets.h` no coincide (mayúsculas incluidas) |
| El LED azul parpadea rápido | La ESP32 no se conecta al WiFi. El hotspot tiene que estar encendido, ser de 2.4 GHz y la clave de `secrets.h` debe estar bien escrita |
| El LED azul hace doble destello | Hay WiFi pero la ESP32 no encuentra el Mac. Revisa que `npm run dev` esté corriendo, que el Mac esté en el mismo hotspot y que el firewall permita `node` (*Ajustes → Red → Firewall*) |
| El celular no abre la página | Revisa que esté en la misma red que el Mac. Las redes de la universidad suelen aislar a los equipos (*AP isolation*), así que es mejor usar el hotspot |
| La ESP32 sigue sin encontrar el Mac en una red difícil | En `secrets.h`, escribe la IP del Mac en `HUB_HOST_FALLBACK` (la terminal la muestra) y vuelve a cargar el código |
| La app dice que el firmware no es compatible / no llegan datos con un firmware viejo | El hub usa el protocolo **v4**. Carga el firmware de esta carpeta |

---

## Cómo funciona (detalle técnico)

```
                    MQTT/TCP :1883                         MQTT/WebSocket  /mqtt
 ┌───────────┐  (descubre el hub solo)  ┌─────────────────────────┐   ┌──────────────────────┐
 │  ESP32    │ ───────────────────────▶ │  Mac (hub)              │──▶│ /listener  (QR)      │ × n
 │ INA3221   │  telemetría JSON c/ 2 s  │  · broker MQTT (Aedes)  │   │ solo lectura         │
 │ BH1750    │ ◀─────────────────────── │  · valida y enriquece   │   └──────────────────────┘
 │ BMP280    │   comandos validados     │  · historial + CSV      │   ┌──────────────────────┐
 │ tira RGB  │                          │  · web (Vite/React)     │◀─▶│ /mainUser            │
 └───────────┘                          └─────────────────────────┘   │ lectura + control    │
                                                                       └──────────────────────┘
```

Es una arquitectura **publish/subscribe**. La ESP32 publica cada dato una sola vez y el broker lo reparte a todos
los suscriptores, así que a la ESP32 le da igual si miran 2 o 50 personas.

| Ruta | Quién | Puede |
|---|---|---|
| `http://<IP>:8080/listener` | quien escanee el QR | ver los datos en vivo |
| `http://<IP>:8080/mainUser` | quien controla | ver, cambiar el modo Auto/Manual, el color, el brillo y los umbrales, e identificar el dispositivo |
| `http://<IP>:8080/` | — | portada con ambos accesos |

Los permisos los hace cumplir **el broker**, no solo la interfaz. Un cliente `listener` que intente
publicar es desconectado, y `main` solo puede publicar en `solace/ui/cmd`. El hub valida cada comando
antes de reenviarlo a la ESP32. Por decisión del equipo, `/mainUser` no pide clave.

### Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` | Hub en modo desarrollo (Vite + HMR) |
| `npm start` | Compila la web y la sirve en modo producción |
| `npm run simulate` | Simula la ESP32 por 120 s (una telemetría cada 3 s y todo en manual al arrancar, como el firmware). Opciones: `-- --duration 60 --rate 1 --seed 42 --host 192.168.1.10` |
| `npm test` | Pruebas de front y back (Vitest) |
| `npm run test:firmware` | Pruebas nativas de la lógica del firmware (C++) |
| `npm run test:e2e` | Pruebas E2E en navegador real (Playwright, escritorio y móvil) |
| `npm run test:all` | Todo lo anterior + typecheck |

Variables opcionales: `PORT` (8080), `MQTT_PORT` (1883) y `SOLACE_HOST_IP`, que fuerza la IP si el Mac tiene varias redes.

El simulador encuentra el hub igual que la ESP32: escucha el beacon UDP. Dura 120 s y repite un ciclo de 60 s
para ver todos los estados en la GUI:

| Segundos del ciclo | Qué pasa |
|---|---|
| 0–15 | De día: el **panel solar carga** la batería (animación de carga en ámbar) |
| 15–40 | Anochece: la tira se enciende sola. A los 20 s se cierra el **interruptor USB** (carga de celular) y a los 34 s se abre |
| 40–55 | Se conecta el **cargador USB**: la batería se carga aunque la luz siga encendida (animación en verde azulado) |
| 55–60 | Solo batería, **en operación** |

Teclas (+ Enter) en la terminal del simulador: **`u`** = interruptor USB, **`l`** = interruptor de la luz, **`t`** = calentar/enfriar el banco
(prueba las protecciones automáticas y el modo manual), **`d`** = cortar la conexión 10 s (la app vuelve a "sin datos"). Usa las mismas reglas que el firmware
(protecciones del USB, saturación del INA3221, umbrales), con el detector opcional de la entrada USB cableado. También responde a los comandos
de `/mainUser` y los muestra en la terminal.

### Registro de datos (para EL8 y la prueba de autonomía)

Cada sesión del hub se guarda en `data/sesion-AAAA-MM-DD-HH-MM-SS.csv`, con una fila por segundo. Incluye los voltajes,
las corrientes, las potencias y el estado de rango de los 3 canales (batería, USB y tira), los lux, la temperatura, la presión (`press_hpa`),
el estado de la luz, el SoC y la autonomía del firmware, las protecciones y las alertas. Desde la web, el botón de descarga entrega el historial reciente.

### Firmware (ESP32 DevKit V1)

Está en `firmware/solace_esp32/`. Es el firmware de prueba de ARES (drivers calibrados del INA3221, BMP280 y BH1750,
protecciones y salida CSV) con la conexión MQTT al hub añadida. **Al inicio de `solace_esp32.ino` está la lista completa de conexiones**
(elemento, pin y a dónde va). Los pines y los periodos se ajustan en `config.h`;
la lógica pura (umbrales y cálculos) está en `logic.h` y se prueba en el computador. Compila con el core de Espressif 3.x (probado con 3.3.8).

La ESP32 busca el hub en este orden: el beacon UDP del Mac (puerto 47474), mDNS `_solace._tcp`, la última IP guardada
y por último `HUB_HOST_FALLBACK` en `secrets.h`, si está definido. Nada de esto bloquea el lazo de protecciones más de ~3 s.

- **Consumo y temperatura de la ESP32:** CPU a 80 MHz (`CPU_MHZ`) y una pausa de 10 ms por vuelta del lazo (la CPU duerme ~90 % del tiempo).
  Dos ritmos: lo que debe sentirse inmediato (interruptores, protecciones, salidas USB y luz) cada **0,5 s**; lo demás más lento:
  telemetría a la app cada **3 s** (un cambio se envía al instante, máx. uno cada 0,5 s), INA3221 cada 1 s (16 muestras, cediendo la CPU
  mientras convierte), BMP280 cada 0,5 s y BH1750 cada 0,25 s, y CSV por Serial cada 3 s. Calibraciones sin cambios.
- **WiFi eficiente:** al arrancar prueba directo la última red que funcionó. Si falla, **apaga la radio** y espera 5, 10, 20, 40… hasta 60 s;
  antes de cada reintento hace un escaneo corto (~2 s) y solo se conecta si una red de `secrets.h` está a la vista (la de mejor señal).
  Potencia adaptativa: 11 dBm (`WIFI_TX_DBM`) con buena señal, 17 dBm con señal débil o tras 2 fallos. No reescribe la clave en flash.
  MQTT reintenta cada 2, 4, 8, 16… hasta 30 s, y mDNS (bloquea ~3 s) solo se consulta de vez en cuando; el beacon UDP es pasivo.
- **Bus I2C (100 kHz):** un supervisor reconecta cada sensor que no responde (cada 2 s) sin afectar a los demás. El INA3221 se da por
  perdido tras 3 lecturas fallidas seguidas (tolera ruido aislado) y se identifica por su ID de fabricante. Si ninguno responde,
  libera el bus (9 pulsos de SCL + STOP) y baja la velocidad hasta 25 kHz.
- **INA3221** (CH1 batería, CH2 USB, CH3 tira): promedio de 16 muestras cada 1 s con los coeficientes de calibración
  (V = a·código + b; I cuadrática). Cada canal informa `OK`, `FUERA_CAL` (> 1500 mA) o `SATURADO`.
- **Batería 2S2P:** 31,5 Wh útiles. El SoC inicial sale de la curva OCV por celda y luego se cuenta la energía (Wh).
  Se recalibra al 100 % con 8,30 V y < 80 mA durante 60 s. Autonomía = energía restante ÷ potencia media (τ = 30 s).
- **Carga de la batería:** CH1 negativo (< −20 mA) = cargando. El estado (cargando / en operación / en reposo) usa la medición
  instantánea. El origen sale del detector opcional de la entrada USB (GPIO34); sin él, cargar con < 50 lx solo puede ser USB y con luz
  se informa "panel solar o USB".
- **Salida USB (interruptor en GPIO32 o app + MOSFET en GPIO26):** arranca en manual, según el interruptor. Las protecciones solo actúan sobre el USB:
  solo en modo **automático**: temperatura (alarma a 45 °C, **corte** a 50 °C, rearme bajo 40 °C, sin dato del BMP280 por 5 s también corta),
  batería baja (corta bajo 6,6 V, vuelve sobre 7,0 V), sin datos del INA3221, y CH1 saturado 3 s → bloqueo de 30 s.
  En **manual** no se evalúa ninguna: el USB obedece solo al interruptor o a la app (alerta `TEMP_GUARD_OFF`).
- **Tira LED:** sin cortes de protección. Siempre alimentada; se enciende, cambia de color y se apaga por el pin de datos.
- **Modo automático (se activa desde la app):** bajo 10 lx durante 0,5 s enciende la tira en blanco (≈1 s en total, BH1750 cada 0,25 s con
  media de 3 lecturas y evaluación al llegar cada lectura); sobre 200 lx durante 3 s la apaga.
  Los umbrales se cambian desde `/mainUser`. Con la tira encendida solo la apaga la luz de día, así su propio reflejo no la hace parpadear.
- **Modo manual:** encendido, color y brillo desde `/mainUser`, o con el interruptor de la luz (GPIO27). Tocar un control de luz pasa a manual.
- **Interruptores (GPIO32 y GPIO27):** se leen cada 0,5 s y se confirman a los 50 ms; cada cambio de posición alterna el estado.
- **WiFi:** *modem sleep* en línea; radio apagada entre reintentos (ver arriba).
- **Alertas:** batería baja/crítica, temperatura alta, corte térmico, sin sensor de temperatura, USB cortado por batería,
  USB bloqueado, INA fuera de rango, USB fuera de 4,75–5,25 V, sensores sin respuesta y protección térmica en manual.

### Protocolo (resumen)

| Topic | Sentido | Contenido |
|---|---|---|
| `solace/device/telemetry` | ESP32 → hub | JSON de telemetría (ver `shared/protocol.ts`). versión **4**: `env`, `power.{bat,usb,led}` (V, A, W y estado de rango), `bat` (SoC, autonomía, origen de la carga), `light`, `protect` (incl. `tempGuard`), `switches`, `alerts` |
| `solace/device/status` | ESP32 → hub | `online` / `offline` (retenido, LWT) |
| `solace/device/cmd` | hub → ESP32 | `{"id","type":"setMode"\|"setLight"\|"setAuto"\|"setUsb"\|"setTempGuard"\|"identify",…}` |
| `solace/device/ack` | ESP32 → hub | `{"id","ok","error?"}` |
| `solace/ui/cmd` | mainUser → hub | `{"id","cmd":{…}}` |
| `solace/live/#` | hub → navegadores | telemetría enriquecida, dispositivo, acks, actividad, estadísticas |

`shared/protocol.ts` es el contrato. El firmware, el simulador y la web siguen ese esquema, y las pruebas lo verifican.

---

## Pruebas

| Suite | Cubre |
|---|---|
| `tests/shared` | SoC, estado y origen de la carga, protecciones del USB, luz automática, alertas y esquema del protocolo v4. Incluye la **paridad C++ ↔ TS**: compila `logic.h` y lo compara con la lógica del simulador en 3600 casos aleatorios |
| `tests/server` | Broker y roles (listener bloqueado, main sin acceso directo al dispositivo), mensajes retenidos para quien llega tarde, validación de comandos, acks y timeouts, API HTTP, beacon UDP, CSV y el simulador contra el hub real |
| `tests/web` | Store, cliente MQTT, vista listener sin controles, cada control de mainUser, errores y desconexión. Incluye una integración real con 3 listeners, 1 main y una ESP32 simulada |
| `tests/e2e` | Navegador real, en escritorio y móvil: datos en vivo, mainUser cambia el color y el listener lo ve, desconexión |
| `firmware/test` | 274 verificaciones nativas de `logic.h`: calibración del INA3221, SoC, estado y origen de la carga, LEDs indicadores, protecciones del USB (automática y manual), interruptores, luz automática (incluido el desbordamiento de `millis()`) y alertas |

Para la E2E hay que instalar el navegador una vez: `npx playwright install chromium`.

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

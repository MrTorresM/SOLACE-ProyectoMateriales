/**
 * JSON idéntico al que arma publicarTelemetria() en solace_esp32.ino (protocolo v4).
 * Escena: de noche, en operación (la batería alimenta todo), celular cargando por la
 * salida USB (encendida con el interruptor) y la tira en manual, ámbar al 80 %.
 */
export const FIRMWARE_SAMPLE = {
  v: 4,
  id: 'solace-a1b2c3',
  seq: 42,
  uptime: 3600,
  env: { lux: 3.1, luxState: 'BAJO_RANGO', tempC: 27.4, pressHpa: 752.3 },
  power: {
    bat: { v: 7.412, i: 1.362, p: 10.095, st: 'OK' },
    usb: { v: 5.052, i: 0.95, p: 4.799, st: 'OK' },
    led: { v: 4.981, i: 0.912, p: 4.543, st: 'OK' },
  },
  bat: { soc: 51.3, state: 'discharging', remainingWh: 16.16, avgPowerW: 9.98, autonomyMin: 97, capacityWh: 31.5, source: null, chargeW: null },
  light: { mode: 'manual', on: true, color: '#E2A64B', brightness: 80, luxOn: 10, luxOff: 200, outPct: 80 },
  protect: { temp: 'NORMAL', tempGuard: 'auto', usbRequested: true, usbOn: true, usbLowBat: false, usbBlocked: false },
  switches: { usb: true, light: false },
  alerts: [] as string[],
  net: { rssi: -61, ip: '192.168.1.57' },
}

/** La misma ESP32 de día, cargando por el panel solar (CH1 negativo). */
export const FIRMWARE_CHARGING = {
  ...FIRMWARE_SAMPLE,
  env: { ...FIRMWARE_SAMPLE.env, lux: 12500, luxState: 'OK' },
  power: {
    bat: { v: 7.802, i: -0.552, p: -4.307, st: 'OK' },
    usb: { v: 0, i: 0, p: 0, st: 'OK' },
    led: { v: 5.02, i: 0.03, p: 0.151, st: 'OK' },
  },
  bat: { ...FIRMWARE_SAMPLE.bat, state: 'charging', autonomyMin: null, source: 'solar', chargeW: 4.307 },
  light: { ...FIRMWARE_SAMPLE.light, mode: 'auto', on: false, color: '#FFFFFF', brightness: 100, outPct: 0 },
  protect: { ...FIRMWARE_SAMPLE.protect, usbRequested: false, usbOn: false },
  switches: { usb: false, light: false },
}

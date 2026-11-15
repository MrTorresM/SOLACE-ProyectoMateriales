/** JSON idéntico al que arma publishTelemetry() en solace_esp32.ino. */
export const FIRMWARE_SAMPLE = {
  v: 1,
  id: 'solace-a1b2c3',
  seq: 42,
  uptime: 3600,
  env: { lux: 3.2, luxAmbient: 3.1, tempC: 27.4, hum: null },
  power: {
    bat: { v: 7.612, i: 0.842, p: 6.409 },
    usb: { v: 5.052, i: 0.95, p: 4.799 },
    radio: { v: 3.304, i: 0.061, p: 0.202 },
    led: { p: 9.15, est: true },
  },
  bat: { soc: 51.3, charging: false },
  light: { mode: 'auto', on: true, color: '#FFFFFF', brightness: 100, luxOn: 15, luxOff: 40 },
  alerts: ['SENSOR_DHT'],
  net: { rssi: -61, ip: '192.168.1.57' },
}

// SOLACE — control de la tira WS2812B con transiciones suaves.
#pragma once

#include <Arduino.h>

#include "logic.h"

class LightController {
 public:
  void begin();
  // Fija el objetivo; la tira hace la transición en LED_FADE_MS.
  void setTarget(bool on, const solace::Rgb& color, uint8_t brightnessPct);
  // Parpadea en ámbar 3 veces para identificar el dispositivo.
  void identify(uint32_t nowMs);
  void loop(uint32_t nowMs);
  // true si la tira está emitiendo luz en este momento (incluye transiciones).
  bool isLit() const;
  // Apaga la tira al instante (para muestrear luz ambiente) y luego la restaura.
  void blank();
  void restore();

 private:
  void render(float r, float g, float b, float level);

  solace::Rgb targetColor_{255, 255, 255};
  float targetLevel_ = 0;  // 0..1 (incluye on/off y brillo)
  float curR_ = 255, curG_ = 255, curB_ = 255, curLevel_ = 0;
  uint32_t lastStep_ = 0;
  uint32_t identifyUntil_ = 0;
  bool blanked_ = false;
  bool needsRender_ = true;
};

#include "light.h"

#include <Adafruit_NeoPixel.h>

#include "config.h"

namespace {
Adafruit_NeoPixel strip(LED_COUNT, PIN_LED_STRIP, NEO_GRB + NEO_KHZ800);
constexpr uint32_t STEP_MS = 16;  // ~60 fps
}  // namespace

void LightController::begin() {
  strip.begin();
  strip.setBrightness(255);  // el brillo se aplica por software (con corrección gamma)
  strip.clear();
  strip.show();
}

void LightController::setTarget(bool on, const solace::Rgb& color, uint8_t brightnessPct) {
  if (brightnessPct > LED_MAX_BRIGHTNESS_PCT) brightnessPct = LED_MAX_BRIGHTNESS_PCT;
  targetColor_ = color;
  targetLevel_ = on ? brightnessPct / 100.0f : 0.0f;
}

void LightController::identify(uint32_t now) { identifyUntil_ = now + 1500; }

bool LightController::isLit() const { return !blanked_ && curLevel_ > 0.005f; }

void LightController::blank() {
  blanked_ = true;
  strip.clear();
  strip.show();
}

void LightController::restore() {
  blanked_ = false;
  render(curR_, curG_, curB_, curLevel_);
}

void LightController::render(float r, float g, float b, float level) {
  // Corrección gamma sobre el nivel para que el brillo percibido sea lineal.
  const uint8_t lv = Adafruit_NeoPixel::gamma8((uint8_t)constrain(level * 255.0f, 0.0f, 255.0f));
  const uint32_t c = strip.Color((uint8_t)(r * lv / 255.0f), (uint8_t)(g * lv / 255.0f), (uint8_t)(b * lv / 255.0f));
  strip.fill(c);
  strip.show();
}

void LightController::loop(uint32_t now) {
  if (blanked_ || now - lastStep_ < STEP_MS) return;
  const float dt = (float)(now - lastStep_);
  lastStep_ = now;

  if ((int32_t)(identifyUntil_ - now) > 0) {
    const bool phase = ((identifyUntil_ - now) / 250) % 2 == 0;
    render(226, 166, 75, phase ? 1.0f : 0.0f);  // Signal Amber
    needsRender_ = true;  // al terminar, vuelve al color normal
    return;
  }

  const float k = min(1.0f, dt / (float)LED_FADE_MS * 3.0f);  // ~95 % en LED_FADE_MS
  const float prev = curLevel_ + curR_ + curG_ + curB_;
  curR_ += k * (targetColor_.r - curR_);
  curG_ += k * (targetColor_.g - curG_);
  curB_ += k * (targetColor_.b - curB_);
  curLevel_ += k * (targetLevel_ - curLevel_);
  if (fabsf(curLevel_ - targetLevel_) < 0.002f) curLevel_ = targetLevel_;
  const float next = curLevel_ + curR_ + curG_ + curB_;
  if (fabsf(next - prev) > 0.01f || needsRender_) {
    render(curR_, curG_, curB_, curLevel_);
    needsRender_ = false;
  }
}


#include <Adafruit_NeoPixel.h>

#define LED_PIN 9
#define NUM_LEDS 30  // Cambia según el número de LEDs de tu tira

Adafruit_NeoPixel strip(
  NUM_LEDS,
  LED_PIN,
  NEO_GRB + NEO_KHZ800
);

int brightness = 100;

void setup() {
  Serial.begin(9600);

  strip.begin();
  strip.setBrightness(255);
  strip.show();

  Serial.println("=== LED CONTROLLER ===");
  Serial.println("Colors: RED, GREEN, BLUE, WHITE, YELLOW, PURPLE, OFF");
  Serial.println("Brightness: 0 - 100");
}

void loop() {
  if (Serial.available()) {

    String command = Serial.readStringUntil('\n');
    command.trim();
    command.toUpperCase();

    if (command == "RED") {
      setColor(255, 0, 0);
    }
    else if (command == "GREEN") {
      setColor(0, 255, 0);
    }
    else if (command == "BLUE") {
      setColor(0, 0, 255);
    }
    else if (command == "WHITE") {
      setColor(255, 255, 255);
    }
    else if (command == "YELLOW") {
      setColor(255, 255, 0);
    }
    else if (command == "PURPLE") {
      setColor(180, 0, 255);
    }
    else if (command == "OFF") {
      setColor(0, 0, 0);
    }
    else if (isDigit(command[0])) {
      int value = command.toInt();

      if (value >= 0 && value <= 100) {
        brightness = value;
        strip.setBrightness(map(brightness, 0, 100, 0, 255));
        strip.show();

        Serial.print("Brightness: ");
        Serial.print(brightness);
        Serial.println("%");
      }
    }
    else {
      Serial.println("Unknown command");
    }
  }
}

void setColor(int r, int g, int b) {
  for (int i = 0; i < NUM_LEDS; i++) {
    strip.setPixelColor(i, strip.Color(r, g, b));
  }

  strip.show();

  Serial.println("Color updated!");
}

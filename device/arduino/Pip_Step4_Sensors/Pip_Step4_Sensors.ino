// Pip Step 4: the real sensors. MQ-2 gas -> yellow light, kit moisture probe (AO on A1) -> blue light.
// These are the quiet heads-ups only. Step 5 adds the poop decision, red and the buttons.
const int YELLOW = 3, BLUE = 5, RED = 6;
const int GAS_PIN = A0;              // MQ-2 AO wire
const int WET_PIN = A1;              // moisture sensor board AO wire
const int GAS_RISE = 60;             // how far above clean air counts as "gas sensed" (tune this)
const int WET_CHANGE = 100;          // how far the moisture reading must move from dry to count as wet (tune this)
const unsigned long WARMUP_MS = 180000UL;   // 3 minutes for the MQ-2 to heat up

int dadState = 1, momState = 0, nanState = 0;   // 0 off duty, 1 on duty, 2 being alerted
int gas = 0, gasBase = 0;
int wet = 0, wetBase = 0;
bool ready = false, gasOn = false, wetOn = false;
unsigned long lastLine = 0;

void setup() {
  pinMode(YELLOW, OUTPUT); pinMode(BLUE, OUTPUT); pinMode(RED, OUTPUT);
  Serial.begin(9600);
}

void loop() {
  gas = analogRead(GAS_PIN);                     // 0 to 1023, higher = more gas

  wet = analogRead(WET_PIN);                     // dry probe = one number, water on it moves it a lot

  if (!ready) {
    // warming up: yellow and blue blink slowly together
    bool blinkOn = (millis() / 1000) % 2;
    digitalWrite(YELLOW, blinkOn); digitalWrite(BLUE, blinkOn);
    if (millis() >= WARMUP_MS) {
      gasBase = gas; wetBase = wet; ready = true;
      digitalWrite(YELLOW, LOW); digitalWrite(BLUE, LOW);
      Serial.print("Status: Pip is ready. Clean air gas = "); Serial.print(gasBase);
      Serial.print(", dry moisture reading = "); Serial.println(wetBase);
    }
  } else {
    // gas: on above the limit, off again once it drops halfway back
    if (!gasOn && gas > gasBase + GAS_RISE) {
      gasOn = true; digitalWrite(YELLOW, HIGH);
      Serial.println("Status: Dad: gas sensed, waiting a few seconds to see if this is just passing gas");
    } else if (gasOn && gas < gasBase + GAS_RISE / 2) {
      gasOn = false; digitalWrite(YELLOW, LOW);
      Serial.println("Status: Dad: gas cleared, just passing gas");
    }
    // moisture: water on the probe moves the reading away from the dry number
    int wetMove = abs(wet - wetBase);
    if (!wetOn && wetMove > WET_CHANGE) {
      wetOn = true; digitalWrite(BLUE, HIGH);
      Serial.println("Status: Dad: moisture sensed in Henry's diaper");
    } else if (wetOn && wetMove < WET_CHANGE / 2) {
      wetOn = false; digitalWrite(BLUE, LOW);
      Serial.println("Status: Dad: moisture cleared");
    }
  }

  if (millis() - lastLine >= 1000) {             // one line a second (also works in Serial Plotter)
    lastLine = millis();
    if (!ready) { Serial.print("Warming up, seconds left: "); Serial.println((WARMUP_MS - millis()) / 1000); }
    Serial.print("Dad:"); Serial.print(dadState);
    Serial.print(",Mom:"); Serial.print(momState);
    Serial.print(",Nan:"); Serial.print(nanState);
    Serial.print(",Gas:"); Serial.print(gas);
    Serial.print(",GasLimit:"); Serial.print(ready ? gasBase + GAS_RISE : 0);
    Serial.print(",Moisture:"); Serial.print(wet);
    Serial.print(",MoistureDry:"); Serial.println(ready ? wetBase : 0);
  }
}

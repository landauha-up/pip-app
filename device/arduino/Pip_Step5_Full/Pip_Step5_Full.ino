// Pip MVP: my diaper sensor prototype (Hannah Landau, IPD 5510)
// Yellow light = gas sensed. Blue light = moisture sensed. These are quiet heads-ups for whoever is on duty.
// Red light = poop confirmed. This is the real alert, and it is the only one that gets passed on.
// My demo shortcuts: type g (fake gas), w (fake moisture, w again to dry it) or p (fake poop) in the Serial Monitor.

// ===== SETTINGS I CAN CHANGE (times are in milliseconds: 1000 = 1 second) =====
const unsigned long POOP_MS = 20000UL;      // how long gas has to stay high before I call it poop (20 seconds)
const unsigned long PASS_MS = 90000UL;      // how long the alert waits for an answer before it goes to the next person (90 seconds)
const bool NEED_MOISTURE_TOO = false;       // false = gas alone can mean poop, true = poop needs gas AND moisture
const int GAS_RISE = 30;                    // how far the gas number has to climb above clean air to count as gas
const int WET_CHANGE = 100;                 // how far the moisture number has to move from dry to count as wet
const unsigned long WARMUP_MS = 90000UL;    // how long I let the gas sensor heat up before Pip starts watching (90 seconds)
const char* BABY = "Henry";                 // the baby's name in my scenario

// ===== WHERE EVERYTHING IS PLUGGED IN ON MY NANO =====
const int YELLOW = 3;                       // yellow light (gas) is on pin D3
const int BLUE = 5;                         // blue light (moisture) is on pin D5
const int RED = 6;                          // red light (poop) is on pin D6
const int CANT_BTN = 8;                     // my "Can't right now" button is on pin D8
const int CHANGED_BTN = 7;                  // my "Diaper changed" button is on pin D7
const int GAS_PIN = A0;                     // the MQ-2 gas sensor's AO wire is on pin A0
const int WET_PIN = A1;                     // the moisture sensor's AO wire is on pin A1

// ===== THE FAMILY =====
const char* NAMES[] = {"", "Dad", "Mom", "Nan"};  // person 1 = Dad, 2 = Mom, 3 = Nan (spot 0 is left empty on purpose)
const int ON_DUTY = 1;                      // who is on duty right now: 1 = Dad
int state[4] = {0, 1, 0, 0};                // each person's number: 0 = off duty, 1 = on duty, 2 = being alerted (Dad starts on duty)
int alerted = 0;                            // who has the red alert right now: 0 = nobody, 1 Dad, 2 Mom, 3 Nan, 4 = everyone

// ===== THINGS PIP KEEPS TRACK OF =====
int gas = 0;                                // the newest gas reading (0 to 1023, higher = more gas)
int gasBase = 0;                            // the gas reading in clean air, saved after warm-up
int wet = 0;                                // the newest moisture reading (about 1015 when dry, drops when wet)
int wetBase = 0;                            // the moisture reading when dry, saved after warm-up
bool ready = false;                         // false while warming up, true once Pip is watching
bool armed = true;                          // false right after a change, until the air is clean and the probe is dry again
bool gasOn = false;                         // true while the yellow gas heads-up is on
bool wetOn = false;                         // true while the blue moisture heads-up is on
bool poop = false;                          // true once Pip has decided it is poop (red is on)
bool fakeGas = false;                       // true after I type g, to pretend there is gas
bool fakeWet = false;                       // true after I type w, to pretend there is moisture
unsigned long gasStart = 0;                 // the time the gas first went high, to count toward the poop decision
unsigned long alertStart = 0;               // the time the current person got the red alert, for the pass-on timer
unsigned long lastLine = 0;                 // the time I last printed the status line, so it prints once a second

// ===== MY HELPER STEPS =====
bool pressed(int pin) {                     // checks if a button was just pressed
  if (digitalRead(pin) == LOW) {            // LOW means the button is being pushed
    delay(30);                              // wait a moment, because the metal inside the button bounces
    if (digitalRead(pin) == LOW) {          // check again to be sure it is a real press
      while (digitalRead(pin) == LOW) {}    // wait until I let go, so one press only counts once
      return true;                          // yes, the button was pressed
    }                                       // end of the second check
  }                                         // end of the first check
  return false;                             // no press
}                                           // end of pressed()

void say(const char* who, const char* text) {  // prints a quiet heads-up, like "Status: Dad: gas sensed"
  Serial.print("Status: ");                 // every message starts with "Status:"
  Serial.print(who);                        // then the person's name
  Serial.print(": ");                       // then a colon
  Serial.println(text);                     // then the message, and a new line
}                                           // end of say()

void alertPerson(int p) {                   // sends the red alert to one person
  alerted = p;                              // remember who has the alert now
  state[p] = 2;                             // their number becomes 2 (being alerted)
  alertStart = millis();                    // start their pass-on clock
  Serial.print("Status: ");                 // start the message
  Serial.print(NAMES[p]);                   // the person's name
  Serial.print(" alert: poop sensed. ");    // what happened
  Serial.print(BABY);                       // the baby's name
  Serial.println("'s diaper needs changing");  // what they need to do
}                                           // end of alertPerson()

void passOn(const char* why) {              // moves the red alert to the next person
  Serial.print("Status: ");                 // start the message
  Serial.print(NAMES[alerted]);             // the person passing it on
  Serial.print(" ");                        // a space
  Serial.println(why);                      // why they passed it ("can't right now" or "didn't answer")
  int from = alerted;                       // remember who is passing it
  state[from] = (from == ON_DUTY) ? 1 : 0;  // the on-duty person goes back to 1 (still on duty), anyone else back to 0
  if (from == 1) alertPerson(2);            // Dad passes to Mom
  else if (from == 2) alertPerson(3);       // Mom passes to Nan
  else {                                    // Nan passes to everyone
    alerted = 4;                            // 4 means everyone has the alert
    alertStart = millis();                  // restart the clock
    state[1] = 2;                           // Dad is alerted
    state[2] = 2;                           // Mom is alerted
    state[3] = 2;                           // Nan is alerted
    Serial.println("Status: everyone alert: nobody has answered yet");  // tell everyone
  }                                         // end of the everyone case
}                                           // end of passOn()

void startPoopAlert() {                     // what happens when Pip decides it is poop
  poop = true;                              // remember that it is poop
  digitalWrite(RED, HIGH);                  // turn on the red light
  alertPerson(ON_DUTY);                     // alert whoever is on duty first
}                                           // end of startPoopAlert()

void diaperChanged() {                      // what happens when I press "Diaper changed"
  const char* who = (alerted >= 1 && alerted <= 3) ? NAMES[alerted] : "Someone";  // whoever had the alert gets credit
  Serial.print("Status: diaper changed by ");  // start the message
  Serial.print(who);                        // who changed it
  Serial.println(". Alerts off, sensing reset");  // finish the message
  digitalWrite(YELLOW, LOW);                // yellow off
  digitalWrite(BLUE, LOW);                  // blue off
  digitalWrite(RED, LOW);                   // red off
  state[1] = 1;                             // Dad back to on duty
  state[2] = 0;                             // Mom back to off duty
  state[3] = 0;                             // Nan back to off duty
  alerted = 0;                              // nobody has an alert
  poop = false;                             // no poop anymore
  gasOn = false;                            // gas heads-up cleared
  wetOn = false;                            // moisture heads-up cleared
  fakeGas = false;                          // turn off my fake gas
  fakeWet = false;                          // turn off my fake moisture
  armed = false;                            // wait for clean air and a dry probe before watching again
  Serial.println("Status: waiting for clean air before watching again");  // tell me Pip is waiting
}                                           // end of diaperChanged()

// ===== SETUP: RUNS ONCE WHEN THE NANO TURNS ON =====
void setup() {                              // start of setup
  pinMode(YELLOW, OUTPUT);                  // the yellow light pin sends power out
  pinMode(BLUE, OUTPUT);                    // the blue light pin sends power out
  pinMode(RED, OUTPUT);                     // the red light pin sends power out
  pinMode(CANT_BTN, INPUT_PULLUP);          // the "Can't right now" pin listens, using the Nano's built-in resistor
  pinMode(CHANGED_BTN, INPUT_PULLUP);       // the "Diaper changed" pin listens the same way
  Serial.begin(9600);                       // start talking to my computer at 9600 (match this in the Serial Monitor)
}                                           // end of setup

// ===== LOOP: RUNS OVER AND OVER, MANY TIMES A SECOND =====
void loop() {                               // start of loop
  gas = analogRead(GAS_PIN);                // read the gas sensor
  wet = analogRead(WET_PIN);                // read the moisture sensor

  // my demo shortcuts, typed in the Serial Monitor
  while (Serial.available()) {              // if I typed something
    char c = Serial.read();                 // read one letter
    if (c == 'g') { fakeGas = true; Serial.println("(demo) fake gas on"); }  // g = pretend there is gas
    if (c == 'w') { fakeWet = !fakeWet; Serial.println(fakeWet ? "(demo) fake moisture on" : "(demo) fake moisture off"); }  // w = pretend wet, w again = dry
    if (c == 'p' && !poop) { Serial.println("(demo) fake poop"); digitalWrite(YELLOW, HIGH); startPoopAlert(); }  // p = skip straight to poop
  }                                         // end of my demo shortcuts

  // warming up
  if (!ready) {                             // if the gas sensor is still heating up
    bool blinkOn = (millis() / 1000) % 2;   // switches between on and off every second
    digitalWrite(YELLOW, blinkOn);          // yellow blinks while warming up
    digitalWrite(BLUE, blinkOn);            // blue blinks with it
    if (millis() >= WARMUP_MS) {            // once the warm-up time is over
      gasBase = gas;                        // save this gas reading as clean air
      wetBase = wet;                        // save this moisture reading as dry
      ready = true;                         // Pip starts watching
      digitalWrite(YELLOW, LOW);            // yellow off
      digitalWrite(BLUE, LOW);              // blue off
      Serial.print("Status: Pip is ready. Clean air gas = ");  // tell me it is ready
      Serial.print(gasBase);                // the clean air number
      Serial.print(", dry moisture reading = ");  // and
      Serial.println(wetBase);              // the dry number
    }                                       // end of the warm-up check
  } else {                                  // Pip is warmed up and watching
    bool gasHigh = fakeGas || gas > gasBase + GAS_RISE;          // gas is high (or I faked it)
    bool gasLow = !fakeGas && gas < gasBase + GAS_RISE / 2;      // gas has come back down about halfway
    bool wetHigh = fakeWet || abs(wet - wetBase) > WET_CHANGE;   // the probe is wet (or I faked it)
    bool wetLow = !fakeWet && abs(wet - wetBase) < WET_CHANGE / 2;  // the probe is close to dry again

    if (!armed) {                           // right after a change
      if (gasLow && wetLow) {               // once the air is clean and the probe is dry
        armed = true;                       // start watching again
        say(NAMES[ON_DUTY], "Pip is watching again");  // tell the on-duty person
      }                                     // end of the clean-and-dry check
    } else if (!poop) {                     // watching, and no poop yet
      if (!gasOn && gasHigh) {              // gas just went high
        gasOn = true;                       // remember the gas heads-up is on
        gasStart = millis();                // start counting toward the poop decision
        digitalWrite(YELLOW, HIGH);         // yellow on
        say(NAMES[ON_DUTY], "gas sensed, waiting a few seconds to see if this is just passing gas");  // quiet heads-up
      } else if (gasOn && gasLow) {         // gas went away before it counted as poop
        gasOn = false;                      // gas heads-up off
        digitalWrite(YELLOW, LOW);          // yellow off
        say(NAMES[ON_DUTY], "gas cleared, just passing gas");  // tell the on-duty person
      }                                     // end of the gas check
      if (!wetOn && wetHigh) {              // the probe just got wet
        wetOn = true;                       // remember the moisture heads-up is on
        digitalWrite(BLUE, HIGH);           // blue on
        say(NAMES[ON_DUTY], "moisture sensed in the diaper");  // quiet heads-up
      } else if (wetOn && wetLow) {         // the probe dried off
        wetOn = false;                      // moisture heads-up off
        digitalWrite(BLUE, LOW);            // blue off
        say(NAMES[ON_DUTY], "moisture cleared");  // tell the on-duty person
      }                                     // end of the moisture check
      bool longEnough = gasOn && millis() - gasStart >= POOP_MS;  // has the gas stayed high long enough?
      if (longEnough && (!NEED_MOISTURE_TOO || wetOn)) startPoopAlert();  // if yes (plus moisture, if I asked for that), it is poop
    }                                       // end of watching
  }                                         // end of warmed-up part

  // the red alert: my buttons and the pass-on timer
  if (pressed(CANT_BTN) && alerted >= 1 && alerted <= 3) passOn("can't right now");  // "Can't right now" passes it on
  if (alerted >= 1 && alerted <= 3 && millis() - alertStart >= PASS_MS) passOn("didn't answer in time");  // no answer in time passes it on
  if (pressed(CHANGED_BTN)) diaperChanged();  // "Diaper changed" clears everything

  // my status line, once a second (also draws in Tools > Serial Plotter)
  if (millis() - lastLine >= 1000) {        // if a second has passed
    lastLine = millis();                    // remember when I printed
    if (!ready) {                           // while warming up
      Serial.print("Warming up, seconds left: ");  // show the countdown
      Serial.println((WARMUP_MS - millis()) / 1000);  // seconds left
    }                                       // end of the countdown
    Serial.print("Dad:");                   // Dad's label
    Serial.print(state[1]);                 // Dad's number
    Serial.print(",Mom:");                  // Mom's label
    Serial.print(state[2]);                 // Mom's number
    Serial.print(",Nan:");                  // Nan's label
    Serial.print(state[3]);                 // Nan's number
    Serial.print(",Gas:");                  // gas label
    Serial.print(gas);                      // the gas reading
    Serial.print(",GasLimit:");             // gas limit label
    Serial.print(ready ? gasBase + GAS_RISE : 0);  // the number gas has to pass (0 while warming up)
    Serial.print(",Moisture:");             // moisture label
    Serial.print(wet);                      // the moisture reading
    Serial.print(",MoistureDry:");          // dry label
    Serial.println(ready ? wetBase : 0);    // the dry number (0 while warming up), then a new line
  }                                         // end of the status line
}                                           // end of loop

// Pip Step 3: the two buttons. Red starts on (Dad alert); I test passing it on and clearing it.
const int YELLOW = 3, BLUE = 5, RED = 6;  // light pins
const int CANT_BTN = 8, CHANGED_BTN = 7;  // "Can't right now" on D8, "Diaper changed" on D7
// caregiver states: 0 = off duty, 1 = on duty, 2 = being alerted
int dadState = 2, momState = 0, nanState = 0;  // Dad starts with the alert
int alerted = 1;                          // who has the alert: 1 Dad, 2 Mom, 3 Nan, 0 nobody
unsigned long lastLine = 0;               // when I last printed the status line

void printStatusLine() {                  // prints Dad, Mom and Nan's numbers on one line
  Serial.print("Dad:"); Serial.print(dadState);   // Dad's number
  Serial.print(",Mom:"); Serial.print(momState);  // Mom's number
  Serial.print(",Nan:"); Serial.println(nanState); // Nan's number
}                                         // end of printStatusLine()

bool pressed(int pin) {                   // true once per press
  if (digitalRead(pin) == LOW) {          // LOW = being pushed
    delay(30);                            // ignore the bounce of the metal contacts
    if (digitalRead(pin) == LOW) {        // still pushed, so it is real
      while (digitalRead(pin) == LOW) {}  // wait until I let go
      return true;                        // it was pressed
    }                                     // end of second check
  }                                       // end of first check
  return false;                           // not pressed
}                                         // end of pressed()

void setup() {                            // runs once
  pinMode(YELLOW, OUTPUT); pinMode(BLUE, OUTPUT); pinMode(RED, OUTPUT);  // light pins send power out
  pinMode(CANT_BTN, INPUT_PULLUP); pinMode(CHANGED_BTN, INPUT_PULLUP);   // button pins listen
  Serial.begin(9600);                     // talk to my computer
  digitalWrite(RED, HIGH);                // start with red on
  Serial.println("Status: poop confirmed. Dad alert: Henry's diaper needs changing");  // the starting alert
}                                         // end of setup

void loop() {                             // runs over and over
  if (pressed(CANT_BTN) && alerted != 0) {  // "Can't right now" pressed while someone has the alert
    if (alerted == 1) {                   // Dad had it
      dadState = 1; momState = 2; alerted = 2;  // pass to Mom
      Serial.println("Status: Dad can't right now. Mom alert: Henry's diaper needs changing");  // tell everyone
    } else if (alerted == 2) {            // Mom had it
      momState = 0; nanState = 2; alerted = 3;  // pass to Nan
      Serial.println("Status: Mom can't right now. Nan alert: Henry's diaper needs changing");  // tell everyone
    } else {                              // Nan had it
      Serial.println("Status: Nan can't either. Everyone alert!");  // alert everyone
      dadState = 2; momState = 2;         // Dad and Mom alerted too
    }                                     // end of who-had-it
  }                                       // end of "Can't right now"

  if (pressed(CHANGED_BTN)) {             // "Diaper changed" pressed
    Serial.println("Status: diaper changed. Alerts off, sensing reset");  // tell everyone
    digitalWrite(YELLOW, LOW); digitalWrite(BLUE, LOW); digitalWrite(RED, LOW);  // all lights off
    dadState = 1; momState = 0; nanState = 0; alerted = 0;  // back to normal
  }                                       // end of "Diaper changed"

  if (millis() - lastLine >= 1000) {      // status line once a second
    lastLine = millis();                  // remember when
    printStatusLine();                    // print it
  }                                       // end of status line
}                                         // end of loop

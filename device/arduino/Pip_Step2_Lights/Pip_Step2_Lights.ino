// Pip Step 2: the three Pip lights + the caregiver status line
const int YELLOW = 3, BLUE = 5, RED = 6;   // which Nano pin each light is on
// caregiver states: 0 = off duty, 1 = on duty, 2 = being alerted
int dadState = 1, momState = 0, nanState = 0;  // Dad starts on duty

void printStatusLine() {                   // prints Dad, Mom and Nan's numbers on one line
  Serial.print("Dad:"); Serial.print(dadState);   // Dad's number
  Serial.print(",Mom:"); Serial.print(momState);  // Mom's number
  Serial.print(",Nan:"); Serial.println(nanState); // Nan's number, then a new line
}                                          // end of printStatusLine()

void showFor(int seconds) {                // print the status line once a second
  for (int i = 0; i < seconds; i++) { printStatusLine(); delay(1000); }  // repeat for that many seconds
}                                          // end of showFor()

void setup() {                             // runs once
  pinMode(YELLOW, OUTPUT); pinMode(BLUE, OUTPUT); pinMode(RED, OUTPUT);  // all three light pins send power out
  Serial.begin(9600);                      // talk to my computer at 9600
}                                          // end of setup

void loop() {                              // a practice run of the story, so I can check each light
  digitalWrite(YELLOW, LOW); digitalWrite(BLUE, LOW); digitalWrite(RED, LOW);  // all lights off
  dadState = 1;                            // Dad on duty
  Serial.println("Status: all clear");     // all clear
  showFor(3);                              // wait 3 seconds

  digitalWrite(YELLOW, HIGH);              // yellow on
  Serial.println("Status: gas detected, waiting a few seconds to see if this is just passing gas");  // gas heads-up
  showFor(3);                              // wait 3 seconds

  digitalWrite(BLUE, HIGH);                // blue on
  Serial.println("Status: moisture detected");  // moisture heads-up
  showFor(3);                              // wait 3 seconds

  digitalWrite(RED, HIGH);                 // red on
  dadState = 2;                            // Dad is being alerted
  Serial.println("Status: poop confirmed. Dad alert: Henry's diaper needs changing");  // the real alert
  showFor(4);                              // wait 4 seconds, then start over
}                                          // end of loop

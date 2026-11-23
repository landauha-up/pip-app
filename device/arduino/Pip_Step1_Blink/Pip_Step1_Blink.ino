// Pip Step 1: blink test. The small orange light on my Nano blinks.
void setup() {                      // runs once when the Nano turns on
  pinMode(LED_BUILTIN, OUTPUT);     // the Nano's own light sends power out
  Serial.begin(9600);               // lets the Nano send text to my computer
}                                   // end of setup

void loop() {                       // runs over and over
  digitalWrite(LED_BUILTIN, HIGH);  // light on
  delay(500);                       // wait half a second
  digitalWrite(LED_BUILTIN, LOW);   // light off
  delay(500);                       // wait half a second
  Serial.println("Pip is alive");   // print a message to the Serial Monitor
}                                   // end of loop

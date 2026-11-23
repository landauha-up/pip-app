// Pip Step 6a: Wi-Fi test (Hannah Landau, IPD 5510)
// My Nano makes its own Wi-Fi network called "Pip". I join it on my phone and open 192.168.4.1.
// If my phone shows "Hello from Pip", the Wi-Fi works and I am ready for the full phone app.

#include <SPI.h>                            // lets the Nano talk to its built-in Wi-Fi chip
#include <WiFiNINA.h>                       // the Wi-Fi library for my Nano 33 IoT

// ===== SETTINGS I CAN CHANGE =====
const char* WIFI_NAME = "Pip";              // the network name my phone will see
const char* WIFI_PASS = "pipdemo123";       // the network password (has to be at least 8 characters)

WiFiServer server(80);                      // a tiny web server on the Nano (80 is the normal web port)

void setup() {                              // runs once when the Nano turns on
  Serial.begin(9600);                       // start talking to my computer at 9600
  delay(1500);                              // give the Serial Monitor a moment to open
  pinMode(LED_BUILTIN, OUTPUT);             // the Nano's small orange light, to show the network is up
  WiFi.config(IPAddress(192, 168, 4, 1));   // the address I will type on my phone
  int status = WiFi.beginAP(WIFI_NAME, WIFI_PASS);  // start my own Wi-Fi network
  if (status != WL_AP_LISTENING) {          // if the network did not start
    Serial.println("Could not start the Pip network. See the fix in Hannah's Step 6 notes.");  // tell me
    while (true) { delay(100); }            // stop here
  }                                         // end of the failed check
  server.begin();                           // start the web server
  digitalWrite(LED_BUILTIN, HIGH);          // orange light on = network is up
  Serial.println("Pip network is on. On my phone: join Wi-Fi 'Pip' (password pipdemo123), then open http://192.168.4.1");  // what to do next
}                                           // end of setup

void loop() {                               // runs over and over
  WiFiClient phone = server.available();    // check if a phone is asking for the page
  if (!phone) return;                       // nobody asking, so try again
  delay(50);                                // give the phone's request a moment to arrive
  while (phone.available()) phone.read();   // read and ignore what the phone asked for
  phone.print("HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nConnection: close\r\n\r\n");  // tell the phone a web page is coming
  phone.print("<meta name='viewport' content='width=device-width'>");  // make it fit my phone screen
  phone.print("<h1 style='font-family:sans-serif;color:#0E004A'>Hello from Pip</h1>");  // the message, in Pip's Deep Twilight
  phone.print("<p style='font-family:sans-serif'>Henry's diaper sensor is connected.</p>");  // a second line
  delay(2);                                 // let the page finish sending
  phone.stop();                             // done with this phone for now
  Serial.println("A phone opened the Pip page");  // tell me it worked
}                                           // end of loop

// Pip Step 6b: my Pip device + the Pip app on my phone (Hannah Landau, IPD 5510)
// Everything from Step 5 still works: the 3 lights, the 2 buttons, the sensors and the Serial Monitor.
// New: my Nano makes a Wi-Fi network called "Pip". On my phone I join it and open http://192.168.4.1
// That page is the Pip app. It shows Henry's status, and its "Can't right now" and "Diaper changed"
// buttons do the same thing as the buttons on my breadboard.
// Yellow light = gas sensed, blue light = moisture sensed (quiet heads-ups for whoever is on duty).
// Red light = poop confirmed (the real alert, and the only one that gets passed on).
// My demo shortcuts: type g, w or p in the Serial Monitor, or tap the DEMO ONLY buttons in the app.

#include <SPI.h>                            // lets the Nano talk to its built-in Wi-Fi chip
#include <WiFiNINA.h>                       // the Wi-Fi library for my Nano 33 IoT

// ===== SETTINGS I CAN CHANGE (times are in milliseconds: 1000 = 1 second) =====
const unsigned long POOP_MS = 20000UL;      // how long gas has to stay high before I call it poop (20 seconds)
const unsigned long PASS_MS = 90000UL;      // how long the alert waits for an answer before it goes to the next person (90 seconds)
const bool NEED_MOISTURE_TOO = false;       // false = gas alone can mean poop, true = poop needs gas AND moisture
const int GAS_RISE = 50;                    // how far the gas number has to climb above clean air to count as gas
const int WET_CHANGE = 100;                 // how far the moisture number has to move from dry to count as wet
const unsigned long WARMUP_MS = 90000UL;    // how long I let the gas sensor heat up before Pip starts watching (90 seconds)
const unsigned long REARM_MS = 15000UL;     // after "Diaper changed", how long I give myself to move the sanitizer away and wipe the probe (15 seconds)
const char* BABY = "Henry";                 // the baby's name in my scenario
const char* WIFI_NAME = "Pip";              // the Wi-Fi network name my phone will see
const char* WIFI_PASS = "pipdemo123";       // the Wi-Fi password (has to be at least 8 characters)

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
int state[4] = {0, 1, 0, 0};                // each person's number: 0 = off duty, 1 = on duty, 2 = being alerted
int alerted = 0;                            // who has the red alert right now: 0 = nobody, 1 Dad, 2 Mom, 3 Nan, 4 = everyone

// ===== THINGS PIP KEEPS TRACK OF =====
int gas = 0;                                // the newest gas reading (0 to 1023, higher = more gas)
int gasBase = 0;                            // the gas reading in clean air, saved after warm-up
int wet = 0;                                // the newest moisture reading (about 1015 when dry, drops when wet)
int wetBase = 0;                            // the moisture reading when dry, saved after warm-up
bool ready = false;                         // false while warming up, true once Pip is watching
bool armed = true;                          // false for a few seconds right after a change, then Pip relearns clean air and watches again
bool gasOn = false;                         // true while the yellow gas heads-up is on
bool wetOn = false;                         // true while the blue moisture heads-up is on
bool poop = false;                          // true once Pip has decided it is poop (red is on)
bool fakeGas = false;                       // true after I type g (or tap Fake gas), to pretend there is gas
bool fakeWet = false;                       // true after I type w (or tap Fake moisture), to pretend there is moisture
unsigned long gasStart = 0;                 // the time the gas first went high, to count toward the poop decision
unsigned long alertStart = 0;               // the time the current person got the red alert, for the pass-on timer
unsigned long lastLine = 0;                 // the time I last printed the status line, so it prints once a second
unsigned long lastChangeAt = 0;             // the time of the last diaper change, for "last change" and the restart countdown
String lastChangeBy = "";                   // who did the last change ("" = no change yet)
int changesToday = 0;                       // how many changes since I turned Pip on
String lastMsg = "Pip is warming up";       // the newest status message, shown in the app

WiFiServer server(80);                      // a tiny web server on the Nano (80 is the normal web port)

// ===== MY HELPER STEPS =====
void note(String text) {                    // prints a status message and saves it for the app
  Serial.print("Status: ");                 // every message starts with "Status:"
  Serial.println(text);                     // then the message
  lastMsg = text;                           // the app shows the newest one
}                                           // end of note()

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

void alertPerson(int p) {                   // sends the red alert to one person
  alerted = p;                              // remember who has the alert now
  state[p] = 2;                             // their number becomes 2 (being alerted)
  alertStart = millis();                    // start their pass-on clock
  note(String(NAMES[p]) + " alert: poop sensed. " + BABY + "'s diaper needs changing");  // the alert message
}                                           // end of alertPerson()

void passOn(String why) {                   // moves the red alert to the next person
  if (alerted < 1 || alerted > 3) return;   // only works while one person has the alert
  Serial.println(String("Status: ") + NAMES[alerted] + " " + why);  // who passed it and why
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
    note("Everyone alert: nobody has answered yet");  // tell everyone
  }                                         // end of the everyone case
}                                           // end of passOn()

void startPoopAlert() {                     // what happens when Pip decides it is poop
  if (poop) return;                         // already alerting, so do nothing
  poop = true;                              // remember that it is poop
  digitalWrite(YELLOW, HIGH);               // yellow stays on (there is gas)
  digitalWrite(RED, HIGH);                  // turn on the red light
  alertPerson(ON_DUTY);                     // alert whoever is on duty first
}                                           // end of startPoopAlert()

void diaperChanged() {                      // what happens when someone presses "Diaper changed"
  String who = (alerted >= 1 && alerted <= 3) ? NAMES[alerted] : NAMES[ON_DUTY];  // whoever had the alert gets credit
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
  armed = false;                            // pause for a few seconds, then relearn clean air (see the loop)
  lastChangeAt = millis();                  // remember when
  lastChangeBy = who;                       // remember who
  changesToday++;                           // add one to today's count
  note("Diaper changed by " + who + ". Alerts off. Pip starts watching again in " + String(REARM_MS / 1000) + " seconds");  // tell everyone
}                                           // end of diaperChanged()

void doAction(char c) {                     // one place for every action, from the Serial Monitor or the app
  if (c == 'g') { fakeGas = true; Serial.println("(demo) fake gas on"); }  // g = pretend there is gas
  if (c == 'w') { fakeWet = !fakeWet; Serial.println(fakeWet ? "(demo) fake moisture on" : "(demo) fake moisture off"); }  // w = pretend wet, w again = dry
  if (c == 'p') { Serial.println("(demo) fake poop"); startPoopAlert(); }  // p = skip straight to poop
  if (c == 'c') passOn("can't right now");  // c = "Can't right now" from the app
  if (c == 'd') diaperChanged();            // d = "Diaper changed" from the app
}                                           // end of doAction()

// ===== THE PIP APP PAGE (what my phone shows) =====
// This is a web page stored inside the Nano. My phone asks the Nano for an update every second.
const char PAGE[] = R"PIP(<!doctype html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Pip</title>
<style>
body{margin:0;background:#FBFAF8;color:#3D3570;font:16px/1.4 -apple-system,Segoe UI,Roboto,sans-serif}
.wrap{max-width:420px;margin:0 auto;padding:18px}
h1{font:700 34px Georgia,serif;color:#0E004A;margin:14px 0 0}
.duty{background:#CCE5FF;border-radius:14px;padding:10px 14px;margin:12px 0;color:#0E004A}
.card{border-radius:18px;padding:22px;margin:12px 0;background:#DDEAF8;border:1px solid #977E6E}
.card.alert{background:#FFF1B8;color:#5E4B3F}
.card h2{font:700 24px Georgia,serif;margin:0 0 6px;color:inherit}
.btn{display:block;width:100%;padding:16px;margin:8px 0;border-radius:14px;border:0;font-size:18px;font-weight:700}
.cant{background:#fff;color:#0E004A;border:2px solid #0E004A}.done{background:#0E004A;color:#fff}
.row{display:flex;gap:10px}.mini{flex:1;background:#fff;border:1px solid #977E6E;border-radius:14px;padding:12px}
.mini b{display:block;font-size:20px;color:#0E004A}
.fam{display:flex;gap:8px;margin:12px 0}.who{flex:1;text-align:center;border-radius:12px;padding:8px;background:#fff;border:1px solid #977E6E}
.who.on{background:#CCE5FF}.who.al{background:#FFF1B8;color:#5E4B3F;font-weight:700}
.demo{background:#222;color:#fff;border-radius:14px;padding:12px;margin-top:18px}
.demo button{background:#444;color:#fff;border:0;border-radius:10px;padding:10px;margin:4px 4px 0 0;font-size:15px}
.sound{background:#0E004A;color:#fff;text-align:center;padding:10px;border-radius:12px}
</style></head><body><div class="wrap">
<div class="sound" id="sound" onclick="unlock()">Tap here once so Pip can make a sound</div>
<h1>Pip</h1>
<div class="duty" id="duty">Dad is on duty</div>
<div class="card" id="card"><h2 id="title">Connecting</h2><div id="sub">Looking for Pip</div></div>
<div id="btns" style="display:none">
<button class="btn cant" onclick="act('c')">Can't right now</button>
<button class="btn done" onclick="act('d')">Diaper changed</button></div>
<div class="row"><div class="mini"><b id="last">None yet</b>Last change</div><div class="mini"><b id="count">0</b>Changes today</div></div>
<div class="fam"><div class="who" id="p1">Dad</div><div class="who" id="p2">Mom</div><div class="who" id="p3">Nan</div></div>
<div class="demo">DEMO ONLY<br><button onclick="act('g')">Fake gas</button><button onclick="act('w')">Fake moisture</button><button onclick="act('p')">Fake poop</button></div>
</div><script>
var names=["","Dad","Mom","Nan"],ctx=null,lastAlert=0;
function unlock(){ctx=new (window.AudioContext||window.webkitAudioContext)();document.getElementById("sound").style.display="none";}
function beep(){if(!ctx)return;[0,0.35].forEach(function(t){var o=ctx.createOscillator(),g=ctx.createGain();o.frequency.value=660;g.gain.value=0.15;o.connect(g);g.connect(ctx.destination);o.start(ctx.currentTime+t);o.stop(ctx.currentTime+t+0.2);});if(navigator.vibrate)navigator.vibrate([200,100,200]);}
function act(c){fetch("/a?"+c).then(load);}
function ago(s){if(s<60)return s+" s ago";return Math.round(s/60)+" min ago";}
function load(){fetch("/s").then(function(r){return r.json();}).then(show).catch(function(){document.getElementById("title").textContent="Not connected";document.getElementById("sub").textContent="Join the Pip Wi-Fi network";});}
function show(d){
var card=document.getElementById("card"),t="",s="",alert=false;
if(!d.ready){t="Pip is warming up";s=d.warm+" seconds until Pip starts watching "+d.baby;}
else if(d.alerted==4){t="Everyone alerted";s=d.baby+" needs a change and nobody has answered yet";alert=true;}
else if(d.alerted>0){t=d.alerted==1?d.baby+" needs a change":"Sent to "+names[d.alerted];s=d.alerted==1?"Poop sensed. You're on duty.":names[d.alerted]+" has the alert now. You can still mark it changed.";alert=true;}
else if(!d.armed){t="Changed";s="Move the sanitizer away and wipe the probe. Pip starts watching again in a few seconds";}
else if(d.gasOn&&d.wetOn){t="Gas and moisture sensed";s="Waiting a few seconds to see if this is just passing gas";}
else if(d.gasOn){t="Gas sensed";s="Waiting a few seconds to see if this is just passing gas";}
else if(d.wetOn){t="Moisture sensed";s=d.baby+"'s diaper is a little wet";}
else{t="All clear";s=d.baby+"'s diaper is clean";}
document.getElementById("title").textContent=t;document.getElementById("sub").textContent=s;
card.className=alert?"card alert":"card";
document.getElementById("btns").style.display=(d.alerted>0)?"block":"none";
document.getElementById("last").textContent=d.lastBy?d.lastBy+", "+ago(d.lastAgo):"None yet";
document.getElementById("count").textContent=d.count;
for(var i=1;i<=3;i++){var e=document.getElementById("p"+i);e.className="who"+(d.st[i-1]==2?" al":d.st[i-1]==1?" on":"");e.textContent=names[i]+(d.st[i-1]==2?" alerted":d.st[i-1]==1?" on duty":"");}
if(d.alerted>0&&lastAlert!=d.alerted)beep();lastAlert=d.alerted;}
load();setInterval(load,1000);
</script></body></html>)PIP";

void sendPage(WiFiClient& phone) {          // sends the app page to a phone
  phone.print("HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nConnection: close\r\n\r\n");  // tell the phone a web page is coming
  const char* p = PAGE;                     // start at the beginning of the page
  size_t left = strlen(PAGE);               // how much is left to send
  while (left > 0) {                        // keep sending until it is all sent
    size_t n = left > 512 ? 512 : left;     // send it in small pieces (the Wi-Fi chip likes that)
    phone.write((const uint8_t*)p, n);      // send one piece
    p += n;                                 // move forward
    left -= n;                              // less left to send
  }                                         // end of sending
}                                           // end of sendPage()

void sendStatus(WiFiClient& phone) {        // sends Henry's status to the app as a short text (JSON)
  String j = "{";                           // start the status text
  j += "\"ready\":" + String(ready ? 1 : 0);  // warming up or watching
  j += ",\"warm\":" + String(ready ? 0 : (long)((WARMUP_MS - millis()) / 1000));  // seconds of warm-up left
  j += ",\"armed\":" + String(armed ? 1 : 0);  // watching again after a change?
  j += ",\"gasOn\":" + String(gasOn ? 1 : 0);  // yellow on?
  j += ",\"wetOn\":" + String(wetOn ? 1 : 0);  // blue on?
  j += ",\"alerted\":" + String(alerted);   // who has the red alert
  j += ",\"st\":[" + String(state[1]) + "," + String(state[2]) + "," + String(state[3]) + "]";  // Dad, Mom, Nan numbers
  j += ",\"lastBy\":\"" + lastChangeBy + "\"";  // who did the last change
  j += ",\"lastAgo\":" + String((millis() - lastChangeAt) / 1000);  // seconds since the last change
  j += ",\"count\":" + String(changesToday);  // changes today
  j += ",\"baby\":\"" + String(BABY) + "\"";  // the baby's name
  j += ",\"gas\":" + String(gas);           // the gas reading
  j += ",\"msg\":\"" + lastMsg + "\"";      // the newest status message
  j += "}";                                 // end of the status text
  phone.print("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n");  // tell the phone status is coming
  phone.print(j);                           // send it
}                                           // end of sendStatus()

void handlePhone() {                        // answers a phone if one is asking for something
  WiFiClient phone = server.available();    // check if a phone is asking
  if (!phone) return;                       // nobody asking
  String request = "";                      // the first line of what the phone asked, like "GET /s HTTP/1.1"
  unsigned long start = millis();           // when I started listening
  while (phone.connected() && millis() - start < 500) {  // listen for up to half a second
    if (!phone.available()) continue;       // nothing new yet
    char ch = phone.read();                 // read one letter
    if (ch == '\n') break;                  // the first line is done
    request += ch;                          // add the letter to the request
  }                                         // end of listening
  while (phone.available()) phone.read();   // skip the rest of what the phone sent
  if (request.startsWith("GET /s")) sendStatus(phone);  // the app wants Henry's status
  else if (request.startsWith("GET /a?")) {  // the app tapped a button
    doAction(request.charAt(7));            // the letter after "/a?" says which button
    sendStatus(phone);                      // send the new status right away
  } else sendPage(phone);                   // anything else gets the app page
  delay(2);                                 // let it finish sending
  phone.stop();                             // done with this phone for now
}                                           // end of handlePhone()

// ===== SETUP: RUNS ONCE WHEN THE NANO TURNS ON =====
void setup() {                              // start of setup
  pinMode(YELLOW, OUTPUT);                  // the yellow light pin sends power out
  pinMode(BLUE, OUTPUT);                    // the blue light pin sends power out
  pinMode(RED, OUTPUT);                     // the red light pin sends power out
  pinMode(CANT_BTN, INPUT_PULLUP);          // the "Can't right now" pin listens, using the Nano's built-in resistor
  pinMode(CHANGED_BTN, INPUT_PULLUP);       // the "Diaper changed" pin listens the same way
  Serial.begin(9600);                       // start talking to my computer at 9600
  delay(1500);                              // give the Serial Monitor a moment to open
  WiFi.config(IPAddress(192, 168, 4, 1));   // the address I type on my phone
  if (WiFi.beginAP(WIFI_NAME, WIFI_PASS) != WL_AP_LISTENING) {  // start my own Wi-Fi network
    Serial.println("Could not start the Pip network. Pip still works without the app.");  // the lights and buttons still work
  } else {                                  // the network started
    server.begin();                         // start the web server
    Serial.println("Pip network is on. On my phone: join Wi-Fi 'Pip' (password pipdemo123), then open http://192.168.4.1");  // what to do
  }                                         // end of the network check
}                                           // end of setup

// ===== LOOP: RUNS OVER AND OVER, MANY TIMES A SECOND =====
void loop() {                               // start of loop
  gas = analogRead(GAS_PIN);                // read the gas sensor
  wet = analogRead(WET_PIN);                // read the moisture sensor

  while (Serial.available()) doAction(Serial.read());  // my typed demo shortcuts (g, w, p)
  handlePhone();                            // answer the phone app

  if (!ready) {                             // if the gas sensor is still heating up
    bool blinkOn = (millis() / 1000) % 2;   // switches between on and off every second
    if (!poop) digitalWrite(YELLOW, blinkOn);  // yellow blinks while warming up
    digitalWrite(BLUE, blinkOn);            // blue blinks with it
    if (millis() >= WARMUP_MS) {            // once the warm-up time is over
      gasBase = gas;                        // save this gas reading as clean air
      wetBase = wet;                        // save this moisture reading as dry
      ready = true;                         // Pip starts watching
      if (!poop) digitalWrite(YELLOW, LOW); // yellow off
      digitalWrite(BLUE, LOW);              // blue off
      note("Pip is ready. Clean air gas = " + String(gasBase) + ", dry moisture reading = " + String(wetBase));  // tell me
    }                                       // end of the warm-up check
  } else {                                  // Pip is warmed up and watching
    bool gasHigh = fakeGas || gas > gasBase + GAS_RISE;          // gas is high (or I faked it)
    bool gasLow = !fakeGas && gas < gasBase + GAS_RISE / 2;      // gas has come back down about halfway
    bool wetHigh = fakeWet || abs(wet - wetBase) > WET_CHANGE;   // the probe is wet (or I faked it)
    bool wetLow = !fakeWet && abs(wet - wetBase) < WET_CHANGE / 2;  // the probe is close to dry again

    if (!armed) {                           // right after a change
      if (millis() - lastChangeAt >= REARM_MS) {  // once the pause is over (sanitizer moved, probe wiped)
        gasBase = gas;                      // relearn clean air from right now, so leftover smell does not count
        wetBase = wet;                      // relearn dry from right now
        armed = true;                       // start watching again, no reset button needed
        note(String(NAMES[ON_DUTY]) + ": Pip is watching again. New clean air gas = " + String(gasBase));  // tell the on-duty person
      }                                     // end of the pause check
    } else if (!poop) {                     // watching, and no poop yet
      if (!gasOn && !fakeGas && gas < gasBase) gasBase = gas;  // if the air keeps getting cleaner, follow it down so Pip stays sensitive
      if (!gasOn && gasHigh) {              // gas just went high
        gasOn = true;                       // remember the gas heads-up is on
        gasStart = millis();                // start counting toward the poop decision
        digitalWrite(YELLOW, HIGH);         // yellow on
        note(String(NAMES[ON_DUTY]) + ": gas sensed, waiting a few seconds to see if this is just passing gas");  // quiet heads-up
      } else if (gasOn && gasLow) {         // gas went away before it counted as poop
        gasOn = false;                      // gas heads-up off
        digitalWrite(YELLOW, LOW);          // yellow off
        note(String(NAMES[ON_DUTY]) + ": gas cleared, just passing gas");  // tell the on-duty person
      }                                     // end of the gas check
      if (!wetOn && wetHigh) {              // the probe just got wet
        wetOn = true;                       // remember the moisture heads-up is on
        digitalWrite(BLUE, HIGH);           // blue on
        note(String(NAMES[ON_DUTY]) + ": moisture sensed in the diaper");  // quiet heads-up
      } else if (wetOn && wetLow) {         // the probe dried off
        wetOn = false;                      // moisture heads-up off
        digitalWrite(BLUE, LOW);            // blue off
        note(String(NAMES[ON_DUTY]) + ": moisture cleared");  // tell the on-duty person
      }                                     // end of the moisture check
      bool longEnough = gasOn && millis() - gasStart >= POOP_MS;  // has the gas stayed high long enough?
      if (longEnough && (!NEED_MOISTURE_TOO || wetOn)) startPoopAlert();  // if yes (plus moisture, if I asked for that), it is poop
    }                                       // end of watching
  }                                         // end of warmed-up part

  if (pressed(CANT_BTN)) passOn("can't right now");  // breadboard "Can't right now" passes it on
  if (alerted >= 1 && alerted <= 3 && millis() - alertStart >= PASS_MS) passOn("didn't answer in time");  // no answer in time passes it on
  if (pressed(CHANGED_BTN)) diaperChanged();  // breadboard "Diaper changed" clears everything

  if (millis() - lastLine >= 1000) {        // once a second
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

# Pip device MVP (Arduino)

The working breadboard prototype of the Pip diaper sensor, built with an Arduino Nano 33 IoT and kit parts. Nothing is soldered.

- **Circuit guide:** [guide/Pip_Circuit_Guide.pdf](guide/Pip_Circuit_Guide.pdf) shows the breadboard, with a numbered table of what each part is, where it plugs in and what it represents in Pip.
- **Lights:** yellow means gas sensed and blue means moisture sensed. These are quiet heads-ups for the person on duty. Red means poop confirmed (the gas stayed high), which is the real alert and the only one that gets passed on.
- **Buttons:** D8 is "Can't right now" and passes the alert from Dad to Mom, then Nan, then everyone. D7 is "Diaper changed".

## Code, in build order
Every line is commented. Each sketch is its own folder, so it opens directly in the Arduino IDE.

| Sketch | What it adds |
|---|---|
| `arduino/Pip_Step1_Blink` | Checks the Nano and the upload |
| `arduino/Pip_Step2_Lights` | The yellow, blue and red lights, plus the Dad/Mom/Nan status line |
| `arduino/Pip_Step3_Buttons` | "Can't right now" and "Diaper changed" |
| `arduino/Pip_Step4_Sensors` | MQ-2 gas sensor on A0 and the moisture probe on A1 |
| `arduino/Pip_Step5_Full` | The full Pip logic, with no Wi-Fi |
| `arduino/Pip_Step6a_WiFi_Test` | The Nano makes the "Pip" Wi-Fi network |
| `arduino/Pip_Step6b_Phone_App` | **Full version:** the device plus the Pip app on a phone |

## Running the phone app version
1. **Libraries:** install **WiFiNINA** from the Arduino Library Manager.
2. **Upload:** upload `Pip_Step6b_Phone_App`.
3. **Connect a phone:** join the Wi-Fi network **Pip** (password `pipdemo123`), then open http://192.168.4.1.

The phone page is served by the Nano itself, so it works with no internet. The settings at the top of each sketch (the poop time, the pass-on time and the sensitivity) can be changed.

AI use: I used AI to help refine my thoughts and organize things, including the circuit diagram and the code.

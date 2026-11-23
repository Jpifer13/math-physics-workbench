# Tablets, the web build and the Scratchpad

The desktop app is built on Electron, which does not run on iPadOS or Android.
For tablets the same interface is built as a static website that can be added
to the home screen and then opens like an app, offline included. There is no
server-side part: anyone can host their own copy by serving a folder of files.

## Build and serve

```bash
npm install
npm run setup:handwriting   # optional: fetch the on-device handwriting model (about 100 MB)
npm run build:web           # writes the site to dist-web/
npm run serve:web           # serves it on this machine and on the local network
```

`dist-web/` is self-contained and uses relative paths, so it can be copied to
any static host, at the root of a site or in a sub-folder.

### Trying it on an iPad

On the same Wi-Fi network, open the "Network" address that `npm run serve:web`
prints (for example `http://192.168.1.20:4173`) in Safari. Everything works
over plain HTTP on a local network, including the handwriting model, with one
exception: **installing for offline use needs HTTPS.** Browsers only allow the
offline cache on secure pages, so for a home-screen app that opens without a
connection, put `dist-web/` on an HTTPS host (GitHub Pages, Netlify, your own
server) and then use Share → Add to Home Screen.

## The native iPad app

The same web build can be packaged as a real iPad app with
[Capacitor](https://capacitorjs.com). The Xcode project lives in `ios/`. The
app carries the interface and the handwriting model inside its bundle, so it
needs no hosting and works offline from the first launch.

```bash
npm run setup:handwriting   # once, if the app should read handwriting
npm run build:ios           # builds dist-web/ and copies it into the Xcode project
npm run open:ios            # opens ios/App/App.xcodeproj in Xcode
```

In Xcode, choose an iPad simulator or a connected iPad and press Run. For a
real device, select the App target → Signing & Capabilities, tick
"Automatically manage signing" and pick your team; the bundle identifier is
`io.mathphysicsworkbench.app`. From the command line, for a simulator:

```bash
xcodebuild -project ios/App/App.xcodeproj -scheme App -sdk iphonesimulator \
  -destination "platform=iOS Simulator,name=iPad Air 11-inch (M4)" -derivedDataPath build/ios build
xcrun simctl boot "iPad Air 11-inch (M4)"
xcrun simctl install booted build/ios/Build/Products/Debug-iphonesimulator/App.app
xcrun simctl launch booted io.mathphysicsworkbench.app
```

Run `npm run build:ios` again after any change to the interface; the copy of
the web files inside `ios/` is generated and not kept in the repository.

In the app, Save and Export open the share sheet (choose "Save to Files"),
because a web view has no downloads. Open uses the system file picker.

## The Scratchpad

A page to write mathematics on with a pen. Each written line is read, typeset
in the panel beside the page, and worked out:

| Write | What happens |
|---|---|
| `3 + 4 =` | the value appears after the equals sign |
| `g = 9.81` | `g` has that value everywhere on the page |
| `F = m g` | `F` is worked out once `m` has a value, wherever that is written |
| `x^2 - 5x + 6 = 0` | one unknown, so it is solved (numerically, real roots between −1000 and 1000) |
| `f(x) = x^2` | defines a function; `f(3) =` then gives 9 |
| `∫₀¹ x² dx`, `Σ`, `Π` | definite integrals, sums and products are evaluated |
| `d/dx x³` | differentiated, symbolically if `x` has no value |
| `m ẍ = −k x`, `x(0) = 1` | differential equations become a model: **Open in Simulations** |

A pen (or mouse) always writes. A finger writes until a pen is first used and
scrolls after that; the "Write with a finger" box changes it back. Two fingers
always scroll. The far end of a stylus, or the Rubber tool, erases whole
strokes.

Lines are separated by vertical gaps, so leave a clear space between them; the
ruled lines help. If a line is misread, **Correct** lets you type what it says
(LaTeX or plain `x^2 + 1`). A correction belongs to the ink as it stands and
is dropped if you add to or change that line.

Not supported yet: symbolic solving, systems of several equations,
inequalities, complex numbers, indefinite integrals, limits, saving a page to
a file (the page is kept in the browser's storage on that device only).

## How handwriting is read

There are three settings, under **Handwriting…** in the Scratchpad.

**On this device** (the default). A model shipped inside the build reads each
line locally; nothing written leaves the device. It is present only if
`npm run setup:handwriting` was run before building. It needs roughly 100 MB of
download once, then is kept by the browser.

**A service I choose.** For people who want better recognition than the
built-in model and accept sending pictures of their writing to a third party.
The app has no service of its own. The contract is small enough to put any
provider behind a few lines of glue code:

```
POST <address>                    Content-Type: image/png, body = picture of one line
Authorization: Bearer <key>       only if a key was entered
→ 200  {"latex": "x^2 + 1"}       (or the LaTeX as plain text)
```

The web build refuses all connections except to its own host unless it is
built to allow more. List the permitted service addresses at build time:

```bash
RECOGNITION_ORIGINS="https://recognise.example.org" npm run build:web
```

The service must also send CORS headers permitting the site.

**Off.** Nothing is read; type what a line says when you want it worked out.

## The built-in model, and its licence

The model is FormulaNet from the [Texo](https://github.com/alephpi/Texo)
project (about 20 million parameters), run with onnxruntime-web through
transformers.js. It is downloaded by the setup script and is **not** part of
this repository.

Before publishing a build that includes it, know that:

- Its code and weights are licensed AGPL-3.0, which is compatible with this
  project's licence.
- Its handwriting ability comes from training on research datasets (CROHME,
  HME100K) whose terms are non-commercial. Whether that restricts the trained
  weights is legally unsettled. For personal use and non-commercial hosting
  this is of little concern; anyone hosting a build commercially should take
  their own advice or build without the model.

Set `HANDWRITING_MODEL_URL` to fetch the same file layout from somewhere else,
for example a mirror or a different model exported the same way.

## What has and has not been checked

Checked with scripted WebKit and Chromium on macOS, drawing strokes with a
simulated pointer against the production build: the model loads under the
build's security policy, lines are read and answered in one to two seconds,
and the portrait and landscape layouts hold.

Also checked in Safari on the iPad Air 11-inch simulator (iPadOS 27.0), with
strokes loaded into the page rather than drawn: the model loads and reads them
correctly. The simulator borrows the Mac's memory and processor, so this says
nothing about memory limits or speed on a tablet.

The native app was built and run on the same simulator: it launches, the
simulation workspace runs, and the model loads from the app bundle and reads
pre-loaded strokes correctly.

**Not checked in the native app:** the share sheet for Save and Export
(written, never tapped through), opening a file, signing and installing on a
device, TestFlight and App Store submission.

**Not checked: a real iPad.** In particular: Apple Pencil pressure and palm
rejection, whether the model fits in Safari's memory on older iPads (it uses a
few hundred megabytes while loaded), reading speed on tablet hardware, and
recognition quality on real handwriting, which will be worse than on the tidy
test strokes. Android tablets are untested. The Scratchpad appears in the
desktop app too, but without recognition: the desktop build does not load the
model yet.

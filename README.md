# University Timetable

A customizable university timetable for Android and the web. The interface is available in French, English, and Arabic. Timetables are stored on the device and remain available offline.

> **Vibecoded APK:** this app was built collaboratively with AI coding tools. Please test it on your own device before relying on reminders or timetable imports.

## Features

- Multiple timetables/groups with editable names, duplication, and deletion.
- A customizable weekly grid: add, rename, reorder by weekday, or remove days and time slots.
- Create, edit, duplicate, and delete lectures, tutorials, labs, and electives.
- Long-press and drag classes to empty slots or onto another class to swap them; undo and redo changes.
- Subject colors, search by subject/teacher/room/type/day/time/notes, and week/day views.
- Teacher and room conflict detection, current/next class banner, and weekly subject-hour statistics.
- On-device French and English OCR for JPG, PNG, and WebP images, with an editable preview. No AI subscription, API key, account, or network connection is required for OCR.
- Direct in-app camera capture on Android.
- JPG/PDF export, scan effect, and JSON backup/restore.
- Local class reminders, light/dark/system themes, Arabic right-to-left layout, and a clean capture mode.
- Local persistence using Capacitor Preferences on Android and local storage on the web.

## Move classes

Long-press a class and drag it to an empty slot to move it, or onto another class to swap them. The destination is highlighted during the gesture. Use **Undo** and **Redo** to reverse changes. With a keyboard, focus a class, press Space, use the arrow keys to choose a destination, and press Space again to confirm or Escape to cancel. On small screens, switch to Day view to avoid horizontal scrolling.

## Import timetable images

Choose **Import a photo** to select an existing JPG, PNG, or WebP image, or **Camera** to take a new photo directly on Android. OCR runs on the device using bundled Tesseract WebAssembly and French/English language data. Review and correct the detected classes before applying them. A sharp, well-lit, straight-on photo improves recognition. PDF import is not supported by local OCR; capture the relevant PDF page as an image first.

The app does not send timetable images to a cloud AI service. OCR works without an account, subscription, API key, or internet connection.

## Notifications

Enable reminders in **Settings** and grant Android notification and exact-alarm access when requested. Reminders are scheduled locally for the next 14 days, refreshed when the timetable changes and when the app returns to the foreground, and restored by the Capacitor plugin after device reboot.

Android notification delivery cannot be guaranteed on every device: users can revoke permissions, and battery optimizers or manufacturer-specific background restrictions may delay or suppress alarms. Exempt the app from battery optimization if the device continues to delay reminders.

## Requirements

- Node.js 20 or later.
- JDK 17.
- Android SDK Platform 36, Build Tools 36, and Android Studio for device/emulator testing.

## Web development

```sh
npm ci
npm run dev
```

To run the static checks and create the web build:

```sh
npm run lint
npm run build
```

## Build a debug APK on Windows

The Capacitor Android project is already initialized. The build script uses `JAVA_HOME` when it points to a supported JDK, or searches common Android Studio/JDK locations on Windows.

```powershell
npm ci
npm run apk
```

The script builds the web app, syncs Capacitor plugins, and runs `gradlew assembleDebug`. The APK is written to:

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

The same steps can be run separately:

```powershell
npm run build
npx cap sync android
cd android
.\gradlew.bat assembleDebug
```

Open the `android/` directory in Android Studio to run the app on a device or emulator.

## GitHub Actions

The workflow in `.github/workflows/apk.yml` builds with Node 20, Java 17, and Android SDK 36 on pushes to `main`/`master`, pull requests, or manual dispatch. It uploads the debug APK as the `app-debug` artifact.

## Signed release APK

Never commit a keystore or its passwords. Create a local keystore with:

```sh
keytool -genkeypair -v -keystore university-timetable-release.jks -keyalg RSA -keysize 2048 -validity 10000 -alias university-timetable
```

Keep the keystore and password in a secure location. Configure release signing with environment variables or CI secrets in `android/app/build.gradle` before distributing a release APK. `npm run apk:release` can assemble an unsigned release, but that build is not suitable for distribution.

## Recommended device checks

- Test touch drag-and-drop, swaps, undo/redo, and haptic feedback on a physical phone.
- Test camera permission, direct capture, and OCR with different image qualities, including offline.
- Grant and revoke notification/exact-alarm access; test reminders after a reboot and with battery optimization enabled.
- Test JPG/PDF/JSON sharing and restore a backup.
- Check safe areas, keyboard behavior, themes, Arabic right-to-left layout, and screen rotation on different display sizes.

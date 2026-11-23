# Pip

Pip tells the on-duty caregiver when the baby's diaper needs a change.

Demo prototype for IPD 5510 Digital Prototype Demo Day (Hannah Landau). Live at https://landauha-up.github.io/pip-app/

**Backup screen recording (2 min):** https://landauha-up.github.io/pip-app/video/ (file: [`video/Pip_backup_recording.mp4`](video/Pip_backup_recording.mp4))

## What works
1. **Who's on duty.** Plan shifts by the day (a timeline where you tap to add and drag an edge to stretch) or by the week (a grid where you tap a box). Faded shifts are Pip's suggestions, based on who covered the same time on 2 or more recent days. Double-tap one to confirm it. "Not Mom" / "Not Dad" marks quick times when someone can't, for example a last-minute meeting.
2. **Know right away.** When the Pip senses a soiled diaper, only the on-duty person gets the alert. They can tap Changed, Can't right now, or False alarm.
3. **Handoff.** If they can't come or don't answer, the alert passes down the backup order. If nobody answers, it goes to everyone.

## Sample data and privacy
Henry, Mom, Dad and Nan are a pretend family. No real baby, health or personal data is used. Everything is stored only in the visitor's own browser (localStorage). The Pip device is simulated with the **Simulate** button, which can do soiled diaper, brief gas, the Pip button, disconnect and low battery. To start over, go to Settings and choose Reset demo data.

## Physical device
The working Arduino prototype of the Pip device (circuit guide and commented code) is in [`device/`](device/README.md).

## Files
Plain HTML, CSS and JavaScript, with no build step: `index.html`, `style.css`, `app.js`.

AI use: built with Claude Code from Hannah's PRD and build spec.

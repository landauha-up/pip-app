# Pip

Pip tells the on-duty caregiver when the baby's diaper needs a change.

Demo prototype for IPD 5510 Digital Prototype Demo Day (Hannah Landau). Live at https://landauha-up.github.io/pip-app/

## What works
1. **Who's on duty.** Plan the day's shifts on a timeline: tap to add, drag an edge to stretch, share a shift, repeat every day, and confirm suggested shifts.
2. **Know right away.** When the Pip senses a soiled diaper, only the on-duty person gets the alert. They can tap Changed, Can't right now, or False alarm.
3. **Handoff.** If they can't come or don't answer, the alert passes down the backup order. If nobody answers, it goes to everyone.

## Sample data and privacy
Henry, Mom, Dad and Nan are a pretend family. No real baby, health or personal data is used. Everything is stored only in the visitor's own browser (localStorage). The Pip device is simulated with the **Simulate** button, which can do soiled diaper, brief gas, the Pip button, disconnect and low battery. To start over, go to Settings and choose Reset demo data.

## Files
Plain HTML, CSS and JavaScript, with no build step: `index.html`, `style.css`, `app.js`.

AI use: built with Claude Code from Hannah's PRD and build spec.

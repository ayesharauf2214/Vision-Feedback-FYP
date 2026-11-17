# Round 2: Dark Mode, Working Settings, Dashboard Reorder, and Two Real Bug Fixes

This zip contains the **full current state** of every file that's been changed so
far (the Sales Analytics feature from before, plus everything below). Just copy
all 9 files over your project at the same paths again — overwriting is safe,
you don't need to track two separate patches.

## 1. Dark / Light mode — now actually functional

Before, the toggle only changed the page background color. Now it:
- Switches the whole UI (cards, sidebar, navbar, tables, inputs, charts) to a
  proper dark theme via `body.dark-mode`.
- Persists your choice in `localStorage`, so it survives a page refresh.
- Re-themes Chart.js chart text/grid lines so charts stay readable in dark mode
  (previously chart text would have stayed dark-on-dark).

## 2. Settings / Profile page — now actually functional

- **Save Changes** now calls a real backend endpoint
  (`PUT /api/auth/update-profile`) and updates your session immediately.
- **Email is intentionally not editable.** It's the key used to link surveys,
  datasets, and responses throughout the whole app — changing it would orphan
  that data. Name, phone, address, department, semester, course are all
  editable.
- **Upload Photo / Upload Logo now works.** New endpoint
  `POST /api/auth/upload-avatar` stores the image under
  `backend/uploads/avatars/` and saves the URL on your user record. Your
  avatar now shows up in the sidebar and on the Profile page everywhere.
  (5MB limit, images only — both enforced client- and server-side.)

## 3. Dashboard reordered + a bit more presentable

- **Sales Insights now appears at the top** of the dashboard, survey
  regression charts below it (was the other way around).
- Added a "Welcome back, {name}" header with today's date.
- Renamed "Recent charts" to "Survey Regression Charts" so the two sections
  read clearly as separate things.

## 4. Fixed: "Please answer: [question]" error on a question you did answer

This was a real bug, not a fluke. Two things were wrong in `form-fill.js`:

- **Answers were keyed by the question's literal text**, not a unique ID. If
  two questions anywhere in the form share the same wording (very plausible
  for boilerplate Likert phrasing reused across sections — which looks like
  exactly what happened with "the responsibility for big data analytics
  development is clear"), answering one could interfere with validating the
  other. Answers are now keyed by the question's own database ID instead.
- **A Likert option with the literal value `0` would silently turn into an
  empty string** (`0 || ''` evaluates to `''` in JS, since `0` is falsy),
  making a correctly-clicked answer register as blank. Fixed to only treat
  `null`/`undefined` as empty, not `0` or `false`.

I wrote a synthetic test reproducing the duplicate-question-text scenario and
confirmed section 2 now validates correctly once answered, and that a `0`
option no longer disappears. If you still see this error after applying the
fix, it means there's a third cause specific to your actual survey data —
tell me the exact question text and I'll dig further.

## 5. Fixed: General Feedback didn't submit, logo issue here too

This page was a static mockup with no logic behind it at all — the submit
button had no click handler. There was already a working backend for this
(`Question`/`Response` models, `/api/questions-for-target`, `/api/submit`,
`/api/responses`), it just was never wired up. Now:

- **Students** see the real question list (your org's custom questions plus
  the two system defaults) and submitting actually saves to the database.
- **Organizations** see a read-only list of feedback they've received instead
  of a form (submitting feedback about yourself didn't make sense) — each
  entry shows the student, their answers resolved to the actual question
  text, and any comment they left.

## Files changed (copy all of these over your project)

```
final year.1/backend/analysis_runner.py
final year.1/backend/server.js
final year.1/backend/routes/analysis.js
final year.1/backend/routes/auth.js
final year.1/backend/models/User.js
final year.1/frontend/form-fill.js
final year.1/frontend/index.html
final year.1/frontend/script.js
final year.1/frontend/styles.css
```

No new `npm install` needed — `multer` was already a dependency (used for the
dataset upload), I just reused it for avatar uploads.

## How to apply and run it (same steps as before)

```bash
cd ~/Downloads/"final year.1"/backend
npm start
```

Then open `http://localhost:3000` (or refresh if it's already running — but
since you're replacing `script.js`, do a hard refresh / private window so the
browser doesn't serve a cached copy).

If you ever get stuck with the server seemingly not picking up changes again,
the fix from earlier still applies: check what's running on port 3000 first.
```bash
lsof -i :3000
kill -9 <PID shown>
```
Then `cd` into `backend` and `npm start` again.

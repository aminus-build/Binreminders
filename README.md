# Kerbside

A local-first progressive web app for Erewash bin-day reminders.

Detailed implementation documentation is available in [docs/FUNCTIONS.md](docs/FUNCTIONS.md).

## Run locally

Serve this folder over HTTP (service workers do not run from `file://`):

```powershell
python -m http.server 8080
```

Then open `http://localhost:8080`.

## Install on a phone

The app must be hosted over HTTPS for installation outside local development. Once hosted:

- iPhone/iPad: open in Safari, tap **Share**, then **Add to Home Screen**.
- Android: open in Chrome and tap **Install app** when prompted, or use the browser menu.

## Automatic Erewash data and email

The scheduled workflow uses the UK Bin Day API every day, updates the app, and includes subscribed garden-waste results returned by the Erewash integration.

For day-before email reminders, add these GitHub Actions repository secrets:

- `BIN_ADDRESS` — the private property address
- `BIN_POSTCODE` — the private property postcode
- `BIN_UPRN` — the private property UPRN
- `RESEND_API_KEY` — an API key from Resend
- `RECIPIENT_EMAIL` — the destination email address
- `EMAIL_FROM` — optional verified sender

Run **Refresh bin dates and send reminders** once manually after deployment. No collection dates are entered in the app.

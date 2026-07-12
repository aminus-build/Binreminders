# Kerbside function reference

This document describes the responsibilities of the application code, the data-sync process, email delivery, and offline support.

## System overview

Kerbside is a static progressive web app hosted by GitHub Pages. The browser reads a generated JSON schedule from `data/collections.json`. A scheduled GitHub Actions workflow refreshes that file through the UK Bin Day API and can send day-before email reminders through Resend.

The main flow is:

1. GitHub Actions runs `npm run sync`.
2. `scripts/sync-collections.mjs` requests collections for the private property configuration.
3. The script validates and normalizes the response.
4. The normalized schedule is written to `data/collections.json`.
5. The workflow commits the changed JSON file.
6. GitHub Pages serves the new schedule.
7. `app.js` loads and renders the schedule in the browser.

## Browser application: `app.js`

### `$(id)`

Returns the DOM element with the supplied ID.

- Input: an HTML element ID.
- Output: the matching `HTMLElement`, or `null` if it does not exist.
- Purpose: keeps repeated `document.getElementById` calls concise.

### `bins`

A configuration object rather than a function. It maps normalized collection types—`black`, `blue`, `brown`, and `green`—to the display name, description, and colour used by the interface.

### `parse(date)`

Converts an ISO date string such as `2026-07-15` into a local JavaScript `Date`.

The time is fixed at noon to avoid a date moving backward or forward because of timezone conversion near midnight.

### `day(date)`

Calculates the number of calendar days between today and a collection date.

- `0`: today.
- `1`: tomorrow.
- A positive number: a future collection.
- A negative number: a past collection.

Past collections are filtered out before rendering.

### `label(date)`

Formats an ISO date as a readable British date, for example `Wednesday 15 July`.

### `relative(date)`

Creates the short countdown label displayed beside a schedule row:

- `Today`
- `Tomorrow`
- `In N days`

### `groupByDate(collections)`

Groups collection records that share the same date.

Input:

```json
[
  { "type": "green", "date": "2026-07-15" },
  { "type": "blue", "date": "2026-07-15" }
]
```

Output:

```json
[
  {
    "date": "2026-07-15",
    "items": [
      { "type": "green", "date": "2026-07-15" },
      { "type": "blue", "date": "2026-07-15" }
    ]
  }
]
```

This is why all bins due on one day appear in a single schedule row.

### `renderBin(collection)`

Builds the HTML fragment for one bin inside a grouped schedule row. It uses the `bins` configuration to select the correct label, description, and coloured dot.

### `render(data)`

Renders the complete schedule response.

Its responsibilities are:

- discard past or unsupported collection records;
- order collections by date;
- group bins by collection date;
- populate the next-collection card;
- render up to ten upcoming collection days;
- display when the data was last refreshed;
- show whether email reminders are configured.

It throws when no valid future collections exist. `load()` catches that failure and displays the fallback state.

### `load()`

Fetches `data/collections.json` and passes the decoded response to `render(data)`.

A timestamp query parameter prevents a browser or CDN from returning stale schedule data. If loading or rendering fails, the function displays a message explaining that collection data is unavailable.

### Browser startup

At the bottom of `app.js`:

- the Refresh button is connected to `load()`;
- `sw.js` is registered when service workers are supported;
- `load()` runs immediately for the initial page view.

## Collection sync: `scripts/sync-collections.mjs`

### Private configuration

The script reads these values from environment variables supplied by GitHub Actions secrets:

- `BIN_ADDRESS`
- `BIN_POSTCODE`
- `BIN_UPRN`

The values must never be committed to the repository. The script stops immediately if any required value is missing.

### `serviceTypes`

A mapping from UK Bin Day service names to the four normalized types understood by the browser:

| API service | App type |
|---|---|
| Domestic Waste Collection Service | `black` |
| Recycling Collection Service | `blue` |
| Garden Waste Collection Service | `brown` |
| Food Collection Service | `green` |

Unknown informational entries are logged and ignored rather than being sent to the UI.

### `fetchCollections()`

Requests the household schedule from the UK Bin Day API.

The function:

1. builds the lookup URL from the private configuration;
2. applies a 45-second timeout;
3. rejects unsuccessful HTTP responses;
4. verifies that the response belongs to the expected UPRN and council;
5. checks that collections exist;
6. maps external service names to app types;
7. validates ISO date strings;
8. removes duplicate type-and-date pairs;
9. sorts the final collection list.

It returns only normalized records shaped like:

```json
{ "type": "blue", "date": "2026-07-16" }
```

### `correctErewashDate(date)`

Corrects a timezone bug in the upstream Erewash integration. During British Summer Time, local midnight is serialized as 23:00 UTC on the preceding date, causing a Thursday collection to be returned as Wednesday. The function:

- calculates the following calendar day;
- checks that day in the `Europe/London` timezone;
- advances the API date only when the London offset is `GMT+1`;
- leaves dates unchanged during GMT.

This seasonal correction preserves Thursday winter collections and avoids incorrectly moving them to Friday.

### `sendReminder(collections)`

Sends email through the Resend API.

For scheduled runs, it filters the normalized schedule to collections due tomorrow. If nothing is due, it exits without contacting Resend.

For manual runs where `SEND_TEST_EMAIL=true`, it sends a clearly labelled test message regardless of tomorrow’s schedule.

Required email environment variables:

- `RESEND_API_KEY`
- `RECIPIENT_EMAIL`

Optional:

- `EMAIL_FROM`—a sender on a domain verified by Resend. When omitted, the Resend testing sender is used.

The function rejects unsuccessful Resend responses so GitHub Actions clearly reports delivery failures.

### Script entry point

The top-level statements at the end of the file:

1. call `fetchCollections()`;
2. create the `data` directory if necessary;
3. write `data/collections.json`;
4. call `sendReminder(collections)`;
5. log the number of synchronized entries.

## Service worker: `sw.js`

### Install event

Creates the versioned application cache and stores the static shell: HTML, CSS, JavaScript, manifest, and icon. `skipWaiting()` allows an updated service worker to become active promptly.

### Activate event

Claims open app pages and removes caches created by older service-worker versions.

### Fetch event

Uses a network-first strategy for GET requests:

1. request the latest resource from the network;
2. cache a copy of a successful response;
3. fall back to the cached response when offline.

Non-GET requests are not intercepted.

## GitHub Actions workflow

The workflow in `.github/workflows/sync.yml` runs:

- every day at 17:15 UTC;
- manually through `workflow_dispatch`.

The manual form includes `send_test_email`. Selecting it passes `SEND_TEST_EMAIL=true` to the sync script.

After a successful run, `stefanzweifel/git-auto-commit-action` commits only `data/collections.json`. Application source files are never modified by the scheduled job.

## Generated data: `data/collections.json`

The public JSON file contains no address, postcode, UPRN, API key, or email address.

Its schema is:

```json
{
  "updatedAt": "ISO-8601 timestamp",
  "emailConfigured": true,
  "collections": [
    {
      "type": "black | blue | brown | green",
      "date": "YYYY-MM-DD"
    }
  ]
}
```

## Failure behaviour

- Missing private property secrets: the sync stops before making an API request.
- UK Bin Day unavailable or malformed: the sync fails and retains the previously committed schedule.
- Resend unavailable or rejects delivery: the workflow fails with Resend’s response.
- Browser cannot load data: the app displays its waiting-for-data state.
- Device is offline: the service worker serves previously cached application resources.


import fs from 'node:fs/promises';

const ADDRESS = process.env.BIN_ADDRESS;
const POSTCODE = process.env.BIN_POSTCODE;
const UPRN = process.env.BIN_UPRN;
const COUNCIL = 'hacs_erewash_gov_uk';
const API_BASE = 'https://ukbinday.co.uk/api/v1';

if (!ADDRESS || !POSTCODE || !UPRN) {
  throw new Error(
    'BIN_ADDRESS, BIN_POSTCODE and BIN_UPRN must be configured as repository secrets.',
  );
}

const serviceTypes = new Map([
  ['Domestic Waste Collection Service', 'black'],
  ['Recycling Collection Service', 'blue'],
  ['Garden Waste Collection Service', 'brown'],
  ['Food Collection Service', 'green'],
]);

async function fetchCollections() {
  const url = new URL(API_BASE + '/lookup/' + UPRN);
  url.searchParams.set('council', COUNCIL);
  url.searchParams.set('postcode', POSTCODE);
  url.searchParams.set('address', ADDRESS);

  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(45_000),
  });

  if (!response.ok) {
    throw new Error(
      'UK Bin Day lookup failed with HTTP ' +
        response.status +
        ': ' +
        (await response.text()),
    );
  }

  const result = await response.json();
  if (result.uprn !== UPRN || result.council !== COUNCIL) {
    throw new Error('UK Bin Day returned data for an unexpected property or council.');
  }
  if (!Array.isArray(result.collections) || !result.collections.length) {
    throw new Error('UK Bin Day returned no collection dates.');
  }

  const collections = [];
  const ignored = new Set();
  for (const item of result.collections) {
    const type = serviceTypes.get(item.type);
    if (!type) {
      ignored.add(item.type);
      continue;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(item.date)) {
      throw new Error('UK Bin Day returned an invalid date: ' + item.date);
    }
    collections.push({ type, date: item.date });
  }

  if (ignored.size) {
    console.log(
      'Ignored informational collection entries: ' + [...ignored].join(', '),
    );
  }

  const unique = [
    ...new Map(
      collections.map((collection) => [
        collection.type + '-' + collection.date,
        collection,
      ]),
    ).values(),
  ].sort((a, b) => a.date.localeCompare(b.date));

  if (!unique.length) {
    throw new Error('UK Bin Day returned no supported bin collection dates.');
  }
  return unique;
}

async function sendReminder(collections) {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const due = collections.filter(
    (collection) => collection.date === tomorrow.toISOString().slice(0, 10),
  );

  if (
    !due.length ||
    !process.env.RESEND_API_KEY ||
    !process.env.RECIPIENT_EMAIL
  ) {
    return;
  }

  const names = due
    .map(
      (collection) =>
        collection.type[0].toUpperCase() + collection.type.slice(1) + ' bin',
    )
    .join(' and ');
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + process.env.RESEND_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM || 'Kerbside <onboarding@resend.dev>',
      to: [process.env.RECIPIENT_EMAIL],
      subject: 'Bin reminder: ' + names + ' tomorrow',
      html:
        '<h1>Put out your ' +
        names +
        '</h1><p>Collection is tomorrow. Please have bins ready by 7am.</p>',
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new Error('Email failed: ' + (await response.text()));
  }
}

const collections = await fetchCollections();
await fs.mkdir('data', { recursive: true });
await fs.writeFile(
  'data/collections.json',
  JSON.stringify(
    {
      updatedAt: new Date().toISOString(),
      emailConfigured: Boolean(process.env.RECIPIENT_EMAIL),
      collections,
    },
    null,
    2,
  ),
);
await sendReminder(collections);
console.log('Synced ' + collections.length + ' collection entries.');

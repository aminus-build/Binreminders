const $ = (id) => document.getElementById(id);
const bins = {
  black: { name: 'Black bin', desc: 'General waste', color: '#282c2b' },
  blue: { name: 'Blue bin', desc: 'Recycling', color: '#2e6da3' },
  brown: { name: 'Brown bin', desc: 'Garden waste', color: '#79543b' },
  green: { name: 'Green food bin', desc: 'Food waste', color: '#2e7752' },
};
const parse = (date) => new Date(date + 'T12:00:00');
const day = (date) =>
  Math.ceil((parse(date) - new Date(new Date().toDateString())) / 86_400_000);
const label = (date) =>
  parse(date).toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
const relative = (date) => {
  const days = day(date);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  return 'In ' + days + ' days';
};

function groupByDate(collections) {
  const groups = new Map();
  for (const collection of collections) {
    if (!groups.has(collection.date)) groups.set(collection.date, []);
    groups.get(collection.date).push(collection);
  }
  return [...groups].map(([date, items]) => ({ date, items }));
}

function renderBin(collection) {
  const bin = bins[collection.type];
  return (
    '<div class="bin-info"><i class="dot" style="background:' +
    bin.color +
    '"></i><div><strong>' +
    bin.name +
    '</strong><small>' +
    bin.desc +
    '</small></div></div>'
  );
}

function render(data) {
  const collections = data.collections
    .filter((collection) => day(collection.date) >= 0 && bins[collection.type])
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!collections.length) throw new Error('No upcoming collections');

  const grouped = groupByDate(collections);
  const nextGroup = grouped[0];
  const main =
    nextGroup.items.find((collection) => collection.type !== 'green') ||
    nextGroup.items[0];
  const days = day(nextGroup.date);

  $('nextCard').classList.remove('skeleton');
  $('nextCard').innerHTML =
    '<div class="next-label">NEXT COLLECTION · ' +
    label(nextGroup.date).toUpperCase() +
    '</div><div class="next-row"><div class="bin-title">' +
    '<span class="bin-icon" style="background:' +
    bins[main.type].color +
    '">♻</span><div><h2>' +
    nextGroup.items.map((item) => bins[item.type].name).join(' + ') +
    '</h2><p>Put ' +
    (nextGroup.items.length > 1 ? 'them' : 'it') +
    ' out the night before</p></div></div><div class="countdown"><strong>' +
    days +
    '</strong><span>' +
    (days === 1 ? 'day' : 'days') +
    ' to go</span></div></div>';

  $('schedule').innerHTML = grouped
    .slice(0, 10)
    .map(
      (group) =>
        '<div class="schedule-item"><div class="date-tile"><span>' +
        parse(group.date)
          .toLocaleDateString('en-GB', { month: 'short' })
          .toUpperCase() +
        '</span><b>' +
        parse(group.date).getDate() +
        '</b></div><div class="bin-list">' +
        group.items.map(renderBin).join('') +
        '</div><div class="when">' +
        relative(group.date) +
        '</div></div>',
    )
    .join('');

  $('status').textContent =
    'Live schedule · checked ' +
    new Date(data.updatedAt).toLocaleString('en-GB');
  $('status').className = 'status success';
  if (data.emailConfigured) {
    $('emailStatus').textContent =
      'Email reminders are active and sent the day before each collection.';
  }
}

async function load() {
  try {
    const response = await fetch('data/collections.json?t=' + Date.now());
    if (!response.ok) throw new Error('Unable to load collection data');
    render(await response.json());
  } catch {
    $('status').textContent =
      'The automated council check needs to run once after deployment.';
    $('status').className = 'status error';
    $('nextCard').classList.remove('skeleton');
    $('nextCard').innerHTML =
      '<h2>Waiting for council data</h2><p>No dates need to be entered here.</p>';
  }
}

$('refreshButton').onclick = load;
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
load();

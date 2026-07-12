import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/+esm';

const supabase = createClient(
  'https://liicfwhbrgcuugvlfnof.supabase.co',
  'sb_publishable_OMrqhL4qgDF-JmqwbmbrkQ_YieHHUBq',
);
const $ = (id) => document.getElementById(id);
const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
})[char]);
const formatDate = (value) => value
  ? new Date(value).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
  : 'Never';

function showLogin(message = '') {
  $('loginPanel').hidden = false;
  $('adminPanel').hidden = true;
  $('loginStatus').textContent = message;
}

function renderDashboard(data) {
  const cards = [
    ['Households', data.totals.households],
    ['Users', data.totals.users],
    ['Properties', data.totals.properties],
    ['Active reminders', data.totals.active_reminders],
  ];
  $('summary').innerHTML = cards.map(([label, value]) =>
    `<article class="card summary-card"><strong>${value}</strong><span>${label}</span></article>`).join('');

  $('households').innerHTML = data.households.length ? data.households.map((household) => `
    <article class="card admin-row">
      <div><strong>${escapeHtml(household.name)}</strong><small>Created ${formatDate(household.created_at)} · ${escapeHtml(household.timezone)}</small></div>
      <div class="row-metrics"><span>${household.member_count} member${household.member_count === 1 ? '' : 's'}</span><span>${household.property_count} propert${household.property_count === 1 ? 'y' : 'ies'}</span><span>${household.reminder_count} reminder${household.reminder_count === 1 ? '' : 's'}</span></div>
    </article>`).join('') : '<p class="empty-state">No households have been created.</p>';

  $('users').innerHTML = data.users.length ? data.users.map((user) => `
    <article class="card admin-row">
      <div><strong>${escapeHtml(user.email || 'No email')}</strong><small>Joined ${formatDate(user.created_at)} · Last sign-in ${formatDate(user.last_sign_in_at)}</small></div>
      <div class="user-badges">${user.is_admin ? '<span class="badge admin-badge">Admin</span>' : ''}${user.confirmed ? '<span class="badge">Confirmed</span>' : '<span class="badge warning-badge">Unconfirmed</span>'}${user.memberships.map((membership) => `<span class="badge">${escapeHtml(membership.household_name)} · ${escapeHtml(membership.role)}</span>`).join('')}</div>
    </article>`).join('') : '<p class="empty-state">No users have been created.</p>';
}

async function loadDashboard() {
  $('adminStatus').textContent = 'Loading admin data…';
  $('adminStatus').className = 'status';
  const { data, error } = await supabase.rpc('get_admin_dashboard');
  if (error) {
    $('adminStatus').textContent = error.message.includes('Administrator')
      ? 'This account does not have administrator access.'
      : `Unable to load admin data: ${error.message}`;
    $('adminStatus').className = 'status error';
    return;
  }
  renderDashboard(data);
  $('adminStatus').textContent = `Updated ${formatDate(data.generated_at)}`;
  $('adminStatus').className = 'status success';
}

async function showAdmin() {
  $('loginPanel').hidden = true;
  $('adminPanel').hidden = false;
  await loadDashboard();
}

$('loginForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  $('loginStatus').textContent = 'Signing in…';
  const { error } = await supabase.auth.signInWithPassword({
    email: $('email').value.trim(),
    password: $('password').value,
  });
  if (error) return showLogin(error.message);
  $('password').value = '';
  await showAdmin();
});

$('reloadButton').addEventListener('click', loadDashboard);
$('signOutButton').addEventListener('click', async () => {
  await supabase.auth.signOut();
  showLogin('Signed out.');
});

const { data: { session } } = await supabase.auth.getSession();
if (session) await showAdmin(); else showLogin();

const BACKEND_URL = 'https://newsletter-digest-backend-515736748868.europe-west1.run.app';

const CATEGORY_CLASSES = {
  reposition_ai_infra: 'cat-ai',
  crypto_defi: 'cat-crypto',
  infogerance_mlops_finops: 'cat-mlops',
  hors_radar: 'cat-radar'
};

function escapeHtml(str = '') {
  return str.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// --- Onglets ---
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('panel-' + tab.dataset.tab).classList.add('active');
  });
});

// --- Digest : état + filtres ---
let allDigestItems = [];
let allDigestRelanceIds = [];
const filterState = { signalOnly: false, categories: new Set(), minScore: 0 };

async function loadDigest() {
  const loading = document.getElementById('digest-loading');
  const empty = document.getElementById('digest-empty');

  try {
    const res = await fetch(`${BACKEND_URL}/digest/current`);
    loading.hidden = true;

    if (res.status === 404) {
      empty.hidden = false;
      updateStats([], 0);
      return;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    document.getElementById('week-tag').textContent = data.semaine.replace('-W', ' · S');

    if (!data.items || data.items.length === 0) {
      empty.hidden = false;
      updateStats([], 0);
      return;
    }

    allDigestItems = data.items;
    allDigestRelanceIds = data.items_relances_ids || [];
    updateStats(allDigestItems, null);
    setupFilterBar(allDigestItems);
    renderFilteredDigest();
  } catch (err) {
    loading.textContent = "Impossible de charger le digest pour l'instant.";
    console.error('loadDigest', err);
  }
}

function setupFilterBar(items) {
  const bar = document.getElementById('filter-bar');
  bar.hidden = false;

  const categories = [...new Set(items.map((i) => i.categorie))].sort();
  const catContainer = document.getElementById('filter-categories');
  catContainer.innerHTML = categories
    .map((cat) => `<button class="filter-chip cat-filter" data-cat="${escapeHtml(cat)}" data-active="false">${escapeHtml(cat)}</button>`)
    .join('');

  document.getElementById('filter-signal').addEventListener('click', (e) => {
    filterState.signalOnly = !filterState.signalOnly;
    e.target.dataset.active = String(filterState.signalOnly);
    renderFilteredDigest();
  });

  const scoreInput = document.getElementById('filter-min-score');
  scoreInput.addEventListener('input', (e) => {
    filterState.minScore = Number(e.target.value);
    document.getElementById('filter-min-score-value').textContent = e.target.value;
    renderFilteredDigest();
  });

  catContainer.querySelectorAll('.cat-filter').forEach((btn) => {
    btn.addEventListener('click', () => {
      const cat = btn.dataset.cat;
      if (filterState.categories.has(cat)) {
        filterState.categories.delete(cat);
        btn.dataset.active = 'false';
      } else {
        filterState.categories.add(cat);
        btn.dataset.active = 'true';
      }
      renderFilteredDigest();
    });
  });
}

function renderFilteredDigest() {
  const list = document.getElementById('digest-list');
  const filtered = allDigestItems.filter((item) => {
    if (filterState.signalOnly && !item.signal_fort) return false;
    if (filterState.categories.size > 0 && !filterState.categories.has(item.categorie)) return false;
    if (Number(item.score_pertinence) < filterState.minScore) return false;
    return true;
  });

  if (filtered.length === 0) {
    list.innerHTML = '<p class="empty-state">Aucun item ne correspond à ces filtres.</p>';
    return;
  }

  list.innerHTML = filtered.map((item) => renderItemCard(item, allDigestRelanceIds)).join('');
  wireItemCards();
}

function renderItemCard(item, relanceIds) {
  const isRelance = relanceIds.includes(item.id);
  const catClass = CATEGORY_CLASSES[item.categorie] || '';
  const description = item.resume || item.justification;

  return `
    <article class="item-card glass-card${item.consulte ? ' read' : ''}" data-id="${item.id}">
      <div class="item-badges">
        ${isRelance ? '<span class="badge badge-relance">manqué la semaine dernière</span>' : ''}
        ${item.signal_fort ? '<span class="badge badge-signal">signal fort</span>' : ''}
      </div>
      <div class="item-head">
        <span class="cat-pill ${catClass}">${escapeHtml(item.categorie)}</span>
        <span class="score">${Number(item.score_pertinence).toFixed(1)}<small>/10</small></span>
      </div>
      <h2>${escapeHtml(item.titre)}</h2>
      <p class="source">${escapeHtml(item.source)}</p>
      <p class="justification">${escapeHtml(description)}</p>
      ${item.url_newsletter ? `<a class="newsletter-link" href="${item.url_newsletter}" target="_blank" rel="noopener">Lire la newsletter →</a>` : ''}
      ${item.conseil ? `
      <details class="conseil">
        <summary>Voir le conseil</summary>
        <p>${escapeHtml(item.conseil)}</p>
      </details>` : ''}
      <button class="mark-read-btn">${item.consulte ? 'Lu' : 'Marquer comme lu'}</button>
    </article>
  `;
}

function updateStats(items, questionsCount) {
  if (items) {
    document.getElementById('stat-items').textContent = items.length;
    document.getElementById('stat-signal').textContent = items.filter((i) => i.signal_fort).length;
  }
  if (questionsCount !== null) {
    document.getElementById('stat-quiz').textContent = questionsCount;
  }
}

function wireItemCards() {
  document.querySelectorAll('.mark-read-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const card = btn.closest('.item-card');
      const id = card.dataset.id;
      btn.disabled = true;
      try {
        const res = await fetch(`${BACKEND_URL}/items/${id}/consulte`, { method: 'POST' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        card.classList.add('read');
        btn.textContent = 'Lu';
        const item = allDigestItems.find((i) => i.id === id);
        if (item) item.consulte = true;
      } catch (err) {
        console.error('mark-read', err);
        alert("Impossible de marquer l'item comme lu pour l'instant.");
      } finally {
        btn.disabled = false;
      }
    });
  });
}

// --- Chargement du quiz ---
async function loadQuiz() {
  const loading = document.getElementById('quiz-loading');
  const empty = document.getElementById('quiz-empty');
  const list = document.getElementById('quiz-list');

  try {
    const res = await fetch(`${BACKEND_URL}/quiz/current`);
    loading.hidden = true;

    if (res.status === 404) {
      empty.hidden = false;
      updateStats(null, 0);
      return;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    if (!data.questions || data.questions.length === 0) {
      empty.hidden = false;
      updateStats(null, 0);
      return;
    }

    list.innerHTML = data.questions.map(renderQuizCard).join('');
    updateStats(null, data.questions.length);
    wireQuizCards();
  } catch (err) {
    loading.textContent = 'Impossible de charger le quiz pour l\'instant.';
    console.error('loadQuiz', err);
  }
}

function renderQuizCard(q) {
  return `
    <article class="quiz-card glass-card" data-question-id="${q.id}" data-concept="${escapeHtml(q.concept_cle)}">
      <span class="concept-tag">${escapeHtml(q.concept_cle)}</span>
      <h3>${escapeHtml(q.question)}</h3>
      <button class="reveal-btn">Voir la réponse</button>
      <div class="answer">
        <p>${escapeHtml(q.reponse)}</p>
        <div class="self-eval">
          <span>Tu savais ?</span>
          <button class="eval-btn eval-yes" data-eval="su">Je savais</button>
          <button class="eval-btn eval-no" data-eval="pas_su">Je ne savais pas</button>
        </div>
      </div>
    </article>
  `;
}

function wireQuizCards() {
  document.querySelectorAll('.reveal-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const answer = btn.nextElementSibling;
      answer.classList.add('visible');
      btn.style.display = 'none';
    });
  });

  document.querySelectorAll('.self-eval').forEach((group) => {
    const card = group.closest('.quiz-card');
    group.querySelectorAll('.eval-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        group.querySelectorAll('.eval-btn').forEach((b) => (b.disabled = true));
        try {
          const res = await fetch(`${BACKEND_URL}/quiz/reponses`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              question_id: card.dataset.questionId,
              concept_cle: card.dataset.concept,
              autoevaluation: btn.dataset.eval
            })
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          group.querySelectorAll('.eval-btn').forEach((b) => b.classList.remove('selected'));
          btn.classList.add('selected');
        } catch (err) {
          console.error('self-eval', err);
          alert("Impossible d'enregistrer ta réponse pour l'instant.");
          group.querySelectorAll('.eval-btn').forEach((b) => (b.disabled = false));
        }
      });
    });
  });
}

// --- Service worker (offline + réception des push) ---
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => {
      console.error('Échec enregistrement service worker', err);
    });
  });
}

// --- Abonnement notifications push ---
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

const notifBtn = document.getElementById('notif-btn');

function updateNotifBtnState() {
  notifBtn.classList.toggle('active', Notification.permission === 'granted');
}

notifBtn.addEventListener('click', async () => {
  if (!('Notification' in window) || !('serviceWorker' in navigator)) {
    alert('Les notifications ne sont pas supportées sur ce navigateur.');
    return;
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    updateNotifBtnState();
    return;
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    const keyRes = await fetch(`${BACKEND_URL}/push/vapid-public-key`);
    if (!keyRes.ok) throw new Error(`HTTP ${keyRes.status}`);
    const { publicKey } = await keyRes.json();

    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey)
    });

    await fetch(`${BACKEND_URL}/push/subscriptions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(subscription)
    });
  } catch (err) {
    console.error('Échec abonnement push', err);
  }

  updateNotifBtnState();
});

updateNotifBtnState();
loadDigest();
loadQuiz();

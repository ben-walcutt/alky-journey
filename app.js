/* global supabase */

/**
 * GitHub Pages setup:
 * 1) Put your Supabase URL + anon key below
 * 2) Ensure your Supabase table + RLS policies exist (journal_entries)
 * 3) Supabase Auth settings: Site URL + Redirect URLs include your GitHub Pages URL
 */
const SUPABASE_URL = "https://djghtvjcmwirtwbdhpng.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_pBZPwZLvn35wr2VylVi_3g_MkWTfCn4";

const client = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const els = {
  email: document.getElementById("email"),
  password: document.getElementById("password"),
  signUp: document.getElementById("signUp"),
  signIn: document.getElementById("signIn"),
  signOut: document.getElementById("signOut"),
  authStatus: document.getElementById("authStatus"),

  signInSection: document.getElementById("signInSection"),
  appSection: document.getElementById("appSection"),
  entriesSection: document.getElementById("entriesSection"),

  entryForm: document.getElementById("entryForm"),
  saveMsg: document.getElementById("saveMsg"),

  refresh: document.getElementById("refresh"),
  entries: document.getElementById("entries"),
  q: document.getElementById("q"),
  filterCategory: document.getElementById("filterCategory"),
  minRating: document.getElementById("minRating")
};

function todayISO() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function setStatus(msg) {
  els.authStatus.textContent = msg || "";
}

function setAuthedUI(isAuthed) {
  // Toggle visibility
  els.signInSection.classList.toggle("hidden", isAuthed);   // hide sign-in when authed
  els.appSection.classList.toggle("hidden", !isAuthed);     // show app when authed
  els.entriesSection.classList.toggle("hidden", !isAuthed); // show entries when authed

  // Sign out button
  els.signOut.disabled = !isAuthed;

  if (!isAuthed) {
    els.entries.innerHTML = ""; // no list visible anyway, but keeps state clean
    els.saveMsg.textContent = "";
  }
}

async function init() {
  // Default date
  els.entryForm.elements.drank_on.value = todayISO();
  
  // Initial auth session
  const { data: { session }, error } = await client.auth.getSession();
  if (error) setStatus(`Auth session error: ${error.message}`);

  setAuthedUI(!!session);
  setStatus(session ? `Signed in as ${session.user.email}` : "Not signed in.");

  // Listen for auth changes
  client.auth.onAuthStateChange((_event, session2) => {
    setAuthedUI(!!session2);
    setStatus(session2 ? `Signed in as ${session2.user.email}` : "Not signed in.");
    if (session2) refreshEntries().catch((e) => setStatus(e.message));
  });

  if (session) await refreshEntries();
}

els.signUp.addEventListener("click", async () => {
  try {
    const email = els.email.value.trim();
    const password = els.password.value;

    if (!email || !password) return setStatus("Enter email + password.");

    const { error } = await client.auth.signUp({ email, password });
    if (error) throw error;

    setStatus("Sign-up successful. If email confirmation is enabled, check your inbox.");
  } catch (e) {
    setStatus(`Sign-up error: ${e.message}`);
  }
});

els.signIn.addEventListener("click", async () => {
  try {
    const email = els.email.value.trim();
    const password = els.password.value;

    if (!email || !password) return setStatus("Enter email + password.");

    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw error;
    // auth listener will update UI
  } catch (e) {
    setStatus(`Sign-in error: ${e.message}`);
  }
});

els.signOut.addEventListener("click", async () => {
  try {
    const { error } = await client.auth.signOut();
    if (error) throw error;
    // auth listener will update UI
  } catch (e) {
    setStatus(`Sign-out error: ${e.message}`);
  }
});

els.entryForm.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  els.saveMsg.textContent = "";

  try {
    const { data: { user }, error: userErr } = await client.auth.getUser();
    if (userErr) throw userErr;
    if (!user) return setStatus("Please sign in.");

    const f = els.entryForm.elements;
    const payload = {
      user_id: user.id, // required due to RLS policy pattern
      drank_on: f.drank_on.value,
      category: f.category.value,
      name: f.name.value.trim(),
      base_spirit: f.base_spirit.value.trim() || null,
      rating: Number(f.rating.value),
      abv: f.abv.value ? Number(f.abv.value) : null,
      ounces: f.ounces.value ? Number(f.ounces.value) : null,
      location: f.location.value.trim() || null,
      photo_url: f.photo_url.value.trim() || null,
      notes: f.notes.value.trim() || null
    };

    if (!payload.name) return setStatus("Name is required.");
    if (!payload.drank_on) return setStatus("Date is required.");
    if (!(payload.rating >= 1 && payload.rating <= 10)) return setStatus("Rating must be 1–10.");

    const { error } = await client.from("journal_entries").insert(payload);
    if (error) throw error;

    els.saveMsg.textContent = "Saved.";
    els.entryForm.reset();
    els.entryForm.elements.drank_on.value = todayISO();
    els.entryForm.elements.category.value = "cocktail";

    await refreshEntries();
  } catch (e) {
    els.saveMsg.textContent = `Save error: ${e.message}`;
  }
});

els.refresh.addEventListener("click", () => refreshEntries().catch((e) => setStatus(e.message)));
[els.q, els.filterCategory, els.minRating].forEach((el) =>
  el.addEventListener("input", () => refreshEntries().catch((e) => setStatus(e.message)))
);

async function refreshEntries() {
  const { data: { session } } = await client.auth.getSession();
  if (!session) {
    els.entries.innerHTML = `<div class="muted">Sign in to view entries.</div>`;
    return;
  }

  const q = els.q.value.trim().toLowerCase();
  const category = els.filterCategory.value;
  const minRating = els.minRating.value ? Number(els.minRating.value) : null;

  let query = client
    .from("journal_entries")
    .select("*")
    .order("drank_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(250);

  if (category) query = query.eq("category", category);
  if (minRating != null) query = query.gte("rating", minRating);

  const { data, error } = await query;
  if (error) throw error;

  let rows = data || [];
  if (q) {
    rows = rows.filter((r) =>
      [r.name, r.notes, r.location, r.base_spirit].some((v) => String(v ?? "").toLowerCase().includes(q))
    );
  }

  if (rows.length === 0) {
    els.entries.innerHTML = `<div class="muted">No entries yet.</div>`;
    return;
  }

  els.entries.innerHTML = rows.map(renderEntry).join("");

  document.querySelectorAll("[data-del]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-del");
      if (!confirm("Delete this entry?")) return;

      const { error: delErr } = await client.from("journal_entries").delete().eq("id", id);
      if (delErr) alert(delErr.message);

      await refreshEntries();
    });
  });
}

function renderEntry(r) {
  const when = escapeHtml(r.drank_on);
  const name = escapeHtml(r.name);
  const cat = escapeHtml(r.category);
  const rating = escapeHtml(r.rating);

  const base = r.base_spirit ? ` • ${escapeHtml(r.base_spirit)}` : "";
  const loc = r.location ? ` • ${escapeHtml(r.location)}` : "";
  const abv = r.abv != null ? ` • ${escapeHtml(r.abv)}%` : "";
  const oz = r.ounces != null ? ` • ${escapeHtml(r.ounces)} oz` : "";
  const notes = r.notes ? `<div class="small">${escapeHtml(r.notes)}</div>` : "";
  const photo = r.photo_url
    ? `<div class="small"><a href="${escapeHtml(r.photo_url)}" target="_blank" rel="noreferrer">photo</a></div>`
    : "";

  return `
    <div class="entry">
      <div class="entryHead">
        <div>
          <div><strong>${name}</strong> <span class="badge">${cat}</span></div>
          <div class="small">${when} • Rating: ${rating}${base}${loc}${abv}${oz}</div>
          ${notes}
          ${photo}
        </div>
        <div class="actions">
          <button class="secondary" data-del="${escapeHtml(r.id)}">Delete</button>
        </div>
      </div>
    </div>
  `;
}

init().catch((e) => setStatus(`Init error: ${e.message}`));

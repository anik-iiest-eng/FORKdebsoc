const API_BASE = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
  ? "http://localhost:5000/api"
  : "/api";
localStorage.removeItem("debsoc_token");
let csrfToken;

const apiFetch = async (url, options = {}) => {
  const method = (options.method || "GET").toUpperCase();
  const headers = new Headers(options.headers || {});
  if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
    if (!csrfToken) {
      const csrfResponse = await fetch(`${API_BASE}/csrf-token`, { credentials: "include" });
      const csrfData = await csrfResponse.json();
      csrfToken = csrfData.csrfToken;
    }
    headers.set("X-CSRF-Token", csrfToken);
  }
  return fetch(url, { ...options, credentials: "include", headers });
};

// Top-Level State Caches
let eventsCache = [];
let historyCache = [];

function refreshCodeTargetOptions() {
  const select = document.getElementById("code-target-select");
  if (!select) return;

  select.innerHTML = `<option value="">-- Choose Event or Archive --</option>` +
    `<optgroup label="Active Events">${eventsCache.map(ev => `<option value="event:${ev.id}">${ev.title}</option>`).join("")}</optgroup>` +
    `<optgroup label="History Archives">${historyCache.map(h => `<option value="history:${h.id}">${h.title}</option>`).join("")}</optgroup>`;
}

document.addEventListener("DOMContentLoaded", () => {
  verifyAdminAccess();
  initDashboard();
});

// 1. Guard Dashboard: Allow Only Verified Admins
function verifyAdminAccess() {
  const userRaw = localStorage.getItem("debsoc_user");

  if (!userRaw) {
    redirectToLogin("Authentication required.");
    return;
  }

  try {
    const user = JSON.parse(userRaw);
    if (user.role !== "ADMIN") {
      alert("Access Denied: Administrator clearance required.");
      window.location.href = "../events.html";
    }
  } catch (err) {
    redirectToLogin("Invalid session state.");
  }
}

function redirectToLogin(msg) {
  alert(msg);
  window.location.href = "../register.html";
}

// 2. Dashboard State & Initialization
function initDashboard() {
  // Logout
  document.getElementById("admin-logout-btn").addEventListener("click", async () => {
    await apiFetch(`${API_BASE}/auth/logout`, { method: "POST" });
    localStorage.removeItem("debsoc_user");
    window.location.href = "../register.html";
  });

  // Event Form Controls
  const eventForm = document.getElementById("event-editor-form");
  const toggleEventBtn = document.getElementById("toggle-event-form-btn");
  const closeEventBtn = document.getElementById("close-event-form-btn");

  toggleEventBtn.addEventListener("click", () => {
    resetEventForm();
    eventForm.classList.toggle("hidden");
  });

  closeEventBtn.addEventListener("click", () => {
    eventForm.classList.add("hidden");
  });

  // History Form Controls
  const histForm = document.getElementById("history-editor-form");
  const toggleHistBtn = document.getElementById("toggle-history-form-btn");
  const closeHistBtn = document.getElementById("close-history-form-btn");

  toggleHistBtn.addEventListener("click", () => {
    resetHistoryForm();
    histForm.classList.toggle("hidden");
  });

  closeHistBtn.addEventListener("click", () => {
    histForm.classList.add("hidden");
  });

  // Form Submissions & Actions
  eventForm.addEventListener("submit", handleEventSubmit);
  histForm.addEventListener("submit", handleHistorySubmit);
  document.getElementById("mint-codes-btn").addEventListener("click", handleMintCodes);
  const roleDelegationForm = document.getElementById("role-delegation-form");
  if (roleDelegationForm) {
    roleDelegationForm.addEventListener("submit", handleRoleDelegation);
  }

  // Initial Data Loads
  loadAllEvents();
  loadAllHistory();
}

// 3. Load & Render Active Events
async function loadAllEvents() {
  const tbody = document.getElementById("events-table-body");
  const token = localStorage.getItem("debsoc_token");

  try {
    const res = await apiFetch(`${API_BASE}/admin/events`, {
      headers: { "Authorization": `Bearer ${token}` }
    });
    if (!res.ok) throw new Error("Could not fetch tournaments.");
    eventsCache = await res.json();

    if (!Array.isArray(eventsCache) || eventsCache.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="p-6 text-center text-neutral-500 font-mono-code">No active events found.</td></tr>`;
      refreshCodeTargetOptions();
      return;
    }

    tbody.innerHTML = eventsCache.map(ev => `
      <tr class="hover:bg-[#181a22] transition">
        <td class="p-4 font-semibold text-white">${ev.title}</td>
        <td class="p-4 font-mono-code text-[11px] text-[#DAA520]">${ev.eventType || 'MAIN'}</td>
        <td class="p-4 font-mono-code text-neutral-400">${new Date(ev.eventDate).toLocaleDateString()}</td>
        <td class="p-4 font-mono-code text-neutral-400">${new Date(ev.registrationDeadline).toLocaleDateString()}</td>
        <td class="p-4 text-neutral-300">${ev.location || "IIEST"}</td>
        <td class="p-4 text-right space-x-2">
          <button onclick="startEditEvent('${ev.id}')" class="px-2.5 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-200 font-mono-code text-[11px]">
            Edit
          </button>
          <button onclick="archiveEvent('${ev.id}')" class="px-2.5 py-1 rounded bg-[#DAA520]/20 hover:bg-[#DAA520]/30 border border-[#DAA520]/40 text-[#DAA520] font-mono-code text-[11px]">
            Archive
          </button>
          <button onclick="deleteEvent('${ev.id}')" class="px-2.5 py-1 rounded bg-red-950/60 hover:bg-red-900 border border-red-900/60 text-red-300 font-mono-code text-[11px]">
            Delete
          </button>
        </td>
      </tr>
    `).join("");

    refreshCodeTargetOptions();

  } catch (err) {
    showToast(err.message, "error");
  }
}

// 4. Load & Render History Archives
async function loadAllHistory() {
  const tbody = document.getElementById("history-table-body");
  const token = localStorage.getItem("debsoc_token");

  try {
    const res = await apiFetch(`${API_BASE}/admin/history`, {
      headers: { "Authorization": `Bearer ${token}` }
    });
    if (!res.ok) throw new Error("Could not fetch archives.");
    historyCache = await res.json();

    refreshCodeTargetOptions();

    if (!Array.isArray(historyCache) || historyCache.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="p-6 text-center text-neutral-500 font-mono-code">No archived history records found.</td></tr>`;
      return;
    }

    tbody.innerHTML = historyCache.map(h => {
      const awards = h.achievements && h.achievements.length > 0
        ? h.achievements.map(a => `<span class="inline-block bg-[#181a22] border border-neutral-800 px-2 py-0.5 rounded text-[10px] mr-1 mb-1 font-mono-code">${a.position}: <b class="text-white">${a.user?.displayName || 'Claimed'}</b></span>`).join("")
        : '<span class="text-neutral-500 font-mono-code text-[11px] italic">No claimed awards</span>';

      return `
        <tr class="hover:bg-[#181a22] transition">
          <td class="p-4 font-semibold text-white">${h.title}</td>
          <td class="p-4 font-mono-code text-[11px] text-[#DAA520]">${h.eventType || 'MAIN'}</td>
          <td class="p-4 font-mono-code text-neutral-400">${new Date(h.eventDate).toLocaleDateString()}</td>
          <td class="p-4">${awards}</td>
          <td class="p-4 text-right space-x-2">
            <button onclick="startEditHistory('${h.id}')" class="px-2.5 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-200 font-mono-code text-[11px]">
              Edit
            </button>
            <button onclick="deleteHistory('${h.id}')" class="px-2.5 py-1 rounded bg-red-950/60 hover:bg-red-900 border border-red-900/60 text-red-300 font-mono-code text-[11px]">
              Delete
            </button>
          </td>
        </tr>
      `;
    }).join("");

  } catch (err) {
    showToast(err.message, "error");
  }
}

// 5. Create or Update Event
async function handleEventSubmit(e) {
  e.preventDefault();
  const token = localStorage.getItem("debsoc_token");
  const editId = document.getElementById("event-edit-id").value;

  const payload = {
    title: document.getElementById("ev-title").value.trim(),
    eventType: document.getElementById("ev-type").value,
    description: document.getElementById("ev-description").value.trim(),
    eventDate: new Date(document.getElementById("ev-date").value).toISOString(),
    registrationDeadline: new Date(document.getElementById("ev-deadline").value).toISOString(),
    location: document.getElementById("ev-location").value.trim(),
    coverImage: document.getElementById("ev-image").value.trim() || undefined
  };

  const url = editId ? `${API_BASE}/admin/events/${editId}` : `${API_BASE}/admin/events`;
  const method = editId ? "PUT" : "POST";

  try {
    const res = await apiFetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to persist event.");

    showToast(editId ? "Tournament updated successfully!" : "Tournament published!", "success");
    document.getElementById("event-editor-form").classList.add("hidden");
    resetEventForm();
    loadAllEvents();
  } catch (err) {
    showToast(err.message, "error");
  }
}

// 6. Create or Update History
async function handleHistorySubmit(e) {
  e.preventDefault();
  const token = localStorage.getItem("debsoc_token");
  const editId = document.getElementById("hist-edit-id").value;

  const rawGallery = document.getElementById("hist-gallery-images").value;
const galleryImages = rawGallery.split(",").map(url => url.trim()).filter(Boolean);
const archivedAt = document.getElementById("hist-archived-at").value;

const payload = {
  title: document.getElementById("hist-title").value.trim(),
  eventType: document.getElementById("hist-type").value,
  description: document.getElementById("hist-description").value.trim(),
  eventDate: new Date(document.getElementById("hist-date").value).toISOString(),
  location: document.getElementById("hist-location").value.trim(),
  coverImage: document.getElementById("hist-image").value.trim() || undefined,
  images: galleryImages,
  eventId: document.getElementById("hist-event-id").value.trim() || null,
  archivedAt: new Date(archivedAt).toISOString(),
  awardCount: Number(document.getElementById("hist-award-count").value)
};

  const url = editId ? `${API_BASE}/admin/history/${editId}` : `${API_BASE}/admin/history`;
  const method = editId ? "PUT" : "POST";

  try {
    const res = await apiFetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to save history entry.");

    showToast(editId ? "History record updated successfully!" : "History archive created!", "success");
    document.getElementById("history-editor-form").classList.add("hidden");
    resetHistoryForm();
    loadAllHistory();
  } catch (err) {
    showToast(err.message, "error");
  }
}

// Form Reset Helpers
function resetEventForm() {
  document.getElementById("event-edit-id").value = "";
  document.getElementById("form-heading").innerText = "Create New Tournament";
  document.getElementById("save-event-btn").innerText = "Save Tournament";
  document.getElementById("event-editor-form").reset();
}

function resetHistoryForm() {
  document.getElementById("hist-edit-id").value = "";
  document.getElementById("hist-form-heading").innerText = "Add Historical Archive";
  document.getElementById("save-history-btn").innerText = "Save Archive Entry";
  document.getElementById("history-editor-form").reset();
  document.getElementById("hist-gallery-images").value = "";
  document.getElementById("hist-event-id").value = "";
  document.getElementById("hist-archived-at").value = "";
  document.getElementById("hist-award-count").value = "";
}

// Pre-fill Handlers
window.startEditEvent = function(id) {
  const ev = eventsCache.find(item => item.id === id);
  if (!ev) return;

  document.getElementById("event-edit-id").value = ev.id;
  document.getElementById("form-heading").innerText = `Edit: ${ev.title}`;
  document.getElementById("ev-title").value = ev.title;
  document.getElementById("ev-type").value = ev.eventType || "MAIN";
  document.getElementById("ev-description").value = ev.description;
  document.getElementById("ev-date").value = new Date(ev.eventDate).toISOString().slice(0, 16);
  document.getElementById("ev-deadline").value = new Date(ev.registrationDeadline).toISOString().slice(0, 16);
  document.getElementById("ev-location").value = ev.location;
  document.getElementById("ev-image").value = ev.coverImage || "";

  document.getElementById("save-event-btn").innerText = "Update Tournament";
  document.getElementById("event-editor-form").classList.remove("hidden");
  window.scrollTo({ top: 0, behavior: "smooth" });
};

window.startEditHistory = function(id) {
  const h = historyCache.find(item => item.id === id);
  if (!h) return;

  document.getElementById("hist-edit-id").value = h.id;
  document.getElementById("hist-form-heading").innerText = `Edit Archive: ${h.title}`;
  document.getElementById("save-history-btn").innerText = "Update Archive Entry";
  
  document.getElementById("hist-title").value = h.title;
  document.getElementById("hist-event-id").value = h.eventId || "";
  document.getElementById("hist-type").value = h.eventType || "MAIN";
  document.getElementById("hist-description").value = h.description;
  document.getElementById("hist-date").value = new Date(h.eventDate).toISOString().slice(0, 16);
  document.getElementById("hist-archived-at").value = new Date(h.archivedAt).toISOString().slice(0, 16);
  document.getElementById("hist-award-count").value = Number.isInteger(h.awardCount) ? h.awardCount : (h.achievements || []).length;
  document.getElementById("hist-location").value = h.location;
  document.getElementById("hist-image").value = h.coverImage || "";
document.getElementById("hist-gallery-images").value = Array.isArray(h.images) ? h.images.join(", ") : "";
  document.getElementById("history-editor-form").classList.remove("hidden");
  document.getElementById("history-editor-form").scrollIntoView({ behavior: "smooth" });
};

// 7. Mint Winner Redemption Codes
async function handleMintCodes() {
  const token = localStorage.getItem("debsoc_token");
  const target = document.getElementById("code-target-select").value;
  const rawTitles = document.getElementById("code-titles-input").value;

  if (!target) {
    showToast("Please choose an event or history archive first.", "error");
    return;
  }

  const titles = rawTitles.split(",").map(t => t.trim()).filter(Boolean);
  if (titles.length === 0) {
    showToast("Please enter at least one award title.", "error");
    return;
  }

  const btn = document.getElementById("mint-codes-btn");
  btn.disabled = true;
  btn.innerText = "Minting Tokens...";

  try {
    const res = await apiFetch(`${API_BASE}/admin/mint-codes`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify(target.startsWith("event:")
        ? { eventId: target.slice("event:".length), titles }
        : { historyId: target.slice("history:".length), titles })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to generate tokens.");

    renderGeneratedCodes(data.codes);
    showToast("Winner codes generated successfully!", "success");
    document.getElementById("code-titles-input").value = "";
  } catch (err) {
    showToast(err.message, "error");
  } finally {
    btn.disabled = false;
    btn.innerText = "Generate Secret Tokens";
  }
}

function renderGeneratedCodes(codes) {
  const container = document.getElementById("codes-output-list");
  const copyBtn = document.getElementById("copy-codes-btn");

  container.innerHTML = codes.map(item => `
    <div class="flex items-center justify-between p-2.5 bg-[#181a22] border border-neutral-800 rounded">
      <div>
        <span class="text-neutral-300 font-semibold">${item.positionTitle}</span>
      </div>
      <div class="flex items-center gap-2">
        <code class="px-2 py-0.5 rounded bg-[#0b0c10] text-[#DAA520] border border-[#DAA520]/30 font-bold tracking-widest">${item.rawToken}</code>
      </div>
    </div>
  `).join("");

  copyBtn.classList.remove("hidden");
  copyBtn.onclick = () => {
    const formatted = codes.map(c => `${c.positionTitle}: ${c.rawToken}`).join("\n");
    navigator.clipboard.writeText(formatted);
    showToast("All codes copied to clipboard!", "success");
  };
}

// 8. Assign User Roles (Delegation)
async function handleRoleDelegation(e) {
  e.preventDefault();
  const userId = document.getElementById("target-user-email").value.trim();
  const role = document.getElementById("target-user-role").value;

  try {
    const res = await apiFetch(`${API_BASE}/admin/users/${encodeURIComponent(userId)}/role`, {
      method: "PATCH",
      credentials: "include",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ role })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Role assignment failed.");

    showToast(`Role updated to ${role} for ${userId}`, "success");
    document.getElementById("role-delegation-form").reset();
  } catch (err) {
    showToast(err.message, "error");
  }
}

// 9. Window Actions (Archive & Deletions)
window.archiveEvent = async function(id) {
  const token = localStorage.getItem("debsoc_token");
  if (!confirm("Archive this tournament to the permanent history records?")) return;

  try {
    const res = await apiFetch(`${API_BASE}/admin/events/${id}/archive`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}` }
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to archive event.");

    showToast("Event transferred to History successfully!", "success");
    loadAllEvents();
    loadAllHistory();
  } catch (err) {
    showToast(err.message, "error");
  }
};

window.deleteEvent = async function(id) {
  const token = localStorage.getItem("debsoc_token");
  if (!confirm("Are you sure you want to permanently delete this event?")) return;

  try {
    const res = await apiFetch(`${API_BASE}/admin/events/${id}`, {
      method: "DELETE",
      headers: { "Authorization": `Bearer ${token}` }
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || "Delete operation failed.");
    }

    showToast("Event deleted successfully", "success");
    loadAllEvents();
  } catch (err) {
    showToast(err.message, "error");
  }
};

window.deleteHistory = async function(id) {
  const token = localStorage.getItem("debsoc_token");
  if (!confirm("Permanently remove this archived history record?")) return;

  try {
    const res = await apiFetch(`${API_BASE}/admin/history/${id}`, {
      method: "DELETE",
      headers: { "Authorization": `Bearer ${token}` }
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || "Failed to delete history record.");
    }

    showToast("History record deleted", "success");
    loadAllHistory();
  } catch (err) {
    showToast(err.message, "error");
  }
};

// 10. Toast Helper
function showToast(msg, type = "info") {
  const toast = document.getElementById("toast");
  toast.innerText = msg;
  toast.className = `fixed bottom-6 right-6 z-50 px-5 py-3 rounded-lg text-xs font-mono-code border shadow-2xl transition-all duration-300 ${
    type === "error" ? "bg-[#2b0c10] border-red-800 text-red-200" : "bg-[#0b2416] border-emerald-700 text-emerald-200"
  }`;
  toast.classList.remove("hidden");
  setTimeout(() => toast.classList.add("hidden"), 3500);
}
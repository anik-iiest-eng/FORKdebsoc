const API_BASE = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
  ? "http://localhost:5000/api"
  : "https://forkdebsoc.onrender.com/api";
// For Vercel deployment with same-origin API routing:
// const API_BASE = "/api";
let csrfToken;

const apiFetch = async (url, options = {}) => {
  const method = (options.method || "GET").toUpperCase();
  const headers = new Headers(options.headers || {});
  const token = localStorage.getItem("debsoc_token");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    if (!csrfToken) {
      const csrfResponse = await fetch(`${API_BASE}/csrf-token`, { credentials: "include" });
      const csrfData = await csrfResponse.json();
      csrfToken = csrfData.csrfToken;
    }
    headers.set("X-CSRF-Token", csrfToken);
  }
  return fetch(url, { ...options, credentials: "include", headers });
};

const escapeHTML = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

const initials = (name) => String(name || "DebSoc")
  .split(/\s+/)
  .filter(Boolean)
  .slice(0, 2)
  .map(part => part[0])
  .join("")
  .toUpperCase();

const formatDate = (value) => value
  ? new Date(value).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
  : "Date unavailable";

const setStatus = (message) => {
  const status = document.getElementById("profile-status");
  status.textContent = message;
  status.classList.remove("hidden");
  document.getElementById("profile-content").classList.add("hidden");
};

const setupProfileNavigation = () => {
  let viewer = null;
  try {
    viewer = JSON.parse(localStorage.getItem("debsoc_user") || "null");
  } catch {
    localStorage.removeItem("debsoc_user");
  }
  const myProfileLink = document.getElementById("my-profile-link");
  if (viewer?.username) {
    myProfileLink.href = `profile.html?u=${encodeURIComponent(viewer.username)}`;
    myProfileLink.classList.remove("hidden");
  }

  document.getElementById("profile-search-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const username = document.getElementById("profile-search-input").value.trim();
    if (username) window.location.href = `profile.html?u=${encodeURIComponent(username)}`;
  });
};

const setEditStatus = (message, isError = false) => {
  const status = document.getElementById("profile-edit-status");
  status.textContent = message;
  status.className = `mt-3 text-xs ${isError ? "text-red-700" : "text-emerald-700"}`;
};

const setRedeemStatus = (message, isError = false) => {
  const status = document.getElementById("redeem-status");
  status.textContent = message;
  status.className = `mt-3 text-xs ${isError ? "text-red-700" : "text-emerald-700"}`;
};

const fillEditForm = (profile) => {
  document.getElementById("edit-display-name").value = profile.displayName || "";
  document.getElementById("edit-profile-image").value = profile.profileImage || "";
  document.getElementById("edit-banner-image").value = profile.bannerImage || "";
  document.getElementById("edit-spotify-link").value = profile.spotifyLink || "";
  document.getElementById("edit-bio").value = profile.bio || "";
  document.getElementById("edit-social-links").value = (Array.isArray(profile.socialLinks) ? profile.socialLinks : [])
    .map(({ label, url }) => `${label || "Link"} | ${url || ""}`).join("\n");
};

const setupSelfEditing = (profile) => {
  let viewer = null;
  try {
    viewer = JSON.parse(localStorage.getItem("debsoc_user") || "null");
  } catch {
    viewer = null;
  }

  if (!viewer || viewer.username !== profile.username) return;

  const editButton = document.getElementById("edit-profile-btn");
  const editForm = document.getElementById("profile-edit-form");
  const redeemSection = document.getElementById("redeem-section");
  const redeemForm = document.getElementById("redeem-form");
  editButton.classList.remove("hidden");
  redeemSection.classList.remove("hidden");
  fillEditForm(profile);
  if (editButton.dataset.bound === "true") return;
  editButton.dataset.bound = "true";
  editButton.addEventListener("click", () => editForm.classList.toggle("hidden"));
  document.getElementById("cancel-profile-edit").addEventListener("click", () => editForm.classList.add("hidden"));
  redeemForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const codeInput = document.getElementById("redeem-code");
    const code = codeInput.value.trim();
    try {
      const response = await apiFetch(`${API_BASE}/achievements/redeem`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not redeem code.");
      setRedeemStatus("Achievement unlocked successfully.");
      codeInput.value = "";
      await loadProfile();
    } catch (error) {
      setRedeemStatus(error.message, true);
    }
  });
  editForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const socialLinks = document.getElementById("edit-social-links").value
      .split("\n").map(line => line.trim()).filter(Boolean).map(line => {
        const separator = line.indexOf("|");
        return separator < 0
          ? { label: "Link", url: line }
          : { label: line.slice(0, separator).trim(), url: line.slice(separator + 1).trim() };
      });

    try {
      const response = await apiFetch(`${API_BASE}/users/me/profile`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: document.getElementById("edit-display-name").value.trim(),
          profileImage: document.getElementById("edit-profile-image").value.trim() || null,
          bannerImage: document.getElementById("edit-banner-image").value.trim() || null,
          spotifyLink: document.getElementById("edit-spotify-link").value.trim() || null,
          bio: document.getElementById("edit-bio").value.trim() || null,
          socialLinks
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Profile update failed.");
      localStorage.setItem("debsoc_user", JSON.stringify(data.user));
      setEditStatus("Profile updated.");
      editForm.classList.add("hidden");
      await loadProfile();
    } catch (error) {
      setEditStatus(error.message, true);
    }
  });
};

const loadProfile = async () => {
  const username = new URLSearchParams(window.location.search).get("u");
  if (!username) {
    setStatus("No username was provided.");
    return;
  }

  try {
    const response = await fetch(`${API_BASE}/users/${encodeURIComponent(username)}`);
    const profile = await response.json();
    if (!response.ok) throw new Error(profile.error || "Profile could not be loaded.");

    document.title = `${profile.displayName} | DebSoc IIEST Shibpur`;
    document.getElementById("profile-status").classList.add("hidden");
    document.getElementById("profile-content").classList.remove("hidden");
    document.getElementById("profile-name").textContent = profile.displayName;
    document.getElementById("profile-username").textContent = `@${profile.username}`;
    document.getElementById("profile-role").textContent = profile.role === "USER" ? "DebSoc member" : profile.role;
    document.getElementById("profile-bio").textContent = profile.bio || "No biography has been added yet.";
    document.getElementById("achievement-count").textContent = profile.achievements.length;
    document.getElementById("registration-count").textContent = profile._count.registrations;

    const avatar = document.getElementById("profile-avatar");
    if (profile.profileImage) {
      avatar.className = "avatar -mt-14 rounded-full";
      avatar.innerHTML = `<img class="h-full w-full rounded-full object-cover" src="${escapeHTML(profile.profileImage)}" alt="${escapeHTML(profile.displayName)}">`;
    } else {
      avatar.textContent = initials(profile.displayName);
    }

    if (profile.bannerImage) {
      document.getElementById("profile-banner").style.backgroundImage = `url("${profile.bannerImage.replaceAll('"', '')}")`;
    }

    if (profile.spotifyLink) {
      const spotify = document.getElementById("spotify-link");
      spotify.href = profile.spotifyLink;
      spotify.classList.remove("hidden");
    }

    const socialLinks = document.getElementById("social-links");
    const links = Array.isArray(profile.socialLinks) ? profile.socialLinks : [];
    socialLinks.innerHTML = links.map(({ label, url }) => {
      const safeUrl = typeof url === "string" && /^https?:\/\//i.test(url) ? url : "";
      if (!safeUrl) return "";
      const safeLabel = escapeHTML(label || "Link");
      return `<a class="rounded border border-[#e8b84b]/60 px-3 py-2 text-xs text-[#e8b84b] hover:bg-white/10" href="${escapeHTML(safeUrl)}" target="_blank" rel="noopener noreferrer">${safeLabel}</a>`;
    }).join("");
    setupSelfEditing(profile);

    const list = document.getElementById("achievement-list");
    list.innerHTML = profile.achievements.length
      ? profile.achievements.map(achievement => {
          const source = achievement.event || achievement.history;
          return `<article class="award-row rounded-r-lg bg-white p-4 shadow-sm">
            <p class="font-serif-title text-lg text-[#6b0f1a]">${escapeHTML(achievement.position)}</p>
            <p class="mt-1 text-sm text-[#5c3a30]">${escapeHTML(source?.title || "DebSoc achievement")}</p>
            <p class="mt-2 font-mono text-[11px] uppercase tracking-wider text-[#9a6f22]">Awarded ${formatDate(achievement.awardedAt)}</p>
          </article>`;
        }).join("")
      : `<p class="rounded-lg bg-white p-5 text-sm text-[#5c3a30]">No verified achievements yet.</p>`;
  } catch (error) {
    setStatus(error.message);
  }
};

document.addEventListener("DOMContentLoaded", () => {
  setupProfileNavigation();
  loadProfile();
});

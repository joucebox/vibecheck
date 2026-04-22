function norm(s) {
  return (s ?? "").toLowerCase().replace(/[\s\-'.]/g, "");
}

function looksLikeName(text) {
  return /^[A-Za-zÀ-ÿ'\-][\w'\- ]*,\s*[A-Za-z]/.test(text.trim());
}

// Cornell roster title format: "First Last (netid)" where netid = lowercase letters + digits
function fullNameFromTitle(title) {
  if (!title) return null;
  const m = title.match(/^(.+?)\s*\([a-z][a-z0-9]*\)\s*$/);
  if (!m) return null;
  const name = m[1].trim();
  if (name.split(/\s+/).length < 2) return null;
  if (!/^[A-Za-zÀ-ÿ]/.test(name)) return null;
  return name;
}

// Returns true if a text-form name ("Last, F") is already represented in titleResults.
// Matches on normalized last name + first initial so two different Lees aren't collapsed.
function coveredByTitle(textShort, titleResults) {
  const normLast = norm(textShort.split(",")[0].trim());
  const initial = (textShort.split(",")[1]?.trim()[0] ?? "").toLowerCase();
  return titleResults.some((r) => {
    const words = r.fullName.trim().split(/\s+/);
    const rNormLast = norm(words.slice(1).join(" "));
    const rInitial = (words[0]?.[0] ?? "").toLowerCase();
    return rNormLast === normLast && (!initial || rInitial === initial);
  });
}

// Extracts all instructors from a li.instructors element.
// Always runs BOTH passes so a section with mixed title/no-title instructors is complete.
function extractInstructors(li) {
  const titleResults = [];
  const seenKeys = new Set();

  // Pass 1: elements with Cornell-style title attributes → gives full name
  li.querySelectorAll("[title]").forEach((el) => {
    const full = fullNameFromTitle(el.getAttribute("title") || "");
    if (!full) return;
    const key = full.toLowerCase();
    if (seenKeys.has(key)) return;
    seenKeys.add(key);
    const short = el.textContent.trim();
    titleResults.push({ shortName: looksLikeName(short) ? short : full, fullName: full });
  });

  const results = [...titleResults];

  // Pass 2: walk each text node individually. Using li.textContent would
  // concatenate adjacent <a> tags without separators ("Sridharan, KThickstun, J"),
  // causing the second instructor to be swallowed by the first. Per-node iteration
  // ensures each professor's text is evaluated in isolation.
  const walker = document.createTreeWalker(li, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    // A single text node may still hold multiple newline-separated names
    // (plain-text fallbacks from the roster), so split by newline defensively.
    for (const line of node.nodeValue.split("\n")) {
      const t = line.trim();
      if (!looksLikeName(t)) continue;
      if (coveredByTitle(t, titleResults)) continue; // same person found via title
      if (seenKeys.has(t.toLowerCase())) continue;
      seenKeys.add(t.toLowerCase());
      results.push({ shortName: t, fullName: t });
    }
  }

  return results;
}

function ratingColor(r) {
  return r >= 4.0 ? "#4caf50" : r >= 2.7 ? "#ff9800" : "#f44336";
}

function buildBadge(data) {
  const badge = document.createElement("span");
  badge.className = "rmp-badge";

  if (!data || data.numRatings === 0) {
    badge.classList.add("rmp-badge--none");
    badge.title = "No RMP data found";
    badge.textContent = "N/A";
    return badge;
  }

  const rating = data.avgRating?.toFixed(1) ?? "?";
  const diff = data.avgDifficulty?.toFixed(1) ?? "?";
  const wta =
    data.wouldTakeAgainPercent >= 0
      ? `${Math.round(data.wouldTakeAgainPercent)}%`
      : "N/A";

  badge.style.setProperty("--rmp-color", ratingColor(data.avgRating));
  badge.title = `${data.firstName} ${data.lastName} · Difficulty: ${diff}/5 · Would take again: ${wta}`;

  const numericId = atob(data.id).split("-")[1];
  const link = document.createElement("a");
  link.href = `https://www.ratemyprofessors.com/professor/${numericId}`;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = `⭐ ${rating}`;
  link.className = "rmp-badge__link";
  badge.appendChild(link);

  const count = document.createElement("span");
  count.className = "rmp-badge__count";
  count.textContent = `(${data.numRatings})`;
  badge.appendChild(count);

  return badge;
}

async function processLi(li) {
  if (li.dataset.rmpDone) return;
  li.dataset.rmpDone = "1";

  const instructors = extractInstructors(li);
  if (instructors.length === 0) return;

  for (const { shortName, fullName } of instructors) {
    const badge = document.createElement("span");
    badge.className = "rmp-badge rmp-badge--loading";
    badge.textContent = "…";
    li.appendChild(badge);

    try {
      const data = await chrome.runtime.sendMessage({
        type: "FETCH_RATING",
        shortName,
        fullName,
      });
      badge.replaceWith(buildBadge(data ?? null));
    } catch (e) {
      badge.replaceWith(buildBadge(null));
    }
  }
}

function processInstructors() {
  document
    .querySelectorAll("li.instructors:not([data-rmp-done])")
    .forEach(processLi);
}

processInstructors();
const observer = new MutationObserver(processInstructors);
observer.observe(document.body, { childList: true, subtree: true });

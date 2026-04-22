// All known Cornell school IDs on Rate My Professor.
// Professors are distributed across the main school and several departmental sub-schools.
// Searching only school 298 misses professors registered under the others.
const CORNELL_SCHOOL_IDS = [
  "U2Nob29sLTI5OA==",  // 298  — main Cornell University
  "U2Nob29sLTQ2OTQ=",  // 4694
  "U2Nob29sLTE3Nzk2",  // 17796
  "U2Nob29sLTE4MDUw",  // 18050
  "U2Nob29sLTE4MTUy",  // 18152
];

const RMP_URL = "https://www.ratemyprofessors.com/graphql";

const SEARCH_QUERY = `
query TeacherSearchResultsPageQuery($query: TeacherSearchQuery!) {
  search: newSearch {
    teachers(query: $query, first: 8) {
      edges {
        node {
          id
          firstName
          lastName
          avgRating
          avgDifficulty
          numRatings
          wouldTakeAgainPercent
          school { name }
        }
      }
    }
  }
}`;

const cache = new Map();

// Normalize for fuzzy name comparison: lowercase, strip spaces/hyphens/apostrophes/periods.
// "VanRenesse" ↔ "Van Renesse", "Stephens-Davidowitz" ↔ "StephensDavidowitz", etc.
function norm(s) {
  return (s ?? "").toLowerCase().replace(/[\s\-'.]/g, "");
}

/**
 * Score one RMP candidate against expected name parts.
 * Returns -1 to hard-reject; otherwise a non-negative score (higher = better match).
 *
 * Hard-reject rules (avoid wrong-person matches):
 *  - Last name must match exactly or after normalization. No last-name match → -1.
 *  - When expectedFirst is provided, its first letter must match RMP's first letter.
 *    This eliminates Tanzeem≠Sanjiban and Sylvia≠Lillian with zero cost to valid matches.
 */
function scoreMatch(node, expectedFirst, expectedLast) {
  // Strip abbreviation periods from RMP first name ("A." → "a")
  const rf = (node.firstName ?? "").toLowerCase().replace(/\./g, "");
  const rl = (node.lastName ?? "").toLowerCase();
  const school = (node.school?.name ?? "").toLowerCase();

  const ef = expectedFirst.toLowerCase();
  const el = expectedLast.toLowerCase();

  const atCornell = school.includes("cornell");
  let score = 0;

  // ── Last name ─────────────────────────────────────────────────────────────
  // Exact and normalized matches are treated equally in confidence —
  // "VanRenesse" and "Van Renesse" are the same name, just different data entry.
  if (rl === el || norm(rl) === norm(el)) {
    score += 5;
  } else if (
    norm(el).length >= 4 &&
    (norm(rl).includes(norm(el)) || norm(el).includes(norm(rl)))
  ) {
    score += 2; // partial compound overlap (last resort)
  } else {
    return -1; // hard reject
  }

  // ── First name ────────────────────────────────────────────────────────────
  // Any first-letter mismatch → hard reject.
  if (ef) {
    const efFirst = ef[0];
    const rfFirst = rf[0] ?? "";
    if (rfFirst !== efFirst) return -1;

    if (ef.length === 1) {
      score += 2; // initial only — matched
    } else if (rf === ef) {
      score += 5; // exact full first name
    } else if (rf.startsWith(ef) || ef.startsWith(rf)) {
      score += 3; // one is prefix of the other
    } else {
      score += 1; // same initial, different name
    }
  }

  // ── School bonus ──────────────────────────────────────────────────────────
  if (atCornell) score += 4;

  return score;
}

function pickBest(edges, expectedFirst, expectedLast, minScore) {
  const scored = edges
    .map(({ node }) => ({ node, score: scoreMatch(node, expectedFirst, expectedLast) }))
    .filter(({ score }) => score >= 0)
    .sort((a, b) => b.score - a.score);

  if (!scored.length || scored[0].score < minScore) return null;

  const { node } = scored[0];
  return {
    id: node.id,
    firstName: node.firstName,
    lastName: node.lastName,
    avgRating: node.avgRating,
    avgDifficulty: node.avgDifficulty,
    numRatings: node.numRatings,
    wouldTakeAgainPercent: node.wouldTakeAgainPercent,
  };
}

async function rmpSearch(text, schoolID) {
  const resp = await fetch(RMP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Basic dGVzdDp0ZXN0",
    },
    body: JSON.stringify({
      query: SEARCH_QUERY,
      variables: { query: schoolID != null ? { text, schoolID } : { text } },
    }),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const json = await resp.json();
  return json?.data?.search?.teachers?.edges ?? [];
}

async function fetchRating(shortName, fullName) {
  const cacheKey = (fullName || shortName).toLowerCase();
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  // Parse name components.
  // fullName ("Lillian Lee", "Anke van Zuylen") is preferred over shortName ("Lee, L").
  let expectedFirst, expectedLast, searchText;

  if (fullName && fullName !== shortName) {
    const parts = fullName.trim().split(/\s+/);
    expectedFirst = parts[0];
    expectedLast = parts.slice(1).join(" ");
    searchText = fullName;
  } else {
    const ci = shortName.indexOf(",");
    expectedLast = ci >= 0 ? shortName.slice(0, ci).trim() : shortName.trim();
    expectedFirst = ci >= 0 ? shortName.slice(ci + 1).trim() : "";
    searchText = expectedFirst ? `${expectedFirst} ${expectedLast}` : expectedLast;
  }

  let result = null;

  // Pass 1: search the main Cornell school (298).
  // Handles the majority of Cornell professors quickly.
  const edges1 = await rmpSearch(searchText, CORNELL_SCHOOL_IDS[0]).catch((err) => {
    console.error("[RMP] pass1:", err.message);
    return [];
  });
  result = pickBest(edges1, expectedFirst, expectedLast, 9);

  // Pass 2: if not found at school 298, search all other Cornell sub-schools in parallel.
  // Professors in Arts & Sciences, Engineering, etc. may be linked to different school IDs.
  // Parallel requests keep this fast (one extra round-trip, not four sequential ones).
  if (!result) {
    const allEdges = (
      await Promise.all(
        CORNELL_SCHOOL_IDS.slice(1).map((sid) =>
          rmpSearch(searchText, sid).catch(() => [])
        )
      )
    ).flat();

    // Deduplicate by professor ID before scoring
    const unique = [
      ...new Map(allEdges.map((e) => [e.node.id, e])).values(),
    ];
    result = pickBest(unique, expectedFirst, expectedLast, 9);
  }

  // Pass 3: global search as last resort (professors not linked to any known Cornell school).
  // Requires score ≥ 10 (lastName + exact firstName) since there's no school disambiguator.
  if (!result) {
    const edges3 = await rmpSearch(searchText, null).catch((err) => {
      console.error("[RMP] pass3:", err.message);
      return [];
    });
    result = pickBest(edges3, expectedFirst, expectedLast, 10);
  }

  cache.set(cacheKey, result);
  return result;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== "FETCH_RATING") return false;
  fetchRating(message.shortName, message.fullName).then(sendResponse);
  return true;
});

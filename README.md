# RMP for Cornell Roster

A Chrome extension that injects Rate My Professors ratings inline on the [Cornell Course Roster](https://classes.cornell.edu/browse/roster/FA26).

## How it works

### 1. Detecting instructors (`content.js`)

When the roster page loads, the extension scans for professor names using two passes:

- **Pass 1 (title attributes):** Cornell's roster wraps each professor in an `<a>` element with a `title` attribute in the format `"First Last (netid)"`. This gives a full name reliably.
- **Pass 2 (text node walk):** For any instructor not found via a title attribute, the extension walks each DOM text node individually with `TreeWalker`.

Names found by both passes are deduplicated. Each found instructor gets a placeholder badge appended to the `<li>` while the rating is fetched.

### 2. Fetching ratings (`background.js`)

(RMP side)

| Pass | Scope | Min score to accept |
|------|-------|-------------------|
| 1 | Main Cornell school (ID 298) | 9 |
| 2 | Four Cornell sub-schools, queried in parallel | 9 |
| 3 | Global (no school filter) | 10 |

Results are cached in memory for the lifetime of the page.

### 3. Matching candidates (`scoreMatch`)

RMP can return multiple professors with similar names. Each candidate is scored against the expected name:

- **Last name:** exact or normalized match (strips spaces, hyphens, apostrophes, periods) → +5; partial compound overlap → +2; no match → hard reject.
- **First name / initial:** first-letter mismatch → hard reject; initial only → +2; prefix match → +3; exact match → +5.
- **Cornell school bonus:** candidate's school contains "cornell" → +4.

The highest-scoring candidate above the pass threshold is selected. The higher minimum score for the global pass (10 vs 9) compensates for the lack of a school filter.

### 4. Badge display

- **Green** (≥ 4.0): links to the professor's RMP page with their average rating and review count.
- **Orange** (≥ 2.7): same, with a warning color.
- **Red** (< 2.7): same, with a danger color.
- **N/A**: professor was not found on RMP or has no ratings.


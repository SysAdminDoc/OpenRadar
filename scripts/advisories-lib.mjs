/**
 * What the advisory gate decides, with the lock file and the network outside.
 *
 * `cargo audit` reads RustSec. RustSec is not the only place an advisory
 * lands, and the one that started this never reached it: GHSA-qwgh-2vcv-g2f7
 * against `block_buffer` was published in August 2026, has no RustSec entry,
 * and three scanners called this tree clean. Two of them were querying a
 * database that holds it. They missed it on the spelling.
 *
 * Nothing here reads a file or opens a connection.
 */

/**
 * Every crate a `Cargo.lock` holds, as name and version.
 *
 * The lock is TOML, but only a fixed shape of it: `[[package]]` tables each
 * carrying a name and a version. Reading those two lines is the whole job,
 * and pulling a TOML parser in for it would put a dependency on the path of
 * the gate whose subject is dependencies.
 */
export function cratesIn(lock) {
  const found = [];
  let name = null;
  for (const line of lock.split(/\r?\n/)) {
    if (/^\[\[package\]\]/.test(line)) {
      name = null;
      continue;
    }
    const named = /^name = "([^"]+)"/.exec(line);
    if (named) {
      name = named[1];
      continue;
    }
    const versioned = /^version = "([^"]+)"/.exec(line);
    if (versioned && name) {
      found.push({ name, version: versioned[1] });
      name = null;
    }
  }
  return found;
}

/**
 * The names to ask an advisory database about, for one crate.
 *
 * crates.io treats a dash and an underscore as the same character in a
 * package name and the databases do not, so a crate has to be asked about
 * under both. The lock spells it `block-buffer`, the advisory says
 * `block_buffer`, and a query for either one alone answers "nothing known"
 * about the other.
 *
 * Three spellings, not every one: as written, all dashes, all underscores. A
 * name holding both separators has more forms than that, and `winapi-x86_64-
 * pc-windows-gnu` alone has thirty-two, which is a batch of questions about
 * names nobody files anything under. Three covers what a database actually
 * uses, and the limit is written here rather than left as a claim to "every
 * spelling".
 */
export function spellings(name) {
  return [...new Set([name, name.replace(/-/g, "_"), name.replace(/_/g, "-")])];
}

/** One question per spelling per crate, in the order the answers come back. */
export function askedFor(crates) {
  const asked = [];
  for (const crate of crates) {
    for (const spelling of spellings(crate.name)) {
      asked.push({ crate: crate.name, version: crate.version, spelling });
    }
  }
  return asked;
}

/** The querybatch body for a run of questions. */
export function batchBody(asked) {
  return {
    queries: asked.map((one) => ({
      package: { ecosystem: "crates.io", name: one.spelling },
      version: one.version,
    })),
  };
}

/**
 * What a batch of answers found, put back on the crates that were asked about.
 *
 * Deduplicated by crate and advisory, because a crate whose name holds neither
 * a dash nor an underscore is asked about once but a crate whose database
 * entry matches the lock is answered under both spellings.
 */
export function hits(asked, results) {
  const seen = new Set();
  const found = [];
  for (const [at, answer] of results.entries()) {
    const question = asked[at];
    if (!question) continue;
    for (const vuln of answer?.vulns ?? []) {
      const key = `${question.crate} ${vuln.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({
        crate: question.crate,
        version: question.version,
        spelling: question.spelling,
        id: vuln.id,
      });
    }
  }
  return found;
}

/**
 * The advisories this repository has looked at and decided it can live with.
 *
 * An allowance is a claim, so the file has the shape of the one beside it that
 * `cargo audit` reads: comment lines carry the evidence and the date to look
 * again, and the identifier sits under them. An identifier with nothing
 * written above it is not an allowance, it is a silenced alarm, and this
 * reports it rather than honouring it.
 */
export function allowanceIn(text) {
  const allowed = new Map();
  const unexplained = [];
  const malformed = [];
  let reason = [];
  for (const line of text.split(/\r?\n/)) {
    const bare = line.trim();
    if (!bare) {
      reason = [];
      continue;
    }
    if (bare.startsWith("#")) {
      reason.push(bare.replace(/^#\s?/, ""));
      continue;
    }
    if (reason.length) {
      const [id, ...rest] = bare.split(/\s+/);
      const read = needsIn(rest);
      // A clause nobody can read is not an allowance with no condition on it,
      // it is a condition that stopped being checked. Reported rather than
      // dropped, for the same reason an identifier with nothing above it is.
      if (read.malformed) malformed.push(`${id} ${rest.join(" ")}`);
      else allowed.set(id, { reason: reason.join("\n"), needs: read.needs });
    } else {
      unexplained.push(bare);
    }
    reason = [];
  }
  return { allowed, unexplained, malformed };
}

/**
 * The crates an allowance's reasoning rests on, written after the identifier.
 *
 * `GHSA-qwgh-2vcv-g2f7 needs sha2 0.11` says: allowed for only while the lock
 * holds a sha2 whose version starts 0.11. Every reason in that file is a claim
 * about the shape of the tree, and without this the claim and the tree drift
 * apart in silence. Putting this app's own hashing back on sha2 0.10 restores
 * exactly the reachable position that entry says has been fixed, and the run
 * stayed green: the identifier, the crate and the version the advisory is
 * filed against had not moved. What moved was the thing the reason rested on.
 *
 * A version matches as a prefix at a component boundary, so `0.11` covers
 * every patch of it and a move to 0.12 is a reason to read the entry again.
 *
 * Anything after the identifier that is not a well-formed clause comes back
 * as malformed rather than as no clause at all. `needs` misspelled, given a
 * capital, or written as `requires` used to parse to an empty list, which
 * left the allowance applying unconditionally for ever: the one silent
 * failure in a file whose whole principle is that a silenced alarm is worse
 * than a loud one.
 */
function needsIn(words) {
  if (words.length === 0) return { needs: [], malformed: false };
  // An odd number of words after `needs` means a crate with no version, which
  // is a clause somebody meant to finish.
  if (words[0] !== "needs" || words.length < 3 || words.length % 2 === 0) {
    return { needs: [], malformed: true };
  }
  const needs = [];
  for (let at = 1; at < words.length; at += 2) {
    needs.push({ crate: words[at], version: words[at + 1] });
  }
  return { needs, malformed: false };
}

/**
 * Whether the lock still holds what an allowance says it rests on.
 *
 * The version is a prefix, but only one that ends where a version component
 * ends. A bare `startsWith` let `needs base64 0.2` be satisfied by base64
 * 0.22.1 and `needs foo 0.1` by foo 0.19.0, which the pre-1.0 Rust ecosystem
 * runs into constantly: the entry would go on holding against a crate several
 * minor versions past the one whose fix it rests on. No entry in this repo's
 * own file was misled by it, checked against all six needed crates on
 * 2026-09-08, but the mechanism was wrong.
 */
export function unmetNeeds(needs, crates) {
  // A component separator, a prerelease marker or build metadata all end a
  // version component. `needs nexrad-model 1.0.0` has to hold against
  // 1.0.0-rc.2, and `needs ndk-sys 0.6.0` against 0.6.0+11769913; both shapes
  // are in this repository's own lock. Only a digit continuing the number is
  // a different version, which is what `0.2` against 0.22.1 was.
  const holds = (version, wanted) =>
    version === wanted ||
    (version.startsWith(wanted) && ".-+".includes(version[wanted.length]));
  return needs.filter(
    (one) =>
      !crates.some(
        (crate) =>
          crate.name === one.crate &&
          (!one.version || holds(crate.version, one.version)),
      ),
  );
}

/**
 * What a run has to say, given what was found and what is allowed.
 *
 * `stale` is the allowance's own key. An entry naming something no longer in
 * the tree is a reason nobody has re-read, and reporting it is what keeps the
 * file from becoming a list of advisories that stopped applying years ago.
 */
export function verdict(found, allowed, crates = []) {
  // An allowance whose reasoning no longer holds is not an allowance. It
  // stands down rather than quietly covering an advisory whose position in
  // the tree has moved underneath it.
  const voided = new Map();
  for (const [id, entry] of allowed) {
    const missing = unmetNeeds(entry.needs ?? [], crates);
    if (missing.length) voided.set(id, missing);
  }
  const covers = (one) => allowed.has(one.id) && !voided.has(one.id);
  const unexplained = found.filter((one) => !covers(one));
  const explained = found.filter(covers);
  const live = new Set(found.map((one) => one.id));
  const stale = [...allowed.keys()].filter((id) => !live.has(id));
  return { unexplained, explained, stale, voided };
}

/**
 * How many questions to send at once.
 *
 * A whole lock file is several hundred crates and up to two spellings each,
 * so the run is split. Small enough that one refusal does not cost the lot.
 */
export const QUESTIONS_AT_ONCE = 200;

/**
 * The floor under how many crates a run has to read out of the lock.
 *
 * A lock that stops parsing reports a clean tree, which is the one way this
 * gate can fail that looks exactly like passing.
 */
export const FEWEST_PLAUSIBLE_CRATES = 200;

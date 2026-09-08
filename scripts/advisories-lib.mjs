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
        summary: vuln.summary ?? "",
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
      allowed.set(bare, reason.join("\n"));
    } else {
      unexplained.push(bare);
    }
    reason = [];
  }
  return { allowed, unexplained };
}

/**
 * What a run has to say, given what was found and what is allowed.
 *
 * `stale` is the allowance's own key. An entry naming something no longer in
 * the tree is a reason nobody has re-read, and reporting it is what keeps the
 * file from becoming a list of advisories that stopped applying years ago.
 */
export function verdict(found, allowed) {
  const unexplained = found.filter((one) => !allowed.has(one.id));
  const explained = found.filter((one) => allowed.has(one.id));
  const live = new Set(found.map((one) => one.id));
  const stale = [...allowed.keys()].filter((id) => !live.has(id));
  return { unexplained, explained, stale };
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

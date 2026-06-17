import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dbPath = path.join(root, "data", "db.json");
const backupPath = path.join(root, "data", "db.backup-before-people-dedupe.json");

function normalizeLinkedin(url) {
  if (!url) return null;
  return url.toLowerCase().replace(/^https?:\/\/(www\.)?linkedin\.com/, "").replace(/\/$/, "").trim();
}

function normalizeName(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function unique(arr) {
  return Array.from(new Set((arr || []).filter(Boolean)));
}

const STATUS_RANK = { contacted: 5, approved: 4, drafting: 3, new: 2, candidate: 1 };

function personScore(p, db) {
  const drafts = db.drafts.filter((d) => d.personId === p.id);
  const research = db.outreachResearch.filter((r) => r.personId === p.id);
  const activities = db.activities.filter((a) => a.personId === p.id);
  return (
    (STATUS_RANK[p.status] || 0) * 1000 +
    drafts.filter((d) => d.status === "approved").length * 800 +
    drafts.length * 400 +
    research.length * 200 +
    activities.length * 10 +
    (p.email ? 50 : 0) +
    p.confidenceScore
  );
}

// --- load & backup ---
const raw = await fs.readFile(dbPath, "utf8");
const db = JSON.parse(raw);
await fs.writeFile(backupPath, raw);
console.log("Backup written to", path.basename(backupPath));
console.log("People before:", db.people.length);

// --- build duplicate groups ---
// Priority 1: same LinkedIn URL
// Priority 2: same normalised name + company

const linkedinGroups = new Map();   // normalised linkedin → [person]
const nameCompanyGroups = new Map(); // "name|company" → [person]
const assignedToGroup = new Set();   // person IDs already in a linkedin group

for (const p of db.people) {
  const li = normalizeLinkedin(p.linkedinUrl || p.identityKey);
  if (li) {
    if (!linkedinGroups.has(li)) linkedinGroups.set(li, []);
    linkedinGroups.get(li).push(p);
    assignedToGroup.add(p.id);
  }
}

for (const p of db.people) {
  if (assignedToGroup.has(p.id)) continue; // already in a linkedin group
  const key = normalizeName(p.name) + "|" + normalizeName(p.companyName);
  if (!nameCompanyGroups.has(key)) nameCompanyGroups.set(key, []);
  nameCompanyGroups.get(key).push(p);
}

// collect all groups that have duplicates
const dupGroups = [
  ...Array.from(linkedinGroups.values()),
  ...Array.from(nameCompanyGroups.values()),
].filter((g) => g.length > 1);

console.log("Duplicate groups found:", dupGroups.length);

// --- merge each group ---
const removedIds = new Set();
const remapId = new Map(); // removed id → kept id

for (const group of dupGroups) {
  // pick winner: highest score, tie-break by earliest createdAt
  const scored = group.map((p) => ({ p, s: personScore(p, db) }));
  scored.sort((a, b) => b.s - a.s || a.p.createdAt.localeCompare(b.p.createdAt));
  const [winner, ...losers] = scored.map((x) => x.p);

  for (const loser of losers) {
    remapId.set(loser.id, winner.id);
    removedIds.add(loser.id);
  }

  // merge fields onto winner
  winner.linkedinUrl = winner.linkedinUrl || losers.map((l) => l.linkedinUrl).find(Boolean);
  winner.email = winner.email || losers.map((l) => l.email).find(Boolean);
  winner.location = winner.location || losers.map((l) => l.location).find(Boolean);
  winner.title = winner.title || losers.map((l) => l.title).find(Boolean);
  winner.sourceQueryIds = unique([
    ...(winner.sourceQueryIds || []),
    ...losers.flatMap((l) => l.sourceQueryIds || []),
  ]);
  winner.sourceQueryNames = unique([
    ...(winner.sourceQueryNames || []),
    ...losers.flatMap((l) => l.sourceQueryNames || []),
  ]);
  winner.sourceBuckets = unique([
    ...(winner.sourceBuckets || []),
    ...losers.flatMap((l) => l.sourceBuckets || []),
  ]);
  winner.overlapCount = Math.max(winner.overlapCount || 0, winner.sourceQueryIds.length);
  winner.updatedAt = new Date().toISOString();
}

// --- remap related records ---
for (const record of [...db.drafts, ...db.outreachResearch, ...db.activities, ...db.personas]) {
  const newId = remapId.get(record.personId);
  if (newId) record.personId = newId;
}

// --- remove duplicate people ---
db.people = db.people.filter((p) => !removedIds.has(p.id));

// --- write ---
await fs.writeFile(dbPath, JSON.stringify(db, null, 2) + "\n");

const remaining = db.people.length;
console.log("People after:", remaining);
console.log("Removed:", removedIds.size);
console.log("Linked records re-homed:", remapId.size);

// verify no more dups
const byLinkedin = new Map();
for (const p of db.people) {
  const li = normalizeLinkedin(p.linkedinUrl || p.identityKey);
  if (li) byLinkedin.set(li, (byLinkedin.get(li) || 0) + 1);
}
const liDups = [...byLinkedin.values()].filter((c) => c > 1).length;

const byNC = new Map();
for (const p of db.people) {
  const k = normalizeName(p.name) + "|" + normalizeName(p.companyName);
  byNC.set(k, (byNC.get(k) || 0) + 1);
}
const ncDups = [...byNC.values()].filter((c) => c > 1).length;

console.log("Remaining LinkedIn dups:", liDups);
console.log("Remaining name+company dups:", ncDups);

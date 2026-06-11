import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dbPath = path.join(root, "data", "db.json");

function draftKey(draft) {
  if (draft.contactId) return [draft.prospectId || "", "contact", draft.contactId].join("::");
  if (draft.candidateId) return [draft.prospectId || "", "candidate", draft.candidateId].join("::");
  if (draft.outreachResearchId) return [draft.prospectId || "", "research", draft.outreachResearchId].join("::");
  return [draft.prospectId || "", "persona", draft.personaId || "", draft.subject || ""].join("::");
}

function updatedTime(draft) {
  return new Date(draft.updatedAt || draft.createdAt || 0).getTime();
}

const db = JSON.parse(await fs.readFile(dbPath, "utf8"));
const groups = new Map();

for (const draft of db.drafts || []) {
  const key = draftKey(draft);
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(draft);
}

const keptDrafts = [];
const removedDraftIds = [];

for (const drafts of groups.values()) {
  const sorted = drafts.sort((a, b) => updatedTime(b) - updatedTime(a));
  keptDrafts.push(sorted[0]);
  removedDraftIds.push(...sorted.slice(1).map((draft) => draft.id));
}

db.drafts = keptDrafts.sort((a, b) => updatedTime(b) - updatedTime(a));

if (removedDraftIds.length > 0) {
  db.activities = db.activities || [];
  db.activities.push({
    id: crypto.randomUUID(),
    prospectId: "system",
    type: "drafts_deduped",
    message: `Removed ${removedDraftIds.length} duplicate outreach drafts.`,
    createdAt: new Date().toISOString()
  });
}

await fs.writeFile(dbPath, `${JSON.stringify(db, null, 2)}\n`);

console.log(
  JSON.stringify(
    {
      draftsRemaining: db.drafts.length,
      duplicateDraftsRemoved: removedDraftIds.length,
      removedDraftIds
    },
    null,
    2
  )
);

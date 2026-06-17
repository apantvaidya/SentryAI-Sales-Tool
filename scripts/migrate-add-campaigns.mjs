import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dbPath = path.join(root, "data", "db.json");
const backupPath = path.join(root, "data", "db.backup-before-campaigns.json");

const raw = await fs.readFile(dbPath, "utf8");
const db = JSON.parse(raw);
await fs.writeFile(backupPath, raw);

if (!Array.isArray(db.campaigns)) db.campaigns = [];

let defaultCampaign = db.campaigns.find((c) => c.name === "Campaign 0");
if (!defaultCampaign) {
  const timestamp = new Date().toISOString();
  defaultCampaign = { id: crypto.randomUUID(), name: "Campaign 0", createdAt: timestamp, updatedAt: timestamp };
  db.campaigns.push(defaultCampaign);
}

let backfilled = 0;
for (const person of db.people) {
  if (!person.campaignId) {
    person.campaignId = defaultCampaign.id;
    backfilled += 1;
  }
}

await fs.writeFile(dbPath, `${JSON.stringify(db, null, 2)}\n`);

console.log(
  JSON.stringify(
    {
      defaultCampaignId: defaultCampaign.id,
      totalPeople: db.people.length,
      backfilled,
      totalCampaigns: db.campaigns.length
    },
    null,
    2
  )
);

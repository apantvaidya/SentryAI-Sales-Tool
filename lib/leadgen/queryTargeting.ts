import { promises as fs } from "fs";
import path from "path";

const targetingPath = path.join(process.cwd(), "lead_generation_mod", "data", "query_targeting.json");

export type QueryTargeting = {
  querySuffix: string;
  userLocation: string;
};

export const defaultQueryTargeting: QueryTargeting = {
  querySuffix: "Northern California",
  userLocation: "US"
};

export async function getQueryTargeting(): Promise<QueryTargeting> {
  try {
    const raw = await fs.readFile(targetingPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<QueryTargeting>;
    return {
      querySuffix: typeof parsed.querySuffix === "string" ? parsed.querySuffix : defaultQueryTargeting.querySuffix,
      userLocation: typeof parsed.userLocation === "string" ? parsed.userLocation : defaultQueryTargeting.userLocation
    };
  } catch {
    return defaultQueryTargeting;
  }
}

export async function saveQueryTargeting(input: QueryTargeting) {
  const querySuffix = input.querySuffix.trim();
  const userLocation = input.userLocation.trim().toUpperCase();
  if (!querySuffix) throw new Error("Query location text is required.");
  if (!/^[A-Z]{2}$/.test(userLocation)) throw new Error("Exa userLocation must be a 2-letter country code, like US.");

  await fs.mkdir(path.dirname(targetingPath), { recursive: true });
  await fs.writeFile(targetingPath, JSON.stringify({ querySuffix, userLocation }, null, 2) + "\n", "utf8");
}

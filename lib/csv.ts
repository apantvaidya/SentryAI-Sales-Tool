import type { OutreachDraft, Person } from "./data/types";

function parseCsvRow(line: string): string[] {
  const fields: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { field += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      fields.push(field); field = "";
    } else {
      field += ch;
    }
  }
  fields.push(field);
  return fields;
}

export type ParsedCsvRow = Record<string, string>;

export function parsePeopleCsv(csvText: string): ParsedCsvRow[] {
  const lines = csvText.replace(/^﻿/, "").trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = parseCsvRow(lines[0]).map((h) => h.toLowerCase().trim());
  const rows: ParsedCsvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const values = parseCsvRow(lines[i]);
    const row: ParsedCsvRow = {};
    headers.forEach((header, j) => { row[header] = (values[j] ?? "").trim(); });
    // skip draft rows from our own export format
    if (row["recordtype"] === "draft") continue;
    rows.push(row);
  }
  return rows;
}

function escape(value: unknown) {
  const text = Array.isArray(value) ? value.join("; ") : String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

export function personCsv(person: Person, drafts: OutreachDraft[], campaignName: string) {
  const personRow = [
    "person",
    campaignName,
    person.companyName,
    person.name,
    person.title || "",
    person.email || "",
    person.emailVerified ? "verified" : "unverified",
    person.linkedinUrl || "",
    person.confidenceScore,
    person.relevanceReason || "",
    person.notes || "",
    "",
    ""
  ];

  const draftRows = drafts.map((draft) => [
    "draft",
    campaignName,
    person.companyName,
    person.name,
    person.title || "",
    "",
    draft.status,
    "",
    "",
    draft.subject,
    draft.body,
    draft.validationRecommendation || "",
    draft.sourceUrls || []
  ]);

  const rows = [
    [
      "recordType",
      "campaign",
      "company",
      "name",
      "title",
      "email",
      "status",
      "linkedinUrl",
      "score",
      "reasonOrSubject",
      "notesOrBody",
      "validationRecommendation",
      "sourceUrls"
    ],
    personRow,
    ...draftRows
  ];

  return rows.map((row) => row.map(escape).join(",")).join("\n");
}

export function peopleCsv(rows: Array<{ person: Person; draft?: OutreachDraft; campaignName: string }>) {
  const header = [
    "name",
    "campaign",
    "title",
    "company",
    "location",
    "status",
    "score",
    "email",
    "emailVerified",
    "linkedinUrl",
    "relevanceReason",
    "draftStatus",
    "draftSubject",
    "draftBody",
    "draftValidationRecommendation",
    "draftSourceUrls"
  ];

  const dataRows = rows.map(({ person, draft, campaignName }) => [
    person.name,
    campaignName,
    person.title || "",
    person.companyName,
    person.location || "",
    person.status,
    person.confidenceScore,
    person.email || "",
    person.emailVerified ? "verified" : "unverified",
    person.linkedinUrl || "",
    person.relevanceReason || "",
    draft?.status || "",
    draft?.subject || "",
    draft?.body || "",
    draft?.validationRecommendation || "",
    draft?.sourceUrls || []
  ]);

  return [header, ...dataRows].map((row) => row.map(escape).join(",")).join("\n");
}

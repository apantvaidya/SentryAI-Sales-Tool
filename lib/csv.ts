import type { OutreachDraft, Person } from "./data/types";

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

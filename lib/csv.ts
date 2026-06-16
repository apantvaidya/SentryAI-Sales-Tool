import type { OutreachDraft, Person } from "./data/types";

function escape(value: unknown) {
  const text = Array.isArray(value) ? value.join("; ") : String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

export function personCsv(person: Person, drafts: OutreachDraft[]) {
  const personRow = [
    "person",
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

import type { ProspectWorkspace } from "./data/types";

function escape(value: unknown) {
  const text = Array.isArray(value) ? value.join("; ") : String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

export function prospectWorkspaceCsv(workspace: ProspectWorkspace) {
  const contactRows = workspace.contacts.map((contact) => [
    "contact",
    workspace.prospect.companyName,
    contact.name,
    contact.title,
    contact.email || "",
    contact.emailVerified ? "verified" : "unverified",
    contact.linkedinUrl || "",
    contact.confidenceScore,
    contact.relevanceReason || "",
    contact.notes || "",
    "",
    ""
  ]);

  const draftRows = workspace.drafts.map((draft) => {
    const contact = workspace.contacts.find((item) => item.id === draft.contactId);
    return [
      "draft",
      workspace.prospect.companyName,
      contact?.name || "",
      contact?.title || "",
      "",
      draft.status,
      "",
      "",
      draft.subject,
      draft.body,
      draft.validationRecommendation || "",
      draft.sourceUrls || []
    ];
  });

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
    ...contactRows,
    ...draftRows
  ];

  return rows.map((row) => row.map(escape).join(",")).join("\n");
}

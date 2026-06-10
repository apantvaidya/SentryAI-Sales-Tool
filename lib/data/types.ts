export type ProspectStatus = "researching" | "drafting" | "approved" | "contacted";
export type DraftTone = "concise" | "executive" | "technical" | "warm";
export type DraftStatus = "draft" | "approved" | "sent_manually";
export type PipelineStatus = "queued" | "running" | "completed" | "failed";
export type CandidateIdentityKeyType = "linkedinUrl" | "nameCompany";
export type LeadCandidateStatus = "accepted" | "dropped" | "needs_review" | "imported";
export type ValidationRecommendation = "approve" | "human_review" | "reject";

export type Prospect = {
  id: string;
  companyName: string;
  website?: string;
  industry?: string;
  companySize?: string;
  segment?: string;
  notes?: string;
  summary?: string;
  painPoints: string[];
  securityRelevance?: string;
  smartSentryFitScore: number;
  fitRationale?: string;
  status: ProspectStatus;
  createdAt: string;
  updatedAt: string;
};

export type BuyerPersona = {
  id: string;
  prospectId: string;
  personaName: string;
  roleTitles: string[];
  painPoints: string[];
  valueProposition: string;
  objectionHandling: string;
  priorityScore: number;
};

export type Contact = {
  id: string;
  prospectId: string;
  name: string;
  title: string;
  email?: string;
  linkedinUrl?: string;
  source?: string;
  confidenceScore: number;
  relevanceReason?: string;
  bestPersonaMatch?: string;
  notes?: string;
  emailVerified: boolean;
  createdAt: string;
  updatedAt: string;
};

export type OutreachDraft = {
  id: string;
  prospectId: string;
  contactId?: string;
  candidateId?: string;
  personaId?: string;
  outreachResearchId?: string;
  subject: string;
  body: string;
  tone: DraftTone;
  status: DraftStatus;
  personalizationNotes: string[];
  riskFlags: string[];
  sourceUrls?: string[];
  validationRecommendation?: ValidationRecommendation;
  evidenceSummarySnippet?: string;
  createdAt: string;
  updatedAt: string;
};

export type Activity = {
  id: string;
  prospectId: string;
  type: string;
  message: string;
  createdAt: string;
};

export type ProspectWorkspace = {
  prospect: Prospect;
  personas: BuyerPersona[];
  contacts: Contact[];
  drafts: OutreachDraft[];
  activities: Activity[];
  leadGenRuns: LeadGenRun[];
  leadCandidates: LeadCandidate[];
  outreachResearch: OutreachResearch[];
};

export type Database = {
  prospects: Prospect[];
  personas: BuyerPersona[];
  contacts: Contact[];
  drafts: OutreachDraft[];
  activities: Activity[];
  leadGenRuns: LeadGenRun[];
  leadCandidates: LeadCandidate[];
  outreachResearch: OutreachResearch[];
};

export type LeadQueryStats = {
  vectorId: string;
  vectorName: string;
  resultCount: number;
  uniqueCount: number;
  overlapCount: number;
};

export type QueryPairOverlap = {
  queryAId: string;
  queryBId: string;
  sharedCandidateIds: string[];
  sharedCount: number;
};

export type LeadGenRun = {
  id: string;
  prospectId: string;
  seedPersonName: string;
  seedRole?: string;
  seedCompanyName: string;
  seedLinkedinUrl?: string;
  status: PipelineStatus;
  artifactRunId: string;
  artifactPath?: string;
  artifactSchemaVersion?: string;
  importerVersion: "leadgen-import-v1";
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
  errorMessage?: string;
  command?: string;
  exitCode?: number;
  stdoutSnippet?: string;
  stderrSnippet?: string;
  summary?: {
    totalCandidates?: number;
    acceptedCandidates?: number;
    droppedCandidates?: number;
    needsReviewCandidates?: number;
  };
  queryStats?: LeadQueryStats[];
  queryPairOverlaps?: QueryPairOverlap[];
};

export type LeadCandidate = {
  id: string;
  leadGenRunId: string;
  prospectId: string;
  identityKey: string;
  identityKeyType: CandidateIdentityKeyType;
  linkedinUrl?: string;
  fullName: string;
  currentTitle?: string;
  currentCompany?: string;
  resolvedLocation?: string;
  yearsAtCurrentRole?: number;
  sourceQueryIds: string[];
  sourceQueryNames?: string[];
  sourceBuckets?: string[];
  overlapCount: number;
  status: LeadCandidateStatus;
  importedContactId?: string;
  artifactRefs?: {
    mappedCandidateIds?: string[];
    filterDecisionIds?: string[];
    queryIds: string[];
  };
  createdAt: string;
  updatedAt: string;
};

export type OutreachResearch = {
  id: string;
  prospectId: string;
  contactId: string;
  candidateId?: string;
  linkedinUrl?: string;
  company: string;
  location?: string;
  role?: string;
  personaType?: string;
  status: PipelineStatus;
  model?: string;
  pipelineVersion: "warm-outreach-v1";
  querySet: unknown;
  searchResults: unknown;
  evidenceSummary: string;
  validation: unknown;
  sourceUrls: string[];
  validationRecommendation: ValidationRecommendation;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
  errorMessage?: string;
  command?: string;
  exitCode?: number;
  stdoutSnippet?: string;
  stderrSnippet?: string;
};

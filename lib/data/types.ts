export type PersonStatus = "candidate" | "new" | "drafting" | "failed" | "approved" | "contacted";
export type DraftTone = "concise" | "executive" | "technical" | "warm";
export type DraftStatus = "draft" | "approved" | "sent_manually";
export type PipelineStatus = "queued" | "running" | "completed" | "failed";
export type CandidateIdentityKeyType = "linkedinUrl" | "nameCompany";
export type ValidationRecommendation = "approve" | "human_review" | "reject";

export type Campaign = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};

export type Person = {
  id: string;
  campaignId: string;
  status: PersonStatus;
  name: string;
  title?: string;
  email?: string;
  emailVerified: boolean;
  linkedinUrl?: string;
  location?: string;
  yearsAtCurrentRole?: number;
  currentRoleDescription?: string;
  source?: string;
  notes?: string;
  confidenceScore: number;
  relevanceReason?: string;
  bestPersonaMatch?: string;
  companyName: string;
  companyWebsite?: string;
  companyIndustry?: string;
  companySize?: string;
  companySegment?: string;
  companyNotes?: string;
  companySummary?: string;
  companyPainPoints: string[];
  companySecurityRelevance?: string;
  companyFitScore: number;
  companyFitRationale?: string;
  leadGenRunId?: string;
  identityKey?: string;
  identityKeyType?: CandidateIdentityKeyType;
  sourceQueryIds?: string[];
  sourceQueryNames?: string[];
  sourceBuckets?: string[];
  overlapCount?: number;
  artifactRefs?: {
    mappedCandidateIds?: string[];
    filterDecisionIds?: string[];
    queryIds: string[];
  };
  createdAt: string;
  updatedAt: string;
};

export type BuyerPersona = {
  id: string;
  personId: string;
  personaName: string;
  roleTitles: string[];
  painPoints: string[];
  valueProposition: string;
  objectionHandling: string;
  priorityScore: number;
};

export type OutreachDraft = {
  id: string;
  personId: string;
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
  personId: string;
  type: string;
  message: string;
  createdAt: string;
};

export type PersonDetail = {
  person: Person;
  personas: BuyerPersona[];
  drafts: OutreachDraft[];
  activities: Activity[];
  outreachResearch: OutreachResearch[];
};

export type OutreachJobItemStatus = "pending" | "running" | "completed" | "failed" | "canceled";

export type OutreachJobItem = {
  personId: string;
  name: string;
  status: OutreachJobItemStatus;
  errorMessage?: string;
};

export type OutreachJob = {
  id: string;
  items: OutreachJobItem[];
  canceledAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type Database = {
  people: Person[];
  personas: BuyerPersona[];
  drafts: OutreachDraft[];
  activities: Activity[];
  leadGenRuns: LeadGenRun[];
  outreachResearch: OutreachResearch[];
  outreachJobs: OutreachJob[];
  campaigns: Campaign[];
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

export type OutreachResearch = {
  id: string;
  personId: string;
  linkedinUrl?: string;
  company: string;
  location?: string;
  role?: string;
  personaType?: string;
  status: PipelineStatus;
  model?: string;
  pipelineVersion: "warm-outreach-v1" | "warm-outreach-v2";
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

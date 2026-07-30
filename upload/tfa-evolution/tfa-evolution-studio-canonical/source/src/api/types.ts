export interface Workflow {
  id: number;
  projectId: number;
  versionId: number;
  state: string;
  userObjective: string | null;
  errorMessage: string | null;
  analysis: AnalysisResult | null;
  plan: EvolutionPlan | null;
  approvedBy: number | null;
  approvedAt: string | null;
  rejectedBy: number | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  outputArtifactId: number | null;
  createdAt: string;
  updatedAt: string;
  projectName?: string;
  agents?: WorkflowAgent[];
  artifact?: { id: number; filename: string; fileSize: number } | null;
}

export interface AnalysisResult {
  fileCount: number;
  language: string[];
  frameworks: string[];
  complexity: string;
  summary: string;
}

export interface EvolutionPlan {
  objectives: string[];
  expectedOutcomes: string[];
}

export interface WorkflowAgent {
  id: number;
  agentId: string;
  agentName: string;
  tier: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  output: string | null;
  fileOps: FileOp[];
  tokensUsed: number;
  durationMs: number | null;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface FileOp {
  op: 'create' | 'modify' | 'delete' | 'rename';
  path: string;
  content?: string;
  reason: string;
}

export interface Project {
  id: number;
  name: string;
  description: string | null;
  versionCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectVersion {
  id: number;
  projectId: number;
  versionNumber: number;
  filename: string;
  fileSize: number;
  checksum: string;
  createdAt: string;
}

export interface Artifact {
  id: number;
  filename: string;
  fileSize: number;
  workflowId: number | null;
  projectId: number | null;
  createdAt: string;
}

export interface Provider {
  id: number;
  name: string;
  displayName: string;
  model: string;
  enabled: boolean;
  isDefault: boolean;
  available: boolean;
  apiKeyConfigured: boolean;
  latencyMs: number | null;
  lastHealthCheck: string | null;
  lastHealthStatus: boolean | null;
  priority: number;
  timeoutMs: number;
  maxRetries: number;
  costEstimate?: number;
  apiKeyEnvVar?: string;
}

export interface AgentStat {
  id: string;
  name: string;
  tier: string;
  description: string;
  totalRuns: number;
  completedRuns: number;
  failedRuns: number;
  totalTokensUsed: number;
  avgDurationMs: number | null;
  avgConfidenceScore: number | null;
}

export interface AgentObservatoryData {
  byTier: {
    executive: AgentStat[];
    engineering: AgentStat[];
    quality: AgentStat[];
    release: AgentStat[];
  };
}

export interface AppSettings {
  default_provider: string;
  default_model: string;
  max_concurrent_workflows: string;
  zip_max_size_mb: string;
  auto_approve: string;
}

export interface AuditEntry {
  id: number;
  action: string;
  userId: number | null;
  resourceType: string | null;
  resourceId: number | null;
  details: string | null;
  ip: string | null;
  createdAt: string;
}

export interface HealthData {
  status: 'ok' | 'degraded' | 'error';
  db: boolean;
  uptime: number;
  version: string;
  checks?: Record<string, boolean>;
}

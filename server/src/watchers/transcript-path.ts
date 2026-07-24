import path from 'node:path';

// Classify a transcript file path (absolute) into a discriminated shape, relative
// to projectsRoot. Pure — no fs, no chokidar — so it is unit-testable in isolation
// and keeps transcript-watcher.ts small.
//
// Path shapes (relative to projectsRoot, path.sep-split):
//   session:          slug/<session>.jsonl                                       len 2
//   subagent:         slug/<session>/subagents/agent-<id>.jsonl                  len 4
//   workflow agent:   slug/<session>/subagents/workflows/wf_X/agent-<id>.jsonl   len 6
//   workflow journal: slug/<session>/subagents/workflows/wf_X/journal.jsonl      len 6
//
// The workflow check MUST precede the generic `subagents` branch: a workflow path
// also has parts[2]==='subagents', so the plain-subagent logic would otherwise
// take parts[3] ('workflows') as an agentId.

export interface SessionPathInfo {
  kind: 'session';
  projectSlug: string;
  sessionId: string;
}

export interface AgentPathInfo {
  kind: 'agent';
  projectSlug: string;
  sessionId: string;
  agentId: string;
}

export interface WorkflowAgentPathInfo {
  kind: 'workflow-agent';
  projectSlug: string;
  sessionId: string;
  workflowId: string;
  agentId: string;
}

export interface WorkflowJournalPathInfo {
  kind: 'workflow-journal';
  projectSlug: string;
  sessionId: string;
  workflowId: string;
}

export type TranscriptPathInfo =
  | SessionPathInfo
  | AgentPathInfo
  | WorkflowAgentPathInfo
  | WorkflowJournalPathInfo;

export function identifyPath(projectsRoot: string, filePath: string): TranscriptPathInfo {
  const rel = path.relative(projectsRoot, filePath);
  const parts = rel.split(path.sep);
  const projectSlug = parts[0] ?? '';

  // Workflow files live two directory levels deeper than a plain subagent.
  if (parts.length >= 6 && parts[2] === 'subagents' && parts[3] === 'workflows') {
    const sessionId = parts[1] ?? '';
    const workflowId = parts[4] ?? '';
    const base = path.basename(filePath);
    if (base === 'journal.jsonl') {
      return { kind: 'workflow-journal', projectSlug, sessionId, workflowId };
    }
    return {
      kind: 'workflow-agent',
      projectSlug,
      sessionId,
      workflowId,
      agentId: path.basename(base, '.jsonl').replace(/^agent-/, ''),
    };
  }

  if (parts.length >= 4 && parts[2] === 'subagents') {
    return {
      kind: 'agent',
      projectSlug,
      sessionId: parts[1] ?? '',
      agentId: path.basename(parts[3] ?? '', '.jsonl').replace(/^agent-/, ''),
    };
  }

  return { kind: 'session', projectSlug, sessionId: path.basename(filePath, '.jsonl') };
}

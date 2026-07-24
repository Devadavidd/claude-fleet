// Bundled Skills-catalog fixture — data adapted verbatim from the designer
// export (docs/design/fleet-redesign/ck-catalog.js). Rendered by the Skills view
// until the read-only GET /api/skills live-scan endpoint lands in phase 03, at
// which point SkillsCatalog flips its single data-source seam.
import type { SkillCatalog } from "../../../shared/types/index.js";

export const skillCatalogFixture: SkillCatalog = {
  "kit": {
    "name": "Claude Fleet /cf",
    "version": "unsynced",
    "installed": "",
    "codingLevel": "auto",
    "statusline": "full",
    "privacy": true,
    "counts": {
      "skills": 84,
      "agents": 13,
      "outputStyles": 6,
      "hooks": 13,
      "rules": 8
    }
  },
  "categories": [
    {
      "key": "utilities",
      "count": 30
    },
    {
      "key": "dev-tools",
      "count": 23
    },
    {
      "key": "frontend",
      "count": 11
    },
    {
      "key": "multimedia",
      "count": 5
    },
    {
      "key": "frameworks",
      "count": 4
    },
    {
      "key": "ai-ml",
      "count": 3
    },
    {
      "key": "backend",
      "count": 3
    },
    {
      "key": "infrastructure",
      "count": 2
    },
    {
      "key": "security",
      "count": 1
    },
    {
      "key": "database",
      "count": 1
    },
    {
      "key": "other",
      "count": 1
    }
  ],
  "workflow": [
    {
      "key": "plan",
      "skill": "plan",
      "label": "Plan"
    },
    {
      "key": "cook",
      "skill": "cook",
      "label": "Cook"
    },
    {
      "key": "test",
      "skill": "test",
      "label": "Test"
    },
    {
      "key": "review",
      "skill": "code-review",
      "label": "Review"
    },
    {
      "key": "ship",
      "skill": "ship",
      "label": "Ship"
    }
  ],
  "agents": [
    {
      "name": "planner",
      "role": "Designs architecture & phased implementation plans"
    },
    {
      "name": "researcher",
      "role": "Gathers requirements, evaluates tech & prior art"
    },
    {
      "name": "brainstormer",
      "role": "Explores ideas & trade-offs with brutal honesty"
    },
    {
      "name": "fullstack-developer",
      "role": "Implements features across the whole stack"
    },
    {
      "name": "code-reviewer",
      "role": "Evidence-based quality & regression review"
    },
    {
      "name": "code-simplifier",
      "role": "Refactors for clarity, removes complexity"
    },
    {
      "name": "debugger",
      "role": "Root-cause analysis before any fix"
    },
    {
      "name": "tester",
      "role": "Writes & runs unit / integration / e2e tests"
    },
    {
      "name": "ui-ux-designer",
      "role": "Interface, interaction & accessibility design"
    },
    {
      "name": "docs-manager",
      "role": "Keeps project documentation in sync"
    },
    {
      "name": "git-manager",
      "role": "Conventional commits, PRs, merges"
    },
    {
      "name": "journal-writer",
      "role": "Session reflections & change logs"
    },
    {
      "name": "project-manager",
      "role": "Tracks plans, tasks & cross-session state"
    }
  ],
  "skills": [
    {
      "name": "agent-browser",
      "desc": "Automate browsers and apps with agent-browser. Use for testing, screenshots, forms, scraping, Browserbase/cloud browsers, and Electron when real Chrome cookies are not required.",
      "cat": "dev-tools",
      "hint": "[url or task]",
      "keywords": [
        "browser",
        "automation",
        "playwright",
        "testing",
        "e2e",
        "browserbase",
        "autonomous",
        "headless",
        "electron",
        "slack",
        "dogfood",
        "agentcore",
        "vercel-sandbox"
      ],
      "scripts": false,
      "refs": true,
      "maturity": ""
    },
    {
      "name": "agentize",
      "desc": "Convert a codebase, feature, or module into an AI-agent-friendly CLI and/or MCP server. Covers npm packaging, stdio/SSE/Streamable HTTP surfaces, credential resolution, docs, tests, CI, and a companion Claude skill for users who need an existing capability exposed as a reusable agent tool.",
      "cat": "dev-tools",
      "hint": "[feature-or-module] [--both|--mcp|--cli] [--auto|--ask]",
      "keywords": [
        "agentize",
        "mcp",
        "cli",
        "monorepo",
        "npm",
        "cloudflare",
        "docker",
        "agent-tool"
      ],
      "scripts": false,
      "refs": true,
      "maturity": ""
    },
    {
      "name": "ai-artist",
      "desc": "Generate product mockups, marketing assets, brand visuals, and concept art via Nano Banana with 129 curated prompts. Mandatory validation interview refines style/mood/colors (use --skip to bypass). 3 modes: search, creative, wild. Styles: Ukiyo-e, Bento grid, cyberpunk, cinematic, vintage patent.",
      "cat": "ai-ml",
      "hint": "[concept] [--mode search|creative|wild|all] [--provider auto|google|openrouter] [--skip]",
      "keywords": [
        "image",
        "generation",
        "prompts",
        "styles"
      ],
      "scripts": true,
      "refs": true,
      "maturity": ""
    },
    {
      "name": "ai-multimodal",
      "desc": "Analyze images/audio/video with Gemini API (better vision than Claude). Generate images (Imagen 4, Nano Banana 2, MiniMax), videos (Veo 3, Hailuo), speech (MiniMax TTS), music (MiniMax). Use for vision analysis, transcription, OCR, design extraction, multimodal AI.",
      "cat": "ai-ml",
      "hint": "[file-path] [prompt]",
      "keywords": [
        "vision",
        "image",
        "video",
        "audio",
        "Gemini"
      ],
      "scripts": true,
      "refs": true,
      "maturity": ""
    },
    {
      "name": "ask",
      "desc": "Answer technical and architectural questions with expert analysis. Use for design decisions, best practices evaluation, solution comparison.",
      "cat": "utilities",
      "hint": "[technical-question]",
      "keywords": [
        "questions",
        "consultation",
        "architecture"
      ],
      "scripts": false,
      "refs": false,
      "maturity": ""
    },
    {
      "name": "backend-development",
      "desc": "Build backends with Node.js, Python, Go (NestJS, FastAPI, Django). Use for REST/GraphQL/gRPC APIs, auth (OAuth, JWT), databases, microservices, security (OWASP), Docker/K8s.",
      "cat": "backend",
      "hint": "[framework] [task]",
      "keywords": [
        "nodejs",
        "python",
        "go",
        "api",
        "rest",
        "graphql"
      ],
      "scripts": false,
      "refs": true,
      "maturity": ""
    },
    {
      "name": "better-auth",
      "desc": "Add authentication with Better Auth (TypeScript). Use for email/password, OAuth providers (Google, GitHub), 2FA/MFA, passkeys/WebAuthn, sessions, RBAC, rate limiting.",
      "cat": "backend",
      "hint": "[auth-method or feature]",
      "keywords": [
        "auth",
        "oauth",
        "2fa",
        "passkeys",
        "sessions"
      ],
      "scripts": true,
      "refs": true,
      "maturity": ""
    },
    {
      "name": "bootstrap",
      "desc": "Bootstrap new projects with research, tech stack, design, planning, and implementation. Modes: full (default interactive), auto (explicit autonomous), fast (skip research), parallel (multi-agent).",
      "cat": "utilities",
      "hint": "[requirements] [--full|--auto|--fast|--parallel]",
      "keywords": [
        "scaffold",
        "project",
        "setup",
        "boilerplate"
      ],
      "scripts": false,
      "refs": true,
      "maturity": ""
    },
    {
      "name": "brainstorm",
      "desc": "Brainstorm solutions with trade-off analysis and brutal honesty. Use for ideation, architecture decisions, technical debates, feature exploration, feasibility assessment, design discussions.",
      "cat": "utilities",
      "hint": "[topic or problem]",
      "keywords": [
        "ideation",
        "tradeoffs",
        "debate",
        "decisions"
      ],
      "scripts": false,
      "refs": false,
      "maturity": ""
    },
    {
      "name": "chrome-profile",
      "desc": "Target a real Google Chrome profile for browser automation through Chrome DevTools MCP or claude-in-chrome. Provides a chrome-profile CLI, profile discovery, bridge diagnostics, setup playbooks, and the URL-anchor workflow for selecting the correct profile tab.",
      "cat": "dev-tools",
      "hint": "",
      "keywords": [
        "chrome",
        "browser",
        "profile",
        "mcp",
        "devtools",
        "automation",
        "cookies"
      ],
      "scripts": true,
      "refs": true,
      "maturity": ""
    },
    {
      "name": "ck-autoresearch",
      "desc": "Autoresearch is the upstream meta-framework (Udit Goenka, MIT) for autonomous goal-directed iteration with safety guardrails. Locally split into 4 specialized skills. Start here to learn the pattern, then route to the right specialized skill.",
      "cat": "utilities",
      "hint": "",
      "keywords": [
        "autoresearch",
        "autonomous",
        "iteration",
        "karpathy",
        "framework",
        "lineage",
        "router",
        "umbrella"
      ],
      "scripts": false,
      "refs": false,
      "maturity": ""
    },
    {
      "name": "ck-code-review",
      "desc": "Review code quality with evidence-based rigor. Supports input modes: pending changes, PR number, commit hash, and codebase scan. Focuses on bugs, regressions, maintainability, reliability, and verification gaps.",
      "cat": "utilities",
      "hint": "[#PR | COMMIT | --pending | codebase [parallel]]",
      "keywords": [
        "review",
        "quality",
        "verification",
        "reliability"
      ],
      "scripts": false,
      "refs": true,
      "maturity": ""
    },
    {
      "name": "ck-debug",
      "desc": "Debug systematically with root cause analysis before fixes. Use for bugs, test failures, unexpected behavior, performance issues, call stack tracing, multi-layer validation, log analysis, CI/CD failures, database diagnostics, system investigation.",
      "cat": "utilities",
      "hint": "[error or issue description]",
      "keywords": [
        "debug",
        "root-cause",
        "bugs",
        "test-failures"
      ],
      "scripts": true,
      "refs": true,
      "maturity": ""
    },
    {
      "name": "ck-graphify",
      "desc": "Build queryable knowledge graphs from code, docs, papers, and images. Use for codebase understanding, architecture analysis, cross-file relationship discovery, token-efficient navigation.",
      "cat": "dev-tools",
      "hint": "[path] [--mcp|--report|--watch]",
      "keywords": [
        "knowledge-graph",
        "code-analysis",
        "tree-sitter",
        "codebase-understanding",
        "ast"
      ],
      "scripts": false,
      "refs": false,
      "maturity": "beta"
    },
    {
      "name": "ck-loop",
      "desc": "Autonomous iterative optimization loop — run N iterations against a mechanical metric, learn from git history, auto-keep/discard changes. Use for improving measurable metrics (coverage, performance, bundle size, etc.) through repeated experimentation.",
      "cat": "utilities",
      "hint": "[Goal/Metric description] or inline config block",
      "keywords": [
        "optimization",
        "iteration",
        "metrics",
        "loop"
      ],
      "scripts": false,
      "refs": true,
      "maturity": ""
    },
    {
      "name": "ck-plan",
      "desc": "Plan implementations, design architectures, create technical roadmaps with detailed phases. Use for feature planning, system design, solution architecture, implementation strategy, phase documentation.",
      "cat": "utilities",
      "hint": "[task] [--fast|--hard|--deep|--parallel|--two] [--tdd|--no-tasks] OR [archive|red-team|validate]",
      "keywords": [
        "planning",
        "architecture",
        "phases",
        "roadmap"
      ],
      "scripts": false,
      "refs": true,
      "maturity": ""
    },
    {
      "name": "ck-predict",
      "desc": "5 expert personas debate proposed changes before implementation. Catches architectural, security, performance, and UX issues early. Use before major features or risky changes.",
      "cat": "utilities",
      "hint": "<feature description or change proposal> [--files <glob>] [--chain reason|probe]",
      "keywords": [
        "prediction",
        "debate",
        "review",
        "risk"
      ],
      "scripts": false,
      "refs": true,
      "maturity": ""
    },
    {
      "name": "ck-scenario",
      "desc": "Generate comprehensive edge cases and test scenarios by decomposing features across 12 dimensions. Use for pre-implementation risk discovery, QA planning, regression design, and iterative saturation when coverage must be exhaustive.",
      "cat": "utilities",
      "hint": "<file path or feature description> [--iterations N] [--saturation]",
      "keywords": [
        "edge-cases",
        "test-scenarios",
        "dimensions",
        "saturation",
        "iterations"
      ],
      "scripts": false,
      "refs": true,
      "maturity": ""
    },
    {
      "name": "ck-security",
      "desc": "STRIDE + OWASP-based security audit with optional red-team persona discovery loop and auto-fix. Scans code for vulnerabilities from multiple attacker perspectives (auth attacker, supply chain, insider, infrastructure), categorizes by severity, and can iteratively fix findings using ck:autoresearch pattern.",
      "cat": "utilities",
      "hint": "<scope glob or 'full'> [--fix] [--red-team] [--iterations N]",
      "keywords": [
        "security",
        "STRIDE",
        "OWASP",
        "audit",
        "red-team",
        "penetration-testing",
        "vulnerability-discovery"
      ],
      "scripts": false,
      "refs": true,
      "maturity": ""
    },
    {
      "name": "coding-level",
      "desc": "Set coding experience level for tailored output. Use for adjusting explanation depth, code complexity, and response format to user expertise.",
      "cat": "utilities",
      "hint": "[0-5]",
      "keywords": [
        "experience",
        "level",
        "explanation",
        "format"
      ],
      "scripts": false,
      "refs": false,
      "maturity": ""
    },
    {
      "name": "context-engineering",
      "desc": "Check context usage limits, monitor time remaining, optimize token consumption, debug context failures. Use when asking about context percentage, rate limits, usage warnings, context optimization, agent architectures, memory systems.",
      "cat": "utilities",
      "hint": "[topic or question]",
      "keywords": [
        "context",
        "tokens",
        "limits",
        "memory",
        "optimization"
      ],
      "scripts": true,
      "refs": true,
      "maturity": ""
    },
    {
      "name": "cook",
      "desc": "Implement features, plans, and fixes with structured workflow. Use for feature development, plan execution, code implementation pipelines.",
      "cat": "utilities",
      "hint": "[task|plan-path] [--interactive|--fast|--parallel|--auto|--no-test] [--tdd]",
      "keywords": [
        "implementation",
        "workflow",
        "feature",
        "pipeline"
      ],
      "scripts": false,
      "refs": true,
      "maturity": ""
    },
    {
      "name": "copywriting",
      "desc": "Conversion copywriting formulas, headline templates, email copy patterns, landing page structures, CTA optimization, and writing style extraction. Activate for writing high-converting copy, crafting headlines, email campaigns, landing pages, or applying custom writing styles from assets/writing-styles/ directory.",
      "cat": "utilities",
      "hint": "[copy-type] [context]",
      "keywords": [
        "copy",
        "headlines",
        "email",
        "landing-page"
      ],
      "scripts": true,
      "refs": true,
      "maturity": ""
    },
    {
      "name": "cti-expert",
      "desc": "Analyze cyber threat intelligence and OSINT cases. Use for exposure reviews, domain recon, breach checks, username/email/phone research, image forensics, blockchain tracing, darknet checks, cloud tenant recon, vulnerability lookup, threat modeling, and structured reports.",
      "cat": "security",
      "hint": "[target] [--yolo] [--case|--sweep|--query|--flow]",
      "keywords": [
        "osint",
        "cti",
        "threat-intelligence",
        "recon",
        "investigation",
        "darknet",
        "breach",
        "forensics"
      ],
      "scripts": true,
      "refs": false,
      "maturity": ""
    },
    {
      "name": "databases",
      "desc": "Design schemas, write queries for MongoDB and PostgreSQL. Use for database design, SQL/NoSQL queries, aggregation pipelines, indexes, migrations, replication, performance optimization, psql CLI.",
      "cat": "database",
      "hint": "[query or schema task]",
      "keywords": [
        "mongodb",
        "postgresql",
        "sql",
        "schemas",
        "queries"
      ],
      "scripts": true,
      "refs": true,
      "maturity": ""
    },
    {
      "name": "deploy",
      "desc": "Deploy projects to any platform with auto-detection. Use when user says \"deploy\", \"publish\", \"ship\", \"go live\", \"push to production\", \"host this app\", or mentions any hosting platform (Vercel, Netlify, Cloudflare, Railway, Fly.io, Render, Heroku, TOSE, Github Pages, AWS, GCP, Digital Ocean, Vultr, Coolify, Dokploy). Auto-detects deployment target from config files and docs/deployment.md.",
      "cat": "infrastructure",
      "hint": "[platform] [environment]",
      "keywords": [
        "deploy",
        "hosting",
        "Vercel",
        "Netlify",
        "Cloudflare"
      ],
      "scripts": false,
      "refs": true,
      "maturity": ""
    },
    {
      "name": "design",
      "desc": "Design brand identity, logos, banners, and visual assets. Use for brand systems, design tokens, corporate identity programs. Not for UI code patterns.",
      "cat": "frontend",
      "hint": "[design-type] [context]",
      "keywords": [
        "brand",
        "logo",
        "CIP",
        "banners",
        "identity"
      ],
      "scripts": true,
      "refs": true,
      "maturity": ""
    },
    {
      "name": "devops",
      "desc": "Deploy to Cloudflare (Workers, R2, D1), Docker, GCP (Cloud Run, GKE), Kubernetes (kubectl, Helm). Use for serverless, containers, CI/CD, GitOps, security audit.",
      "cat": "infrastructure",
      "hint": "[platform] [task]",
      "keywords": [
        "cloudflare",
        "docker",
        "gcp",
        "kubernetes",
        "cicd"
      ],
      "scripts": true,
      "refs": true,
      "maturity": ""
    },
    {
      "name": "docs",
      "desc": "Analyze codebase and manage project documentation. Use for doc initialization, updates, summaries, codebase analysis.",
      "cat": "utilities",
      "hint": "init|update|summarize",
      "keywords": [
        "documentation",
        "init",
        "update",
        "summarize"
      ],
      "scripts": false,
      "refs": true,
      "maturity": ""
    },
    {
      "name": "docs-seeker",
      "desc": "Search library/framework documentation via llms.txt (context7.com). Use for API docs, GitHub repository analysis, technical documentation lookup, latest library features.",
      "cat": "dev-tools",
      "hint": "[library-name] [topic]",
      "keywords": [
        "docs",
        "llms-txt",
        "api",
        "library",
        "context7"
      ],
      "scripts": true,
      "refs": true,
      "maturity": ""
    },
    {
      "name": "document-skills/docx",
      "desc": "Create, edit, analyze .docx Word documents. Use for document creation, tracked changes, comments, formatting preservation, text extraction, template modification.",
      "cat": "multimedia",
      "hint": "",
      "keywords": [
        "docx",
        "word",
        "document",
        "office"
      ],
      "scripts": true,
      "refs": false,
      "maturity": ""
    },
    {
      "name": "document-skills/pdf",
      "desc": "Extract text/tables, create, merge, split PDFs. Fill PDF forms programmatically. Use for PDF processing, generation, form filling, document analysis, batch operations.",
      "cat": "multimedia",
      "hint": "",
      "keywords": [
        "pdf",
        "extract",
        "text",
        "pages"
      ],
      "scripts": true,
      "refs": false,
      "maturity": ""
    },
    {
      "name": "document-skills/pptx",
      "desc": "Create, edit, analyze .pptx PowerPoint files. Use for presentations, slides, layouts, speaker notes, template modification, content extraction, slide generation.",
      "cat": "multimedia",
      "hint": "",
      "keywords": [
        "pptx",
        "powerpoint",
        "slides",
        "office"
      ],
      "scripts": true,
      "refs": false,
      "maturity": ""
    },
    {
      "name": "document-skills/xlsx",
      "desc": "Create, edit, analyze spreadsheets (.xlsx, .csv, .tsv). Use for Excel formulas, data analysis, visualization, formatting, pivot tables, charts, formula recalculation.",
      "cat": "multimedia",
      "hint": "",
      "keywords": [
        "xlsx",
        "excel",
        "spreadsheet",
        "data"
      ],
      "scripts": false,
      "refs": false,
      "maturity": ""
    },
    {
      "name": "excalidraw",
      "desc": "Create Excalidraw diagrams — architecture, data flow, workflows, system design. Use when user wants to visualize, diagram, draw architecture, show data flow, create flowcharts, map components, or export .excalidraw files to PNG/SVG. Supports two modes: live MCP canvas (real-time) or file-based JSON + Playwright rendering. Also supports zero-config codebase auto-diagramming — just say \"diagram this repo\" or \"visualize the architecture\".",
      "cat": "dev-tools",
      "hint": "",
      "keywords": [
        "diagrams",
        "architecture",
        "flowcharts",
        "whiteboard",
        "SVG"
      ],
      "scripts": false,
      "refs": true,
      "maturity": ""
    },
    {
      "name": "find-skills",
      "desc": "Helps users discover and install agent skills when they ask questions like \"how do I do X\", \"find a skill for X\", \"is there a skill that can...\", or express interest in extending capabilities. This skill should be used when the user is looking for functionality that might exist as an installable skill.",
      "cat": "dev-tools",
      "hint": "[capability or task description]",
      "keywords": [
        "discover",
        "install",
        "skills",
        "search"
      ],
      "scripts": false,
      "refs": false,
      "maturity": ""
    },
    {
      "name": "fix",
      "desc": "Fix bugs, errors, test failures, and CI/CD issues with intelligent routing. Use for type errors, lint issues, log errors, UI bugs, code problems.",
      "cat": "utilities",
      "hint": "[issue] --auto|--review|--quick|--parallel",
      "keywords": [
        "bugfix",
        "error",
        "test-failure",
        "CI",
        "lint"
      ],
      "scripts": false,
      "refs": true,
      "maturity": ""
    },
    {
      "name": "frontend-design",
      "desc": "Create polished frontend interfaces from designs/screenshots/videos. Use for web components, 3D experiences, replicating UI designs, quick prototypes, immersive interfaces, avoiding AI slop.",
      "cat": "frontend",
      "hint": "",
      "keywords": [
        "ui",
        "design",
        "screenshots",
        "prototyping"
      ],
      "scripts": false,
      "refs": true,
      "maturity": ""
    },
    {
      "name": "frontend-development",
      "desc": "Build React/TypeScript frontends with modern patterns. Use for components, Suspense, lazy loading, useSuspenseQuery, MUI v7 styling, TanStack Router, performance optimization.",
      "cat": "frontend",
      "hint": "[component or feature]",
      "keywords": [
        "react",
        "typescript",
        "components",
        "mui"
      ],
      "scripts": false,
      "refs": false,
      "maturity": ""
    },
    {
      "name": "git",
      "desc": "Git operations with conventional commits. Use for staging, committing, pushing, PRs, merges. Auto-splits commits by type/scope. Security scans for secrets.",
      "cat": "dev-tools",
      "hint": "cm|cp|pr|merge [args]",
      "keywords": [
        "git",
        "commits",
        "staging",
        "PR",
        "merge"
      ],
      "scripts": false,
      "refs": true,
      "maturity": ""
    },
    {
      "name": "gkg",
      "desc": "Semantic code analysis with GitLab Knowledge Graph. Use for go-to-definition, find-usages, impact analysis, architecture visualization. Supports Ruby, Java, Kotlin, Python, TypeScript/JavaScript.",
      "cat": "dev-tools",
      "hint": "[symbol or query]",
      "keywords": [
        "code-analysis",
        "knowledge-graph",
        "gitlab"
      ],
      "scripts": false,
      "refs": true,
      "maturity": ""
    },
    {
      "name": "google-adk-python",
      "desc": "Build AI agents with Google ADK Python. Multi-agent systems, A2A protocol, MCP tools, workflow agents, state/memory, callbacks/plugins, Vertex AI deployment, evaluation.",
      "cat": "ai-ml",
      "hint": "[agent or feature]",
      "keywords": [
        "google-adk",
        "agents",
        "a2a",
        "mcp",
        "vertex-ai"
      ],
      "scripts": false,
      "refs": true,
      "maturity": ""
    },
    {
      "name": "journal",
      "desc": "Write technical journal entries analyzing recent changes. Use for session reflections, change analysis, decision documentation.",
      "cat": "utilities",
      "hint": "[topic or reflection]",
      "keywords": [
        "journal",
        "reflection",
        "changes",
        "session"
      ],
      "scripts": false,
      "refs": false,
      "maturity": ""
    },
    {
      "name": "llms",
      "desc": "Generate llms.txt files from docs or codebase scanning. Follows llmstxt.org spec. Use for LLM-friendly site indexes, documentation summaries, AI context optimization.",
      "cat": "dev-tools",
      "hint": "[path|url] [--full] [--output path]",
      "keywords": [
        "llms-txt",
        "documentation",
        "AI-context"
      ],
      "scripts": true,
      "refs": true,
      "maturity": ""
    },
    {
      "name": "markdown-novel-viewer",
      "desc": "View markdown files in a calm, book-like reader served via HTTP. Use for long-form content review — RFCs, runbooks, design docs, reports, specs, novels — anywhere you want a distraction-free reading mode in the browser.",
      "cat": "utilities",
      "hint": "[file-or-directory]",
      "keywords": [
        "markdown",
        "viewer",
        "reading",
        "preview"
      ],
      "scripts": true,
      "refs": false,
      "maturity": ""
    },
    {
      "name": "mcp-builder",
      "desc": "Build MCP servers for LLM-external service integration. Use for FastMCP (Python), MCP SDK (Node/TypeScript), tool design, API integration, resource providers.",
      "cat": "dev-tools",
      "hint": "[service or API to integrate]",
      "keywords": [
        "MCP",
        "server",
        "tools",
        "integration"
      ],
      "scripts": true,
      "refs": false,
      "maturity": ""
    },
    {
      "name": "media-processing",
      "desc": "Process media with FFmpeg (video/audio), ImageMagick (images), RMBG (AI background removal). Use for encoding, format conversion, filters, thumbnails, batch processing, HLS/DASH streaming.",
      "cat": "multimedia",
      "hint": "[input-file] [operation]",
      "keywords": [
        "ffmpeg",
        "imagemagick",
        "video",
        "audio",
        "images"
      ],
      "scripts": true,
      "refs": true,
      "maturity": ""
    },
    {
      "name": "mermaidjs-v11",
      "desc": "Create diagrams with Mermaid.js v11 syntax. Use for flowcharts, sequence diagrams, class diagrams, ER diagrams, Gantt charts, state diagrams, architecture diagrams, timelines, user journeys.",
      "cat": "utilities",
      "hint": "[diagram-type or description]",
      "keywords": [
        "mermaid",
        "diagrams",
        "flowcharts",
        "charts"
      ],
      "scripts": false,
      "refs": true,
      "maturity": ""
    },
    {
      "name": "mintlify",
      "desc": "Build and maintain Mintlify documentation sites. Covers docs.json, MDX components, navigation, page frontmatter, theming, OpenAPI/AsyncAPI, AI docs assets such as llms.txt and skill.md, deployment targets, and local validation CLI commands.",
      "cat": "dev-tools",
      "hint": "[task] [path]",
      "keywords": [
        "docs-site",
        "API-docs",
        "MDX",
        "Mintlify"
      ],
      "scripts": false,
      "refs": true,
      "maturity": ""
    },
    {
      "name": "mobile-development",
      "desc": "Build mobile apps with React Native, Flutter, Swift/SwiftUI, Kotlin/Jetpack Compose. Use for iOS/Android, mobile UX, performance optimization, offline-first, app store deployment.",
      "cat": "frameworks",
      "hint": "[platform] [feature]",
      "keywords": [
        "react-native",
        "flutter",
        "swift",
        "kotlin",
        "ios"
      ],
      "scripts": false,
      "refs": true,
      "maturity": ""
    },
    {
      "name": "payment-integration",
      "desc": "Integrate payments with SePay (VietQR), Polar, Stripe, Paddle (MoR subscriptions), Creem.io (licensing). Checkout, webhooks, subscriptions, QR codes, multi-provider orders.",
      "cat": "backend",
      "hint": "[provider] [task]",
      "keywords": [
        "payments",
        "stripe",
        "polar",
        "webhooks",
        "qr"
      ],
      "scripts": true,
      "refs": true,
      "maturity": ""
    },
    {
      "name": "plans-kanban",
      "desc": "Open the ClaudeKit plans dashboard in the CLI config UI. Use for plan kanban views, progress tracking, timeline checks, and quick navigation into plan files.",
      "cat": "dev-tools",
      "hint": "[deprecated flags are accepted with warnings]",
      "keywords": [
        "plans",
        "dashboard",
        "kanban",
        "progress",
        "timeline"
      ],
      "scripts": true,
      "refs": false,
      "maturity": ""
    },
    {
      "name": "preview",
      "desc": "View files or generate visual explanations, slides, and diagrams. Use for code walkthroughs, architecture visualization, HTML/Markdown presentations.",
      "cat": "utilities",
      "hint": "[path] OR [--html] --explain|--slides|--diagram|--ascii [topic] OR --html --diff|--plan-review|--recap",
      "keywords": [
        "preview",
        "visual",
        "slides",
        "diagrams",
        "HTML"
      ],
      "scripts": false,
      "refs": true,
      "maturity": ""
    },
    {
      "name": "problem-solving",
      "desc": "Apply systematic problem-solving techniques when stuck. Use for complexity spirals, innovation blocks, recurring patterns, assumption constraints, simplification cascades, scale uncertainty.",
      "cat": "utilities",
      "hint": "[problem description]",
      "keywords": [
        "problem-solving",
        "stuck",
        "patterns",
        "simplify"
      ],
      "scripts": false,
      "refs": true,
      "maturity": ""
    },
    {
      "name": "project-management",
      "desc": "Track progress, update plan statuses, manage Claude Tasks, generate reports, coordinate docs updates. Use for project oversight, status checks, plan completion, task hydration, cross-session continuity.",
      "cat": "utilities",
      "hint": "[task: status, hydrate, sync, report]",
      "keywords": [
        "project",
        "progress",
        "status",
        "reports"
      ],
      "scripts": false,
      "refs": true,
      "maturity": ""
    },
    {
      "name": "project-organization",
      "desc": "Organize files, directories, and content structure in any project. Use when creating files, determining output paths, organizing existing assets, or standardizing project layout.",
      "cat": "utilities",
      "hint": "[directories or files to organize]",
      "keywords": [
        "files",
        "directories",
        "structure",
        "layout"
      ],
      "scripts": false,
      "refs": true,
      "maturity": ""
    },
    {
      "name": "react-best-practices",
      "desc": "Apply React and Next.js performance optimization patterns from Vercel Engineering. Use for component optimization, rendering performance, bundle analysis.",
      "cat": "frontend",
      "hint": "[component or pattern]",
      "keywords": [
        "react",
        "nextjs",
        "performance",
        "vercel"
      ],
      "scripts": false,
      "refs": false,
      "maturity": ""
    },
    {
      "name": "remotion",
      "desc": "Build video content with Remotion in React. Use for programmatic video creation, animated sequences, data-driven video rendering.",
      "cat": "frontend",
      "hint": "[video or component]",
      "keywords": [
        "video",
        "react",
        "remotion",
        "rendering"
      ],
      "scripts": false,
      "refs": false,
      "maturity": ""
    },
    {
      "name": "repomix",
      "desc": "Pack repositories into AI-friendly files with Repomix (XML, Markdown, plain text). Use for new-project onboarding, codebase snapshots, LLM context preparation, security audits, third-party library analysis.",
      "cat": "dev-tools",
      "hint": "[path] [--style xml|markdown|plain|json]",
      "keywords": [
        "codebase",
        "pack",
        "snapshot",
        "llm-context"
      ],
      "scripts": true,
      "refs": true,
      "maturity": ""
    },
    {
      "name": "research",
      "desc": "Research technical solutions, analyze architectures, gather requirements thoroughly. Use for technology evaluation, best practices research, solution design, scalability/security/maintainability analysis.",
      "cat": "utilities",
      "hint": "[topic]",
      "keywords": [
        "research",
        "evaluation",
        "analysis",
        "solutions"
      ],
      "scripts": false,
      "refs": false,
      "maturity": ""
    },
    {
      "name": "retro",
      "desc": "Generate data-driven sprint retrospectives from any git history. Use for sprint reviews, commit analysis, code-health indicators, team-velocity reporting, and quarterly engineering reviews. Works on solo or team repos.",
      "cat": "utilities",
      "hint": "[timeframe] [--compare] [--team] [--format html|md]",
      "keywords": [
        "retrospective",
        "sprint",
        "metrics",
        "review"
      ],
      "scripts": false,
      "refs": true,
      "maturity": ""
    },
    {
      "name": "scout",
      "desc": "Fast codebase scouting using parallel agents. Use for file discovery, task context gathering, quick searches across directories. Supports internal (Explore) and external (Gemini/OpenCode) agents.",
      "cat": "dev-tools",
      "hint": "[search-target] [ext]",
      "keywords": [
        "codebase",
        "scouting",
        "file-discovery",
        "search"
      ],
      "scripts": false,
      "refs": true,
      "maturity": ""
    },
    {
      "name": "security-scan",
      "desc": "Scan codebase for security vulnerabilities, hardcoded secrets, dependency issues, and OWASP patterns. Use when asked to 'security scan', 'check for secrets', 'audit security', or before major releases.",
      "cat": "utilities",
      "hint": "[scope] [--secrets-only] [--deps-only] [--full]",
      "keywords": [
        "security",
        "secrets",
        "vulnerabilities",
        "OWASP"
      ],
      "scripts": false,
      "refs": true,
      "maturity": ""
    },
    {
      "name": "sequential-thinking",
      "desc": "Apply step-by-step analysis for complex problems with revision capability. Use for multi-step reasoning, hypothesis verification, adaptive planning, problem decomposition, course correction.",
      "cat": "utilities",
      "hint": "[problem to analyze step-by-step]",
      "keywords": [
        "reasoning",
        "step-by-step",
        "analysis"
      ],
      "scripts": true,
      "refs": true,
      "maturity": ""
    },
    {
      "name": "shader",
      "desc": "Write GLSL fragment shaders for procedural graphics. Topics: shapes (SDF), patterns, noise (Perlin/simplex/cellular), fBm, colors (HSB/RGB), matrices, gradients, animations. Use for generative art, textures, visual effects, WebGL, Three.js shaders.",
      "cat": "frontend",
      "hint": "[effect or pattern]",
      "keywords": [
        "glsl",
        "shaders",
        "procedural",
        "webgl"
      ],
      "scripts": false,
      "refs": true,
      "maturity": ""
    },
    {
      "name": "ship",
      "desc": "Ship pipeline: merge main, test, review, commit, push, PR. Single command from feature branch to PR URL. Use for shipping official releases to main/master or beta releases to dev/beta branches.",
      "cat": "dev-tools",
      "hint": "[official|beta] [--skip-tests] [--skip-review] [--skip-journal] [--skip-docs] [--dry-run]",
      "keywords": [
        "ship",
        "PR",
        "merge",
        "push",
        "release"
      ],
      "scripts": false,
      "refs": true,
      "maturity": ""
    },
    {
      "name": "shopify",
      "desc": "Build Shopify apps, extensions, themes with Shopify CLI. Use for GraphQL/REST APIs, Polaris UI, Liquid templates, checkout customization, webhooks, billing integration.",
      "cat": "frameworks",
      "hint": "[extension-type] [feature]",
      "keywords": [
        "shopify",
        "polaris",
        "liquid",
        "checkout"
      ],
      "scripts": true,
      "refs": true,
      "maturity": ""
    },
    {
      "name": "show-off",
      "desc": "Create stunning self-contained HTML pages to showcase work. Use for demos, visual presentations, interactive showcases.",
      "cat": "other",
      "hint": "[markdown-or-prompt]",
      "keywords": [
        "HTML",
        "showcase",
        "demo",
        "presentation"
      ],
      "scripts": true,
      "refs": false,
      "maturity": ""
    },
    {
      "name": "skill-creator",
      "desc": "Create or update Claude skills with eval-driven iteration. Use for new skills, skill scripts, references, benchmark optimization, description optimization, eval testing, extending Claude's capabilities.",
      "cat": "dev-tools",
      "hint": "[skill-name or description]",
      "keywords": [
        "skills",
        "authoring",
        "eval",
        "testing",
        "templates"
      ],
      "scripts": true,
      "refs": true,
      "maturity": ""
    },
    {
      "name": "stitch",
      "desc": "AI design generation with Google Stitch. Generate UI designs from text prompts, export Tailwind/HTML/DESIGN.md, orchestrate design-to-code pipeline. Use for rapid prototyping, UI generation, design exploration.",
      "cat": "frontend",
      "hint": "[design prompt or action]",
      "keywords": [
        "Stitch",
        "UI-generation",
        "prototyping",
        "Tailwind"
      ],
      "scripts": true,
      "refs": true,
      "maturity": ""
    },
    {
      "name": "tanstack",
      "desc": "Build with TanStack Start (full-stack React framework), TanStack Form (headless form management), and TanStack AI (AI streaming/chat). Use when creating TanStack projects, routes, server functions, forms, validation, or AI chat features.",
      "cat": "frameworks",
      "hint": "[framework] [feature]",
      "keywords": [
        "tanstack",
        "start",
        "form",
        "ai",
        "router"
      ],
      "scripts": false,
      "refs": true,
      "maturity": ""
    },
    {
      "name": "team",
      "desc": "Orchestrate Agent Teams for parallel multi-session collaboration. Use for research, implementation, review, and debug workflows requiring independent teammates.",
      "cat": "dev-tools",
      "hint": "<template> <context> [--devs|--researchers|--reviewers N] [--delegate]",
      "keywords": [
        "agents",
        "parallel",
        "multi-session",
        "collaboration"
      ],
      "scripts": false,
      "refs": true,
      "maturity": ""
    },
    {
      "name": "tech-graph",
      "desc": "Generate production-quality SVG+PNG technical diagrams — architecture, data flow, flowchart, sequence, agent/memory, or concept maps — across 7 visual styles. Use when user wants \"generate diagram\", \"draw diagram\", \"visualize\", \"architecture diagram\", \"flowchart\", or any system/flow they want illustrated. Pairs with /ck:preview --diagram for visual self-review and /ck:mermaidjs-v11 for inline-doc diagrams; this skill is the publish-grade output mode.",
      "cat": "dev-tools",
      "hint": "[diagram-type or system description]",
      "keywords": [
        "diagrams",
        "architecture",
        "flowchart",
        "sequence",
        "svg",
        "png",
        "agent",
        "memory",
        "visualization"
      ],
      "scripts": true,
      "refs": true,
      "maturity": ""
    },
    {
      "name": "test",
      "desc": "Run unit, integration, e2e, and UI tests. Use for test execution, coverage analysis, build verification, visual regression, and QA reports.",
      "cat": "utilities",
      "hint": "[context] OR ui [url]",
      "keywords": [
        "test",
        "unit",
        "integration",
        "e2e",
        "coverage"
      ],
      "scripts": false,
      "refs": true,
      "maturity": ""
    },
    {
      "name": "threejs",
      "desc": "Build 3D web experiences with Three.js. Use for WebGL/WebGPU scenes, GLTF models, animations, physics, VR/XR. Supports 556 searchable examples.",
      "cat": "frontend",
      "hint": "[3D scene or feature]",
      "keywords": [
        "threejs",
        "3d",
        "webgl",
        "webgpu",
        "gltf"
      ],
      "scripts": true,
      "refs": true,
      "maturity": ""
    },
    {
      "name": "ui-styling",
      "desc": "Style UIs with shadcn/ui components (Radix UI + Tailwind CSS). Use for accessible components, themes, dark mode, responsive layouts, design systems, color customization.",
      "cat": "frontend",
      "hint": "[component or layout]",
      "keywords": [
        "shadcn",
        "radix",
        "tailwind",
        "themes"
      ],
      "scripts": true,
      "refs": true,
      "maturity": ""
    },
    {
      "name": "ui-ux-pro-max",
      "desc": "UI/UX design intelligence for web and mobile: style selection, color systems, typography, layout, accessibility, interaction states, responsive behavior, forms, charts, design systems, and code review across React, Next.js, Vue, Svelte, SwiftUI, React Native, Flutter, Tailwind, shadcn/ui, and HTML/CSS.",
      "cat": "frontend",
      "hint": "",
      "keywords": [
        "ui-ux",
        "styles",
        "palettes",
        "fonts"
      ],
      "scripts": true,
      "refs": false,
      "maturity": ""
    },
    {
      "name": "use-mcp",
      "desc": "Discover and execute MCP server tools. Two execution paths: Gemini CLI (LLM-driven, all tasks) or direct scripts (deterministic, specific tool/server). Use for MCP integrations, tool execution, capability discovery, persistent tool catalog.",
      "cat": "dev-tools",
      "hint": "[task]",
      "keywords": [
        "MCP",
        "tools",
        "execute",
        "discovery",
        "gemini",
        "mcp-client"
      ],
      "scripts": true,
      "refs": true,
      "maturity": ""
    },
    {
      "name": "watzup",
      "desc": "Generate short handoff reports from Git branches, remote refs, worktrees, and unfinished plans. Use when the user asks what's in flight, wants progress/next steps, is in a fresh worktree or detached checkout, or needs end-of-session status.",
      "cat": "utilities",
      "hint": "",
      "keywords": [
        "session",
        "wrap-up",
        "changes",
        "review",
        "worktree",
        "branches",
        "plans"
      ],
      "scripts": true,
      "refs": false,
      "maturity": ""
    },
    {
      "name": "web-design-guidelines",
      "desc": "Review UI code for Web Interface Guidelines compliance. Use when asked to \"review my UI\", \"check accessibility\", \"audit design\", \"review UX\", or \"check my site against best practices\".",
      "cat": "frontend",
      "hint": "[file-or-pattern]",
      "keywords": [
        "ui-review",
        "accessibility",
        "ux-audit"
      ],
      "scripts": false,
      "refs": false,
      "maturity": ""
    },
    {
      "name": "web-frameworks",
      "desc": "Build with Next.js (App Router, RSC, SSR, ISR), Turborepo monorepos. Use for React apps, server rendering, build optimization, caching strategies, shared dependencies.",
      "cat": "frameworks",
      "hint": "[framework] [feature]",
      "keywords": [
        "nextjs",
        "turborepo",
        "ssr",
        "isr",
        "rsc"
      ],
      "scripts": true,
      "refs": true,
      "maturity": ""
    },
    {
      "name": "web-testing",
      "desc": "Web testing with Playwright, Vitest, k6. E2E/unit/integration/load/security/visual/a11y testing. Use for test automation, flakiness, Core Web Vitals, mobile gestures, cross-browser.",
      "cat": "dev-tools",
      "hint": "[test-type] [target]",
      "keywords": [
        "Playwright",
        "Vitest",
        "k6",
        "e2e",
        "load-testing"
      ],
      "scripts": true,
      "refs": true,
      "maturity": ""
    },
    {
      "name": "worktree",
      "desc": "Create, inspect, and clean isolated git worktrees. Use for feature isolation, worktree health audits, stale cleanup, and monorepo or submodule workflows.",
      "cat": "dev-tools",
      "hint": "[feature-description] OR [project] [feature]",
      "keywords": [
        "worktree",
        "parallel",
        "monorepo",
        "isolation"
      ],
      "scripts": true,
      "refs": false,
      "maturity": ""
    },
    {
      "name": "xia",
      "desc": "Extract, compare, port, or adapt a feature from a GitHub repository or local repo path into the current project. Use when the user wants to copy behavior from another repo, study how another codebase implements something, compare implementations, or rewrite a feature in the local stack. Triggers on: 'port from', 'copy from repo', 'like how X does it', 'clone feature from', 'adapt from', 'bring feature from', 'borrow from', 'take from repo', 'xia', 'xi a', 'xia feature'.",
      "cat": "dev-tools",
      "hint": "<github-url-or-owner/repo|local-path> [feature] [--compare|--copy|--improve|--port] [--auto|--fast]",
      "keywords": [
        "port",
        "extract",
        "compare",
        "feature",
        "repo"
      ],
      "scripts": false,
      "refs": true,
      "maturity": ""
    }
  ]
};

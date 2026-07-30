# Requirements Document

## 1. Application Overview

**Application Name**: TFA Evolution Studio

**Tagline**: AI Operating System in Your Pocket

**Description**: A mobile-first React Native Expo app serving as an AI Operating Environment for managing AI-powered code evolution workflows. Users can approve AI decisions on the go, launch new code evolution tasks in seconds, monitor what their AI agents accomplished, and access AI-generated outputs. The app connects to self-hosted TFA Evolution Studio backend and operates in private alpha mode without authentication.

**Key Characteristics**:
- No login/authentication — opens directly to main interface
- Dark theme with premium mobile UX (#0a0e17 background, #111827 cards, #1e293b borders)
- Action-first design: buttons and flows before statistics
- Connects to self-hosted backend via configurable API base URL
- Built with React Native Expo

---

## 2. Users and Usage Scenarios

**Target Users**: Single alpha tester managing personal AI code evolution workflows

**Core Usage Scenarios**:
- Approve AI decisions on the go without desktop access
- Launch new code evolution tasks in under 30 seconds
- Monitor active AI agent execution in real-time
- Download and access AI-generated artifacts
- Review agent performance and system health
- Configure AI providers and API endpoints

---

## 3. Page Structure and Functionality

### Navigation Architecture

Bottom tab navigation with 5 primary tabs:

```
App Root
├── Missions (Mission Control)
│   └── Mission Launch Screen
├── Forge (Project Workspace)
│   ├── Project Detail
│   ├── File Explorer
│   └── Lineage View
├── Pipeline (Execution Pipeline)
│   └── Workflow Detail Screen
├── Lab (Agent Laboratory)
│   └── Agent Detail Screen
└── Vault (Outputs + Memory + System)
    ├── Outputs Section
    │   └── Artifact Detail Screen
    ├── Memory Section
    └── System Section
        ├── Provider Diagnostics
        └── Health Dashboard
```

### 3.1 Missions (Mission Control)

**Purpose**: Action center for active work requiring user attention

**Functionality**:

**Hero Section - \"What needs your attention now?\"**:
- Display approval queue as actionable cards
- Each card shows:
  - Workflow name
  - Objective summary
  - Plan summary (key points)
  - Approve button (green)
  - Reject button (red)
- Tap Approve: POST approval to API, card disappears, success haptic feedback
- Tap Reject: show confirmation dialog requiring reason, POST rejection to API
- If queue empty: show \"All clear\" message

**Active Evolutions Section**:
- Display running workflows with live progress
- Each item shows:
  - Workflow name
  - Current agent running
  - Progress bar with percentage
  - Estimated completion time
- Tap item: navigate to Workflow Detail Screen

**Quick Launch FAB**:
- Floating action button at bottom-right
- Tap: navigate to Mission Launch Screen

**Recent Completions Section**:
- Display last 3 finished evolutions
- Each item shows:
  - Workflow name
  - Completion timestamp
  - Download button (inline)
- Tap Download: open artifact download URL
- Tap item: navigate to Workflow Detail Screen

**Empty State**:
- If no active work: show \"Start your first mission\" with prominent CTA button
- Tap CTA: navigate to Mission Launch Screen

**Data Refresh**:
- Auto-refresh every 8 seconds via polling
- Pull-to-refresh gesture available

### 3.2 Forge (Project Workspace)

**Purpose**: Workspace to create projects and launch code evolution tasks

**Functionality**:

**Project List Screen**:
- Display all projects as cards
- Each card shows:
  - Project name
  - Last activity timestamp
  - Version count
  - \"Launch Evolution\" button (inline, blue)
- Tap \"Launch Evolution\": navigate to Mission Launch Screen with project pre-selected
- Tap card: navigate to Project Detail
- \"Create New Project\" button at top
- Pull-to-refresh available

**Create New Project Flow**:
- Tap \"Create New Project\": show full-screen form
- Input fields:
  - Project name (required)
  - Description (optional)
  - ZIP file upload button
- Tap ZIP upload: open file picker, select ZIP file
- After ZIP selected: show filename and size
- \"Create & Launch\" button: POST project creation, upload ZIP, navigate to Mission Launch Screen with new project selected
- \"Create Only\" button: POST project creation without launching evolution

**Project Detail Screen**:
- Display project name and description
- Show version history list:
  - Version number
  - Checksum
  - File size
  - Created date
  - \"Evolve This Version\" button (inline)
- Tap \"Evolve This Version\": navigate to Mission Launch Screen with project and version pre-selected
- \"Upload New ZIP\" button: open file picker, upload ZIP, create new version
- \"View File Explorer\" button: navigate to File Explorer
- \"View Lineage\" button: navigate to Lineage View

**File Explorer Screen**:
- Display ZIP file contents in tree structure
- Show file names and folder hierarchy
- Read-only view

**Lineage View Screen**:
- Display project lineage as tree visualization
- Show parent-child relationships between versions

### 3.3 Pipeline (Execution Pipeline)

**Purpose**: Visual execution pipeline grouped by workflow stage

**Functionality**:

**Pipeline List Screen**:
- Group workflows into 4 sections:
  - Active (running workflows)
  - Awaiting Decision (approval needed)
  - Completed (finished successfully)
  - Failed (error state)
- Each section collapsible with count badge

**Active Section**:
- Each item shows:
  - Workflow name
  - Current agent running
  - Progress bar
  - Estimated completion time
- Tap item: navigate to Workflow Detail Screen

**Awaiting Decision Section**:
- Each item shows:
  - Workflow name
  - Objective summary
  - Plan summary (key points)
  - Approve button (green, inline)
  - Reject button (red, inline)
- Tap Approve: POST approval to API, item moves to Active section, haptic feedback
- Tap Reject: show confirmation dialog requiring reason, POST rejection to API
- Tap item: navigate to Workflow Detail Screen

**Completed Section**:
- Each item shows:
  - Workflow name
  - Completion timestamp
  - Download button (inline)
- Tap Download: open artifact download URL
- Tap item: navigate to Workflow Detail Screen

**Failed Section**:
- Each item shows:
  - Workflow name
  - Error message summary
  - Timestamp
- Tap item: navigate to Workflow Detail Screen

**Data Refresh**:
- Auto-refresh every 6 seconds via polling
- Pull-to-refresh available

### 3.4 Lab (Agent Laboratory)

**Purpose**: Understand and monitor AI agent performance

**Functionality**:

**Agent Cards Screen**:
- Group agents by tier with color coding:
  - Executive tier (purple #a855f7)
  - Engineering tier (blue #3b82f6)
  - Quality tier (amber #f59e0b)
  - Release tier (green #22c55e)
- Each agent card shows:
  - Agent name
  - Agent ID (monospace font)
  - Success rate bar (visual percentage)
  - Average duration
  - Total token usage
  - Last run time
- Tap agent: navigate to Agent Detail Screen

**System Performance Section**:
- Display overall AI team health metrics:
  - Total runs today
  - Overall success rate
  - Average response time
  - Active providers count
- Show bottlenecks if detected (e.g., \"Quality tier agents running slow\")
- Display recommendations (e.g., \"Consider increasing concurrent workflow limit\")

**Run Diagnostics Button**:
- Tap: trigger health check of all AI providers
- Show loading indicator during check
- Display results: provider name, status (healthy/unhealthy), latency

### 3.5 Vault (Outputs + Memory + System)

**Purpose**: Access generated artifacts, saved contexts, and system configuration

**Functionality**:

**Top Tab Navigation**:
- Three tabs: Outputs, Memory, System
- Swipeable between tabs

**Outputs Section**:
- Display all generated artifacts organized by project
- Filter dropdown: All Projects / select specific project
- Each artifact item shows:
  - Filename
  - File size
  - Which evolution produced it (workflow name)
  - Creation date
  - Download button
- Tap item: navigate to Artifact Detail Screen
- Tap Download: open artifact download URL
- Pull-to-refresh available

**Memory Section**:
- Display saved contexts and project insights
- Each entry shows:
  - Title
  - Tags (comma-separated)
  - Which project
  - Date
- Tap entry: show full content in modal or detail screen
- Data sourced from audit logs and workflow analysis summaries
- Pull-to-refresh available

**System Section**:
- **API Configuration**:
  - API Server URL text input
  - \"Test Connection\" button: verify API accessibility, show success/error message
- **Provider Management**:
  - List of configured AI providers:
    - Provider name
    - Health status indicator (green dot = healthy, red dot = unhealthy)
    - Latency display (milliseconds)
    - \"Ping\" button: test connection, update latency
    - \"Set as Default\" button
  - Default AI Provider picker (openai/anthropic/gemini/openrouter/ollama/mock)
  - Default Model text input
- **System Settings**:
  - Max Concurrent Workflows number input
  - Max ZIP Size MB number input
  - Auto-Approve toggle switch
- **Admin Links**:
  - \"Health Dashboard\" button: navigate to Health Dashboard
  - \"Provider Diagnostics\" button: navigate to Provider Diagnostics

**Provider Diagnostics Screen**:
- Display detailed health metrics for each AI provider
- Show connection status, response times, error rates
- \"Refresh\" button to re-check all providers

**Health Dashboard Screen**:
- Display overall system health metrics
- Show API connectivity status
- Display resource usage statistics
- Show recent errors or warnings

### 3.6 Mission Launch Screen

**Purpose**: Full-screen flow to launch new code evolution task

**Functionality**:

**Step 1: Select Project**:
- Display list of existing projects
- \"Create New Project\" option at top
- Tap project: proceed to Step 2
- Tap \"Create New Project\": show inline form (name + description), create project, proceed to Step 2

**Step 2: Select Version**:
- Display version history for selected project
- \"Upload New ZIP\" option at top
- Tap version: proceed to Step 3
- Tap \"Upload New ZIP\": open file picker, upload ZIP, create new version, proceed to Step 3

**Step 3: Write Evolution Objective**:
- Large text area for objective input
- Show example objectives below text area (e.g., \"Add user authentication\", \"Refactor database layer\")
- Character count indicator
- \"Next\" button: proceed to Step 4

**Step 4: Review & Launch**:
- Display summary:
  - Project name
  - Version number
  - Objective text
- \"Launch Evolution\" button (prominent, blue)
- \"Back\" button to edit
- Tap \"Launch Evolution\": POST workflow creation to API, redirect to Missions tab with new evolution visible in Active section

**Navigation**:
- Back button at top-left to cancel and return
- Progress indicator showing current step (1/4, 2/4, 3/4, 4/4)

### 3.7 Workflow Detail Screen

**Purpose**: Complete view of workflow execution and results

**Functionality**:

**Current Stage Progress Bar**:
- Visual progress indicator showing workflow stage
- Stages: Extracting → Analyzing → Planning → Awaiting Approval → Executing → Completed

**Objective Section**:
- Display user-provided objective text

**Analysis Results Section**:
- File count
- Programming languages detected
- Frameworks identified
- Complexity score

**Evolution Plan Section**:
- Display plan objectives (bullet list)
- Display expected outcomes (bullet list)

**Approve/Reject Actions** (visible only when state = awaiting_approval):
- \"Approve\" button (green, full-width)
- \"Reject\" button (red, full-width)
- Tap Approve: show confirmation dialog, POST approval to API, haptic feedback
- Tap Reject: show dialog requiring rejection reason, POST rejection to API

**Agent Execution Timeline**:
- Display each agent with:
  - Agent name
  - Status badge (pending/running/completed/failed)
  - Token usage
  - Duration
  - Timestamp
- Tap agent: navigate to Agent Detail Screen

**File Operations Section**:
- List of file operations:
  - Operation type (created/modified/deleted) with color coding
  - File path
  - Line count change (for modified files)

**Download Artifact Button** (visible only when state = ready_for_download):
- Full-width button at bottom
- Tap: open artifact download URL, haptic feedback

**Data Refresh**:
- Auto-refresh every 5 seconds via polling when workflow is active

### 3.8 Agent Detail Screen

**Purpose**: Detailed view of individual agent performance

**Functionality**:

**Agent Information**:
- Agent name
- Agent ID (monospace font)
- Agent role description
- Tier badge (executive/engineering/quality/release)

**Performance Metrics**:
- Total runs count
- Success rate (percentage with visual bar)
- Average token usage
- Average duration
- Last run timestamp

**Run History Section**:
- List of workflows that used this agent
- Each item shows:
  - Workflow name
  - Outcome (success/failed)
  - Tokens used
  - Duration
  - Timestamp
- Tap item: navigate to Workflow Detail Screen

**Configuration View** (read-only for alpha):
- Display agent configuration parameters
- No editing capability in this release

### 3.9 Artifact Detail Screen

**Purpose**: Detailed view of generated artifact

**Functionality**:

**Artifact Information**:
- Filename
- File size
- Creation date
- Which workflow produced it (workflow name, tappable link)
- Which project it belongs to (project name, tappable link)

**Download Button**:
- Full-width button
- Tap: open artifact download URL

**Navigation Links**:
- Tap workflow name: navigate to Workflow Detail Screen
- Tap project name: navigate to Project Detail Screen

---

## 4. Business Rules and Logic

### 4.1 API Connection Management
- API base URL stored persistently in AsyncStorage
- All API calls use configured base URL as prefix
- No authentication headers required (no-auth mode for alpha)
- Test Connection validates API accessibility before saving URL

### 4.2 Workflow State Management
- Workflow states determine available actions and display location:
  - extracting/analyzing/planning: shown in Active section of Pipeline
  - awaiting_approval: shown in Awaiting Decision section of Pipeline and Missions approval queue
  - executing: shown in Active section of Pipeline
  - ready_for_download: shown in Completed section of Pipeline
  - failed: shown in Failed section of Pipeline
- State transitions tracked with timestamps

### 4.3 Inline Approval/Rejection
- Approve/Reject actions available inline in Missions and Pipeline without navigating to detail screen
- Rejection requires user to provide reason via dialog
- After approval/rejection, item moves to appropriate section and disappears from approval queue

### 4.4 Mission Launch Flow
- User can launch evolution in under 30 seconds via optimized 4-step flow
- Each step allows inline creation (new project, new ZIP upload) to avoid navigation away
- After launch, user redirected to Missions tab with new evolution visible

### 4.5 Data Refresh Strategy
- Missions tab: poll every 8 seconds when screen is focused
- Pipeline tab: poll every 6 seconds when screen is focused
- Workflow Detail: poll every 5 seconds when workflow is active
- Pull-to-refresh available on all list screens
- SSE (Server-Sent Events) support for real-time updates where backend provides it

### 4.6 File Operations
- ZIP upload uses expo-document-picker for file selection
- Max ZIP size enforced based on System settings configuration
- Artifact download uses expo-web-browser to open download URLs

### 4.7 Provider Management
- Default provider used for new workflows unless overridden
- Provider health checked via ping endpoint
- Set-as-Default updates default provider in System settings
- Latency displayed in milliseconds after ping

### 4.8 Haptic Feedback
- Triggered on:
  - Approve action
  - Reject action
  - Launch evolution
  - Download artifact
  - Any destructive action

### 4.9 Empty States
- Every list screen has meaningful empty state with CTA
- Examples:
  - Missions: \"Start your first mission\" with launch button
  - Forge: \"Create your first project\" with create button
  - Pipeline: \"No workflows yet\" with launch button
  - Lab: \"No agent data available\" with diagnostics button
  - Vault Outputs: \"No artifacts generated yet\"

### 4.10 Offline Behavior
- Detect offline state and display stale data indicator
- Show meaningful error messages when API calls fail
- Cache last successful data for offline viewing

---

## 5. Exceptions and Edge Cases

| Scenario | Handling |
|----------|----------|
| API endpoint unreachable | Display connection error banner at top of screen, show cached data with stale indicator |
| Invalid API URL format | Show validation error on System section, prevent saving |
| ZIP file exceeds max size | Show error toast, prevent upload |
| Workflow approval fails | Display error toast with retry button |
| Workflow rejection fails | Display error toast with retry button |
| Download artifact fails | Show error toast with retry button |
| Empty approval queue | Show \"All clear\" message in Missions hero section |
| No active workflows | Show empty state in Pipeline Active section |
| Provider ping timeout | Show timeout indicator, mark provider as unhealthy |
| Concurrent workflow limit reached | Display warning toast when attempting to launch new evolution |
| Network request timeout | Show timeout error toast with retry option |
| Invalid file format (non-ZIP) | Show format error toast, reject file selection |
| Mission Launch flow interrupted | Allow user to resume from last completed step or cancel |
| Rejection without reason | Prevent submission, show validation error |
| Agent detail with no run history | Show \"No runs yet\" empty state |
| Memory section with no data | Show \"No saved contexts yet\" empty state |

---

## 6. Acceptance Criteria

1. User opens app and immediately sees Missions tab without login
2. User taps approval queue card in Missions, taps Approve button inline, workflow moves to Active section
3. User taps Quick Launch FAB in Missions, completes 4-step Mission Launch flow (select project → select version → write objective → review & launch) in under 30 seconds
4. User navigates to Forge tab, taps \"Create New Project\", fills name and description, uploads ZIP, taps \"Create & Launch\", redirected to Mission Launch Screen with new project selected
5. User navigates to Pipeline tab, sees workflow in Awaiting Decision section, taps Approve button inline without navigating to detail screen
6. User waits for workflow to complete, workflow appears in Completed section with Download button inline
7. User taps Download button in Pipeline Completed section, artifact downloads successfully
8. User navigates to Vault tab, switches to Outputs section, sees downloaded artifact listed, taps artifact to view details

---

## 7. Out of Scope for This Release

- User authentication and login system
- Multi-user support
- Push notifications for workflow state changes
- In-app code editor or diff viewer
- Custom agent configuration or editing
- Workflow scheduling or automation
- Export audit logs
- Dark/light theme toggle (dark theme only)
- Localization and multi-language support
- Biometric authentication
- Workflow templates or presets
- Collaborative features (sharing, comments)
- Advanced filtering and sorting beyond basic project filter in Vault Outputs
- Workflow cloning or duplication
- Batch operations on multiple workflows
- Custom notification preferences
- Analytics dashboard beyond Lab system performance
- Integration with external version control systems
- Editing Memory entries
- Custom agent creation
- Workflow pause/resume functionality
- File preview in File Explorer
- Diff viewer in Workflow Detail
- Search functionality across tabs
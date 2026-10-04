// The small example grove behind "How to read your grove". Each step is two
// groves, before and after one change, drawn by the real canvas. Everything
// here is made up for the lesson; none of it is the user's data.
import type { GroveResponse, GroveTab, TreeData } from '../types';

export interface GuideStep {
  id: string;
  title: string;
  /** What the person did, in everyday words. */
  browser: string;
  /** What the grove does in answer. */
  grove: string;
  /** Trees (by cluster_ref) and 'sprout' that stay bright; the rest step back. */
  focus: string[];
  before: GroveResponse;
  after: GroveResponse;
}

const LOGIN = 'guide-login';
const PREP = 'guide-prep';
const JOB = 'guide-job';
const RUST = 'guide-rust';

const tab = (ref: string, title: string, domain: string, minutes = 6): GroveTab => ({
  tab_ref: ref,
  title,
  domain,
  dwell_minutes: minutes,
  is_open: true,
});

const claim = (id: string, text: string) => ({
  id,
  text,
  display_text: text,
  provenance: 'inferred' as const,
  confidence: 0.82,
  evidence: [],
});

function tree(
  ref: string,
  name: string,
  minutes: number,
  goal: string,
  branches: Array<[string, GroveTab[]]>
): TreeData {
  return {
    cluster_ref: ref,
    project: { id: ref, name, is_existing_project_id: null },
    status: 'active',
    attention_minutes: minutes,
    last_active_at: '2026-10-04T11:00:00Z',
    days_since_active: 0,
    canopy: 'green',
    goal: claim(`${ref}-goal`, goal),
    current_direction: claim(`${ref}-direction`, ''),
    branches: branches.map(([label, tabs], index) => ({
      branch_ref: `${ref}-b${index + 1}`,
      label,
      status: 'active',
      tab_refs: tabs.map((item) => item.tab_ref),
    })),
    decisions: [],
    unresolved_questions: [],
    blockers: [],
    next_actions: [],
    redundant_groups: [],
    important_tab_refs: [],
    hypotheses: [],
    tabs: branches.flatMap(([, tabs]) => tabs),
  };
}

const login = (): TreeData => ({
  ...tree(LOGIN, 'Login for my app', 74, 'Add sign-in to my app', [
    [
      'Sign-in pages',
      [
        tab('g-l1', 'How sign-in works', 'docs.example.com', 14),
        tab('g-l2', 'Sponsor prizes list', 'hackathon.example.org', 3),
        tab('g-l3', 'Sign-in form examples', 'docs.example.com', 9),
        tab('g-l4', 'Password rules', 'security.example.com', 5),
      ],
    ],
    [
      'Staying signed in',
      [
        tab('g-l5', 'Sessions explained', 'docs.example.com', 12),
        tab('g-l6', 'Sessions or tokens?', 'forum.example.com', 8),
        tab('g-l7', 'Sign-out checklist', 'docs.example.com', 4),
        tab('g-l8', 'Sign-out checklist', 'docs.example.com', 1),
      ],
    ],
  ]),
  decisions: [
    {
      ...claim('g-d1', 'Use sessions to keep people signed in'),
      stone_kind: 'mossy',
    },
  ],
  redundant_groups: [
    { tab_refs: ['g-l8'], keep_ref: 'g-l7', reason: 'The same page is open twice', is_exact_dup: true },
  ],
});

const prep = (): TreeData =>
  tree(PREP, 'Hackathon prep', 41, 'Get ready for the hackathon', [
    ['Rules', [tab('g-p1', 'Hackathon rules', 'hackathon.example.org', 7), tab('g-p2', 'Judging criteria', 'hackathon.example.org', 6)]],
    ['Prizes', [tab('g-p3', 'Prize tracks', 'hackathon.example.org', 5), tab('g-p4', 'Past winners', 'hackathon.example.org', 4), tab('g-p5', 'Submission guide', 'hackathon.example.org', 3)]],
  ]);

const job = (): TreeData =>
  tree(JOB, 'Job search', 52, 'Apply for jobs', [
    ['Openings', [tab('g-j1', 'Backend engineer opening', 'jobs.example.com', 11), tab('g-j2', 'Software engineer opening', 'jobs.example.com', 9), tab('g-j3', 'Application form', 'jobs.example.com', 11)]],
    ['Interviews', [tab('g-j4', 'Interview questions', 'prep.example.com', 8), tab('g-j5', 'Salary guide', 'prep.example.com', 5)]],
  ]);

const sproutTabs = [tab('g-r1', 'Getting started with Rust', 'rust.example.org', 5), tab('g-r2', 'Rust command-line tools', 'rust.example.org', 4)];

const base = (): GroveResponse => ({
  schema_version: '1.0',
  run_id: 'guide',
  generated_at: '2026-10-04T11:40:00Z',
  degraded: false,
  hollow_count: 0,
  trees: [login(), prep(), job()],
  meadow: { label: 'Wildflower Meadow', tabs: [] },
  sprouts: [{ sprout_ref: 'guide-sprout', label: 'rust · tools', tab_count: 2, tabs: sproutTabs }],
  fog: [],
  past_connections: [],
});

/** A copy of the grove with one tree changed. */
const withTree = (grove: GroveResponse, ref: string, change: (tree: TreeData) => TreeData): GroveResponse => ({
  ...grove,
  trees: grove.trees.map((item) => (item.cluster_ref === ref ? change(item) : item)),
});

const addTabs = (item: TreeData, branchIndex: number, tabs: GroveTab[]): TreeData => ({
  ...item,
  tabs: [...item.tabs, ...tabs],
  branches: item.branches.map((branch, index) =>
    index === branchIndex ? { ...branch, tab_refs: [...branch.tab_refs, ...tabs.map((t) => t.tab_ref)] } : branch
  ),
});

const dropTab = (item: TreeData, ref: string): TreeData => ({
  ...item,
  tabs: item.tabs.filter((t) => t.tab_ref !== ref),
  branches: item.branches.map((branch) => ({ ...branch, tab_refs: branch.tab_refs.filter((r) => r !== ref) })),
});

const openQuestion = (item: TreeData): TreeData => ({
  ...item,
  unresolved_questions: [
    {
      id: 'g-q1',
      question: 'Which prize track fits my project?',
      display_text: 'Which prize track fits my project?',
      kind: 'repeated_search',
      confidence: 0.8,
      status: 'open',
      recurrence_count: 3,
      evidence: [],
    },
  ],
});

const asleep = (item: TreeData): TreeData => ({
  ...item,
  status: 'dormant',
  canopy: 'amber',
  days_since_active: 4,
  tabs: item.tabs.map((t) => (['g-j1', 'g-j2', 'g-j4'].includes(t.tab_ref) ? { ...t, fallen: true } : t)),
});

function buildSteps(): GuideStep[] {
  const start = base();

  const questionOpen = withTree(start, PREP, openQuestion);
  const dormant = withTree(start, JOB, asleep);

  return [
    {
      id: 'leaf',
      title: 'Every tab is a leaf',
      browser: 'You open one more page about your sign-in work.',
      grove: 'A new leaf opens on that tree. One tab, one leaf.',
      focus: [LOGIN],
      before: start,
      after: withTree(start, LOGIN, (item) => addTabs(item, 0, [tab('g-l9', 'Sign-in error messages', 'docs.example.com', 4)])),
    },
    {
      id: 'trunk',
      title: 'Time spent makes the trunk thicker',
      browser: 'You spend another half hour on your hackathon pages.',
      grove: 'The trunk grows thicker, and the minutes under the name go up.',
      focus: [PREP],
      before: start,
      after: withTree(start, PREP, (item) => ({ ...item, attention_minutes: 74 })),
    },
    {
      id: 'branch',
      title: 'A new direction grows a new branch',
      browser: 'You start looking into a different side of the same work.',
      grove: 'A branch reaches out from the top of the tree, then its leaves open.',
      focus: [LOGIN],
      before: start,
      after: withTree(start, LOGIN, (item) => {
        const tabs = [
          tab('g-l10', 'Forgot password flow', 'docs.example.com', 5),
          tab('g-l11', 'Reset email examples', 'docs.example.com', 4),
          tab('g-l12', 'Reset link safety', 'security.example.com', 3),
        ];
        return {
          ...item,
          tabs: [...item.tabs, ...tabs],
          branches: [
            ...item.branches,
            { branch_ref: `${LOGIN}-b3`, label: 'Password reset', status: 'active', tab_refs: tabs.map((t) => t.tab_ref) },
          ],
        };
      }),
    },
    {
      id: 'mushroom',
      title: 'An open question is a mushroom',
      browser: 'You keep searching for the same thing and have not found the answer yet.',
      grove: 'A mushroom pops up at the foot of the tree, so you can see something is still open.',
      focus: [PREP],
      before: start,
      after: questionOpen,
    },
    {
      id: 'flower',
      title: 'An answered question becomes a flower',
      browser: 'You find the answer and mark the question as done.',
      grove: 'The mushroom closes and a flower opens in its place, petal by petal.',
      focus: [PREP],
      before: questionOpen,
      after: withTree(questionOpen, PREP, (item) => ({
        ...item,
        unresolved_questions: item.unresolved_questions.map((q) => ({ ...q, status: 'resolved' as const })),
      })),
    },
    {
      id: 'stone',
      title: 'A decision is a stone',
      browser: 'TabForest guessed that you made a decision. You confirm it is right.',
      grove: 'The moss slides off the stone and marks are carved into it. Now it is yours, not a guess.',
      focus: [LOGIN],
      before: start,
      after: withTree(start, LOGIN, (item) => ({
        ...item,
        decisions: item.decisions.map((d) => ({ ...d, provenance: 'stated' as const, stone_kind: 'carved' as const, confidence: 1 })),
      })),
    },
    {
      id: 'duplicate',
      title: 'Copies of the same page are tied together',
      browser: 'You had the same page open twice, and you close the extra one.',
      grove: 'The vine that tied the two leaves is gone, and the extra leaf falls and fades.',
      focus: [LOGIN],
      before: start,
      after: withTree(start, LOGIN, (item) => ({ ...dropTab(item, 'g-l8'), redundant_groups: [] })),
    },
    {
      id: 'move',
      title: 'A tab can move to another tree',
      browser: 'A tab was put under the wrong goal, and you drag it to the right one.',
      grove: 'The leaf lifts off, flies across and settles on the other tree.',
      focus: [LOGIN, PREP],
      before: start,
      after: withTree(
        withTree(start, LOGIN, (item) => dropTab(item, 'g-l2')),
        PREP,
        (item) => addTabs(item, 1, [tab('g-l2', 'Sponsor prizes list', 'hackathon.example.org', 3)])
      ),
    },
    {
      id: 'dormant',
      title: 'A goal you leave alone goes quiet',
      browser: 'You do not visit any of your job search tabs for several days.',
      grove: 'The tree turns amber and thins out. Leaves let go and rest on the ground.',
      focus: [JOB],
      before: start,
      after: dormant,
    },
    {
      id: 'wake',
      title: 'Come back, and it wakes up',
      browser: 'You open your job search tabs again.',
      grove: 'The tree turns green again and fresh leaves grow back where the old ones fell.',
      focus: [JOB],
      before: dormant,
      after: start,
    },
    {
      id: 'sprout',
      title: 'A new goal grows into a tree',
      browser: 'A couple of loose tabs turn into something you are clearly working on.',
      grove: 'The little sprout becomes a tree: the trunk rises, the top opens out, leaves appear and it gets a name.',
      focus: [RUST, 'sprout'],
      before: start,
      after: {
        ...start,
        sprouts: [],
        trees: [
          ...start.trees,
          tree(RUST, 'Learning Rust', 18, 'Learn Rust', [
            ['Basics', [...sproutTabs, tab('g-r3', 'Rust by example', 'rust.example.org', 5), tab('g-r4', 'Rust error handling', 'rust.example.org', 4)]],
          ]),
        ],
      },
    },
  ];
}

export const GUIDE_STEPS: GuideStep[] = buildSteps();

/**
 * One example grove with everything in the key on it at once: an open question,
 * an answered one, a confirmed decision and a tree gone quiet. For the landing page.
 */
export const GUIDE_SHOWCASE: GroveResponse = (() => {
  const start = base();
  const withQuestions = withTree(start, PREP, (item) => ({
    ...openQuestion(item),
    unresolved_questions: [
      ...openQuestion(item).unresolved_questions,
      {
        id: 'g-q2',
        question: 'When is the submission deadline?',
        display_text: 'When is the submission deadline?',
        kind: 'repeated_search' as const,
        confidence: 0.8,
        status: 'resolved' as const,
        recurrence_count: 2,
        evidence: [],
      },
    ],
  }));
  const carved = withTree(withQuestions, LOGIN, (item) => ({
    ...item,
    decisions: item.decisions.map((d) => ({ ...d, provenance: 'stated' as const, stone_kind: 'carved' as const })),
  }));
  return withTree(carved, JOB, asleep);
})();

/** What each thing in the grove stands for, in everyday words. */
export const GUIDE_KEY = [
  { id: 'tree', name: 'A tree', meaning: 'is one thing you are working on' },
  { id: 'leaf', name: 'A leaf', meaning: 'is one open tab' },
  { id: 'trunk', name: 'A thick trunk', meaning: 'means a lot of your time' },
  { id: 'mushroom', name: 'A mushroom', meaning: 'is a question you have not answered' },
  { id: 'flower', name: 'A flower', meaning: 'is a question you answered' },
  { id: 'stone', name: 'A stone', meaning: 'is a decision you made' },
  { id: 'amber', name: 'An amber tree', meaning: 'has been left alone for days' },
] as const;

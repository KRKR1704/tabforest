// Everything the landing page says. The install steps and notes come from
// lane D (Deep); when the final ones arrive, this is the only file to edit.

/** Where the extension zip is downloaded from. Lane D attaches it to the latest GitHub release. */
export const EXTENSION_ZIP_URL: string =
  (import.meta.env.VITE_EXTENSION_ZIP_URL as string | undefined) ||
  'https://github.com/KRKR1704/tabforest/releases/latest/download/tabforest-extension.zip';

export interface InstallStep {
  /** Plain text before the highlighted part. */
  text: string;
  /** Text shown exactly as Chrome shows it: a button, a switch or an address. */
  mark?: { text: string; kind: 'address' | 'control' };
  after?: string;
}

/** Lane D's steps, in order, from the downloaded zip to being signed in. */
export const INSTALL_STEPS: InstallStep[] = [
  { text: 'Download the zip and unzip it.' },
  { text: 'In Chrome, type ', mark: { text: 'chrome://extensions', kind: 'address' }, after: ' in the address bar and press Enter.' },
  { text: 'Turn on ', mark: { text: 'Developer mode', kind: 'control' }, after: ' (top right).' },
  { text: 'Click ', mark: { text: 'Load unpacked', kind: 'control' }, after: ' and choose the unzipped folder.' },
  { text: 'Click the puzzle-piece icon in the toolbar and pin TabForest.' },
  { text: 'Click the TabForest icon to open your Grove.' },
  { text: 'Click ', mark: { text: 'Sign in with Microsoft', kind: 'control' }, after: ' and finish the Microsoft window.' },
];

export const INSTALL_NOTES: Array<{ heading: string; lines: string[] }> = [
  {
    heading: 'Good to know',
    lines: [
      'Chrome may show a note about developer-mode extensions. That is normal.',
      'Tested in Chrome. Edge and Brave should work.',
    ],
  },
  {
    heading: 'After you sign in',
    lines: [
      'TabForest starts right away. “Grow grove” needs at least two open tabs; browse for a few minutes to get a useful result.',
      'The first time you restore a saved grove into a tab group, Chrome asks for a permission.',
    ],
  },
  {
    heading: 'Updating',
    lines: ['Remove the old one on chrome://extensions, then load the new folder.'],
  },
  {
    heading: 'Removing',
    lines: [
      'Click “Remove” on chrome://extensions. What is stored on the server stays unless you first use Privacy → “Delete all my memory”.',
    ],
  },
];

export const HOW_IT_WORKS = [
  {
    title: 'Add TabForest to Chrome',
    body: 'Download it, load it into Chrome and sign in with Microsoft. The steps are further down.',
  },
  {
    title: 'Browse the way you always do',
    body: 'It starts noting which tabs you open and how long you stay on them as soon as you sign in. There is nothing to tag or sort.',
  },
  {
    title: 'Open your grove',
    body: 'Press “Grow grove” once you have at least two tabs open. Your tabs gather into trees, one for each thing you are working on.',
  },
] as const;

/** The "In one paragraph" section of docs/privacy.md, word for word. A test keeps the two the same. */
export const PRIVACY_PARAGRAPH =
  'TabForest watches which tabs you open, switch to and close, so it can show why you opened them. ' +
  'It records only the site name (domain), a cleaned-up page title and timings. ' +
  'It never records full addresses, page contents, passwords, cookies or what you type. ' +
  'Private sites (banking, health, personal email, password managers, sign-in pages) and Incognito windows are never recorded at all. ' +
  'You can pause, exclude a site, or delete everything.';

export const NEVER_COLLECTED = [
  'Passwords and cookies',
  'Form contents and text typed into pages',
  'Card numbers',
  'Browsing history from before TabForest was installed',
  'Pages visited in Incognito',
] as const;

export const SKIPPED_ENTIRELY = [
  'Banking and payments',
  'Health portals',
  'Personal email',
  'Password managers',
  'Sign-in pages',
  'Any site you add to “never analyze this site”',
] as const;

export const WHAT_HAPPENS_NEXT = ['Load it into Chrome', 'Sign in with Microsoft', 'A short tour of what each thing means', 'Your grove opens'] as const;

/** A sentence for each thing in the key, a little fuller than the tour's. */
export const KEY_DETAILS: Record<string, string> = {
  tree: 'One thing you are working on.',
  leaf: 'One open tab. Click it to go to that tab.',
  trunk: 'A lot of your time went here.',
  mushroom: 'A question you have not answered yet.',
  flower: 'A question you answered.',
  stone: 'A decision you made.',
  amber: 'Something you have left alone for days.',
};

// Domain and data shapes shared by the collector, the build and the site.

/** How a project's history is measured: release-notes bullets, or first-parent commits. */
export type Basis = 'changelog' | 'commits';

export type Category =
  | 'added'
  | 'fixed'
  | 'changed'
  | 'improved'
  | 'removed'
  | 'other'
  | 'revert'
  | 'chore'
  | 'test'
  | 'docs'
  | 'ci';

/** Where an event's category came from: a build-time rule, a stored model label, or nothing yet. */
export type Source = 'rule' | 'model' | 'pending';

/** Per-category tallies; a row only carries the categories of its project's basis. */
export type Counts = Partial<Record<Category, number>>;

/** Commits basis: lines added/deleted and files touched vs the first parent. */
export type CommitStats = { add: number; del: number; files: number };

/** One entry of projects.json (config, not published as is). */
export type ProjectConfig = {
  id: string;
  name: string;
  basis: Basis;
  /** Vendor names of the annotations drawn on this project's charts. */
  annotations?: string[];
  /** URL templates with `{version}` / `{sha}` placeholders. */
  links?: { commit?: string; release?: string };
  /** Commits basis: authors counted as bots besides names ending in "[bot]". */
  bots?: string[];
  sources?: {
    changelog?: string;
    npm?: string;
    git?: GitSource;
  };
};

export type GitSource = { repo: string; branch: string; since: string };

/** One line of data/<project>/events.jsonl: raw facts only, never a category. */
export type Event = {
  /** Changelog `<version>#<index>` (0-based bullet position under its header); commits `<sha>`. */
  id: string;
  /** hash.ts over project + text; the label cache key; not unique per event. */
  textHash: string;
  project: string;
  kind: 'changelog' | 'commit';
  /** Changelog basis. */
  version?: string;
  /** Commits basis. */
  sha?: string;
  /** Commits basis (committer date, ISO UTC); changelog ts comes from dates.json. */
  ts?: string;
  /** Bullet or commit subject with leading [Tag] groups stripped. */
  text: string;
  /** e.g. 'vscode' from [VSCode], 'regression:2.1.296', 'pr:53969'. */
  tags: string[];
  /** Commits basis. */
  author?: string;
  /** Commits basis: Co-authored-by names. */
  coauthors?: string[];
  /** Commits basis; absent when the commit was collected before stats were recorded. */
  stats?: CommitStats;
};

/** An Event as parsed from a git log: always has a sha, a ts and the commit's people. */
export type CommitEvent = Event & { kind: 'commit'; sha: string; ts: string; author: string; coauthors: string[] };

/** data/<project>/dates.json (changelog basis): version → ISO ts, npm publish times ∪ seed/<project>-dates.json. */
export type Dates = Record<string, string>;

/** One line of data/<project>/classifications.jsonl: a model's label for every event sharing a textHash. */
export type Classification = { textHash: string; category: Category; model: string; ts: string };

/** One entry of annotations.json (copied to docs/data/annotations.json). */
export type Annotation = {
  date: string;
  label: string;
  vendor: string;
  kind: string;
  source: string;
  major?: boolean;
};

/** docs/data/projects.json row. `source` is the one URL the page's help dialog links. */
export type ProjectEntry = {
  id: string;
  name: string;
  basis: Basis;
  annotations: string[];
  links: { commit?: string; release?: string };
  source?: string;
};

/** docs/data/<project>/summary.json */
export type Summary = {
  project: string;
  name: string;
  basis: Basis;
  generatedAt: string;
  firstDate: string | null;
  lastDate: string;
  totals: {
    events: number;
    byCategory: Counts;
    bySource: Record<Source, number>;
    /** Changelog basis. */
    versions?: number;
  };
};

/**
 * docs/data/<project>/daily.json and weekly.json row: `d` is a calendar day, or the ISO-week Monday.
 * `lines` (weekly rows of the commits basis): add+del of each counted commit that has stats, ascending, so the
 * browser can pool weeks into any window and take an exact median.
 */
export type CountRow = { d: string; counts: Counts; total: number; lines?: number[] };

/** docs/data/<project>/releases.json row (changelog basis). */
export type Release = { version: string; ts: string; count: number };

/** docs/data/<project>/months/YYYY-MM.json row: an Event with its derived category. */
export type MonthEvent = {
  id: string;
  ts: string;
  version?: string;
  sha?: string;
  category: Category;
  source: Source;
  text: string;
  tags: string[];
  author?: string;
  bot?: boolean;
  stats?: CommitStats;
  url?: string;
};

// LOC report for the codebase, grouped by category, with an optional
// comparison against a git ref so a change's effect on size is visible.
//
//   deno task loc            # current working tree
//   deno task loc main       # working tree vs `main`
//   deno task loc HEAD~5      # working tree vs five commits back
//
// "Code changes fare" = the right column (Δ) when a ref is given.

const SOURCE_EXT = /\.(ts|tsx)$/;

/** Ordered category rules — first match wins, so put specific paths first. */
const CATEGORIES: { name: string; match: (path: string) => boolean }[] = [
  { name: "app tests (src/**/*.test)", match: (p) => p.startsWith("src/") && /\.test\.tsx?$/.test(p) },
  { name: "app code (src)", match: (p) => p.startsWith("src/") },
  { name: "e2e + headless (test)", match: (p) => p.startsWith("test/") },
  { name: "config (root)", match: (p) => !p.includes("/") },
  { name: "other", match: () => true },
];

type Counts = Map<string, number>;

function categorize(path: string): string {
  return CATEGORIES.find((c) => c.match(path))!.name;
}

async function run(cmd: string[]): Promise<string> {
  const { stdout } = await new Deno.Command(cmd[0], {
    args: cmd.slice(1),
    stdout: "piped",
    stderr: "null",
  }).output();
  return new TextDecoder().decode(stdout);
}

function countLines(text: string): number {
  if (text.length === 0) return 0;
  let n = 0;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  // Count a final line without trailing newline.
  if (text.charCodeAt(text.length - 1) !== 10) n++;
  return n;
}

/** Tracked + untracked (not ignored) source files in the working tree. */
async function workingTreeFiles(): Promise<string[]> {
  const out = await run(["git", "ls-files", "--cached", "--others", "--exclude-standard"]);
  return out.split("\n").filter((p) => p && SOURCE_EXT.test(p));
}

async function countWorkingTree(): Promise<Counts> {
  const counts: Counts = new Map();
  for (const path of await workingTreeFiles()) {
    try {
      const text = await Deno.readTextFile(path);
      const cat = categorize(path);
      counts.set(cat, (counts.get(cat) ?? 0) + countLines(text));
    } catch {
      // File vanished between listing and read — skip.
    }
  }
  return counts;
}

async function countAtRef(ref: string): Promise<Counts> {
  const counts: Counts = new Map();
  const list = await run(["git", "ls-tree", "-r", "--name-only", ref]);
  const files = list.split("\n").filter((p) => p && SOURCE_EXT.test(p));
  for (const path of files) {
    const text = await run(["git", "show", `${ref}:${path}`]);
    const cat = categorize(path);
    counts.set(cat, (counts.get(cat) ?? 0) + countLines(text));
  }
  return counts;
}

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

function signed(n: number): string {
  if (n === 0) return "—";
  return (n > 0 ? "+" : "") + fmt(n);
}

function report(current: Counts, base?: Counts, refLabel?: string) {
  const order = CATEGORIES.map((c) => c.name);
  const w = 28;
  const head = "category".padEnd(w) +
    (base ? (refLabel ?? "ref").padStart(12) : "") +
    (base ? "working".padStart(12) : "lines".padStart(10)) +
    (base ? "Δ".padStart(12) : "");
  console.log(head);
  console.log("-".repeat(head.length));
  let total = 0;
  let baseTotal = 0;
  for (const name of order) {
    const cur = current.get(name) ?? 0;
    const prev = base?.get(name) ?? 0;
    if (cur === 0 && prev === 0) continue;
    total += cur;
    baseTotal += prev;
    const row = name.padEnd(w) +
      (base ? fmt(prev).padStart(12) : "") +
      fmt(cur).padStart(base ? 12 : 10) +
      (base ? signed(cur - prev).padStart(12) : "");
    console.log(row);
  }
  console.log("-".repeat(head.length));
  console.log(
    "total".padEnd(w) +
      (base ? fmt(baseTotal).padStart(12) : "") +
      fmt(total).padStart(base ? 12 : 10) +
      (base ? signed(total - baseTotal).padStart(12) : ""),
  );
}

const ref = Deno.args[0];
const current = await countWorkingTree();
const base = ref ? await countAtRef(ref) : undefined;
let refLabel: string | undefined;
if (ref) {
  const sha = (await run(["git", "rev-parse", "--short", ref])).trim();
  refLabel = `${ref}@${sha}`;
  console.log(`working tree vs ${refLabel}\n`);
}
report(current, base, ref ? (ref.length > 11 ? ref.slice(0, 11) : ref) : undefined);

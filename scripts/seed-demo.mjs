// Sets up demo data on a local dev instance: two accounts and a room per language with an example program, each
// run once so its output panel isn't empty. Safe to run again: the demo rooms are recreated from scratch.
//
// Needs the API running (npm run dev:all) and MongoDB up (npm run db:up). Usage: npm run seed:demo
// The password is saved in .env.demo (gitignored) on the first run and reused after that.
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MongoClient, ObjectId } from 'mongodb';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const API = process.env.API_URL ?? 'http://localhost:4000';
const CREDENTIALS_FILE = `${ROOT}.env.demo`;

const OWNER = { username: 'demo_alex', email: 'alex@demo.devverse.test' };
const PARTNER = { username: 'demo_sam', email: 'sam@demo.devverse.test' };

/** partner: how demo_sam joins (an invite makes them an editor; joining a public room makes them a viewer). */
const ROOMS = [
  {
    name: 'Python Playground',
    language: 'python',
    visibility: 'public',
    partner: 'editor',
    stdin: 'demo audience\n',
    code: `# Type a name into "Program input (stdin)" and press Run (or Ctrl/Cmd+Enter).
import sys

name = sys.stdin.readline().strip() or "DevVerse"
GREEN, BOLD, RESET = "\\033[32m", "\\033[1m", "\\033[0m"

print(f"{BOLD}Hello, {name}!{RESET}")
for n in range(1, 6):
    print(f"{GREEN}{n} squared is {n * n}{RESET}")
print("This line goes to stderr", file=sys.stderr)
`,
  },
  {
    name: 'JavaScript Sandbox',
    language: 'javascript',
    visibility: 'private',
    partner: 'editor',
    code: `// Fibonacci with memoisation. Uncomment the last line to see a runtime error.
const memo = new Map();
function fib(n) {
  if (n < 2) return n;
  if (!memo.has(n)) memo.set(n, fib(n - 1) + fib(n - 2));
  return memo.get(n);
}

for (const n of [10, 40, 70]) console.log(\`fib(\${n}) = \${fib(n)}\`);
console.log('\\x1b[33mAll done!\\x1b[0m');
// null.boom();
`,
  },
  {
    name: 'C++ Algorithms',
    language: 'cpp',
    visibility: 'private',
    partner: 'editor',
    code: `#include <bits/stdc++.h>
using namespace std;

// Sorts the numbers given on stdin (or a default list) and prints their sum.
int main() {
    vector<long long> numbers;
    long long x;
    while (cin >> x) numbers.push_back(x);
    if (numbers.empty()) numbers = {42, 7, 19, 3, 88, 1};

    sort(numbers.begin(), numbers.end());
    for (long long n : numbers) cout << n << ' ';
    cout << "\\nsum = " << accumulate(numbers.begin(), numbers.end(), 0LL) << '\\n';
}
`,
  },
  {
    name: 'Java Basics',
    language: 'java',
    visibility: 'private',
    partner: 'editor',
    code: `import java.util.*;
import java.util.stream.*;

public class Main {
    public static void main(String[] args) {
        List<String> words = List.of("devverse", "java", "stream", "sandbox", "room", "code");
        Map<Integer, List<String>> byLength = words.stream()
            .collect(Collectors.groupingBy(String::length, TreeMap::new, Collectors.toList()));
        byLength.forEach((length, group) -> System.out.println(length + " letters: " + group));
    }
}
`,
  },
  {
    name: 'Infinite Loop Demo',
    language: 'python',
    visibility: 'public',
    partner: 'viewer',
    run: false, // run it live: the sandbox stops it after 5 seconds
    code: `# Press Run: this never ends on its own, so the sandbox stops it after 5 seconds.
print("Starting a loop that never ends...")
while True:
    pass
`,
  },
];

function loadPassword() {
  if (existsSync(CREDENTIALS_FILE)) {
    const match = readFileSync(CREDENTIALS_FILE, 'utf8').match(/^DEMO_PASSWORD=(.+)$/m);
    if (match) return match[1].trim();
  }
  const password = randomBytes(12).toString('base64url');
  writeFileSync(
    CREDENTIALS_FILE,
    [
      '# Demo accounts created by `npm run seed:demo`. Gitignored; share it with the team privately.',
      `# ${OWNER.username} <${OWNER.email}>: owns the demo rooms`,
      `# ${PARTNER.username} <${PARTNER.email}>: editor in most rooms, viewer in "Infinite Loop Demo"`,
      `DEMO_PASSWORD=${password}`,
      '',
    ].join('\n'),
    { mode: 0o600 },
  );
  return password;
}

async function api(path, { token, ...init } = {}) {
  const res = await fetch(`${API}/api/v1${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  const body = res.status === 204 ? null : await res.json();
  if (!res.ok) {
    const error = new Error(`${init.method ?? 'GET'} ${path} → ${res.status} ${body?.title ?? ''}`);
    error.status = res.status;
    throw error;
  }
  return body;
}

/** Signs the account up, or logs in if it already exists. Returns an access token. */
async function signIn({ username, email }, password) {
  try {
    const session = await api('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, email, password }),
    });
    console.log(`Created account ${username}`);
    return session.accessToken;
  } catch (err) {
    if (err.status !== 409) throw err;
    const session = await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    console.log(`Logged in as existing account ${username}`);
    return session.accessToken;
  }
}

async function waitForRun(runId, token) {
  for (let i = 0; i < 60; i++) {
    const run = await api(`/runs/${runId}`, { token });
    if (run.status === 'finished' || run.status === 'failed') return run;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Run ${runId} did not finish`);
}

function mongoUri() {
  const env = readFileSync(`${ROOT}server/.env`, 'utf8');
  const match = env.match(/^MONGODB_URI=(.+)$/m);
  if (!match) throw new Error('MONGODB_URI is missing from server/.env');
  return match[1].trim();
}

const password = loadPassword();
const ownerToken = await signIn(OWNER, password);
const partnerToken = await signIn(PARTNER, password);

// Start from a clean slate: delete demo rooms left over from a previous run (members and runs go with them).
const names = new Set(ROOMS.map((r) => r.name));
for (const room of await api('/rooms', { token: ownerToken })) {
  if (room.role === 'owner' && names.has(room.name)) {
    await api(`/rooms/${room.slug}`, { method: 'DELETE', token: ownerToken });
    console.log(`Deleted old room "${room.name}"`);
  }
}

const mongo = new MongoClient(mongoUri());
await mongo.connect();
try {
  for (const spec of ROOMS) {
    const room = await api('/rooms', {
      method: 'POST',
      token: ownerToken,
      body: JSON.stringify({
        name: spec.name,
        language: spec.language,
        visibility: spec.visibility,
      }),
    });

    // There's no API for editing files outside the live editor, so write the example straight into the file.
    // Nobody has opened it yet (no Yjs state), so the editor builds its document from this text on first open.
    await mongo
      .db()
      .collection('files')
      .updateOne(
        { _id: new ObjectId(room.files[0].id) },
        { $set: { content: spec.code, yState: null } },
      );

    const inviteCode = spec.partner === 'editor' ? room.inviteCode : undefined;
    await api(`/rooms/${room.slug}/join`, {
      method: 'POST',
      token: partnerToken,
      body: JSON.stringify(inviteCode ? { inviteCode } : {}),
    });

    let result = 'not run (run it live)';
    if (spec.run !== false) {
      const accepted = await api('/runs', {
        method: 'POST',
        token: ownerToken,
        body: JSON.stringify({
          roomSlug: room.slug,
          fileId: room.files[0].id,
          stdin: spec.stdin ?? '',
        }),
      });
      const run = await waitForRun(accepted.id, ownerToken);
      result =
        run.status === 'finished'
          ? `ran: ${run.verdict}, ${run.durationMs} ms`
          : `run failed: ${run.error}`;
    }
    console.log(
      `Room "${spec.name}" (${spec.language}, ${spec.visibility}, ${PARTNER.username} is ${spec.partner}): ${result}`,
    );
    console.log(`  http://localhost:5173/rooms/${room.slug}`);
  }
} finally {
  await mongo.close();
}

console.log(`\nLog in as ${OWNER.email} or ${PARTNER.email}; the password is in .env.demo.`);

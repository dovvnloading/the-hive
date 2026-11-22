import { readFileSync } from 'node:fs';
import { runAcceptance } from '../lib/arena/sandbox-store.mjs';

try {
  const [file, query, expectedPath] = process.argv.slice(2);
  const index = JSON.parse(readFileSync(file, 'utf8'));
  if (
    index.schemaVersion !== 1 ||
    !Array.isArray(index.documents) ||
    !index.documents.length
  )
    throw new Error('Invalid or empty document index');
  const checks =
    query === '--suite'
      ? JSON.parse(expectedPath)
      : [{ query, expectedPath, mode: 'contains' }];
  if (!Array.isArray(checks) || checks.length < 1 || checks.length > 6)
    throw new Error('Invalid acceptance suite');
  const { passed, cases } = runAcceptance(index.documents, checks);
  process.stdout.write(
    JSON.stringify({
      query: cases[0].query,
      expectedPath: cases[0].expectedPath,
      passed,
      resultPaths: cases[0].resultPaths,
      cases,
    }),
  );
  process.exitCode = passed ? 0 : 1;
} catch (error) {
  process.stderr.write(error.message);
  process.exitCode = 1;
}

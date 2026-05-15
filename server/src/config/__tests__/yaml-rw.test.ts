import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readYamlDoc,
  writeYamlDoc,
  applyMutation,
  computeEtag,
  EtagMismatchError,
} from '../yaml-rw.js';

const SAMPLE = `# top-level comment
company:
  name: "Meine Agentur"
  # company-internal comment
  agents:
    office:
      type: office
      model: deepseek/deepseek-v4-flash
      personality: |
        Du bist der Office-Manager einer Agentur. Koordiniere Deadlines.

projects:
  kunde-webshop:
    name: "Kunde Webshop Relaunch"
    directory: "~/demo-projects/kunde-webshop"

costs:
  anthropic/claude-sonnet: { in: 3.0, out: 15.0 }

pool:
  # Maximum number of warm sessions
  maxWarmSessions: 10
`;

describe('yaml-rw', () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'yaml-rw-'));
    path = join(dir, 'pragents.yaml');
    writeFileSync(path, SAMPLE, 'utf8');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe('readYamlDoc', () => {
    it('returns doc + etag + raw for a parseable file', () => {
      const { doc, etag, raw } = readYamlDoc(path);
      expect(doc.errors).toEqual([]);
      expect(raw).toBe(SAMPLE);
      expect(etag).toMatch(/^W\/"[a-f0-9]{64}"$/);
    });

    it('throws on YAML parse errors', () => {
      writeFileSync(path, '{ unclosed', 'utf8');
      expect(() => readYamlDoc(path)).toThrow(/YAML parse error/);
    });
  });

  describe('writeYamlDoc — round trip without mutation', () => {
    it('produces byte-identical output when no mutation is applied', () => {
      const { doc } = readYamlDoc(path);
      writeYamlDoc(path, doc, { suppressWatcher: false });
      expect(readFileSync(path, 'utf8')).toBe(SAMPLE);
    });

    it('returns the new etag, matching computeEtag of file content', () => {
      const { doc } = readYamlDoc(path);
      const { etag } = writeYamlDoc(path, doc, { suppressWatcher: false });
      expect(etag).toBe(computeEtag(readFileSync(path, 'utf8')));
    });
  });

  describe('applyMutation — comment + order preservation', () => {
    it('preserves block comments after editing a deeply-nested value', () => {
      const { doc } = readYamlDoc(path);
      applyMutation(doc, (d) => {
        d.setIn(['pool', 'maxWarmSessions'], 12);
      });
      writeYamlDoc(path, doc, { suppressWatcher: false });
      const after = readFileSync(path, 'utf8');
      expect(after).toContain('# top-level comment');
      expect(after).toContain('# company-internal comment');
      expect(after).toContain('# Maximum number of warm sessions');
      expect(after).toContain('maxWarmSessions: 12');
    });

    it('preserves key order when adding a new project', () => {
      const { doc } = readYamlDoc(path);
      applyMutation(doc, (d) => {
        const projects = d.get('projects') as ReturnType<typeof d.get>;
        const node = d.createNode({
          name: 'New Project',
          directory: '~/new-project',
        });
        (projects as { set: (k: string, v: unknown) => void }).set('new-project', node);
      });
      writeYamlDoc(path, doc, { suppressWatcher: false });
      const after = readFileSync(path, 'utf8');
      const companyIdx = after.indexOf('company:');
      const projectsIdx = after.indexOf('projects:');
      const costsIdx = after.indexOf('costs:');
      const poolIdx = after.indexOf('pool:');
      expect(companyIdx).toBeLessThan(projectsIdx);
      expect(projectsIdx).toBeLessThan(costsIdx);
      expect(costsIdx).toBeLessThan(poolIdx);
      expect(after).toContain('new-project:');
    });

    it('preserves flow-style maps', () => {
      const { doc } = readYamlDoc(path);
      writeYamlDoc(path, doc, { suppressWatcher: false });
      const after = readFileSync(path, 'utf8');
      expect(after).toContain('{ in: 3.0, out: 15.0 }');
    });
  });

  describe('writeYamlDoc — If-Match semantics', () => {
    it('writes when ifMatch matches current etag', () => {
      const { doc, etag } = readYamlDoc(path);
      applyMutation(doc, (d) => d.setIn(['pool', 'maxWarmSessions'], 99));
      const { etag: newEtag } = writeYamlDoc(path, doc, {
        ifMatch: etag,
        suppressWatcher: false,
      });
      expect(newEtag).not.toBe(etag);
      expect(readFileSync(path, 'utf8')).toContain('maxWarmSessions: 99');
    });

    it('throws EtagMismatchError when ifMatch does not match', () => {
      const { doc, etag } = readYamlDoc(path);
      writeFileSync(path, SAMPLE + '\n# external edit\n', 'utf8');
      expect(() =>
        writeYamlDoc(path, doc, { ifMatch: etag, suppressWatcher: false }),
      ).toThrow(EtagMismatchError);
    });

    it('EtagMismatchError carries path, expected, and actual', () => {
      const { doc, etag } = readYamlDoc(path);
      writeFileSync(path, SAMPLE + '\n# external edit\n', 'utf8');
      try {
        writeYamlDoc(path, doc, { ifMatch: etag, suppressWatcher: false });
        expect.fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(EtagMismatchError);
        const e = err as EtagMismatchError;
        expect(e.path).toBe(path);
        expect(e.expected).toBe(etag);
        expect(e.actual).not.toBe(etag);
      }
    });
  });

  describe('computeEtag', () => {
    it('is deterministic for identical content', () => {
      expect(computeEtag('hello')).toBe(computeEtag('hello'));
    });

    it('differs for different content', () => {
      expect(computeEtag('hello')).not.toBe(computeEtag('hello!'));
    });

    it('uses the weak-etag W/ prefix and 64-char hex digest', () => {
      expect(computeEtag('x')).toMatch(/^W\/"[a-f0-9]{64}"$/);
    });
  });
});

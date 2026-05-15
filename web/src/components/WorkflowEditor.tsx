import React, { useEffect, useRef, useState } from 'react';
import Editor, { type OnMount, type OnChange } from '@monaco-editor/react';
import { configureMonacoYaml } from 'monaco-yaml';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type * as Monaco from 'monaco-editor';
import * as YAML from 'yaml';
import { WorkflowDef } from '@pragents/schema/workflow';
import { WORKFLOW_SNIPPETS } from './workflow-snippets.js';
import { computeAgentMarkers } from './workflow-markers.js';

/**
 * Monaco-backed YAML editor for project workflows (Slice 4 / U12).
 *
 * Lazy-loaded by the route wrapping it (see
 * `web/src/routes/projects/$projectId.workflows.$workflowName.tsx`) so
 * the ~3 MB Monaco bundle never lands in the main chunk. The component
 * itself is purely presentational over `@monaco-editor/react`; all
 * editor state belongs to the parent.
 *
 * Validation has two layers:
 *  1. `monaco-yaml` enforces the JSON-Schema derived from `WorkflowDef`
 *     via `zod-to-json-schema`. Inline markers + hover docs come for
 *     free.
 *  2. A small post-pass adds custom markers for agent refs that don't
 *     match any agent in `knownAgents`. The pure marker computation
 *     lives in `computeAgentMarkers` so tests can drive it without
 *     spinning up Monaco.
 */

const WORKFLOW_SCHEMA_URI = 'inmemory://schemas/workflow.json';
const WORKFLOW_MODEL_URI = 'inmemory://workflows/edit.yaml';

let monacoYamlConfigured = false;

export interface WorkflowEditorProps {
  value: string;
  onChange: (next: string) => void;
  /** Agent IDs (`<type>@<projectId>`) that count as valid in this workflow. */
  knownAgents: readonly string[];
  /** Forwarded to Monaco's `readOnly` option. */
  readOnly?: boolean;
  /** Height of the editor pane (CSS value). */
  height?: string;
}

// Compute the JSON schema once at module load — `WorkflowDef` is immutable
// at runtime, and the previous per-mount recomputation only happened to
// apply on the first mount (because of the `monacoYamlConfigured` guard).
const WORKFLOW_JSON_SCHEMA = zodToJsonSchema(
  WorkflowDef as any,
  'WorkflowDef',
) as any;

export function WorkflowEditor({
  value,
  onChange,
  knownAgents,
  readOnly = false,
  height = '500px',
}: WorkflowEditorProps) {
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const monacoRef = useRef<Parameters<OnMount>[1] | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    if (!monacoYamlConfigured) {
      configureMonacoYaml(monaco, {
        enableSchemaRequest: false,
        validate: true,
        format: { enable: true },
        hover: true,
        completion: true,
        schemas: [
          {
            uri: WORKFLOW_SCHEMA_URI,
            fileMatch: [WORKFLOW_MODEL_URI],
            schema: WORKFLOW_JSON_SCHEMA,
          },
        ],
      });
      monacoYamlConfigured = true;
    }

    monaco.languages.registerCompletionItemProvider('yaml', {
      triggerCharacters: [' ', '\n', '-'],
      provideCompletionItems: (
        _model: Monaco.editor.ITextModel,
        position: Monaco.Position,
      ) => {
        const range = {
          startLineNumber: position.lineNumber,
          startColumn: position.column,
          endLineNumber: position.lineNumber,
          endColumn: position.column,
        };
        return {
          suggestions: WORKFLOW_SNIPPETS.map((s) => ({
            label: s.label,
            kind: monaco.languages.CompletionItemKind.Snippet,
            detail: s.description,
            insertText: s.body,
            insertTextRules:
              monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            range,
          })),
        };
      },
    });

    refreshAgentMarkers(editor.getValue());
  };

  function refreshAgentMarkers(source: string) {
    const monaco = monacoRef.current;
    const editor = editorRef.current;
    if (!monaco || !editor) return;
    const model = editor.getModel();
    if (!model) return;
    const markers = computeAgentMarkers(source, knownAgents).map((m) => ({
      severity: monaco.MarkerSeverity.Warning,
      startLineNumber: m.line,
      startColumn: m.column,
      endLineNumber: m.line,
      endColumn: m.column + m.length,
      message: m.message,
      source: 'pragents',
    }));
    monaco.editor.setModelMarkers(model, 'pragents-agents', markers);
  }

  const handleChange: OnChange = (next) => {
    const text = next ?? '';
    onChange(text);
    // Cheap parse to surface "is it even YAML" feedback in the status bar
    // alongside Monaco's own schema markers.
    try {
      YAML.parse(text);
      setParseError(null);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : String(err));
    }
    refreshAgentMarkers(text);
  };

  useEffect(() => {
    if (editorRef.current) refreshAgentMarkers(editorRef.current.getValue());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [knownAgents]);

  return (
    <div className="border border-zinc-800 rounded-lg overflow-hidden">
      <Editor
        height={height}
        defaultLanguage="yaml"
        value={value}
        path={WORKFLOW_MODEL_URI}
        onMount={handleMount}
        onChange={handleChange}
        options={{
          readOnly,
          minimap: { enabled: false },
          fontSize: 13,
          lineNumbers: 'on',
          wordWrap: 'on',
          renderWhitespace: 'selection',
          scrollBeyondLastLine: false,
          tabSize: 2,
          // Snippets-from-completion is the trigger-char autocomplete
          // path used by `registerCompletionItemProvider` above.
          suggest: { snippetsPreventQuickSuggestions: false },
          quickSuggestions: { other: true, comments: false, strings: false },
        }}
        theme="vs-dark"
      />
      {parseError && (
        <div
          role="alert"
          className="px-3 py-2 text-[11px] text-amber-300 bg-amber-950/30 border-t border-amber-900 font-mono"
        >
          YAML parse error: {parseError}
        </div>
      )}
    </div>
  );
}

import { defineTool, type JsonObject, type ToolDefinition } from './types'

type ListFilesArguments = { path?: string }
type ReadFileArguments = { path: string; startLine?: number; endLine?: number }
type SearchFilesArguments = { query: string; path?: string; isRegex?: boolean }
type WriteFileArguments = { path: string; content: string; expectedRevision?: string }
type ApplyPatchArguments = { patch: string }
type EditFileArguments = {
  path: string
  expectedRevision: string
  replacements: Array<{ oldText: string; newText: string }>
}
type DeleteFileArguments = { path: string; expectedRevision: string }
type PreviewCheckArguments = Record<string, never>

type FilesResult = { paths: string[] }
type FileResult = { path: string; revision: string; content?: string; changeSummary?: string }
type ApplyPatchResult = { paths: string[]; changeSummary: string }
type SearchResult = { matches: Array<{ path: string; line: number; text: string }> }
type PreviewResult = { issueCount: number; status: 'loaded' | 'error' }

function bridgedHandler<TArguments extends JsonObject, TResult extends JsonObject>(name: string) {
  return (argumentsValue: TArguments, context: Parameters<ToolDefinition<string, TArguments, TResult>['handler']>[1]) =>
    context.invoke<TResult>(name, argumentsValue)
}

const pathProperty = { type: 'string' as const, description: 'Normalized workspace-relative path.' }
const expectedRevisionProperty = { type: 'string' as const, description: 'Revision observed by the model before editing.' }

export const toolDefinitions = [
  defineTool<'list_files', ListFilesArguments, FilesResult>({
    name: 'list_files',
    description: 'List the filtered workspace tree with sizes and revisions.',
    inputSchema: { type: 'object', properties: { path: pathProperty }, additionalProperties: false },
    effect: 'read', concurrency: 'parallel', resultBudget: 4_000,
    handler: bridgedHandler('list_files'),
    present: (_args, result) => ({ title: 'Listed project files', subtitle: result?.data ? `${result.data.paths.length} files` : undefined }),
  }),
  defineTool<'read_file', ReadFileArguments, FileResult>({
    name: 'read_file',
    description: 'Read a full file or a bounded line range at its current revision.',
    inputSchema: { type: 'object', properties: { path: pathProperty, startLine: { type: 'number' }, endLine: { type: 'number' } }, required: ['path'], additionalProperties: false },
    effect: 'read', concurrency: 'parallel', resultBudget: 12_000,
    handler: bridgedHandler('read_file'),
    present: args => ({ title: `Read ${args.path}`, subtitle: 'File contents loaded' }),
  }),
  defineTool<'search_files', SearchFilesArguments, SearchResult>({
    name: 'search_files',
    description: 'Search workspace text using an exact string or regular expression.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, path: pathProperty, isRegex: { type: 'boolean' } }, required: ['query'], additionalProperties: false },
    effect: 'read', concurrency: 'parallel', resultBudget: 8_000,
    handler: bridgedHandler('search_files'),
    present: (args, result) => ({ title: `Searched for “${args.query}”`, subtitle: result?.data ? `${result.data.matches.length} matches` : undefined }),
  }),
  defineTool<'write_file', WriteFileArguments, FileResult>({
    name: 'write_file',
    description: 'Create a file or intentionally replace a file at an expected revision.',
    inputSchema: { type: 'object', properties: { path: pathProperty, content: { type: 'string' }, expectedRevision: expectedRevisionProperty }, required: ['path', 'content'], additionalProperties: false },
    effect: 'write', concurrency: 'serial', resultBudget: 2_000,
    handler: bridgedHandler('write_file'),
    present: args => ({ title: `Wrote ${args.path}`, details: [{ label: args.path }] }),
  }),
  defineTool<'apply_patch', ApplyPatchArguments, ApplyPatchResult>({
    name: 'apply_patch',
    description: 'Apply one atomic Codex-style patch across one or more workspace files.',
    inputSchema: { type: 'object', properties: { patch: { type: 'string' } }, required: ['patch'], additionalProperties: false },
    effect: 'write', concurrency: 'serial', resultBudget: 2_000,
    handler: bridgedHandler('apply_patch'),
    present: (_args, result) => ({
      title: 'Applied patch',
      details: result?.data?.paths.map(path => ({ label: path })),
    }),
  }),
  defineTool<'edit_file', EditFileArguments, FileResult>({
    name: 'edit_file',
    description: 'Apply atomic exact-text replacements against an expected file revision.',
    inputSchema: { type: 'object', properties: { path: pathProperty, expectedRevision: expectedRevisionProperty, replacements: { type: 'array', items: { type: 'object', properties: { oldText: { type: 'string' }, newText: { type: 'string' } }, required: ['oldText', 'newText'], additionalProperties: false } } }, required: ['path', 'expectedRevision', 'replacements'], additionalProperties: false },
    effect: 'write', concurrency: 'serial', resultBudget: 2_000,
    handler: bridgedHandler('edit_file'),
    present: (args, result) => ({ title: `Edited ${args.path}`, details: [{ label: args.path, value: result?.data?.changeSummary ?? `${args.replacements.length} replacements` }] }),
  }),
  defineTool<'delete_file', DeleteFileArguments, FileResult>({
    name: 'delete_file',
    description: 'Delete one explicit workspace file after its snapshot is captured.',
    inputSchema: { type: 'object', properties: { path: pathProperty, expectedRevision: expectedRevisionProperty }, required: ['path', 'expectedRevision'], additionalProperties: false },
    effect: 'write', concurrency: 'serial', resultBudget: 2_000,
    handler: bridgedHandler('delete_file'),
    present: args => ({ title: `Deleted ${args.path}`, details: [{ label: args.path }] }),
  }),
  defineTool<'preview_check', PreviewCheckArguments, PreviewResult>({
    name: 'preview_check',
    description: 'Return the latest preview load, console, runtime, and asset diagnostics.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    effect: 'diagnostic', concurrency: 'parallel', resultBudget: 4_000,
    handler: bridgedHandler('preview_check'),
    present: (_args, result) => ({ title: 'Checked preview', subtitle: result?.data ? `${result.data.issueCount} issues` : undefined }),
  }),
] as const

export type ToolDefinitionUnion = (typeof toolDefinitions)[number]
export type ToolName = ToolDefinitionUnion['name']
export type ToolArguments<TName extends ToolName> = Extract<ToolDefinitionUnion, { name: TName }> extends ToolDefinition<TName, infer TArguments, infer _TResult> ? TArguments : never

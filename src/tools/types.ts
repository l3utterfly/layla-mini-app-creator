export type JsonObject = Record<string, unknown>

export type JsonSchema = {
  type: 'object' | 'array' | 'string' | 'number' | 'boolean'
  description?: string
  properties?: Record<string, JsonSchema>
  required?: readonly string[]
  additionalProperties?: boolean
  items?: JsonSchema
}

export type ToolEffect = 'read' | 'write' | 'diagnostic'
export type ToolConcurrency = 'parallel' | 'serial'
export type ToolStatus = 'pending' | 'running' | 'completed' | 'error'

export type ToolPresentation = {
  title: string
  subtitle?: string
  details?: Array<{ label: string; value?: string }>
}

export type ToolContext = {
  workspaceId: string
  workspaceRevision: number
  invoke<TResult extends JsonObject>(toolName: string, argumentsValue: JsonObject): Promise<TResult>
}

export type ToolDefinition<
  TName extends string,
  TArguments extends JsonObject,
  TResult extends JsonObject,
> = {
  name: TName
  description: string
  inputSchema: JsonSchema
  effect: ToolEffect
  concurrency: ToolConcurrency
  resultBudget: number
  availability?: (context: ToolContext) => boolean
  handler: (argumentsValue: TArguments, context: ToolContext) => Promise<TResult>
  present: (argumentsValue: TArguments, result?: ToolResultEnvelope<TResult>) => ToolPresentation
}

export type ToolCall<TName extends string = string, TArguments extends JsonObject = JsonObject> = {
  callId: string
  name: TName
  arguments: TArguments
}

export type ToolError = {
  code: string
  message: string
}

export type ToolResultEnvelope<TResult extends JsonObject = JsonObject> = {
  callId: string
  tool: string
  ok: boolean
  workspaceRevision: number
  changedPaths: string[]
  data?: TResult
  diagnostics: string[]
  error?: ToolError
}

export type ToolActivity = {
  call: ToolCall
  status: ToolStatus
  result?: ToolResultEnvelope
}

export type ToolRunGroup = {
  id: string
  activities: ToolActivity[]
}

export function defineTool<
  const TName extends string,
  TArguments extends JsonObject,
  TResult extends JsonObject,
>(definition: ToolDefinition<TName, TArguments, TResult>) {
  return definition
}

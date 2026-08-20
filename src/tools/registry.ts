import { toolDefinitions, type ToolArguments, type ToolDefinitionUnion, type ToolName } from './definitions'
import { validateArguments } from './schema'
import type { JsonObject, ToolCall, ToolContext, ToolPresentation, ToolResultEnvelope } from './types'

const definitionByName = new Map<ToolName, ToolDefinitionUnion>(
  toolDefinitions.map(definition => [definition.name, definition]),
)

let nextCallNumber = 1

export function getToolDefinition<TName extends ToolName>(name: TName) {
  const definition = definitionByName.get(name)
  if (!definition) throw new Error(`Unknown tool: ${name}`)
  return definition
}

export function materializeToolCatalog(context: ToolContext) {
  return toolDefinitions
    .filter(definition => !definition.availability || definition.availability(context))
    .map(({ name, description, inputSchema, effect, concurrency, resultBudget }) => ({
      name,
      description,
      inputSchema,
      effect,
      concurrency,
      resultBudget,
    }))
}

export function createToolCall<TName extends ToolName>(
  name: TName,
  argumentsValue: ToolArguments<TName>,
  callId?: string,
): ToolCall<TName, ToolArguments<TName>> {
  return createToolCallFromUnknown(name, argumentsValue, callId) as ToolCall<TName, ToolArguments<TName>>
}

export function createToolCallFromUnknown(
  name: string,
  argumentsValue: JsonObject,
  callId = `call_${nextCallNumber++}`,
): ToolCall {
  if (!isKnownToolName(name)) throw new Error(`Unknown tool: ${name}`)
  const definition = getToolDefinition(name)
  const errors = validateArguments(definition.inputSchema, argumentsValue)
  if (errors.length) throw new Error(`Invalid ${name} call: ${errors.join('; ')}`)
  return { callId, name, arguments: argumentsValue }
}

export function presentToolCall(call: ToolCall, result?: ToolResultEnvelope): ToolPresentation {
  const definition = definitionByName.get(call.name as ToolName)
  if (!definition) return { title: call.name, subtitle: 'Unknown tool' }
  return definition.present(call.arguments as never, result as never)
}

export function summarizeToolRun(calls: Array<{ call: ToolCall; result?: ToolResultEnvelope }>): ToolPresentation {
  const changedPaths = [...new Set(calls.flatMap(activity => activity.result?.changedPaths ?? []))]
  if (changedPaths.length) {
    return {
      title: `Edited ${changedPaths.length} ${changedPaths.length === 1 ? 'file' : 'files'}`,
      subtitle: changedPaths.join(' · '),
      details: calls.flatMap(activity => presentToolCall(activity.call, activity.result).details ?? []),
    }
  }
  return calls[0] ? presentToolCall(calls[0].call, calls[0].result) : { title: 'No tool activity' }
}

export function isKnownToolName(value: string): value is ToolName {
  return definitionByName.has(value as ToolName)
}

export type AnyToolArguments = JsonObject

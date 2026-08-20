import type { JsonObject, JsonSchema } from './types'

function describePath(path: string) {
  return path || 'arguments'
}

function validateValue(schema: JsonSchema, value: unknown, path: string): string[] {
  if (schema.type === 'array') {
    if (!Array.isArray(value)) return [`${describePath(path)}: expected array`]
    if (!schema.items) return []
    return value.flatMap((item, index) => validateValue(schema.items!, item, `${path}[${index}]`))
  }

  if (schema.type === 'object') {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return [`${describePath(path)}: expected object`]
    }

    const objectValue = value as JsonObject
    const properties = schema.properties ?? {}
    const errors: string[] = []

    for (const key of schema.required ?? []) {
      if (!(key in objectValue)) errors.push(`${path ? `${path}.` : ''}${key}: required`)
    }

    for (const [key, propertyValue] of Object.entries(objectValue)) {
      const propertyPath = path ? `${path}.${key}` : key
      const propertySchema = properties[key]
      if (!propertySchema) {
        if (schema.additionalProperties === false) errors.push(`${propertyPath}: unknown argument`)
        continue
      }
      errors.push(...validateValue(propertySchema, propertyValue, propertyPath))
    }
    return errors
  }

  return typeof value === schema.type ? [] : [`${describePath(path)}: expected ${schema.type}`]
}

export function validateArguments(schema: JsonSchema, value: unknown): string[] {
  return validateValue(schema, value, '')
}

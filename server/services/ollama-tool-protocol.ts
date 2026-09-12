type Schema = Record<string, unknown>;
const object = (value: unknown): value is Schema => !!value && typeof value === 'object' && !Array.isArray(value);
function branches(input: unknown, root: Schema, depth = 0): Schema[] {
  if(!object(input) || depth > 32) return [{}];
  if(typeof input.$ref === 'string' && input.$ref.startsWith('#/')) {
    let target: unknown = root;
    for(const token of input.$ref.slice(2).split('/').map(v => v.replace(/~1/g, '/').replace(/~0/g, '~'))) target = object(target) && Object.hasOwn(target, token) ? target[token] : undefined;
    return branches(target, root, depth + 1);
  }
  const variants = input.oneOf ?? input.anyOf;
  if(Array.isArray(variants)) {
    const {oneOf, anyOf, ...base} = input;
    return variants.flatMap(variant => branches(variant, root, depth + 1).map(child => ({...base, ...child})));
  }
  return [input];
}
const types = (schema: Schema): string[] => Array.isArray(schema.type) ? schema.type as string[] : typeof schema.type === 'string' ? [schema.type] : schema.properties ? ['object'] : schema.items ? ['array'] : [];

/** Ollama's model-facing tool schema must expose properties outside union keywords.
 * This is an input hint only: the original MCP/workspace schema still validates calls.
 */
export function ollamaToolSchema(input: Schema): Schema {
  const visit = (node: unknown, depth: number): Schema => {
    if(depth > 32) return {};
    const variants = branches(node, input);
    const typeSet = [...new Set(variants.flatMap(types))];
    const result: Schema = typeSet.length ? {type: typeSet.length === 1 ? typeSet[0] : typeSet} : {};
    if(variants.length === 1) for(const key of ['description', 'enum', 'const', 'minimum', 'maximum', 'minItems', 'maxItems', 'minLength', 'maxLength', 'format']) {
      if(variants[0][key] !== undefined) result[key] = variants[0][key];
    }
    if(variants.every(v => Array.isArray(v.enum) || Object.hasOwn(v, 'const'))) result.enum = [...new Set(variants.flatMap(v => Array.isArray(v.enum) ? v.enum : [v.const]))];
    const objectVariants = variants.filter(v => types(v).includes('object'));
    if(objectVariants.length) {
      const names = [...new Set(objectVariants.flatMap(v => Object.keys(object(v.properties) ? v.properties : {})))];
      result.properties = Object.fromEntries(names.map(name => {
        const properties = objectVariants.map(v => object(v.properties) ? v.properties[name] : undefined).filter(v => v !== undefined);
        return [name, visit(properties.length === 1 ? properties[0] : {anyOf: properties}, depth + 1)];
      }));
      result.required = names.filter(name => objectVariants.every(v => Array.isArray(v.required) && v.required.includes(name)));
      result.additionalProperties = objectVariants.some(v => v.additionalProperties !== false);
    }
    const items = variants.map(v => v.items).filter(v => v !== undefined);
    if(items.length) result.items = visit(items.length === 1 ? items[0] : {anyOf: items}, depth + 1);
    return result;
  };
  return visit(input, 0);
}

/** Decode serialized containers only where the schema expects an object/array.
 * Never coerce numbers, booleans or JSON-looking text fields, or infer missing values.
 */
export function decodeToolArguments(input: unknown, schema: Schema): {arguments: Record<string, unknown>; note?: string} {
  const decoded: string[] = [];
  const visit = (value: unknown, node: unknown, pointer: string, depth: number): unknown => {
    if(depth > 32) throw new Error('Tool arguments are nested too deeply.');
    const variants = branches(node, schema);
    const allowed = new Set(variants.flatMap(types));
    if(typeof value === 'string' && !allowed.has('string') && (allowed.has('object') || allowed.has('array'))) {
      let parsed: unknown;
      try {parsed = JSON.parse(value);} catch {throw new Error(`${pointer}: expected ${[...allowed].join('/')} but received a string containing invalid JSON. Pass the actual object or array, without surrounding quotes.`);}
      if(!(object(parsed) && allowed.has('object')) && !(Array.isArray(parsed) && allowed.has('array'))) throw new Error(`${pointer}: expected an object or array, not a JSON scalar.`);
      value = parsed; decoded.push(pointer);
    }
    if(object(value)) return Object.fromEntries(Object.entries(value).map(([key, child]) => {
      const childSchemas = variants.map(v => object(v.properties) && Object.hasOwn(v.properties, key) ? v.properties[key] : object(v.additionalProperties) ? v.additionalProperties : undefined).filter(v => v !== undefined);
      return [key, childSchemas.length ? visit(child, childSchemas.length === 1 ? childSchemas[0] : {anyOf: childSchemas}, `${pointer}.${key}`, depth + 1) : child];
    }));
    if(Array.isArray(value)) {
      const items = variants.map(v => v.items).filter(v => v !== undefined);
      return items.length ? value.map((child, i) => visit(child, items.length === 1 ? items[0] : {anyOf: items}, `${pointer}[${i}]`, depth + 1)) : value;
    }
    return value;
  };
  const args = visit(input, schema, 'arguments', 0);
  if(!object(args)) throw new Error('Tool arguments must be a JSON object.');
  return {arguments: args, ...(decoded.length ? {note: `Decoded JSON text into containers at ${decoded.join(', ')}. Values are unchanged; normal validation still applies.`} : {})};
}

/** Detect protocol tokens leaked as plain text; request a real call, never execute prose. */
export function isLeakedToolCall(text: string) {
  return /^\s*(?:\[TOOL_CALLS\]\s*)?[\w.-]+\s*\[ARGS\]/.test(text) || /^\s*<tool_call>/.test(text);
}

import {AjvJsonSchemaValidator} from '@modelcontextprotocol/sdk/validation/ajv';
import type {JsonSchemaValidator, JsonSchemaType} from '@modelcontextprotocol/sdk/validation';

/** Validate the original contract, not the simplified hints shown to the model. */
export class OllamaToolExecution {
  private provider = new AjvJsonSchemaValidator();
  private validators = new Map<string, JsonSchemaValidator<unknown>>();
  private failures = new Map<string, {signature: string; repeated: number; total: number}>();
  constructor(private schemas: Map<string, Record<string, unknown>>) {}

  validate(name: string, args: unknown) {
    const schema = this.schemas.get(name);
    if(!schema) throw new Error(`Unknown or disabled tool: ${name}`);
    let validate = this.validators.get(name);
    if(!validate) {validate = this.provider.getValidator(schema as JsonSchemaType); this.validators.set(name, validate);}
    const result = validate(args);
    if(!result.valid) throw new Error(`Invalid ${name} arguments: ${result.errorMessage}. ${this.hint(name)}`);
  }

  hint(name: string) {
    const schema = this.schemas.get(name);
    if(!schema) return 'Discover an available tool before retrying.';
    return `Required fields: ${JSON.stringify(schema.required ?? [])}. Use the native schema, real IDs and the returned project revision; never invent missing values.`;
  }

  failed(name: string, signature: string) {
    const previous = this.failures.get(name);
    const failure = {signature, repeated: previous?.signature === signature ? previous.repeated + 1 : 1, total: (previous?.total ?? 0) + 1};
    this.failures.set(name, failure);
    // Fixing shape, then ranges, then cache evidence is progress, not three
    // identical failures. Still bound a model that keeps inventing new errors.
    if(failure.repeated >= 3) return 'repeated the same error three times';
    if(failure.total >= 8) return 'made eight unsuccessful repair attempts';
    return null;
  }
  succeeded(name: string) {this.failures.delete(name);}
  unresolved() {return [...this.failures.keys()];}
}

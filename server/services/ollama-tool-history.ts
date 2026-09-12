import type {OllamaMessage, OllamaTool} from './ollama-client';

/** Some model templates resolve historical calls against the current tool definitions.
 * Encode inactive calls through our permanent dispatcher, preserving names, arguments
 * and paired results without loading every old schema or enabling any old permission.
 * This is a request-only view: saved history and visible activity remain unchanged.
 */
export function ollamaToolHistory(messages: OllamaMessage[], tools: OllamaTool[]): OllamaMessage[] {
  const declared = new Set(tools.map(tool => tool.function.name));
  const inspectionArgs = (args: Record<string, unknown>) => Object.keys(args).length === 1 && args.inspection && typeof args.inspection === 'object' && !Array.isArray(args.inspection) ? args.inspection as Record<string, unknown> : args;
  return messages.map(message => {
    if(message.role === 'assistant' && message.tool_calls?.length) return {...message, tool_calls: message.tool_calls.map(call => {
      let args = call.function.arguments;
      if(args && typeof args === 'object') {
        if(call.function.name === 'inspect_video') args = inspectionArgs(args);
        if(call.function.name === 'call_editor_tool' && args.name === 'inspect_video' && args.arguments && typeof args.arguments === 'object' && !Array.isArray(args.arguments)) args = {...args, arguments: inspectionArgs(args.arguments as Record<string, unknown>)};
      }
      return declared.has(call.function.name) ? {...call, function: {...call.function, arguments: args}} : {
        ...call, function: {name: 'call_editor_tool', arguments: {name: call.function.name, arguments: args}},
      };
    })};
    if(message.role === 'tool' && message.tool_name && !declared.has(message.tool_name)) return {...message, tool_name: 'call_editor_tool'};
    return message;
  });
}

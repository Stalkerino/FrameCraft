/** Keep installed resources read-only while allowing agents to create assets. */
export const agentWorkspacePath = (sourceRoot: string) => process.env.FRAMECRAFT_AGENT_WORKSPACE || sourceRoot;

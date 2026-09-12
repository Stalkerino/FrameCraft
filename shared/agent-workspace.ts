import {z} from 'zod';

const filePath = z.string().min(1).max(4096).describe('Path relative to the configured workspace.');
const expectedSha256 = z.string().regex(/^[a-f0-9]{64}$/).nullable().describe('Hash from read_workspace_file, or null to create a new file. Existing files require their current hash.');
export const workspaceToolSchemas = {
  list_workspace_files: z.object({path: filePath.default('.'), offset: z.number().int().min(0).default(0)}).strict(),
  read_workspace_file: z.object({path: filePath, offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(32000).default(16000)}).strict(),
  write_workspace_file: z.object({path: filePath, content: z.string().max(2_000_000), expectedSha256}).strict(),
  edit_workspace_file: z.object({path: filePath, expectedSha256: expectedSha256.unwrap(), search: z.string().min(1).max(2_000_000), replacement: z.string().max(2_000_000)}).strict(),
  run_workspace_command: z.object({executable: z.string().min(1).max(4096), args: z.array(z.string().max(64000)).max(256).default([]), cwd: filePath.default('.'), timeoutMs: z.number().int().min(1000).max(600000).default(60000)}).strict(),
};
export type WorkspaceToolName = keyof typeof workspaceToolSchemas;

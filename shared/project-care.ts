import {z} from 'zod';
const revision = z.number().int().nonnegative();
const filePath = z.string().trim().min(1).max(4096);
export const checkpointSchema = z.object({revision, label: z.string().trim().min(1).max(120).default('Manual checkpoint')}).strict();
export const restoreProjectSchema = z.object({revision, id: z.string().uuid()}).strict();
export const relinkMediaSchema = z.object({revision, assetId: z.string().min(1), filePath}).strict();
export const packageProjectSchema = z.object({revision, directory: filePath}).strict();
export const importPackageSchema = z.object({directory: filePath}).strict();
export interface RecoveryVersion {id: string; projectId: string; name: string; revision: number; createdAt: string; label: string; bytes: number}
export interface MediaHealth {projectId: string; revision: number; media: {assetId: string; name: string; kind: string; src: string; filePath?: string; status: 'available' | 'missing' | 'unreadable' | 'unsupported'; bytes?: number}[]}
export interface ProjectTransferJob {id: string; kind: 'export' | 'import'; status: 'queued' | 'copying' | 'done' | 'error' | 'cancelled'; projectId: string; directory: string; progress: number; files: number; totalFiles: number; bytes: number; totalBytes: number; error?: string}

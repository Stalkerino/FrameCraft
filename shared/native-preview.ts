/** Control/geometry only. Video pixels never cross this contract. */
export interface NativePreviewInput {file: string; sourceStart: number; image: boolean; width: number; height: number}
export interface NativePreviewScene {
  quality?: import('./media-import').PreviewQuality; mediaKey?: string;
  projectId: string; revision: number; start: number; duration: number; fps: number;
  width: number; height: number; bufferedFrames: number; graph: string; inputs: NativePreviewInput[];
}

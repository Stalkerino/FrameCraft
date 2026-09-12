import {realpath} from 'node:fs/promises';
import path from 'node:path';
import {browserExecutable} from './browser-service';
import {remotionRenderer} from './remotion-encoder-adapter';
import type {HardwareEncoder} from './encoding-arguments';

interface GpuInfo {gpu: {auxAttributes?: {glRenderer?: string}; featureStatus?: Record<string, string>}}

export function hardwareBrowserStatus(info: GpuInfo) {
  const renderer = info.gpu.auxAttributes?.glRenderer ?? '';
  const features = info.gpu.featureStatus ?? {};
  const software = /swiftshader|llvmpipe|softpipe|software|lavapipe/i.test(renderer);
  return {accelerated: !!renderer && !software && features.gpu_compositing === 'enabled' && features.rasterization === 'enabled', renderer};
}

/** Run inside the isolated export worker. Never force Vulkan or ignore driver
 * capability failures. Share one browser between artwork and the full renderer.
 */
export async function openRenderBrowser(hardware?: HardwareEncoder) {
  const previousPrime = process.env.DRI_PRIME;
  if(hardware?.device && process.platform === 'linux' && previousPrime === undefined) {
    const device = await realpath(path.join('/sys/class/drm', path.basename(hardware.device), 'device')).catch(() => '');
    const pci = path.basename(device);
    if(/^[\da-f]{4}:[\da-f]{2}:[\da-f]{2}\.[\da-f]$/i.test(pci)) process.env.DRI_PRIME = `pci-${pci.replace(/[:.]/g, '_')}`;
  }
  const chromiumOptions = {gl: hardware ? process.platform === 'linux' ? 'angle-egl' as const : 'angle' as const : 'swangle' as const};
  let browser: Awaited<ReturnType<typeof remotionRenderer.openBrowser>>;
  try {browser = await remotionRenderer.openBrowser('chrome', {browserExecutable: browserExecutable(), chromiumOptions, logLevel: 'error'});}
  finally {if(previousPrime === undefined) delete process.env.DRI_PRIME; else process.env.DRI_PRIME = previousPrime;}
  if(!hardware) return {browser, chromiumOptions, accelerated: false, label: 'Software browser rendering'};
  try {
    // Remotion's pinned CDP type subset omits this standard browser command.
    const connection = browser.connection as unknown as {send(method: 'SystemInfo.getInfo'): Promise<{value: GpuInfo}>};
    const {value} = await connection.send('SystemInfo.getInfo');
    const status = hardwareBrowserStatus(value);
    return {browser, chromiumOptions, accelerated: status.accelerated,
      label: status.accelerated ? `GPU browser rendering · ${status.renderer}` : 'Software browser rendering',
      warning: status.accelerated ? undefined : 'The browser did not enable hardware compositing and rasterization. Video encoding still uses the selected GPU; browser effects use software rendering.'};
  } catch(error) {
    await browser.close({silent: true});
    throw new Error(`Could not verify the export browser GPU: ${(error as Error).message}`);
  }
}

import {realpath} from 'node:fs/promises';
import path from 'node:path';
import {browserExecutable, prepareRenderBrowser} from './browser-service';
import {remotionRenderer} from './remotion-encoder-adapter';
import type {HardwareEncoder} from './encoding-arguments';
import {gpuDisabled} from './rendering/gpu-policy';

interface GpuInfo {gpu: {auxAttributes?: {glRenderer?: string}; featureStatus?: Record<string, string>}}

export function renderBrowserGl(platform: NodeJS.Platform, hardware?: HardwareEncoder): 'angle-egl' | 'angle' | 'swangle' {
  if(gpuDisabled()) return 'swangle';
  return platform === 'linux' ? hardware ? 'angle-egl' : 'swangle' : 'angle';
}

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
  await prepareRenderBrowser();
  const previousPrime = process.env.DRI_PRIME;
  if(hardware?.device && process.platform === 'linux' && previousPrime === undefined) {
    const device = await realpath(path.join('/sys/class/drm', path.basename(hardware.device), 'device')).catch(() => '');
    const pci = path.basename(device);
    if(/^[\da-f]{4}:[\da-f]{2}:[\da-f]{2}\.[\da-f]$/i.test(pci)) process.env.DRI_PRIME = `pci-${pci.replace(/[:.]/g, '_')}`;
  }
  // Windows ANGLE can accelerate stills and CPU-encoded formats too. Preserve
  // the proven software default on Linux hosts without a selected GPU encoder.
  let chromiumOptions = {gl: renderBrowserGl(process.platform, hardware)};
  let browser: Awaited<ReturnType<typeof remotionRenderer.openBrowser>>;
  let startupWarning: string | undefined;
  try {
    try {browser = await remotionRenderer.openBrowser('chrome', {browserExecutable: browserExecutable(), chromiumOptions, logLevel: 'error'});}
    catch {
      chromiumOptions = {gl: 'swangle'};
      startupWarning = 'The hardware browser could not start. Browser effects use software rendering.';
      browser = await remotionRenderer.openBrowser('chrome', {browserExecutable: browserExecutable(), chromiumOptions, logLevel: 'error'});
    }
  }
  finally {if(previousPrime === undefined) delete process.env.DRI_PRIME; else process.env.DRI_PRIME = previousPrime;}
  if(chromiumOptions.gl === 'swangle' && !startupWarning) return {browser, chromiumOptions, accelerated: false, label: 'Software browser rendering'};
  if(startupWarning) return {browser, chromiumOptions, accelerated: false, label: 'Software browser rendering', warning: startupWarning};
  try {
    // Remotion's pinned CDP type subset omits this standard browser command.
    const connection = browser.connection as unknown as {send(method: 'SystemInfo.getInfo'): Promise<{value: GpuInfo}>};
    const {value} = await connection.send('SystemInfo.getInfo');
    const status = hardwareBrowserStatus(value);
    return {browser, chromiumOptions, accelerated: status.accelerated,
      label: status.accelerated ? `GPU browser rendering · ${status.renderer}` : 'Software browser rendering',
      warning: status.accelerated ? undefined : 'The browser did not enable hardware compositing and rasterization. Browser effects use software rendering; video encoding uses the selected encoder.'};
  } catch(error) {
    await browser.close({silent: true});
    throw new Error(`Could not verify the export browser GPU: ${(error as Error).message}`);
  }
}

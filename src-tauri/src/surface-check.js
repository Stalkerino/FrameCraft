// Debug-only, explicitly enabled by the isolated desktop smoke runner.
(async () => {
  const invoke = window.__TAURI_INTERNALS__.invoke;
  window.__desktopStage = 'waiting for React';
  try {
    let canvas;
    for(let i = 0; i < 100; i++) {
      canvas = document.querySelector('.preview__canvas');
      if(canvas?.getBoundingClientRect().width > 100) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if(!canvas || canvas.getBoundingClientRect().width <= 100) throw new Error('React program monitor did not mount.');
    window.__desktopStage = 'reading desktop metadata';
    const metadata = await invoke('desktop_info');
    const rect = canvas.getBoundingClientRect(); const ratio = window.devicePixelRatio;
    const bounds = {x: rect.x, y: rect.y, width: 320 / ratio, height: 180 / ratio, pixelRatio: ratio};
    const video = __CHECK_VIDEO__;
    const surface = await invoke('surface_open', {bounds, vendor: '__CHECK_VENDOR__', video});
    if(video) {
      const {project} = await (await fetch('/api/project')).json();
      for(const frame of [0, 1, 7, 2]) {
        await invoke('surface_frame', {projectId: project.id, revision: project.revision, frame});
      }
    }
    await new Promise(resolve => setTimeout(resolve, 200));
    await invoke('surface_resize', {bounds: {...bounds, x: bounds.x + 16, y: bounds.y + 16, width: 400 / ratio, height: 220 / ratio}});
    await new Promise(resolve => setTimeout(resolve, 200));
    await invoke('surface_close');
    await invoke('surface_check_finished', {result: {status: 'passed', metadata, surface, resized: true, closed: true, videoConnected: video, ...(video ? {frames: [0, 1, 7, 2], cut: true, backwardSeek: true} : {})}});
  } catch(error) {
    window.__desktopStage = String(error);
    await invoke('surface_check_finished', {result: {status: 'failed', error: String(error)}});
  }
})();

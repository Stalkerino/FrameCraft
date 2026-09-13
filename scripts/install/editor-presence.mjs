export async function framecraftAt(url) {
  try {
    const response = await fetch(`${url}/api/project`, {signal: AbortSignal.timeout(1500)});
    if(!response.ok) return false;
    const data = await response.json();
    return data.project?.version === 1 && typeof data.project?.id === 'string' && Array.isArray(data.project?.clips) && Array.isArray(data.project?.tracks);
  } catch {return false;}
}

import {useEffect, type RefObject} from 'react';

export function useTimelineFollowPlayhead(scroll: RefObject<HTMLDivElement | null>, position: number, headerWidth: number, playing: boolean, follow: boolean) {
  useEffect(() => {
    const element = scroll.current; if(!element || !playing || !follow) return;
    const available = element.clientWidth - headerWidth;
    if(position < element.scrollLeft || position > element.scrollLeft + available - 32) element.scrollLeft = Math.max(0, position - available * .2);
  }, [scroll, position, headerWidth, playing, follow]);
}

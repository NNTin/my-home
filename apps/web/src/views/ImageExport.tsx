import { useThree } from '@react-three/fiber';
import { useEffect, type RefObject } from 'react';
import { useFrameControl } from '../scene/Frame';
import { saveImage } from './exportImage';

/** "Save image": saves the view as it is, named after `view` (`exportImage.ts`). */
export type SaveImage = (view: string) => Promise<void>;

/** Inside the canvas: provides the "Save image" action (§7.4). */
export function ImageExport({ actionRef }: { actionRef: RefObject<SaveImage | undefined> }) {
  const get = useThree((s) => s.get);
  const frame = useFrameControl();
  useEffect(() => {
    actionRef.current = frame && ((view) => saveImage(get(), frame, view));
    return () => {
      actionRef.current = undefined;
    };
  }, [get, frame, actionRef]);
  return null;
}

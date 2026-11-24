import { Composition, registerRoot } from 'remotion';
import timeline from '../timeline.json';
import { MyHomeReel, reelFrames } from './reel';

function Root() {
  return (
    <Composition
      id="MyHomeReel"
      component={MyHomeReel}
      durationInFrames={reelFrames}
      fps={timeline.fps}
      width={timeline.size}
      height={timeline.size}
    />
  );
}

registerRoot(Root);

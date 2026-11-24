import { Composition, registerRoot } from 'remotion';
import { MyHomeReel, reelFrames } from './reel';

function Root() {
  return (
    <Composition
      id="MyHomeReel"
      component={MyHomeReel}
      durationInFrames={reelFrames}
      fps={30}
      width={1080}
      height={1920}
    />
  );
}

registerRoot(Root);

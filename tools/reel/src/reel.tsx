import { AbsoluteFill, Audio, Img, Series, staticFile, useCurrentFrame } from 'remotion';
import timeline from '../timeline.json';

type Shot = (typeof timeline.shots)[number];
export const reelFrames = timeline.shots.reduce((total, shot) => total + shot.frames, 0);

function Footage({ shot }: { shot: Shot }) {
  const frame = useCurrentFrame();
  const source = shot.still
    ? shot.id + '.png'
    : shot.id + '/' + String(frame).padStart(3, '0') + '.png';

  return (
    <AbsoluteFill>
      <Img src={staticFile(source)} width={timeline.size} height={timeline.size} />
      {shot.label && (
        <div
          style={{
            position: 'absolute',
            left: 45,
            bottom: 45,
            background: 'rgba(20, 22, 24, 0.83)',
            color: '#fff',
            padding: '12px 18px',
            fontFamily: 'Arial, sans-serif',
            fontSize: 29,
            fontWeight: 600,
            letterSpacing: 0.2,
            lineHeight: 1,
            borderRadius: 5,
          }}
        >
          {shot.label}
        </div>
      )}
    </AbsoluteFill>
  );
}

export function MyHomeReel() {
  return (
    <AbsoluteFill>
      <Audio src={staticFile('score.wav')} />
      <Series>
        {timeline.shots.map((shot) => (
          <Series.Sequence key={shot.id} durationInFrames={shot.frames}>
            <Footage shot={shot} />
          </Series.Sequence>
        ))}
      </Series>
    </AbsoluteFill>
  );
}

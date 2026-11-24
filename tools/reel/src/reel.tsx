import type { CSSProperties, ReactNode } from 'react';
import {
  AbsoluteFill,
  Audio,
  Easing,
  Img,
  interpolate,
  OffthreadVideo,
  Series,
  staticFile,
  useCurrentFrame,
} from 'remotion';

const fps = 30;
const palette = {
  page: '#14201a',
  film: '#1e2b23',
  ivory: '#f6f1e4',
  accent: '#e0e8aa',
  rule: '#526054',
};

type Beat = {
  seconds: number;
  caption: [string, string];
  file?: string;
};

const beats: Beat[] = [
  { seconds: 2, caption: ['We started with', 'a mock house.'], file: 'mock.jpg' },
  { seconds: 2, caption: ['Then we built', 'our real home.'], file: 'house.jpg' },
  { seconds: 3, caption: ['Room layouts fitted', 'to measurements.'], file: 'plan.svg' },
  { seconds: 4, caption: ['A real photo guided', 'the kitchen model.'] },
  { seconds: 3, caption: ['The first', 'kitchen render.'], file: 'early.mp4' },
  { seconds: 3, caption: ['Daylight', 'and downlights.'], file: 'lighting.mp4' },
  { seconds: 3, caption: ['Softer shadows,', 'more depth.'], file: 'shadows.mp4' },
  { seconds: 4, caption: ['Finishes matched', 'to photos.'], file: 'materials.mp4' },
  { seconds: 4, caption: ['Walk through', 'the model.'], file: 'walk.mp4' },
  { seconds: 2, caption: ['See inside with', 'a section cut.'], file: 'section.mp4' },
];

export const reelFrames = beats.reduce((total, beat) => total + beat.seconds * fps, 0);

const fill: CSSProperties = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  objectFit: 'cover',
};

function PhotoMatch() {
  const frame = useCurrentFrame();
  const reveal = interpolate(frame, [38, 64], [0, 100], {
    easing: Easing.inOut(Easing.cubic),
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const label = reveal < 50 ? 'Reference photo' : 'Matching model view';

  return (
    <AbsoluteFill>
      <Img src={staticFile('reference.webp')} style={fill} />
      <AbsoluteFill style={{ clipPath: 'inset(0 ' + (100 - reveal) + '% 0 0)' }}>
        <Img src={staticFile('match.jpg')} style={fill} />
      </AbsoluteFill>
      {reveal > 0 && reveal < 100 && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: reveal + '%',
            width: 3,
            background: palette.accent,
          }}
        />
      )}
      <div
        style={{
          position: 'absolute',
          left: 28,
          bottom: 24,
          padding: '11px 16px',
          background: palette.page,
          color: palette.ivory,
          textTransform: 'uppercase',
          fontFamily: 'Arial, sans-serif',
          fontSize: 19,
          fontWeight: 700,
          letterSpacing: 1.5,
        }}
      >
        {label}
      </div>
    </AbsoluteFill>
  );
}

function Footage({ beat }: { beat: Beat }) {
  const frame = useCurrentFrame();
  if (!beat.file) return <PhotoMatch />;

  const { file } = beat;
  if (file.endsWith('.mp4')) {
    return <OffthreadVideo src={staticFile(file)} muted style={fill} />;
  }

  const scale = interpolate(frame, [0, beat.seconds * fps - 1], [1, 1.055], {
    extrapolateRight: 'clamp',
  });
  return <Img src={staticFile(file)} style={{ ...fill, transform: 'scale(' + scale + ')' }} />;
}

function Layout({ beat, start, children }: { beat: Beat; start: number; children: ReactNode }) {
  const frame = useCurrentFrame();
  const appear = interpolate(frame, [0, 10], [12, 0], {
    easing: Easing.out(Easing.cubic),
    extrapolateRight: 'clamp',
  });
  const progress = (start + frame + 1) / reelFrames;
  const rotation = start >= 11 * fps && start < 24 * fps;
  const section = start >= 28 * fps;

  return (
    <AbsoluteFill
      style={{
        backgroundColor: palette.page,
        backgroundImage: 'radial-gradient(ellipse at 50% 50%, #253229 0%, #14201a 72%)',
        color: palette.ivory,
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: 68,
          right: 68,
          top: 249,
          height: 54,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderTop: '2px solid ' + palette.rule,
          fontFamily: 'Arial, sans-serif',
          fontSize: 22,
          letterSpacing: 5,
          fontWeight: 700,
          paddingTop: 13,
        }}
      >
        <div>MY HOME</div>
        <div style={{ color: palette.accent, fontSize: 19, letterSpacing: 3 }}>
          {rotation ? 'RENDERING' : section ? 'SECTION VIEW' : ''}
        </div>
      </div>
      <div
        style={{
          position: 'absolute',
          left: 68,
          top: 354 + appear,
          right: 65,
          fontFamily: 'Georgia, "Liberation Serif", serif',
          fontSize: 102,
          lineHeight: 0.99,
          letterSpacing: -4.6,
        }}
      >
        <div>{beat.caption[0]}</div>
        <div style={{ color: palette.accent, fontStyle: 'italic' }}>{beat.caption[1]}</div>
      </div>
      <div
        style={{
          position: 'absolute',
          left: 60,
          top: 655,
          width: 960,
          height: 720,
          border: '1px solid ' + palette.rule,
          boxSizing: 'border-box',
          backgroundColor: palette.film,
          overflow: 'hidden',
        }}
      >
        {children}
      </div>
      <div
        style={{
          position: 'absolute',
          left: 68,
          right: 68,
          top: 1461,
          height: 2,
          backgroundColor: palette.rule,
        }}
      >
        <div style={{ width: progress * 100 + '%', height: '100%', background: palette.accent }} />
      </div>
    </AbsoluteFill>
  );
}

export function MyHomeReel() {
  let start = 0;
  return (
    <AbsoluteFill>
      <Audio src={staticFile('score.wav')} />
      <Series>
        {beats.map((beat) => {
          const from = start;
          start += beat.seconds * fps;
          return (
            <Series.Sequence key={from} durationInFrames={beat.seconds * fps}>
              <Layout beat={beat} start={from}>
                <Footage beat={beat} />
              </Layout>
            </Series.Sequence>
          );
        })}
      </Series>
    </AbsoluteFill>
  );
}

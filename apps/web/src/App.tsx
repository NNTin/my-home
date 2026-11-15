import { ApiOverlay } from './overlay/ApiOverlay';
import { Scene } from './scene/Scene';

export function App() {
  return (
    <main className="app">
      <Scene />
      <ApiOverlay />
    </main>
  );
}

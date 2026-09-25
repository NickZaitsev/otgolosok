import {Composition} from "remotion";
import {DURATION_IN_FRAMES, FPS} from "./timeline";
import {OtgolosokPromo} from "./otgolosok-promo";

export function VideoRoot() {
  return (
    <Composition
      id="OtgolosokPromo"
      component={OtgolosokPromo}
      durationInFrames={DURATION_IN_FRAMES}
      fps={FPS}
      width={1080}
      height={1920}
    />
  );
}

import {Composition} from "remotion";
import {DURATION_IN_FRAMES, FPS} from "./timeline";
import {AD_DURATION_IN_FRAMES, AD_FPS} from "./ad-timeline";
import {OtgolosokAd} from "./otgolosok-ad";
import {OtgolosokPromo} from "./otgolosok-promo";

export function VideoRoot() {
  return (
    <>
      <Composition
        id="OtgolosokAd"
        component={OtgolosokAd}
        durationInFrames={AD_DURATION_IN_FRAMES}
        fps={AD_FPS}
        width={1080}
        height={1920}
      />
      <Composition
        id="OtgolosokPromo"
        component={OtgolosokPromo}
        durationInFrames={DURATION_IN_FRAMES}
        fps={FPS}
        width={1080}
        height={1920}
      />
    </>
  );
}

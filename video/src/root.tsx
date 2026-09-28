import {Composition} from "remotion";
import {DURATION_IN_FRAMES, FPS} from "./timeline";
import {AD_DURATION_IN_FRAMES, AD_FPS} from "./ad-timeline";
import {OtgolosokAd} from "./otgolosok-ad";
import {OtgolosokPromo} from "./otgolosok-promo";
import {OtgolosokGuide} from "./otgolosok-guide";
import {OtgolosokMotion} from "./otgolosok-motion";
import {OtgolosokCreateAd} from "./otgolosok-create-ad";
import {CREATE_AD_DURATION_IN_FRAMES, CREATE_AD_FPS} from "./create-ad-timeline";
import {OtgolosokMotionWide} from "./otgolosok-motion-wide";
import {OtgolosokMotionCentre} from "./otgolosok-motion-centre";
import {OtgolosokCentreVertical} from "./otgolosok-centre-vertical";
import {CENTRE_VERTICAL_DURATION_IN_FRAMES, CENTRE_VERTICAL_FPS} from "./centre-vertical-timeline";
import {CENTRE_DURATION_IN_FRAMES, CENTRE_FPS} from "./motion-centre-timeline";
import {WIDE_DURATION_IN_FRAMES, WIDE_FPS} from "./motion-wide-timeline";
import {MOTION_DURATION_IN_FRAMES, MOTION_FPS} from "./motion-timeline";
import {GUIDE_DURATION_IN_FRAMES, GUIDE_FPS, GUIDE_WIDTH, GUIDE_HEIGHT} from "./guide-timeline";
import {OtgolosokCreateGuide} from "./otgolosok-create-guide";
import {CREATE_GUIDE_DURATION_IN_FRAMES} from "./create-guide-timeline";

export function VideoRoot() {
  return (
    <>
      <Composition id="OtgolosokGuide" component={OtgolosokGuide} durationInFrames={GUIDE_DURATION_IN_FRAMES} fps={GUIDE_FPS} width={GUIDE_WIDTH} height={GUIDE_HEIGHT} />
      <Composition id="OtgolosokCreateGuide" component={OtgolosokCreateGuide} durationInFrames={CREATE_GUIDE_DURATION_IN_FRAMES} fps={GUIDE_FPS} width={GUIDE_WIDTH} height={GUIDE_HEIGHT} />
      <Composition
        id="OtgolosokCreateAd"
        component={OtgolosokCreateAd}
        durationInFrames={CREATE_AD_DURATION_IN_FRAMES}
        fps={CREATE_AD_FPS}
        width={1080}
        height={1920}
      />
      <Composition
        id="OtgolosokMotion"
        component={OtgolosokMotion}
        durationInFrames={MOTION_DURATION_IN_FRAMES}
        fps={MOTION_FPS}
        width={1080}
        height={1920}
      />
      <Composition
        id="OtgolosokCentreVertical"
        component={OtgolosokCentreVertical}
        durationInFrames={CENTRE_VERTICAL_DURATION_IN_FRAMES}
        fps={CENTRE_VERTICAL_FPS}
        width={1080}
        height={1920}
      />
      <Composition
        id="OtgolosokMotionWide"
        component={OtgolosokMotionWide}
        durationInFrames={WIDE_DURATION_IN_FRAMES}
        fps={WIDE_FPS}
        width={1920}
        height={1080}
      />
      <Composition
        id="OtgolosokMotionCentre"
        component={OtgolosokMotionCentre}
        durationInFrames={CENTRE_DURATION_IN_FRAMES}
        fps={CENTRE_FPS}
        width={1920}
        height={1080}
      />
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

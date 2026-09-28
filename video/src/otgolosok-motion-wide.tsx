import {linearTiming, TransitionSeries} from "@remotion/transitions";
import {clockWipe} from "@remotion/transitions/clock-wipe";
import {iris} from "@remotion/transitions/iris";
import {pushCut} from "@remotion/transitions/push-cut";
import {slide} from "@remotion/transitions/slide";
import {wipe} from "@remotion/transitions/wipe";
import {Fragment, type ReactNode} from "react";
import {AbsoluteFill, Html5Audio, Sequence, staticFile} from "remotion";
import {C, easeInOut} from "./motion-wide/fx";
import {Claim, Facts, Hook, Logo, Outro, RouteMap, Steps} from "./motion-wide/scenes";
import {WIDE_SCENES, WIDE_TRANSITIONS, wideScene, type WideSceneId} from "./motion-wide-timeline";

const WIDTH = 1920;
const HEIGHT = 1080;

const scenes: Record<WideSceneId, () => ReactNode> = {
  hook: Hook,
  logo: Logo,
  claim: Claim,
  steps: Steps,
  map: RouteMap,
  facts: Facts,
  outro: Outro,
};

// Переход перед сценой с тем же индексом + 1: вспышка, «диафрагма», шторка,
// вспышка, часовая стрелка во светлую сцену и подъём к финалу.
const presentations = [
  pushCut({flashColor: C.cinnabar, flashOpacity: 0.85}),
  iris({width: WIDTH, height: HEIGHT}),
  wipe({direction: "from-right"}),
  pushCut({flashColor: C.peach, flashOpacity: 0.6}),
  clockWipe({width: WIDTH, height: HEIGHT}),
  slide({direction: "from-bottom"}),
];

const story = staticFile("audio/walk/kozhevniki-d2ccb2df8e45.mp3");

/** Горизонтальный моушн-ролик 1920×1080 для сайтов, презентаций и YouTube. */
export function OtgolosokMotionWide() {
  const facts = wideScene("facts");
  const voiceFrames = facts.frames - 12;
  return (
    <AbsoluteFill style={{background: C.night}}>
      <TransitionSeries>
        {WIDE_SCENES.map((scene, index) => {
          const Scene = scenes[scene.id];
          return (
            <Fragment key={scene.id}>
              {index > 0 && (
                <TransitionSeries.Transition
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- презентации разных типов в одном списке
                  presentation={presentations[index - 1] as any}
                  timing={linearTiming({durationInFrames: WIDE_TRANSITIONS[index - 1], easing: easeInOut})}
                />
              )}
              <TransitionSeries.Sequence name={scene.id} durationInFrames={scene.frames}>
                <Scene />
              </TransitionSeries.Sequence>
            </Fragment>
          );
        })}
      </TransitionSeries>
      <Html5Audio src={staticFile("motion/wide-bed.wav")} volume={0.9} />
      {/* Начало истории первой остановки — её текст и источники на карточке. */}
      <Sequence from={facts.start + 12} durationInFrames={voiceFrames} name="Фрагмент истории">
        <Html5Audio src={story} volume={(frame) => Math.min(1, frame / 10, (voiceFrames - frame) / 18)} />
      </Sequence>
    </AbsoluteFill>
  );
}

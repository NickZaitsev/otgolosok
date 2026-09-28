import {linearTiming, TransitionSeries} from "@remotion/transitions";
import {iris} from "@remotion/transitions/iris";
import {pushCut} from "@remotion/transitions/push-cut";
import {slide} from "@remotion/transitions/slide";
import {Fragment, type ReactNode} from "react";
import {AbsoluteFill, Html5Audio, Sequence, staticFile} from "remotion";
import {CENTRE_SITE, FACT_VOICE_FRAMES, FACT_VOICE_FROM, Facts, Hook, RouteMap} from "./motion-centre/scenes";
import {C, easeInOut} from "./motion-wide/fx";
import {Logo, Outro} from "./motion-wide/scenes";
import {CENTRE_SCENES, CENTRE_TRANSITIONS, centreScene, type CentreSceneId} from "./motion-centre-timeline";

const WIDTH = 1920;
const HEIGHT = 1080;

const scenes: Record<CentreSceneId, () => ReactNode> = {
  hook: Hook,
  logo: Logo,
  map: RouteMap,
  facts: Facts,
  outro: () => <Outro site={CENTRE_SITE} />,
};

// Переход перед сценой с тем же индексом + 1: вспышка к знаку, знак раскрывается
// в карту, метка остановки в центре кадра раскрывается в её карточку, подъём к финалу.
const presentations = [
  pushCut({flashColor: C.cinnabar, flashOpacity: 0.85}),
  iris({width: WIDTH, height: HEIGHT}),
  iris({width: WIDTH, height: HEIGHT}),
  slide({direction: "from-bottom"}),
];

/**
 * Горизонтальный моушн-ролик «Прогулка по центру» (V2) по опубликованным историям:
 * места → знак → прогулка на карте → остановка 7 с голосом и источниками → финал.
 */
export function OtgolosokMotionCentre() {
  const facts = centreScene("facts");
  return (
    <AbsoluteFill style={{background: C.night}}>
      <TransitionSeries>
        {CENTRE_SCENES.map((scene, index) => {
          const Scene = scenes[scene.id];
          return (
            <Fragment key={scene.id}>
              {index > 0 && (
                <TransitionSeries.Transition
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- презентации разных типов в одном списке
                  presentation={presentations[index - 1] as any}
                  timing={linearTiming({durationInFrames: CENTRE_TRANSITIONS[index - 1], easing: easeInOut})}
                />
              )}
              <TransitionSeries.Sequence name={scene.id} durationInFrames={scene.frames}>
                <Scene />
              </TransitionSeries.Sequence>
            </Fragment>
          );
        })}
      </TransitionSeries>
      <Html5Audio src={staticFile("centre/bed.wav")} volume={0.9} />
      {/* Первая фраза опубликованной озвучки истории с карточки. */}
      <Sequence from={facts.start + FACT_VOICE_FROM} durationInFrames={FACT_VOICE_FRAMES} name="Фрагмент истории">
        <Html5Audio src={staticFile("centre/story.mp3")} volume={(frame) => Math.min(1, frame / 6, (FACT_VOICE_FRAMES - frame) / 10)} />
      </Sequence>
    </AbsoluteFill>
  );
}

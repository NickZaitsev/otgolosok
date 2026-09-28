import centre from "../src/video/motion-centre-scenes.json" with {type: "json"};
import walk from "../src/video/centre-walk.json" with {type: "json"};
import {wideMotionScore} from "./motion-wide-score.mjs";

/**
 * Партитура ролика «Прогулка по центру»: склейки и голос — как у горизонтального
 * ролика, плюс щелчок на каждом названии места в хуке.
 */
export function centreMotionScore(config = centre, stops = walk.stops.length) {
  const {fireStart, itemFrames} = config.hook;
  return {
    ...wideMotionScore(config),
    taps: Array.from({length: stops}, (_, index) => (fireStart + index * itemFrames) / config.fps),
  };
}

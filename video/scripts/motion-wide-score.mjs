import wide from "../src/motion-wide-scenes.json" with {type: "json"};

/**
 * Партитура музыки горизонтального моушн-ролика, в секундах. Склейки считаются
 * так же, как в TransitionSeries: каждая сцена начинается на длину перехода
 * раньше конца предыдущей. Голос истории звучит в сцене «facts».
 * @returns {{seconds: number, cuts: number[], duck: [number, number], groove: number, finale: number}}
 */
export function wideMotionScore(config = wide) {
  const starts = [];
  let start = 0;
  config.scenes.forEach((scene, index) => {
    if (index > 0) start += config.scenes[index - 1].frames - config.transitions[index - 1];
    starts.push(start);
  });
  const at = (id) => starts[config.scenes.findIndex((scene) => scene.id === id)];
  const last = config.scenes.at(-1);
  const facts = at("facts");
  return {
    seconds: (starts.at(-1) + last.frames) / config.fps,
    cuts: starts.slice(1).map((frame) => frame / config.fps),
    duck: [facts / config.fps, (facts + config.scenes.find((scene) => scene.id === "facts").frames) / config.fps],
    groove: at("logo") / config.fps,
    finale: (at("outro") + config.lockupFrame) / config.fps,
  };
}

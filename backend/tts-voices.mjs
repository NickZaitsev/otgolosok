// Built-in voices: https://developers.openai.com/api/docs/guides/text-to-speech
// Russian voices: https://aistudio.yandex.ru/ru/docs/speechkit/tts/voices
const voices = {
  openai: ["marin", "cedar", "alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse"]
    .map(id => ({ id, label: id[0].toUpperCase() + id.slice(1) })),
  yandex: [
    ["marina", "Марина"], ["dasha", "Даша"], ["julia", "Юлия"], ["lera", "Лера"], ["masha", "Маша"],
    ["alexander", "Александр"], ["anton", "Антон"], ["kirill", "Кирилл"], ["ermil", "Ермил"],
    ["filipp", "Филипп"], ["zahar", "Захар"], ["jane", "Джейн"], ["omazh", "Омаж"],
    ["madi_ru", "Мади"], ["saule_ru", "Сауле"], ["zamira_ru", "Замира"], ["zhanar_ru", "Жанар"], ["yulduz_ru", "Юлдуз"],
  ].map(([id, label]) => ({ id, label })),
};

export function validVoiceId(value) {
  return typeof value === "string" && /^[a-z][a-z0-9_-]{0,63}$/.test(value);
}

export function ttsVoiceOptions(provider, configuredVoice) {
  const catalog = voices[provider];
  const defaultVoice = validVoiceId(configuredVoice) ? configuredVoice : catalog[0].id;
  return { defaultVoice, voices: catalog.some(voice => voice.id === defaultVoice)
    ? catalog : [{ id: defaultVoice, label: defaultVoice }, ...catalog] };
}

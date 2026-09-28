import {GuideVideo} from "./otgolosok-guide";
import {CREATE_GUIDE, CREATE_GUIDE_INTRO_FRAMES, CREATE_GUIDE_OUTRO_FRAMES, CREATE_GUIDE_TIMINGS} from "./create-guide-timeline";

export function OtgolosokCreateGuide() {
  return <GuideVideo guide={CREATE_GUIDE} timings={CREATE_GUIDE_TIMINGS} introFrames={CREATE_GUIDE_INTRO_FRAMES} outroFrames={CREATE_GUIDE_OUTRO_FRAMES}
    intro={{eyebrow: "Инструкция по сайту", title: ["Своя", "прогулка"], lead: "Отметьте начало, выберите время — маршрут и истории соберутся сами.", screen: "create/preview", focus: {x: 400, y: 80, width: 800, height: 520}, page: "Новая прогулка"}}
    outro={{title: ["Город ждёт", "вашу прогулку."], lead: "Отметьте начало, выберите время — и город начнёт рассказывать свои истории.", footer: "Прогулка → точка на карте → По времени → Построить"}} />;
}

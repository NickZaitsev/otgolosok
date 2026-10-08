import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const dir = dirname(fileURLToPath(import.meta.url));
const out = (name, text) => writeFileSync(join(dir, name), text);
const duration = 79.488;
const sceneData = [
  [
    "f01",
    0,
    23.19,
    "Начало прогулки",
    "Большой Каменный мост",
    "current-bridge.jpg",
    "Мост, открытый в 1938 году. Фото: GAlexandrova, 2019 · CC BY-SA 4.0",
    "От Кропоткинской к Новокузнецкой",
  ],
  [
    "f02",
    23.19,
    46.2,
    "Первая постоянная переправа",
    "1643 → 1687",
    "bridge-fenton-1852.jpg",
    "Каменный мост XVII века на фотографии Роджера Фентона, 1852 · Public domain",
    "Проект Анце Кристлера → завершение строительства",
  ],
  [
    "f03",
    46.2,
    52.33,
    "Город на мосту",
    "Лавки и башня",
    "bridge-fenton-1852.jpg",
    "Старый мост, 1852. Лавки и башня к этому времени разобраны",
    "Название хранит память о каменной переправе",
  ],
  [
    "f04",
    52.33,
    58.51,
    "Перестройка переправы",
    "1783",
    "bridge-fenton-1852.jpg",
    "Схема арок условная. Фотография старого моста: Роджер Фентон, 1852",
    "Обрушение арок. При ремонте лавки и башню разобрали",
  ],
  [
    "f05",
    58.51,
    63.45,
    "Следующий мост",
    "XIX век",
    "bridge-1890-1900-display.jpg",
    "Металлический мост 1858–1938 годов. Фотохром, 1890–1900 · Library of Congress",
    "Переправа с металлическими фермами",
  ],
  [
    "f06",
    63.45,
    duration,
    "Современная переправа",
    "1938",
    "current-bridge.jpg",
    "Большой Каменный мост. GAlexandrova, 2019 · CC BY-SA 4.0",
    "Ниже по течению. Новый проезд. Более крупные суда",
  ],
];
mkdirSync(join(dir, "compositions"), { recursive: true });
out(
  "frame.md",
  `# Визуальная система\n\nКонцепция: одно место и три переправы, чётко разделённые подписями времени. Бренд по otgolosok-shorts: фон #0D0B0A, поверхность #1C1917, текст #F2EDE4, вторичный текст #B5ADA2, акцент #FF7A5C, знак бренда #E34234. Manrope 500/700 и Cormorant Garamond 600, встроенные латинские и кириллические woff2. Иллюстрации без искусственного старения и без дорисовки. Главный объект в центре кадра, надпись эпохи сверху, подпись источника рядом с изображением. Субтитры отдельным слоем поверх, не обрезают картинку. Мягкий направленный переход влево, без растворения; движение камеры выделяет детали реального изображения. Схемы подписаны как условные.\n`,
);
const css = `
@font-face{font-family:Manrope;font-weight:500;src:url('assets/fonts/manrope-cyrillic-500-normal.woff2')}@font-face{font-family:Manrope;font-weight:500;src:url('assets/fonts/manrope-latin-500-normal.woff2');unicode-range:U+0-024F,U+2000-206F}@font-face{font-family:Manrope;font-weight:700;src:url('assets/fonts/manrope-cyrillic-700-normal.woff2')}@font-face{font-family:Manrope;font-weight:700;src:url('assets/fonts/manrope-latin-700-normal.woff2');unicode-range:U+0-024F,U+2000-206F}@font-face{font-family:'Cormorant Garamond';font-weight:600;src:url('assets/fonts/cormorant-garamond-cyrillic-600-normal.woff2')}@font-face{font-family:'Cormorant Garamond';font-weight:600;src:url('assets/fonts/cormorant-garamond-latin-600-normal.woff2');unicode-range:U+0-024F,U+2000-206F}
*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;background:#0D0B0A;color:#F2EDE4;font-family:Manrope;font-weight:500}#main{width:100%;height:100%;position:relative;overflow:hidden;background:#0D0B0A}.slot{position:absolute;inset:0}.seam{position:absolute;inset:0;width:100%;height:100%}.brand{position:absolute;top:90px;left:74px;display:flex;align-items:center;gap:15px;z-index:10;font-size:38px}.dot{width:17px;height:17px;border-radius:50%;background:#E34234}.series{position:absolute;top:103px;right:74px;font-size:25px;color:#B5ADA2;letter-spacing:3px;z-index:10}.scene{position:absolute;inset:0;padding:225px 74px 150px;display:flex;flex-direction:column;gap:30px;background:#0D0B0A}.eyebrow{font-size:26px;letter-spacing:3px;text-transform:uppercase;color:#FF7A5C}.headline{font-family:'Cormorant Garamond';font-weight:600;font-size:100px;line-height:.96;max-width:930px;margin:0}.image-frame{position:relative;overflow:hidden;margin-top:25px;width:932px;height:740px;background:#1C1917;border:1px solid #B5ADA2}.image-frame img{width:100%;height:100%;object-fit:cover;display:block}.photo-camera{width:100%;height:100%;transform-origin:50% 50%}.photo-credit{font-size:23px;line-height:1.35;color:#B5ADA2;max-width:920px}.detail{font-size:41px;line-height:1.28;max-width:900px}.rule{width:100%;height:3px;background:#FF7A5C;transform-origin:left center}.caption{position:absolute;inset:0;z-index:20;pointer-events:none;display:flex;align-items:flex-end;justify-content:center;padding:0 82px 205px}.caption-text{font-family:Manrope;font-weight:700;font-size:49px;line-height:1.22;text-align:center;max-width:920px;max-height:225px;padding:18px 28px;color:#F2EDE4;background:#0D0B0A;border-radius:12px}.footer{position:absolute;bottom:96px;left:74px;right:74px;display:flex;justify-content:space-between;color:#B5ADA2;font-size:23px;z-index:12}.map-shell{position:absolute;inset:0;background:#1C1917;padding:25px;display:flex;align-items:center;justify-content:center}.map-shell svg{width:100%;height:100%}.map-label{font:500 32px Manrope;fill:#F2EDE4}.map-small{font:500 24px Manrope;fill:#B5ADA2}.map-river{fill:none;stroke:#B5ADA2;stroke-width:67;opacity:.22}.map-route{fill:none;stroke:#FF7A5C;stroke-width:7;stroke-linecap:round;stroke-linejoin:round}.map-marker{fill:#FF7A5C;stroke:#F2EDE4;stroke-width:3}.schema{position:absolute;inset:0;background:#1C1917;padding:70px;display:flex;flex-direction:column;justify-content:center;gap:45px}.schema svg{width:100%;height:360px}.schema-note{font-size:29px;color:#B5ADA2}.year-detail{font-family:'Cormorant Garamond';font-size:150px;line-height:1;color:#FF7A5C}.photo-camera.fenton img{object-fit:contain}.timeline-foot{position:absolute;bottom:32px;left:74px;right:74px;height:3px;background:#1C1917;z-index:25}.timeline-foot i{display:block;width:100%;height:3px;background:#FF7A5C;transform-origin:left center}
`;
const map = `<div class="map-shell" id="f01-map"><svg viewBox="0 0 880 690"><path class="map-river" data-layout-allow-overflow d="M-80 90 Q220 140 360 270 T 970 280"/><path class="map-river" data-layout-allow-overflow d="M230 430 Q470 380 930 600"/><text x="100" y="100" class="map-small">Москва-река</text><text x="400" y="570" class="map-small">Водоотводный канал</text><text x="400" y="390" class="map-label">Остров</text><path id="f01-route" class="map-route" d="M90 175 L300 238 L440 328 Q610 330 760 460"/><circle class="map-marker" cx="90" cy="175" r="12"/><circle class="map-marker" cx="300" cy="238" r="12"/><circle class="map-marker" cx="760" cy="460" r="12"/><text class="map-label" x="28" y="230">Кропоткинская</text><text class="map-label" x="380" y="210">Большой Каменный</text><text class="map-label" x="425" y="505">Новокузнецкая</text><text class="map-small" x="30" y="650">Схема направления прогулки, не для навигации</text></svg></div>`;
const arcs = `<div class="schema" id="f04-schema"><div class="year-detail">1783</div><svg viewBox="0 0 790 350"><path d="M0 90 L790 90" stroke="#F2EDE4" stroke-width="14" fill="none"/><g stroke="#F2EDE4" stroke-width="14" fill="none"><path d="M0 220 Q100 15 200 220"/><path id="f04-arch" d="M200 220 Q300 15 400 220"/><path d="M400 220 Q500 15 600 220"/><path d="M600 220 Q700 15 790 220"/></g><path d="M0 295 Q200 250 390 295 T790 295" stroke="#B5ADA2" stroke-width="6" fill="none"/></svg><div class="schema-note">Условная схема: разрушение нескольких арок</div></div>`;
for (const [
  id,
  start,
  end,
  kicker,
  title,
  image,
  credit,
  detail,
] of sceneData) {
  const dur = end - start;
  if (!existsSync(join(dir, "assets", image)))
    throw new Error(`Не найден обязательный снимок: ${image}`);
  const actualImage = image;
  const actualCredit = credit;
  const extras = id === "f01" ? map : id === "f04" ? arcs : "";
  const motions = [];
  motions.push(
    `tl.fromTo('#${id}-rule',{scaleX:0},{scaleX:1,duration:0.7,ease:'power2.out'},0.2);`,
  );
  motions.push(
    `tl.fromTo('#${id}-camera',{scale:1,x:0},{scale:1.085,x:-18,duration:${Math.max(dur - 1, 1)},ease:'none'},0.5);`,
  );
  if (id === "f01") {
    motions.push(
      `tl.fromTo('#f01-map',{opacity:0},{opacity:1,duration:.5},7); const path=document.getElementById('f01-route'); const len=path.getTotalLength(); tl.fromTo(path,{strokeDasharray:len,strokeDashoffset:len},{strokeDashoffset:0,duration:7,ease:'none'},7.5);`,
    );
  }
  if (id === "f04") {
    motions.push(
      `tl.fromTo('#f04-schema',{opacity:0},{opacity:1,duration:.4},0.4);tl.fromTo('#f04-arch',{y:0,opacity:1},{y:100,opacity:0,duration:.8,ease:'power2.in'},3);`,
    );
  }
  out(
    `compositions/${id}.html`,
    `<!doctype html><html lang="ru"><body><template><style>#${id}-root{position:absolute;inset:0;width:100%;height:100%;overflow:hidden}</style><div id="${id}-root" data-composition-id="${id}" data-width="1080" data-height="1920" data-duration="${dur}"><div class="scene" id="${id}-visual"><div class="eyebrow">${kicker}</div><h1 class="headline">${title}</h1><div class="rule" id="${id}-rule"></div><div class="image-frame"><div data-layout-allow-overflow class="photo-camera ${image.includes("fenton") ? "fenton" : ""}" id="${id}-camera"><img id="${id}-photo" src="assets/${actualImage}" alt="${actualCredit}"></div>${extras}</div><div class="photo-credit">${actualCredit}</div><div class="detail">${detail}</div></div></div><script>{const tl=gsap.timeline({paused:true});${motions.join("\n")}window.__timelines['${id}']=tl;}</script></template></body></html>`,
  );
  out(
    `compositions/${id}.motion.json`,
    JSON.stringify(
      {
        composition: id,
        duration: dur,
        assertions: [
          { kind: "appearsBy", selector: `#${id}-photo`, bySec: 1 },
          { kind: "staysInFrame", selector: `#${id}-visual` },
        ],
      },
      null,
      2,
    ) + "\n",
  );
}
const captions = JSON.parse(readFileSync(join(dir, "captions.json"), "utf8"));
if (!captions.length)
  throw new Error("Для полного рассказа требуются готовые субтитры");
const captionHtml = captions
  .map(
    (c, i) =>
      `<div id="caption-${i}" class="clip caption" data-start="${c.start}" data-duration="${c.end - c.start}" data-track-index="3"><span class="caption-text">${c.text.replaceAll("&", "&amp;").replaceAll("<", "&lt;")}</span></div>`,
  )
  .join("\n");
out(
  "index.html",
  `<!doctype html><html lang="ru"><head><meta charset="UTF-8"><script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script><style>${css}</style></head><body><div id="main" data-composition-id="main" data-width="1080" data-height="1920" data-duration="${duration}"><div class="brand"><i class="dot"></i>отголосок</div><div class="series">МОСКВА / ОСТРОВ</div>${sceneData.map(([id, s, e]) => `<div class="seam" id="seam-${id}"><div class="clip slot" id="slot-${id}" data-composition-id="${id}" data-composition-src="compositions/${id}.html" data-start="${s}" data-duration="${e - s}" data-track-index="1" data-width="1080" data-height="1920"></div></div>`).join("\n")}${captionHtml}<audio id="full-narration" src="assets/narration.mp3" data-start="0" data-duration="${duration}" data-track-index="4" data-volume="1"></audio><div class="footer"><span>Большой Каменный мост</span><span>otgolosok.online</span></div><div class="timeline-foot"><i id="film-progress"></i></div></div><script>const tl=gsap.timeline({paused:true});tl.fromTo('#film-progress',{scaleX:0},{scaleX:1,duration:${duration},ease:'none'},0);window.__timelines["main"]=tl;\n</script></body></html>`,
);
out(
  "ledger.json",
  JSON.stringify(
    {
      fps: 30,
      seams: sceneData
        .slice(1)
        .map((s, i) => ({
          id: `${sceneData[i][0]}-${s[0]}`,
          cut: s[1],
          technique: "cut-the-curve LEFT",
          exit: {
            selector: `#seam-${sceneData[i][0]}`,
            axis: "x",
            dir: -1,
            dur: 0.32,
          },
          entry: {
            selector: `#seam-${s[0]}`,
            axis: "x",
            dir: -1,
            dur: 0.4,
            travel: 8,
          },
        })),
    },
    null,
    2,
  ) + "\n",
);
out(
  "STORYBOARD.md",
  `---\nmode: autonomous\nmessage: "Полный рассказ о Большом Каменном мосте"\nmusic: none\n---\n\n` +
    sceneData
      .map(
        ([id, s, e, k, t]) =>
          `## Frame ${id}\n\nstatus: animated\nsrc: compositions/${id}.html\nstart: ${s}\nduration: ${e - s}\nrules: coordinate-target-zoom, svg-path-draw\nroute: camera with intent; staged reveals\nbeat: ${k}. ${t}. Честное разделение изображения и эпохи, без реконструкции неподтверждённых деталей.\n`,
      )
      .join("\n"),
);
console.log(`Built six scenes; ${captions.length} caption cues; ${duration}s`);

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import videos from "./place-videos.json";
import publication from "../../../videos/bolshoy-kamenny-most-2026-10-08/youtube-publication.json";
import verification from "../../../videos/bolshoy-kamenny-most-2026-10-08/verification.json";

it("встраивает проверенный полный ролик с подтверждённым доступом по ссылке и исходной озвучкой v4", () => {
  const bridge = videos["osm:relation:1794442"];
  expect(bridge.youtubeId).toBe(publication.videoId);
  expect(bridge.durationSeconds).toBe(verification.durationSec);
  expect(publication.sha256).toBe(verification.sha256);
  expect(publication.status).toMatchObject({ privacyStatus:"unlisted", uploadStatus:"processed", embeddable:true });
  expect(verification).toMatchObject({ complete:true, provider:"elevenlabs", model:"eleven_v4", voiceName:"Отголосок2", sourceAudioUnchanged:true, fullNarrationAndPunctuationInCaptions:true });
  const original = readFileSync(new URL("../../../videos/bolshoy-kamenny-most-2026-10-08/assets/narration.mp3", import.meta.url));
  expect(createHash("sha256").update(original).digest("hex")).toBe(verification.originalAudioSha256);
});

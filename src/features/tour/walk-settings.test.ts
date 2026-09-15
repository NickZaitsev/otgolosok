import { describe, expect, it } from "vitest";
import { defaultWalkSettings, parseWalkSettings } from "./walk-settings";

describe("walk settings", () => {
  it("starts chapters by button until the stops are checked on the ground", () => {
    expect(defaultWalkSettings).toEqual({ advance: "manual", rate: 1 });
  });

  it("restores a stored choice", () => {
    expect(parseWalkSettings('{"advance":"place","rate":1.25}')).toEqual({ advance: "place", rate: 1.25 });
    expect(parseWalkSettings('{"advance":"sequence","rate":0.8}')).toEqual({ advance: "sequence", rate: 0.8 });
  });

  it("falls back to the default for anything it does not recognise", () => {
    for (const raw of [null, "", "{", "[]", '"place"', "42", '{"advance":"gps","rate":2}', '{"advance":null}', `{"rate":${Number.MAX_SAFE_INTEGER}}`]) {
      expect(parseWalkSettings(raw)).toEqual(defaultWalkSettings);
    }
  });

  it("keeps a valid half of a partly broken record", () => {
    expect(parseWalkSettings('{"advance":"sequence","rate":3}')).toEqual({ advance: "sequence", rate: 1 });
    expect(parseWalkSettings('{"advance":"loud","rate":1.5}')).toEqual({ advance: "manual", rate: 1.5 });
    expect(parseWalkSettings('{"advance":"place","rate":"1"}')).toEqual({ advance: "place", rate: 1 });
  });

  it("ignores an oversized record rather than parsing it", () => {
    expect(parseWalkSettings(`{"advance":"place","note":"${"a".repeat(600)}"}`)).toEqual(defaultWalkSettings);
  });
});

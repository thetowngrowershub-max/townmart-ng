import { describe, expect, it } from "vitest";
import { centredOffset, clampOffset, coverScale, cropRect, frameSize, outputSize, zoomAroundCentre } from "@/lib/images/crop";

const photo = { width: 4000, height: 3000 };

describe("image crop geometry", () => {
  it("fits the frame for the chosen shape inside the editor", () => {
    expect(frameSize({ width: 320, height: 320 }, 1)).toEqual({ width: 320, height: 320 });
    expect(frameSize({ width: 320, height: 320 }, 4 / 3)).toEqual({ width: 320, height: 240 });
    expect(frameSize({ width: 320, height: 320 }, 3 / 4)).toEqual({ width: 240, height: 320 });
  });

  it("centres a landscape photo in a square and crops its middle", () => {
    const frame = { width: 300, height: 300 };
    const scale = coverScale(photo, frame); // 0.1: height fills the frame
    expect(scale).toBeCloseTo(0.1);
    const offset = centredOffset(photo, frame, scale);
    expect(cropRect(offset, photo, frame, scale)).toEqual({ x: 500, y: 0, width: 3000, height: 3000 });
  });

  it("never lets the image leave a gap in the frame", () => {
    const frame = { width: 300, height: 300 };
    const scale = coverScale(photo, frame);
    expect(clampOffset({ x: 50, y: 50 }, photo, frame, scale)).toEqual({ x: 0, y: 0 });
    expect(clampOffset({ x: -9999, y: -9999 }, photo, frame, scale)).toEqual({ x: -100, y: 0 });
  });

  it("zooms around the centre of the frame", () => {
    const frame = { width: 300, height: 300 };
    const base = coverScale(photo, frame);
    const offset = zoomAroundCentre(centredOffset(photo, frame, base), photo, frame, base, base * 2);
    const rect = cropRect(offset, photo, frame, base * 2);
    expect(rect).toEqual({ x: 1250, y: 750, width: 1500, height: 1500 });
  });

  it("dragged to a corner, crops that corner", () => {
    const frame = { width: 300, height: 300 };
    const scale = coverScale(photo, frame) * 2;
    const offset = clampOffset({ x: -99999, y: -99999 }, photo, frame, scale);
    expect(cropRect(offset, photo, frame, scale)).toEqual({ x: 2500, y: 1500, width: 1500, height: 1500 });
  });

  it("limits the output's longest edge", () => {
    expect(outputSize({ width: 3000, height: 3000 }, 1600)).toEqual({ width: 1600, height: 1600 });
    expect(outputSize({ width: 800, height: 600 }, 1600)).toEqual({ width: 800, height: 600 });
  });
});

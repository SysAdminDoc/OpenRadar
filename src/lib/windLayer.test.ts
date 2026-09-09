import { describe, expect, it, vi } from "vitest";

import { createWindLayer } from "./windLayer";
import { en } from "../i18n/en";
import type { WindField } from "./wind";

/**
 * What the layer does on a card its shaders will not build on.
 *
 * A program that compiles on one driver and not the next is the ordinary way
 * a WebGL layer fails, and the failure is silent by construction: the layer
 * is added, nothing is drawn, and the map reads as a calm afternoon. Two
 * readers of another radar app hit exactly that in one week on GLSL ES 100
 * and GLSL 120, so this pins the half of it that lives here, which is that
 * the layer says so rather than throwing past its caller or going quiet.
 */

const field: WindField = {
  columns: 2,
  rows: 2,
  north: 45,
  west: -100,
  dLat: -5,
  dLon: 5,
  minU: -30,
  maxU: 30,
  minV: -30,
  maxV: 30,
  init: "2026-09-08T00:00:00Z",
  leadHours: 0,
  image: "data:image/png;base64,AAAA",
};

/** Enough of a WebGL2 context to reach the compile check and no more. */
function contextThatRefuses(compiles: boolean) {
  return {
    VERTEX_SHADER: 1,
    FRAGMENT_SHADER: 2,
    COMPILE_STATUS: 3,
    LINK_STATUS: 4,
    createShader: vi.fn(() => ({}) as WebGLShader),
    shaderSource: vi.fn(),
    compileShader: vi.fn(),
    getShaderParameter: vi.fn(() => compiles),
    getShaderInfoLog: vi.fn(
      () => "ERROR: 0:1: '' : version '300 es' is not supported",
    ),
    deleteShader: vi.fn(),
    createProgram: vi.fn(() => ({}) as WebGLProgram),
    attachShader: vi.fn(),
    linkProgram: vi.fn(),
    getProgramParameter: vi.fn(() => true),
    getProgramInfoLog: vi.fn(() => ""),
    deleteProgram: vi.fn(),
    // The rest of what `onAdd` touches once the programs have built. Present
    // so the compiling case runs to the end of it: a fake that ran out half
    // way would report an error of its own and the positive control would be
    // measuring this file rather than the layer.
    ARRAY_BUFFER: 5,
    STATIC_DRAW: 6,
    TEXTURE_2D: 7,
    RGBA: 8,
    UNSIGNED_BYTE: 9,
    TEXTURE_MIN_FILTER: 10,
    TEXTURE_MAG_FILTER: 11,
    TEXTURE_WRAP_S: 12,
    TEXTURE_WRAP_T: 13,
    CLAMP_TO_EDGE: 14,
    NEAREST: 15,
    LINEAR: 16,
    createBuffer: vi.fn(() => ({}) as WebGLBuffer),
    bindBuffer: vi.fn(),
    bufferData: vi.fn(),
    createTexture: vi.fn(() => ({}) as WebGLTexture),
    bindTexture: vi.fn(),
    texImage2D: vi.fn(),
    texParameteri: vi.fn(),
    createFramebuffer: vi.fn(() => ({}) as WebGLFramebuffer),
    bindFramebuffer: vi.fn(),
    getAttribLocation: vi.fn(() => 0),
    getUniformLocation: vi.fn(() => ({}) as WebGLUniformLocation),
    pixelStorei: vi.fn(),
    activeTexture: vi.fn(),
  } as unknown as WebGL2RenderingContext;
}

describe("the wind layer on a card that will not build it", () => {
  it("says so once rather than throwing past the map", () => {
    const said: string[] = [];
    const layer = createWindLayer({
      id: "wind-particles",
      field,
      onError: (message) => said.push(message),
    });

    // `addLayer` calls this synchronously, so a throw here would take the
    // whole style down rather than one layer.
    expect(() =>
      layer.onAdd!(
        {} as Parameters<NonNullable<typeof layer.onAdd>>[0],
        contextThatRefuses(false),
      ),
    ).not.toThrow();

    expect(said).toHaveLength(1);
    // The driver's own line, because it names the card and the version, and
    // it reaches a log rather than a reader. What the reader is told is
    // `wind.noDraw`, said by whoever asked for the layer.
    expect(said[0]).toContain("version '300 es' is not supported");
  });

  it("says nothing when the programs build", () => {
    const said: string[] = [];
    const layer = createWindLayer({
      id: "wind-particles",
      field,
      onError: (message) => said.push(message),
    });
    layer.onAdd!(
      {} as Parameters<NonNullable<typeof layer.onAdd>>[0],
      contextThatRefuses(true),
    );
    // The positive control: a context that compiles must not reach the same
    // branch, or the case above would pass against a layer that always fails.
    expect(said).toEqual([]);
  });

  it("says so when the draw program fails on the first frame, not on add", () => {
    // Two programs, and only one is built in `onAdd`. The other is linked on
    // the first frame because its vertex prelude comes from MapLibre and
    // depends on the projection in force, which makes it the one whose source
    // varies by engine version and by projection: the likelier of the two to
    // build on one card and not the next.
    //
    // It was outside every guard. MapLibre calls `render` bare and has no
    // catch of its own, so the throw went into its frame, the cleanup after
    // the call was skipped and the GL state was left dirty for every other
    // layer, while the wind layer stayed in the style with its switch on.
    const said: string[] = [];
    const layer = createWindLayer({
      id: "wind-particles",
      field,
      onError: (message) => said.push(message),
    });
    // Compiles for `onAdd`, refuses once the prelude is concatenated in.
    let building = 0;
    const context = contextThatRefuses(true) as unknown as {
      getShaderParameter: () => boolean;
    };
    context.getShaderParameter = () => {
      building += 1;
      // `onAdd` builds one program, so two shaders; the draw program's
      // vertex shader is the third, and it is the one refused here.
      return building < 3;
    };
    const gl = context as unknown as WebGL2RenderingContext;
    layer.onAdd!({} as Parameters<NonNullable<typeof layer.onAdd>>[0], gl);
    expect(said, "the fixture failed in onAdd, so this proves nothing").toEqual(
      [],
    );

    expect(() =>
      layer.render!(gl, {
        shaderData: { vertexShaderPrelude: "vec4 projectTile(vec2 p);" },
      } as unknown as Parameters<NonNullable<typeof layer.render>>[1]),
    ).not.toThrow();
    expect(said).toHaveLength(1);
    expect(said[0]).toContain("version '300 es' is not supported");
  });

  it("has a sentence for the reader that names no card of its own", () => {
    // The one the workspace shows when this fires. Held here because the
    // layer's own fallback uses it too, and an English literal in that branch
    // is what the failure-path gate exists to keep out.
    expect(en["wind.noDraw"]).toMatch(/graphics card/);
    expect(en["wind.noDrawBody"]).toMatch(/switched off/);
  });
});

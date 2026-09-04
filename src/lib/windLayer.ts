import type * as maplibregl from "maplibre-gl";
import type { WindField } from "./wind";
import { translate } from "../i18n";

/**
 * Animated wind particles, drawn straight into the map's own GL context.
 *
 * MapLibre has no particle layer, so this is a custom layer doing the standard
 * two-pass trick: a small texture holds every particle's position, one pass
 * moves them by the wind and writes the texture back, and a second draws each
 * one as a short streak from where it was to where it is.
 *
 * Projection is MapLibre's own. A custom layer is handed a `projectTile`
 * function in its shader prelude that takes mercator coordinates and works in
 * both flat and globe projections, so the particles follow the globe without
 * this file knowing anything about how a globe is drawn.
 */

/** Sixty-five thousand particles, which fills a world view without flooding it. */
const PARTICLE_TEXTURE = 256;
const PARTICLES = PARTICLE_TEXTURE * PARTICLE_TEXTURE;
/** How far a particle moves per frame, as a fraction of the world. */
const SPEED = 0.00008;
/** Roughly one particle in this many is put somewhere new each frame, so the
 * pattern does not settle into permanent streamlines. */
const DROP_RATE = 0.003;
/** A fast particle is dropped more often, or the jets go bald. */
const DROP_RATE_BUMP = 0.01;

const UPDATE_VERTEX = `#version 300 es
in vec2 a_pos;
out vec2 v_tex;
void main() {
  v_tex = a_pos;
  gl_Position = vec4(a_pos * 2.0 - 1.0, 0.0, 1.0);
}`;

const UPDATE_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D u_particles;
uniform sampler2D u_wind;
uniform vec2 u_wind_min;
uniform vec2 u_wind_max;
uniform float u_speed;
uniform float u_drop;
uniform float u_drop_bump;
uniform sampler2D u_seeds;
uniform float u_seed;
uniform vec2 u_seed_shift;
in vec2 v_tex;
out vec4 fragColor;

// Position is kept as two bytes per axis, which is finer than a pixel at any
// zoom this layer is drawn at.
vec2 decode(vec4 value) {
  return vec2(value.r / 255.0 + value.b, value.g / 255.0 + value.a);
}
vec4 encode(vec2 pos) {
  vec4 out_value;
  out_value.rb = fract(vec2(pos.x, pos.x) * vec2(255.0, 1.0));
  out_value.ga = fract(vec2(pos.y, pos.y) * vec2(255.0, 1.0));
  out_value.b = pos.x - out_value.r / 255.0;
  out_value.a = pos.y - out_value.g / 255.0;
  return out_value;
}

vec2 windAt(vec2 pos) {
  // The field is a whole world of longitude and the mercator y has to be
  // turned back into a latitude before it can index a regular grid.
  float lat = degrees(2.0 * atan(exp(radians(180.0 - pos.y * 360.0))) - 1.5707963);
  // The grid starts at zero east and mercator x starts at the antimeridian.
  vec2 uv = vec2(fract(pos.x + 0.5), (90.0 - lat) / 180.0);
  vec2 raw = texture(u_wind, uv).rg;
  return mix(u_wind_min, u_wind_max, raw);
}

// The usual sin based hash aliases badly once its input is large, which puts
// whole neighbourhoods of particles on the same spot and grows starbursts.
float random(vec2 seed) {
  vec3 p = fract(vec3(seed.xyx) * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

void main() {
  vec2 pos = decode(texture(u_particles, v_tex));
  vec2 wind = windAt(pos);

  // A degree of longitude is a smaller distance the further north it is, so a
  // particle at high latitude has to move further in mercator x for the same
  // speed on the ground.
  float lat = degrees(2.0 * atan(exp(radians(180.0 - pos.y * 360.0))) - 1.5707963);
  float shrink = max(cos(radians(clamp(lat, -80.0, 80.0))), 0.25);
  vec2 step = vec2(wind.x / shrink, -wind.y) * u_speed;
  pos = vec2(fract(1.0 + pos.x + step.x), clamp(pos.y + step.y, 0.0, 1.0));

  float speed = length(wind) / length(max(abs(u_wind_min), abs(u_wind_max)));
  float drop = u_drop + speed * u_drop_bump;
  // The seed has to come from the particle rather than from where it is, or
  // neighbours share a seed, reset together, and the field grows starbursts
  // where a crowd of them lands on the same spot.
  // Where a reset lands is read from a texture of positions made once on the
  // CPU, at a coordinate that turns a little each frame. A hash of the
  // particle will not do: whatever chose it for a reset also chooses where it
  // goes, and the survivors pile onto the same few spots.
  if (random(v_tex + vec2(u_seed, u_seed * 1.7)) < drop) {
    pos = decode(texture(u_seeds, fract(v_tex + u_seed_shift)));
  }
  fragColor = encode(pos);
}`;

const DRAW_FRAGMENT = `#version 300 es
precision highp float;
in float v_age;
uniform vec4 u_color;
out vec4 fragColor;
void main() {
  fragColor = vec4(u_color.rgb, u_color.a * v_age);
}`;

function compile(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error(translate("wind.noDraw"));
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`createWindLayer could not build a shader: ${log}`);
  }
  return shader;
}

function link(
  gl: WebGL2RenderingContext,
  vertex: string,
  fragment: string,
): WebGLProgram {
  const program = gl.createProgram();
  if (!program) throw new Error(translate("wind.noDraw"));
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vertex));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragment));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`createWindLayer could not link a program: ${log}`);
  }
  return program;
}

/** The starting positions, spread evenly rather than clustered. */
export function seedParticles(count: number, random = Math.random): Uint8Array {
  const state = new Uint8Array(count * 4);
  for (let at = 0; at < count; at += 1) {
    const x = random();
    const y = random();
    state[at * 4] = Math.floor(x * 255 * 255) % 255;
    state[at * 4 + 1] = Math.floor(y * 255 * 255) % 255;
    state[at * 4 + 2] = Math.floor(x * 255);
    state[at * 4 + 3] = Math.floor(y * 255);
  }
  return state;
}

export interface WindLayerOptions {
  id: string;
  field: WindField;
  /** The streak colour, as four numbers from zero to one. */
  color?: [number, number, number, number];
  onError?: (message: string) => void;
}

export function createWindLayer(
  options: WindLayerOptions,
): maplibregl.CustomLayerInterface & { setField: (field: WindField) => void } {
  const color = options.color ?? [0.85, 0.93, 1, 0.55];
  let field = options.field;

  let gl: WebGL2RenderingContext | null = null;
  let map: maplibregl.Map | null = null;
  let updateProgram: WebGLProgram | null = null;
  let drawProgram: WebGLProgram | null = null;
  let quad: WebGLBuffer | null = null;
  let indexBuffer: WebGLBuffer | null = null;
  let windTexture: WebGLTexture | null = null;
  let seedTexture: WebGLTexture | null = null;
  let framebuffer: WebGLFramebuffer | null = null;
  let textures: [WebGLTexture | null, WebGLTexture | null] = [null, null];
  let current = 0;
  let fieldDirty = true;

  function texture(context: WebGL2RenderingContext): WebGLTexture {
    const created = context.createTexture();
    context.bindTexture(context.TEXTURE_2D, created);
    context.texParameteri(
      context.TEXTURE_2D,
      context.TEXTURE_MIN_FILTER,
      context.NEAREST,
    );
    context.texParameteri(
      context.TEXTURE_2D,
      context.TEXTURE_MAG_FILTER,
      context.NEAREST,
    );
    context.texParameteri(
      context.TEXTURE_2D,
      context.TEXTURE_WRAP_S,
      context.CLAMP_TO_EDGE,
    );
    context.texParameteri(
      context.TEXTURE_2D,
      context.TEXTURE_WRAP_T,
      context.CLAMP_TO_EDGE,
    );
    return created;
  }

  return {
    id: options.id,
    type: "custom",
    renderingMode: "2d",

    setField(next: WindField) {
      field = next;
      fieldDirty = true;
      map?.triggerRepaint();
    },

    onAdd(added: maplibregl.Map, context: WebGL2RenderingContext) {
      map = added;
      gl = context;
      try {
        updateProgram = link(context, UPDATE_VERTEX, UPDATE_FRAGMENT);

        quad = context.createBuffer();
        context.bindBuffer(context.ARRAY_BUFFER, quad);
        context.bufferData(
          context.ARRAY_BUFFER,
          new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]),
          context.STATIC_DRAW,
        );

        // Two vertices per particle, both naming the same particle, because a
        // streak is a line and a line has two ends. One entry per particle
        // would pair each vertex with a different particle and draw lines
        // between unrelated points all over the world.
        const indices = new Float32Array(PARTICLES * 2);
        for (let at = 0; at < indices.length; at += 1) {
          indices[at] = Math.floor(at / 2);
        }
        indexBuffer = context.createBuffer();
        context.bindBuffer(context.ARRAY_BUFFER, indexBuffer);
        context.bufferData(context.ARRAY_BUFFER, indices, context.STATIC_DRAW);

        const state = seedParticles(PARTICLES);
        seedTexture = texture(context);
        context.bindTexture(context.TEXTURE_2D, seedTexture);
        context.texImage2D(
          context.TEXTURE_2D,
          0,
          context.RGBA,
          PARTICLE_TEXTURE,
          PARTICLE_TEXTURE,
          0,
          context.RGBA,
          context.UNSIGNED_BYTE,
          state,
        );

        textures = [texture(context), texture(context)];
        for (const held of textures) {
          context.bindTexture(context.TEXTURE_2D, held);
          context.texImage2D(
            context.TEXTURE_2D,
            0,
            context.RGBA,
            PARTICLE_TEXTURE,
            PARTICLE_TEXTURE,
            0,
            context.RGBA,
            context.UNSIGNED_BYTE,
            state,
          );
        }

        windTexture = texture(context);
        context.bindTexture(context.TEXTURE_2D, windTexture);
        context.texParameteri(
          context.TEXTURE_2D,
          context.TEXTURE_MIN_FILTER,
          context.LINEAR,
        );
        context.texParameteri(
          context.TEXTURE_2D,
          context.TEXTURE_MAG_FILTER,
          context.LINEAR,
        );
        framebuffer = context.createFramebuffer();
      } catch (failure) {
        options.onError?.(
          failure instanceof Error
            ? failure.message
            : "The wind layer could not start.",
        );
      }
    },

    onRemove(_removed: maplibregl.Map, context: WebGL2RenderingContext) {
      for (const held of [...textures, windTexture, seedTexture]) {
        if (held) context.deleteTexture(held);
      }
      if (quad) context.deleteBuffer(quad);
      if (indexBuffer) context.deleteBuffer(indexBuffer);
      if (framebuffer) context.deleteFramebuffer(framebuffer);
      if (updateProgram) context.deleteProgram(updateProgram);
      if (drawProgram) context.deleteProgram(drawProgram);
      gl = null;
      map = null;
    },

    render(
      context: WebGL2RenderingContext,
      args: maplibregl.CustomRenderMethodInput,
    ) {
      if (!updateProgram || !textures[0] || !windTexture) return;

      // The draw shader is built the first time, because its prelude comes
      // from MapLibre and depends on the projection in force.
      if (!drawProgram) {
        drawProgram = link(
          context,
          `#version 300 es
${args.shaderData.vertexShaderPrelude}
${args.shaderData.define}
in float a_index;
uniform sampler2D u_particles;
uniform sampler2D u_wind;
uniform vec2 u_wind_min;
uniform vec2 u_wind_max;
uniform float u_texture_size;
uniform float u_length;
out float v_age;

vec2 decode(vec4 value) {
  return vec2(value.r / 255.0 + value.b, value.g / 255.0 + value.a);
}

void main() {
  float row = floor(a_index / u_texture_size);
  vec2 tex = vec2(
    fract(a_index / u_texture_size) + 0.5 / u_texture_size,
    (row + 0.5) / u_texture_size
  );
  vec2 pos = decode(texture(u_particles, tex));

  float lat = degrees(2.0 * atan(exp(radians(180.0 - pos.y * 360.0))) - 1.5707963);
  // The grid starts at zero east and mercator x starts at the antimeridian.
  vec2 uv = vec2(fract(pos.x + 0.5), (90.0 - lat) / 180.0);
  vec2 wind = mix(u_wind_min, u_wind_max, texture(u_wind, uv).rg);
  float shrink = max(cos(radians(clamp(lat, -80.0, 80.0))), 0.25);

  // Each particle is drawn as a two point line, from where it was to where it
  // is, so the streak shows the direction without a screen sized trail buffer.
  float end = mod(float(gl_VertexID), 2.0);
  vec2 tail = pos - vec2(wind.x / shrink, -wind.y) * u_length;
  vec2 at = mix(tail, pos, end);
  v_age = end;
  gl_Position = projectTile(at);
}`,
          DRAW_FRAGMENT,
        );
      }

      if (fieldDirty) {
        const image = new Image();
        image.onload = () => {
          if (!gl || !windTexture) return;
          gl.bindTexture(gl.TEXTURE_2D, windTexture);
          gl.texImage2D(
            gl.TEXTURE_2D,
            0,
            gl.RGBA,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            image,
          );
          map?.triggerRepaint();
        };
        image.src = field.image;
        fieldDirty = false;
      }

      const next = 1 - current;

      // Move every particle.
      context.bindFramebuffer(context.FRAMEBUFFER, framebuffer);
      context.framebufferTexture2D(
        context.FRAMEBUFFER,
        context.COLOR_ATTACHMENT0,
        context.TEXTURE_2D,
        textures[next],
        0,
      );
      context.viewport(0, 0, PARTICLE_TEXTURE, PARTICLE_TEXTURE);
      context.useProgram(updateProgram);
      context.disable(context.BLEND);

      const quadAttribute = context.getAttribLocation(updateProgram, "a_pos");
      context.bindBuffer(context.ARRAY_BUFFER, quad);
      context.enableVertexAttribArray(quadAttribute);
      context.vertexAttribPointer(quadAttribute, 2, context.FLOAT, false, 0, 0);

      context.activeTexture(context.TEXTURE0);
      context.bindTexture(context.TEXTURE_2D, textures[current]);
      context.activeTexture(context.TEXTURE1);
      context.bindTexture(context.TEXTURE_2D, windTexture);
      context.uniform1i(
        context.getUniformLocation(updateProgram, "u_particles"),
        0,
      );
      context.uniform1i(context.getUniformLocation(updateProgram, "u_wind"), 1);
      context.uniform2f(
        context.getUniformLocation(updateProgram, "u_wind_min"),
        field.minU,
        field.minV,
      );
      context.uniform2f(
        context.getUniformLocation(updateProgram, "u_wind_max"),
        field.maxU,
        field.maxV,
      );
      context.uniform1f(
        context.getUniformLocation(updateProgram, "u_speed"),
        SPEED,
      );
      context.uniform1f(
        context.getUniformLocation(updateProgram, "u_drop"),
        DROP_RATE,
      );
      context.uniform1f(
        context.getUniformLocation(updateProgram, "u_drop_bump"),
        DROP_RATE_BUMP,
      );
      context.activeTexture(context.TEXTURE2);
      context.bindTexture(context.TEXTURE_2D, seedTexture);
      context.uniform1i(
        context.getUniformLocation(updateProgram, "u_seeds"),
        2,
      );
      context.uniform1f(
        context.getUniformLocation(updateProgram, "u_seed"),
        Math.random() + 0.1,
      );
      context.uniform2f(
        context.getUniformLocation(updateProgram, "u_seed_shift"),
        Math.random(),
        Math.random(),
      );
      context.drawArrays(context.TRIANGLES, 0, 6);

      // Draw them.
      context.bindFramebuffer(context.FRAMEBUFFER, null);
      const size = map?.getCanvas();
      if (size) context.viewport(0, 0, size.width, size.height);
      context.useProgram(drawProgram);
      context.enable(context.BLEND);
      context.blendFunc(context.SRC_ALPHA, context.ONE_MINUS_SRC_ALPHA);

      const indexAttribute = context.getAttribLocation(drawProgram, "a_index");
      context.bindBuffer(context.ARRAY_BUFFER, indexBuffer);
      context.enableVertexAttribArray(indexAttribute);
      context.vertexAttribPointer(
        indexAttribute,
        1,
        context.FLOAT,
        false,
        0,
        0,
      );

      context.activeTexture(context.TEXTURE0);
      context.bindTexture(context.TEXTURE_2D, textures[next]);
      context.activeTexture(context.TEXTURE1);
      context.bindTexture(context.TEXTURE_2D, windTexture);
      context.uniform1i(
        context.getUniformLocation(drawProgram, "u_particles"),
        0,
      );
      context.uniform1i(context.getUniformLocation(drawProgram, "u_wind"), 1);
      context.uniform2f(
        context.getUniformLocation(drawProgram, "u_wind_min"),
        field.minU,
        field.minV,
      );
      context.uniform2f(
        context.getUniformLocation(drawProgram, "u_wind_max"),
        field.maxU,
        field.maxV,
      );
      context.uniform1f(
        context.getUniformLocation(drawProgram, "u_texture_size"),
        PARTICLE_TEXTURE,
      );
      context.uniform1f(
        context.getUniformLocation(drawProgram, "u_length"),
        SPEED * 22,
      );
      context.uniform4f(
        context.getUniformLocation(drawProgram, "u_color"),
        color[0],
        color[1],
        color[2],
        color[3],
      );
      applyProjection(context, drawProgram, args.defaultProjectionData);

      context.drawArrays(context.LINES, 0, PARTICLES * 2);

      current = next;
      map?.triggerRepaint();
    },
  };
}

/** The uniforms MapLibre's own `projectTile` reads. */
function applyProjection(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  data: maplibregl.CustomRenderMethodInput["defaultProjectionData"],
) {
  const matrix = gl.getUniformLocation(program, "u_projection_matrix");
  if (matrix) gl.uniformMatrix4fv(matrix, false, data.mainMatrix);
  const fallback = gl.getUniformLocation(
    program,
    "u_projection_fallback_matrix",
  );
  if (fallback) gl.uniformMatrix4fv(fallback, false, data.fallbackMatrix);
  const mercator = gl.getUniformLocation(
    program,
    "u_projection_tile_mercator_coords",
  );
  if (mercator) gl.uniform4fv(mercator, data.tileMercatorCoords);
  const clipping = gl.getUniformLocation(
    program,
    "u_projection_clipping_plane",
  );
  if (clipping) gl.uniform4fv(clipping, data.clippingPlane);
  const transition = gl.getUniformLocation(program, "u_projection_transition");
  if (transition) gl.uniform1f(transition, data.projectionTransition);
  const antimeridian = gl.getUniformLocation(
    program,
    "u_projection_clip_antimeridian",
  );
  if (antimeridian) gl.uniform1f(antimeridian, data.clipAntimeridian ? 1 : 0);
}

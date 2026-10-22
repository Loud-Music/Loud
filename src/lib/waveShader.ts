export const waveVertex = `
attribute vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

export const waveFragment = `
precision highp float;
uniform vec2 resolution;
uniform float time;
uniform float energy;
uniform float bass;
uniform float pulse;
uniform vec3 palette0;
uniform vec3 palette1;
uniform vec3 palette2;

float hash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0)), u.x), u.y);
}

float flow(vec2 p) {
  float value = 0.0;
  float weight = 0.5;
  mat2 turn = mat2(0.8, -0.6, 0.6, 0.8);
  for (int i = 0; i < 4; i++) {
    value += weight * noise(p);
    p = turn * p * 2.03 + 3.7;
    weight *= 0.5;
  }
  return value;
}

void main() {
  vec2 uv = gl_FragCoord.xy / resolution;
  vec2 p = vec2(uv.x * resolution.x / resolution.y, uv.y);
  p += vec2(sin(uv.y * 3.0), cos(uv.x * 2.0)) * pulse * 0.12;
  float t = time * 0.4;
  vec2 warp = vec2(flow(p * 1.7 + vec2(t, -t * 0.4)),
                   flow(p * 1.6 + vec2(-t * 0.6, t * 0.3)));
  float field = flow(p * 1.9 + warp * (2.2 + bass * 1.65 + pulse * 0.65) + vec2(t * 0.5, -t * 0.35));
  float silk = sin(p.y * 3.1 - p.x * 0.75 + field * (5.0 + bass * 1.5) + t * 0.6);
  float amber = smoothstep(0.18, 0.92, silk * 0.5 + 0.5);
  float coral = smoothstep(0.25, 0.8, field + uv.x * 0.3);
  vec3 color = mix(palette0 * 0.18, palette1 * 0.65, coral);
  color = mix(color, palette2 * 0.85, amber * (0.42 + bass * 0.32));
  float haze = smoothstep(0.25, 0.78, flow(p * 2.4 + warp + t * 0.15));
  color += palette0 * 0.18 * haze * (0.4 + energy * 0.65);
  color *= 0.65 + energy * 0.3 + pulse * 0.12;
  color += (hash(gl_FragCoord.xy) - 0.5) / 255.0;
  gl_FragColor = vec4(color, 1.0);
}
`;

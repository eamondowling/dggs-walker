// Browser Gamepad API reader for "standard"-mapping pads (Xbox, PlayStation, Switch Pro).
// Standard layout: axes 0/1 = left stick (x, y; up is -1), 2/3 = right stick,
// buttons 0 = A, 4/5 = LB/RB, 7 = RT, 12-15 = d-pad up/down/left/right.

export interface GamepadState {
  connected: boolean;
  forward: number; // -1..1, +1 = forward
  turn: number; // -1..1, +1 = right
  lookX: number; // right stick, -1..1
  lookY: number; // right stick, -1..1 (down is +1)
  zoom: number; // +1 = zoom out (LB), -1 = zoom in (RB)
  sprint: boolean;
  jump: boolean;
}

const DEADZONE = 0.18;

const NEUTRAL: GamepadState = {
  connected: false,
  forward: 0,
  turn: 0,
  lookX: 0,
  lookY: 0,
  zoom: 0,
  sprint: false,
  jump: false,
};

// Radial deadzone with the live range rescaled to 0..1 so the stick eases in from the edge.
function applyDeadzone(x: number, y: number): [number, number] {
  const mag = Math.hypot(x, y);
  if (mag < DEADZONE) return [0, 0];
  const scaled = Math.min(1, (mag - DEADZONE) / (1 - DEADZONE));
  return [(x / mag) * scaled, (y / mag) * scaled];
}

export function readGamepad(): GamepadState {
  if (typeof navigator === 'undefined' || !navigator.getGamepads) return NEUTRAL;

  const pad = Array.from(navigator.getGamepads()).find((p): p is Gamepad => !!p && p.connected && p.mapping === 'standard');
  if (!pad) return NEUTRAL;

  const pressed = (i: number) => !!pad.buttons[i]?.pressed;
  const axis = (i: number) => pad.axes[i] ?? 0;

  const [lx, ly] = applyDeadzone(axis(0), axis(1));
  const [rx, ry] = applyDeadzone(axis(2), axis(3));

  const forward = -ly + (pressed(12) ? 1 : 0) - (pressed(13) ? 1 : 0);
  const turn = lx + (pressed(15) ? 1 : 0) - (pressed(14) ? 1 : 0);

  return {
    connected: true,
    forward: Math.max(-1, Math.min(1, forward)),
    turn: Math.max(-1, Math.min(1, turn)),
    lookX: rx,
    lookY: ry,
    zoom: (pressed(4) ? 1 : 0) - (pressed(5) ? 1 : 0),
    sprint: (pad.buttons[7]?.value ?? 0) > 0.5,
    jump: pressed(0),
  };
}

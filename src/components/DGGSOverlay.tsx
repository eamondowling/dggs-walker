import React from 'react';
import { CameraMode } from '../character/controller';
import { DGGSCell, faceCountAtDepth } from '../dggs/icosahedron';
import {
  Volume2,
  VolumeX,
  RotateCcw,
  Layers,
  Sparkles,
  Crosshair,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

// Tailwind classes per wireframe depth button, outermost (coarsest) to innermost (finest).
// Falls back to repeating the last entry if maxDepth ever exceeds this list.
const WIREFRAME_BUTTON_STYLE: { active: string; label: string }[] = [
  { active: 'border-amber-400/80 bg-amber-500/20 text-amber-200', label: 'text-amber-400' },
  { active: 'border-cyan-400/80 bg-cyan-500/20 text-cyan-200', label: 'text-cyan-400' },
  { active: 'border-purple-400/80 bg-purple-500/20 text-purple-200', label: 'text-purple-400' },
  { active: 'border-rose-400/80 bg-rose-500/20 text-rose-200', label: 'text-rose-400' },
  { active: 'border-pink-400/80 bg-pink-500/20 text-pink-200', label: 'text-pink-400' },
  { active: 'border-slate-400/80 bg-slate-500/20 text-slate-200', label: 'text-slate-400' },
];

interface DGGSOverlayProps {
  currentCell: DGGSCell | null;
  latitude: number;
  longitude: number;
  speed: number;
  beaconsActivated: number;
  totalBeacons: number;
  dggsDepth: number;
  leafCellCount: number;
  cameraMode: CameraMode;
  onSelectCameraMode: (mode: CameraMode) => void;
  wireframeDepth: boolean[];
  onToggleWireframe: (depth: number) => void;
  soundEnabled: boolean;
  onToggleSound: () => void;
  onResetPosition: () => void;
  onTouchMove?: (deltaX: number, deltaY: number) => void;
  onTouchJump?: () => void;
  onTouchSprint?: (active: boolean) => void;
}

export const DGGSOverlay: React.FC<DGGSOverlayProps> = ({
  currentCell,
  latitude,
  longitude,
  speed,
  beaconsActivated,
  totalBeacons,
  dggsDepth,
  leafCellCount,
  cameraMode,
  onSelectCameraMode,
  wireframeDepth,
  onToggleWireframe,
  soundEnabled,
  onToggleSound,
  onResetPosition,
}) => {
  const [detailsExpanded, setDetailsExpanded] = React.useState(true);
  const [controlsHelpOpen, setControlsHelpOpen] = React.useState(false);

  const formatCoord = (deg: number, posChar: string, negChar: string) => {
    const dir = deg >= 0 ? posChar : negChar;
    return `${Math.abs(deg).toFixed(1)}° ${dir}`;
  };

  return (
    <div className="absolute inset-0 pointer-events-none flex flex-col justify-between p-4 md:p-6 text-slate-100 select-none">
      {/* 1. TOP BAR CONTRACT: Exactly 3 Zones */}
      <header className="flex items-center justify-between gap-4 pointer-events-auto bg-slate-950/60 backdrop-blur-md border border-white/10 px-5 py-3 rounded-xl shadow-2xl">
        {/* Zone 1: Single text element wordmark */}
        <div className="flex items-center gap-3">
          <div className="w-3 h-3 rounded-full bg-rose-500 shadow-[0_0_10px_rgba(244,63,94,0.8)] animate-pulse" />
          <span className="text-base font-semibold tracking-tight text-white font-mono">
            DGGS Icosahedron
          </span>
        </div>

        {/* Zone 2: Clean unboxed metadata with typographic separators */}
        <div className="hidden lg:flex items-center gap-2.5 text-xs text-slate-300 font-mono tabular-nums">
          <span>Aperture 4</span>
          <span className="text-slate-600" aria-hidden="true">·</span>
          <span>Depth {dggsDepth}</span>
          <span className="text-slate-600" aria-hidden="true">·</span>
          <span>{leafCellCount.toLocaleString()} Tessellated Cells</span>
          <span className="text-slate-600" aria-hidden="true">·</span>
          <span>12 Base Vertices</span>
          <span className="text-slate-600" aria-hidden="true">·</span>
          <span className="text-amber-400 font-medium">
            {beaconsActivated}/{totalBeacons} Beacons
          </span>
        </div>

        {/* Zone 3: 1-2 primary actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={onResetPosition}
            title="Reset position to North Pole"
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-200 bg-white/5 hover:bg-white/10 active:bg-white/20 border border-white/10 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5 text-slate-400" />
            <span className="hidden sm:inline">North Pole</span>
          </button>

          <button
            onClick={onToggleSound}
            title={soundEnabled ? 'Mute Audio' : 'Enable Audio'}
            className="p-2 text-slate-200 bg-white/5 hover:bg-white/10 active:bg-white/20 border border-white/10 rounded-lg transition-colors cursor-pointer"
          >
            {soundEnabled ? (
              <Volume2 className="w-4 h-4 text-emerald-400" />
            ) : (
              <VolumeX className="w-4 h-4 text-slate-400" />
            )}
          </button>
        </div>
      </header>

      {/* 2. MIDDLE FLOATING PANELS */}
      <div className="flex justify-between items-start my-auto pointer-events-none">
        {/* Left: Active DGGS Cell Inspector Card */}
        <div className="pointer-events-auto bg-slate-950/75 backdrop-blur-md border border-white/10 rounded-xl p-4 w-72 sm:w-80 shadow-2xl transition-all">
          <div className="flex items-center justify-between pb-2 border-b border-white/10">
            <div className="flex items-center gap-2">
              <Crosshair className="w-4 h-4 text-rose-400" />
              <span className="text-xs font-medium uppercase tracking-wider text-slate-300">
                Active Cell Telemetry
              </span>
            </div>
            <button
              onClick={() => setDetailsExpanded(!detailsExpanded)}
              className="text-slate-400 hover:text-white p-0.5 rounded cursor-pointer"
            >
              {detailsExpanded ? (
                <ChevronUp className="w-4 h-4" />
              ) : (
                <ChevronDown className="w-4 h-4" />
              )}
            </button>
          </div>

          {currentCell && (
            <div className="mt-3 space-y-2.5 text-xs">
              <div className="flex items-baseline justify-between">
                <span className="text-slate-400">DGGS Code</span>
                <span className="font-mono text-sm font-semibold text-rose-400 tracking-wide">
                  {currentCell.id}
                </span>
              </div>

              {detailsExpanded && (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Primary Face</span>
                    <span className="font-mono text-slate-200">
                      Face #{currentCell.faceIndex} of 20
                    </span>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Aperture Path</span>
                    <span className="font-mono text-slate-200">
                      [{currentCell.path.join(' → ')}]
                    </span>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Biome Zone</span>
                    <span className="text-slate-200 font-medium">
                      {currentCell.biome}
                    </span>
                  </div>

                  <div className="flex items-center justify-between pt-1 border-t border-white/5 font-mono text-[11px] text-slate-400">
                    <span>Coordinates</span>
                    <span>
                      {formatCoord(latitude, 'N', 'S')}, {formatCoord(longitude, 'E', 'W')}
                    </span>
                  </div>

                  <div className="flex items-center justify-between font-mono text-[11px] text-slate-400">
                    <span>Surface Speed</span>
                    <span className="tabular-nums text-slate-300">
                      {speed.toFixed(1)} m/s
                    </span>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Beacon quest status */}
          <div className="mt-3 pt-2.5 border-t border-white/10 flex items-center justify-between text-xs">
            <span className="text-slate-400 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              Vertices Reached
            </span>
            <span className="font-mono font-semibold text-amber-400">
              {beaconsActivated} / {totalBeacons}
            </span>
          </div>
        </div>

        {/* Right: Quick Controls & Camera Modes */}
        <div className="pointer-events-auto flex flex-col gap-2.5 items-end">
          {/* Camera Perspective Mode Segmented Control */}
          <div className="bg-slate-950/75 backdrop-blur-md border border-white/10 rounded-xl p-1.5 flex flex-col sm:flex-row gap-1 shadow-2xl">
            {(
              [
                { id: 'curved_horizon', label: 'Curved 3rd' },
                { id: 'close_third', label: 'Close 3rd' },
                { id: 'wide_panoramic', label: 'Panoramic' },
                { id: 'orbital_planet', label: 'Orbital DGGS' },
                { id: 'icosahedral_net', label: 'Net View' },
                { id: 'local_patch', label: 'Local Flat' },
              ] as const
            ).map((mode) => (
              <button
                key={mode.id}
                onClick={() => onSelectCameraMode(mode.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                  cameraMode === mode.id
                    ? 'bg-rose-500 text-white shadow-md'
                    : 'text-slate-300 hover:text-white hover:bg-white/10'
                }`}
              >
                {mode.label}
              </button>
            ))}
          </div>

          {/* Wireframe Subdivision Depth Toggles */}
          <div className="bg-slate-950/75 backdrop-blur-md border border-white/10 rounded-xl p-2.5 shadow-2xl flex flex-col gap-1.5 min-w-[170px]">
            <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-slate-400 pb-1 border-b border-white/10">
              <Layers className="w-3.5 h-3.5 text-cyan-400" />
              <span>Grid Subdivision</span>
            </div>

            <div className="grid grid-cols-2 gap-1.5 pt-1">
              {wireframeDepth.map((active, depth) => {
                const style = WIREFRAME_BUTTON_STYLE[Math.min(depth, WIREFRAME_BUTTON_STYLE.length - 1)];
                return (
                  <button
                    key={depth}
                    onClick={() => onToggleWireframe(depth)}
                    className={`px-2 py-1 text-[11px] font-mono rounded border transition-colors cursor-pointer ${
                      active ? style.active : 'border-white/10 text-slate-500 hover:border-white/20'
                    }`}
                  >
                    D{depth} ({faceCountAtDepth(depth).toLocaleString()} Faces)
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* 3. BOTTOM BAR: Instructions & Keybinds */}
      <footer className="pointer-events-auto bg-slate-950/65 backdrop-blur-md border border-white/10 rounded-xl px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-300">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-1.5">
            <span className="px-1.5 py-0.5 font-mono text-[10px] bg-white/10 rounded border border-white/20 text-white">
              W / S
            </span>
            <span className="text-slate-400">Forward / Reverse</span>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="px-1.5 py-0.5 font-mono text-[10px] bg-white/10 rounded border border-white/20 text-white">
              A / D
            </span>
            <span className="text-slate-400">Turn Character & View</span>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="px-1.5 py-0.5 font-mono text-[10px] bg-white/10 rounded border border-white/20 text-white">
              Drag Mouse
            </span>
            <span className="text-slate-400">Orbit Camera</span>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="px-1.5 py-0.5 font-mono text-[10px] bg-white/10 rounded border border-white/20 text-white">
              Wheel
            </span>
            <span className="text-slate-400">Zoom</span>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="px-1.5 py-0.5 font-mono text-[10px] bg-white/10 rounded border border-white/20 text-white">
              SPACE
            </span>
            <span className="text-slate-400">Jump</span>
          </div>
        </div>

        <div className="flex items-center gap-3 text-slate-400 text-[11px]">
          <span>Curvature aligned gravity</span>
          <span aria-hidden="true">·</span>
          <span>Red biped explorer</span>
        </div>
      </footer>
    </div>
  );
};

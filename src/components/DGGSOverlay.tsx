import React from 'react';
import { CameraMode, CharacterOrientationMode } from '../character/controller';
import { DGGSCell } from '../dggs/icosahedron';
import {
  Volume2,
  VolumeX,
  Compass,
  RotateCcw,
  Layers,
  Sparkles,
  Eye,
  Crosshair,
  MapPin,
  ChevronDown,
  ChevronUp,
  Shield,
  Navigation,
} from 'lucide-react';

interface DGGSOverlayProps {
  currentCell: DGGSCell | null;
  latitude: number;
  longitude: number;
  speed: number;
  beaconsActivated: number;
  totalBeacons: number;
  cameraMode: CameraMode;
  onSelectCameraMode: (mode: CameraMode) => void;
  orientationMode: CharacterOrientationMode;
  onSelectOrientationMode: (mode: CharacterOrientationMode) => void;
  wireframeDepth: { d0: boolean; d1: boolean; d2: boolean; d3: boolean };
  onToggleWireframe: (depth: 'd0' | 'd1' | 'd2' | 'd3') => void;
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
  cameraMode,
  onSelectCameraMode,
  orientationMode,
  onSelectOrientationMode,
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
          <span>Depth 3</span>
          <span className="text-slate-600" aria-hidden="true">·</span>
          <span>1,280 Tessellated Cells</span>
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

                  <div className="flex items-center justify-between font-mono text-[11px] text-slate-400">
                    <span>Upright Mode</span>
                    <span className="text-rose-400 font-medium">
                      {orientationMode === 'tile_normal'
                        ? 'Tile Facet Normal'
                        : orientationMode === 'camera_top'
                        ? 'Camera View Top'
                        : 'Radial Gravity'}
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
          {/* Character Orientation Mode (User control for tile normal vs camera view top vs radial) */}
          <div className="bg-slate-950/75 backdrop-blur-md border border-white/10 rounded-xl p-2.5 shadow-2xl flex flex-col gap-1.5 w-full max-w-[210px]">
            <div className="flex items-center justify-between text-[11px] font-medium uppercase tracking-wider text-slate-400 pb-1 border-b border-white/10">
              <div className="flex items-center gap-1.5">
                <Compass className="w-3.5 h-3.5 text-rose-400" />
                <span>Upright Alignment</span>
              </div>
            </div>

            <div className="flex flex-col gap-1 pt-0.5">
              <button
                onClick={() => onSelectOrientationMode('tile_normal')}
                title="Align character normal to whichever DGGS facet tile it is on"
                className={`px-2.5 py-1.5 text-xs text-left font-medium rounded-lg transition-colors flex items-center justify-between cursor-pointer ${
                  orientationMode === 'tile_normal'
                    ? 'bg-rose-500/25 border border-rose-500/60 text-rose-200'
                    : 'text-slate-300 hover:text-white hover:bg-white/5 border border-transparent'
                }`}
              >
                <span>Tile Normal</span>
                <span className="text-[10px] text-slate-400 font-normal">Active tile</span>
              </button>
              <button
                onClick={() => onSelectOrientationMode('camera_top')}
                title="Align character straight up toward camera view top"
                className={`px-2.5 py-1.5 text-xs text-left font-medium rounded-lg transition-colors flex items-center justify-between cursor-pointer ${
                  orientationMode === 'camera_top'
                    ? 'bg-sky-500/25 border border-sky-500/60 text-sky-200'
                    : 'text-slate-300 hover:text-white hover:bg-white/5 border border-transparent'
                }`}
              >
                <span>Camera View Top</span>
                <span className="text-[10px] text-slate-400 font-normal">Screen-up</span>
              </button>
              <button
                onClick={() => onSelectOrientationMode('radial_gravity')}
                title="Align character with spherical planet center gravity"
                className={`px-2.5 py-1.5 text-xs text-left font-medium rounded-lg transition-colors flex items-center justify-between cursor-pointer ${
                  orientationMode === 'radial_gravity'
                    ? 'bg-amber-500/25 border border-amber-500/60 text-amber-200'
                    : 'text-slate-300 hover:text-white hover:bg-white/5 border border-transparent'
                }`}
              >
                <span>Radial Gravity</span>
                <span className="text-[10px] text-slate-400 font-normal">Center</span>
              </button>
            </div>
          </div>

          {/* Camera Perspective Mode Segmented Control */}
          <div className="bg-slate-950/75 backdrop-blur-md border border-white/10 rounded-xl p-1.5 flex flex-col sm:flex-row gap-1 shadow-2xl">
            {(
              [
                { id: 'curved_horizon', label: 'Curved 3rd' },
                { id: 'close_third', label: 'Close 3rd' },
                { id: 'wide_panoramic', label: 'Panoramic' },
                { id: 'orbital_planet', label: 'Orbital DGGS' },
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
              <button
                onClick={() => onToggleWireframe('d0')}
                className={`px-2 py-1 text-[11px] font-mono rounded border transition-colors cursor-pointer ${
                  wireframeDepth.d0
                    ? 'border-amber-400/80 bg-amber-500/20 text-amber-200'
                    : 'border-white/10 text-slate-500 hover:border-white/20'
                }`}
              >
                D0 (20 Faces)
              </button>
              <button
                onClick={() => onToggleWireframe('d1')}
                className={`px-2 py-1 text-[11px] font-mono rounded border transition-colors cursor-pointer ${
                  wireframeDepth.d1
                    ? 'border-cyan-400/80 bg-cyan-500/20 text-cyan-200'
                    : 'border-white/10 text-slate-500 hover:border-white/20'
                }`}
              >
                D1 (80 Faces)
              </button>
              <button
                onClick={() => onToggleWireframe('d2')}
                className={`px-2 py-1 text-[11px] font-mono rounded border transition-colors cursor-pointer ${
                  wireframeDepth.d2
                    ? 'border-purple-400/80 bg-purple-500/20 text-purple-200'
                    : 'border-white/10 text-slate-500 hover:border-white/20'
                }`}
              >
                D2 (320 Faces)
              </button>
              <button
                onClick={() => onToggleWireframe('d3')}
                className={`px-2 py-1 text-[11px] font-mono rounded border transition-colors cursor-pointer ${
                  wireframeDepth.d3
                    ? 'border-rose-400/80 bg-rose-500/20 text-rose-200'
                    : 'border-white/10 text-slate-500 hover:border-white/20'
                }`}
              >
                D3 (1,280)
              </button>
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

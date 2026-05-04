/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Copy, Hash, Info, Sliders, Palette, RefreshCw, Layers, ImageIcon } from 'lucide-react';
import ImageProcessingView from './components/ImageProcessingView';

// --- Types ---
interface CMYK {
  c: number;
  m: number;
  y: number;
  k: number;
}

interface RGB {
  r: number;
  g: number;
  b: number;
}

// --- Utils ---
const cmykToRgb = (cmyk: CMYK): RGB => {
  const { c, m, y, k } = cmyk;
  const r = Math.round(255 * (1 - c / 100) * (1 - k / 100));
  const g = Math.round(255 * (1 - m / 100) * (1 - k / 100));
  const b = Math.round(255 * (1 - y / 100) * (1 - k / 100));
  return { r: Math.max(0, r), g: Math.max(0, g), b: Math.max(0, b) };
};

const rgbToHex = (rgb: RGB): string => {
  const toHex = (n: number) => n.toString(16).padStart(2, '0').toUpperCase();
  return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`;
};

const hexToRgb = (hex: string): RGB | null => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : null;
};

const rgbToCmyk = (rgb: RGB): CMYK => {
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;

  const k = 1 - Math.max(r, g, b);
  if (k === 1) return { c: 0, m: 0, y: 0, k: 100 };

  const c = Math.round(((1 - r - k) / (1 - k)) * 100);
  const m = Math.round(((1 - g - k) / (1 - k)) * 100);
  const y = Math.round(((1 - b - k) / (1 - k)) * 100);
  const kPercent = Math.round(k * 100);

  return { c, m, y, k: kPercent };
};

const getColorDifference = (rgb1: RGB, rgb2: RGB): number => {
  // Simple Euclidean distance in RGB space
  return Math.sqrt(
    Math.pow(rgb1.r - rgb2.r, 2) +
    Math.pow(rgb1.g - rgb2.g, 2) +
    Math.pow(rgb1.b - rgb2.b, 2)
  );
};

// Check if a color is strictly printable
const checkPrintability = (rgb: RGB, cmyk: CMYK, inkLimit: number): { isOut: boolean; reason: string | null } => {
  const roundTrip = cmykToRgb(cmyk);
  const diff = getColorDifference(rgb, roundTrip);
  
  // 1. 檢查視覺偏差（容差調為 2.5，確保包含合理的數值舍入誤差）
  if (diff > 2.5) return { isOut: true, reason: '色域偏差：CMYK 油墨組合無法精確還原此 RGB 飽和度' };

  // 2. 檢查總墨量 (TIC)
  const totalInk = cmyk.c + cmyk.m + cmyk.y + cmyk.k;
  if (totalInk > inkLimit + 0.1) return { isOut: true, reason: `總墨量 (${totalInk.toFixed(1)}%) 超過設定限制 (${inkLimit}%)` };

  // 3. 針對螢光/高亮度 RGB 顏色的啟發式檢查
  const max = Math.max(rgb.r, rgb.g, rgb.b);
  const min = Math.min(rgb.r, rgb.g, rgb.b);
  const saturation = max === 0 ? 0 : (max - min) / max;
  if (max > 240 && saturation > 0.88) return { isOut: true, reason: '此顏色亮度過高且過於鮮豔，傳統油墨無法還原（螢光感）' };

  return { isOut: false, reason: null };
};

export default function App() {
  const [activeTab, setActiveTab] = useState<'explorer' | 'image'>('explorer');
  const [cmyk, setCmyk] = useState<CMYK>({ c: 50, m: 0, y: 50, k: 0 });
  const [totalInkLimit, setTotalInkLimit] = useState(300);
  const [selectedPos, setSelectedPos] = useState({ x: -70, y: -70 }); // Relative to center
  const [isCopied, setIsCopied] = useState(false);

  // HEX Input Feature State
  const [hexInput, setHexInput] = useState('');
  const [inputCmyk, setInputCmyk] = useState<CMYK | null>(null);
  const [isOutofGamut, setIsOutofGamut] = useState(false);
  const [gamutReason, setGamutReason] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<{ cmyk: CMYK; hex: string; label: string }[]>([]);

  const canvasRef = useRef<HTMLCanvasElement>(null);

  const rgb = cmykToRgb(cmyk);
  const hex = rgbToHex(rgb);

  // Helper to generate a printable alternative
  const generatePrintableAlternative = (inputRgb: RGB, factor: number, targetInkLimit: number): { cmyk: CMYK; hex: string } => {
    const baseCmyk = rgbToCmyk(inputRgb);
    
    // Adjust CMY based on factor to bring it into gamut
    let c = baseCmyk.c * factor;
    let m = baseCmyk.m * factor;
    let y = baseCmyk.y * factor;
    let k = baseCmyk.k;

    // Direct TIC clamping
    const currentTotal = c + m + y + k;
    if (currentTotal > targetInkLimit) {
      const allowed = Math.max(0, targetInkLimit - k);
      const sum = c + m + y;
      if (sum > 0) {
        const ratio = allowed / sum;
        c *= ratio; m *= ratio; y *= ratio;
      }
    }

    // High Luminance clamping
    const tR = (1 - c/100) * (1 - k/100) * 255;
    const tG = (1 - m/100) * (1 - k/100) * 255;
    const tB = (1 - y/100) * (1 - k/100) * 255;
    const tMax = Math.max(tR, tG, tB);
    const tMin = Math.min(tR, tG, tB);
    const tSat = tMax === 0 ? 0 : (tMax - tMin) / tMax;

    if (tMax > 235 && tSat > 0.85) {
      const f = 0.85 / tSat;
      c *= f; m *= f; y *= f;
    }

    const finalCmyk = { c: Math.round(c), m: Math.round(m), y: Math.round(y), k: Math.round(k) };
    const finalRgb = cmykToRgb(finalCmyk);
    return { cmyk: finalCmyk, hex: rgbToHex(finalRgb) };
  };

  // Handle HEX input logic
  useEffect(() => {
    if (/^#?[0-9A-F]{6}$/i.test(hexInput)) {
      const inputRgb = hexToRgb(hexInput);
      if (inputRgb) {
        const convertedCmyk = rgbToCmyk(inputRgb);
        setInputCmyk(convertedCmyk);

        const gamutInfo = checkPrintability(inputRgb, convertedCmyk, totalInkLimit);
        
        if (gamutInfo.isOut) {
          setIsOutofGamut(true);
          setGamutReason(gamutInfo.reason);
          
          // Generate 3 distinct alternatives
          const alt1 = generatePrintableAlternative(inputRgb, 0.85, totalInkLimit); // Perceptual
          const alt2 = generatePrintableAlternative(inputRgb, 0.70, totalInkLimit); // High Saturation adjustment
          const alt3 = generatePrintableAlternative(inputRgb, 0.90, Math.min(totalInkLimit, 220)); // Safe Zone

          setSuggestions([
            { ...alt1, label: '感知匹配 (視覺優先)' },
            { ...alt2, label: '高飽和處理 (色彩活力)' },
            { ...alt3, label: '嚴格安全區 (低墨量)' }
          ]);
        } else {
          setIsOutofGamut(false);
          setGamutReason(null);
          setSuggestions([]);
        }
      }
    } else {
      setInputCmyk(null);
      setIsOutofGamut(false);
      setGamutReason(null);
      setSuggestions([]);
    }
  }, [hexInput, totalInkLimit]);

  // Initialize position on mount or based on default CMYK (simplified as center-ish for now)
  useEffect(() => {
    // Initial position for C:50, M:0, Y:50
    // This is roughly top-left. For simplicity, we just set a default that matches the initial state
    setSelectedPos({ x: -70, y: -70 });
  }, []);

  // --- Wheel Logic ---
  const hueToCMY = (hue: number, sat: number, kValue: number): { c: number; m: number; y: number } => {
    let c = 0, m = 0, y = 0;
    const h = hue % 360;
    const sector = Math.floor(h / 60);
    const f = (h % 60) / 60;

    switch (sector) {
      case 0: c = 100; m = f * 100; y = 0; break;
      case 1: c = (1 - f) * 100; m = 100; y = 0; break;
      case 2: c = 0; m = 100; y = f * 100; break;
      case 3: c = 0; m = (1 - f) * 100; y = 100; break;
      case 4: c = f * 100; m = 0; y = 100; break;
      case 5: c = 100; m = 0; y = (1 - f) * 100; break;
    }

    let resC = (c * sat) / 100;
    let resM = (m * sat) / 100;
    let resY = (y * sat) / 100;

    // --- 1. Ink Limit Correction ---
    const currentTotal = resC + resM + resY + kValue;
    if (currentTotal > totalInkLimit) {
      const allowedCMY = Math.max(0, totalInkLimit - kValue);
      const cmySum = resC + resM + resY;
      if (cmySum > 0) {
        const factor = allowedCMY / cmySum;
        resC *= factor;
        resM *= factor;
        resY *= factor;
      } else {
        resC = 0; resM = 0; resY = 0;
      }
    }

    // --- 2. High Luminance / Neon Protection ---
    const tR = (1 - resC / 100) * (1 - kValue / 100) * 255;
    const tG = (1 - resM / 100) * (1 - kValue / 100) * 255;
    const tB = (1 - resY / 100) * (1 - kValue / 100) * 255;
    
    const tMax = Math.max(tR, tG, tB);
    const tMin = Math.min(tR, tG, tB);
    const tSaturation = tMax === 0 ? 0 : (tMax - tMin) / tMax;

    if (tMax > 240 && tSaturation > 0.88) {
      const correctionFactor = 0.88 / tSaturation;
      resC *= correctionFactor;
      resM *= correctionFactor;
      resY *= correctionFactor;
    }

    return { c: resC, m: resM, y: resY };
  };

  const drawWheel = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    const size = canvas.width;
    const center = size / 2;
    const radius = center - 5;
    const k = cmyk.k; // Use current K value for the wheel

    ctx.clearRect(0, 0, size, size);

    const imageData = ctx.createImageData(size, size);
    const data = imageData.data;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = x - center;
        const dy = y - center;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist <= radius) {
          const angle = (Math.atan2(dy, dx) * 180 / Math.PI + 360 + 90) % 360;
          const sat = (dist / radius) * 100;
          const { c, m, y: y_val } = hueToCMY(angle, sat, k);
          
          // Use more accurate CMYK -> RGB including K
          const r = Math.round(255 * (1 - c / 100) * (1 - k / 100));
          const g = Math.round(255 * (1 - m / 100) * (1 - k / 100));
          const b = Math.round(255 * (1 - y_val / 100) * (1 - k / 100));

          const idx = (y * size + x) * 4;
          data[idx] = r;
          data[idx + 1] = g;
          data[idx + 2] = b;
          data[idx + 3] = 255;
        }
      }
    }
    ctx.putImageData(imageData, 0, 0);

    ctx.strokeStyle = 'rgba(0,0,0,0.1)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(center, center, radius, 0, Math.PI * 2);
    ctx.stroke();
  }, [cmyk.k, totalInkLimit]); // Redraw when K or limit changes

  const setCanvasRef = useCallback((node: HTMLCanvasElement | null) => {
    canvasRef.current = node;
    if (node) {
      drawWheel();
    }
  }, [drawWheel]);

  useEffect(() => {
    if (activeTab === 'explorer') {
      drawWheel();
    }
  }, [drawWheel, activeTab]);

  const handlePointerDown = (e: React.PointerEvent) => {
    handlePointerMove(e);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (e.type !== 'pointerdown' && e.buttons !== 1) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const xRaw = e.clientX - rect.left;
    const yRaw = e.clientY - rect.top;
    
    const center = canvas.width / 2;
    const dx = xRaw - center;
    const dy = yRaw - center;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const radius = center - 5;

    // Clamping logic: keep selection within the radius
    let finalX = dx;
    let finalY = dy;
    let finalDist = dist;

    if (dist > radius) {
      const angleRad = Math.atan2(dy, dx);
      finalX = Math.cos(angleRad) * radius;
      finalY = Math.sin(angleRad) * radius;
      finalDist = radius;
    }

    const angle = (Math.atan2(finalY, finalX) * 180 / Math.PI + 360 + 90) % 360;
    const sat = (finalDist / radius) * 100;
    
    // 獲取受 TIC 限制的 CMY 數值
    const { c, m, y: y_val } = hueToCMY(angle, sat, cmyk.k);
    
    // 確保存入狀態的值是經過精確捨入的整數，避免浮點數造成的色偏
    setCmyk(prev => ({ 
      ...prev, 
      c: Math.round(c), 
      m: Math.round(m), 
      y: Math.round(y_val) 
    }));
    setSelectedPos({ x: finalX, y: finalY });
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(hex);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  return (
    <div className="min-h-screen bg-[#F0F0EE] text-[#141414] font-sans selection:bg-[#141414] selection:text-[#F0F0EE]">
      {/* Header */}
      <header className="border-b border-[#141414]/10 p-6 flex justify-between items-center bg-white/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-[#141414] flex items-center justify-center rounded-sm">
            <Palette className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-medium tracking-tight">CMYK 色彩探索器</h1>
            <p className="text-[10px] uppercase tracking-widest opacity-50 font-mono italic">精確色彩配置 (ISO 12647-2)</p>
          </div>
        </div>

        <nav className="flex bg-[#141414]/5 p-1 rounded-sm">
          <button 
            onClick={() => setActiveTab('explorer')}
            className={`px-4 py-2 text-[10px] uppercase tracking-widest font-mono transition-all rounded-[1px] flex items-center gap-2 ${activeTab === 'explorer' ? 'bg-white shadow-sm opacity-100' : 'opacity-40 hover:opacity-60'}`}
          >
            <Palette className="w-3 h-3" />
            色彩探索
          </button>
          <button 
            onClick={() => setActiveTab('image')}
            className={`px-4 py-2 text-[10px] uppercase tracking-widest font-mono transition-all rounded-[1px] flex items-center gap-2 ${activeTab === 'image' ? 'bg-white shadow-sm opacity-100' : 'opacity-40 hover:opacity-60'}`}
          >
            <ImageIcon className="w-3 h-3" />
            圖片處理
          </button>
        </nav>

        <div className="hidden md:flex gap-6 items-center">
            <div className="flex flex-col items-end text-right">
                <span className="text-[10px] uppercase tracking-widest opacity-40 font-mono">印刷參考</span>
                <span className="text-xs font-mono">ISO 12647-2 (FOGRA39)</span>
            </div>
            <div className="w-[1px] h-8 bg-[#141414]/10" />
            <button className="text-[10px] uppercase tracking-widest opacity-60 hover:opacity-100 transition-opacity flex items-center gap-2">
                <Info className="w-3 h-3" />
                資訊
            </button>
        </div>
      </header>

      <AnimatePresence mode="wait">
        {activeTab === 'explorer' ? (
          <motion.div 
            key="explorer"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.3 }}
          >
            <main className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 min-h-[calc(100vh-88px)]">
              {/* Left Pane: Interaction */}
              <section className="lg:col-span-8 p-8 flex flex-col items-center justify-center border-r border-[#141414]/10 bg-white/30 relative">
                {/* Ink Limit Setting */}
                <div className="absolute top-24 left-8 lg:left-12 z-40 space-y-4 max-w-[160px]">
                   <div className="flex justify-between items-end">
                      <label className="text-[9px] uppercase tracking-[0.2em] font-mono opacity-40">總墨量 TIC 限制</label>
                   </div>
                   <div className="relative group">
                      <input 
                          type="number"
                          min="0"
                          max="400"
                          value={totalInkLimit}
                          onChange={(e) => {
                              const val = parseInt(e.target.value);
                              setTotalInkLimit(isNaN(val) ? 0 : Math.min(400, val));
                          }}
                          onBlur={(e) => {
                              const val = parseInt(e.target.value);
                              if (isNaN(val) || val < 0) setTotalInkLimit(300);
                              if (val > 400) setTotalInkLimit(400);
                          }}
                          className="w-full bg-white border border-[#141414]/10 rounded-sm py-3 pl-4 pr-10 font-mono text-base focus:outline-none focus:border-[#141414]/30 focus:ring-4 focus:ring-[#141414]/2 transition-all shadow-sm"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-mono opacity-30 pointer-events-none">%</span>
                   </div>
                   <p className="text-[8px] opacity-30 leading-tight font-mono">標準商業印刷限制通常為 300%。色輪會依據此限制縮減顯示的飽和範圍。</p>
                </div>

                <div className="relative">
                  <motion.div 
                    className="relative p-2 bg-white rounded-full shadow-2xl shadow-black/5"
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ duration: 0.5 }}
                  >
                    <canvas
                      ref={setCanvasRef}
                      width={400}
                      height={400}
                      className="rounded-full cursor-crosshair touch-none relative z-10"
                      onPointerDown={handlePointerDown}
                      onPointerMove={handlePointerMove}
                    />
                    
                    {/* Selected Position Indicator */}
                    <motion.div 
                      className="absolute w-6 h-6 border-2 border-white rounded-full shadow-[0_0_10px_rgba(0,0,0,0.3)] pointer-events-none z-20 flex items-center justify-center"
                      style={{ 
                          left: '50%', 
                          top: '50%',
                      }}
                      animate={{ 
                          x: selectedPos.x - 12, // Offset by half width
                          y: selectedPos.y - 12, // Offset by half height
                      }}
                      transition={{ type: 'spring', damping: 25, stiffness: 300, mass: 0.5 }}
                    >
                      <div className="w-1 h-1 bg-white rounded-full" />
                    </motion.div>
                    
                    {/* Interaction Guide */}
                    <div className="absolute -inset-10 pointer-events-none flex items-center justify-center">
                       <div className="w-full h-full border border-dashed border-[#141414]/10 rounded-full animate-[spin_60s_linear_infinite]" />
                    </div>
                  </motion.div>
                </div>

                <div className="mt-16 w-full max-w-md space-y-8">
                  <div className="space-y-4">
                      <div className="flex justify-between items-end">
                          <label className="text-[10px] uppercase tracking-[0.2em] font-mono opacity-50 flex items-center gap-2">
                              <Sliders className="w-3 h-3" />
                              黑色通道 (K)
                          </label>
                          <span className="text-xl font-mono">{cmyk.k}%</span>
                      </div>
                      <input 
                        type="range"
                        min="0"
                        max="100"
                        value={cmyk.k}
                        onChange={(e) => setCmyk(prev => ({ ...prev, k: parseInt(e.target.value) }))}
                        className="w-full h-1.5 bg-[#141414]/10 rounded-full appearance-none cursor-pointer accent-[#141414]"
                      />
                      <div className="flex justify-between text-[8px] font-mono opacity-30 uppercase tracking-[0.2em]">
                          <span>淺 (Light)</span>
                          <span>深 (Density)</span>
                      </div>
                  </div>
                  
                  <div className="flex gap-4">
                      <button 
                          onClick={() => {
                              setCmyk({ c: 0, m: 0, y: 0, k: 0 });
                              setSelectedPos({ x: 0, y: 0 });
                          }}
                          className="flex-1 flex items-center justify-center gap-2 py-3 border border-[#141414]/10 rounded-sm hover:bg-white transition-all text-[10px] uppercase tracking-widest font-mono"
                      >
                          <RefreshCw className="w-3 h-3" /> 清除設定
                      </button>
                  </div>
                </div>
              </section>

              {/* Right Pane: Technical Data */}
              <aside className="lg:col-span-4 bg-white p-8 lg:p-12 space-y-12 overflow-y-auto">
                <div className="space-y-6">
                  <h2 className="text-sm font-mono uppercase tracking-[0.3em] opacity-40 italic">色彩結果 (Chromatic Result)</h2>
                  <motion.div 
                    className="aspect-video w-full rounded-sm shadow-inner relative group border border-[#141414]/10"
                    style={{ backgroundColor: hex }}
                    animate={{ backgroundColor: hex }}
                    transition={{ duration: 0.1 }}
                  >
                      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/5 backdrop-blur-[1px]">
                         <span className="text-[10px] font-mono tracking-widest bg-white/90 text-[#141414] px-4 py-2 rounded-sm uppercase shadow-sm">模擬油墨</span>
                      </div>
                  </motion.div>
                </div>

                <div className="space-y-8">
                  <h2 className="text-sm font-mono uppercase tracking-[0.3em] opacity-40 italic">減法色值 (Subtractive Values)</h2>
                  <div className="space-y-6">
                    {[
                      { label: '青色 (Cyan)', val: cmyk.c, color: 'bg-cyan-500' },
                      { label: '洋紅 (Magenta)', val: cmyk.m, color: 'bg-pink-500' },
                      { label: '黃色 (Yellow)', val: cmyk.y, color: 'bg-yellow-400' },
                      { label: '黑色 (Black)', val: cmyk.k, color: 'bg-[#141414]' },
                    ].map((item) => (
                      <div key={item.label} className="space-y-2">
                        <div className="flex justify-between items-end font-mono">
                          <span className="text-[10px] uppercase tracking-widest opacity-50">{item.label}</span>
                          <span className="text-xl font-medium">{item.val}%</span>
                        </div>
                        <div className="h-2 bg-[#141414]/5 rounded-sm overflow-hidden p-[1px]">
                          <motion.div 
                            className={`h-full rounded-sm ${item.color}`}
                            initial={{ width: 0 }}
                            animate={{ width: `${item.val}%` }}
                            transition={{ duration: 0.4, ease: "circOut" }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="pt-8 border-t border-[#141414]/10 space-y-6">
                  <h2 className="text-sm font-mono uppercase tracking-[0.3em] opacity-40 italic">十六進制轉換 (HEX)</h2>
                  <div 
                      className="bg-[#141414] text-white p-8 rounded-sm flex items-center justify-between group cursor-pointer transition-transform active:scale-[0.98]" 
                      onClick={copyToClipboard}
                  >
                      <div className="flex items-center gap-6">
                          <Hash className="w-6 h-6 opacity-30" />
                          <span className="text-4xl font-mono tracking-tighter">{hex.replace('#', '')}</span>
                      </div>
                      <AnimatePresence mode="wait">
                        {isCopied ? (
                          <motion.span 
                            key="copied"
                            initial={{ opacity: 0, x: 10 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: -10 }}
                            className="text-[9px] font-mono uppercase tracking-widest bg-white/20 px-3 py-1.5 rounded-sm"
                          >
                            已複製
                          </motion.span>
                        ) : (
                          <motion.div key="icon" className="opacity-30 group-hover:opacity-100 transition-opacity">
                              <Copy className="w-5 h-5" />
                          </motion.div>
                        )}
                      </AnimatePresence>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  {[
                      { l: '紅色 (R)', v: rgb.r },
                      { l: '綠色 (G)', v: rgb.g },
                      { l: '藍色 (B)', v: rgb.b },
                  ].map(item => (
                      <div key={item.l} className="p-4 border border-[#141414]/10 rounded-sm text-center bg-[#141414]/[0.01]">
                          <span className="block text-[8px] uppercase tracking-widest opacity-30 font-mono mb-2">{item.l}</span>
                          <span className="text-sm font-mono font-medium">{item.v}</span>
                      </div>
                  ))}
                </div>

                <footer className="text-[10px] font-mono uppercase tracking-widest opacity-20 pt-12 border-t border-[#141414]/5 space-y-2">
                  <p>© 2026 Studio Chromatica</p>
                  <p>非破壞性色彩映射配置已啟用</p>
                </footer>
              </aside>
            </main>

            {/* HEX to CMYK Inspector */}
            <section className="border-t border-[#141414]/10 bg-[#F8F8F6] p-8 lg:p-12">
              <div className="max-w-7xl mx-auto">
                <div className="flex flex-col lg:flex-row gap-12 items-start">
                  <div className="lg:w-1/3 space-y-4">
                    <h2 className="text-sm font-mono uppercase tracking-[0.3em] font-medium">HEX 轉 CMYK 檢查器</h2>
                    <p className="text-xs opacity-60 leading-relaxed max-w-sm">
                      貼上十六進制顏色代碼，分析其技術 CMYK 數值，並驗證其在標準減法色域下的可列印性。
                    </p>
                    <div className="relative pt-4">
                      <Hash className="absolute left-4 top-[2.1rem] w-4 h-4 opacity-30" />
                      <input 
                        type="text" 
                        placeholder="範例: #FF5733"
                        value={hexInput}
                        onChange={(e) => setHexInput(e.target.value)}
                        className="w-full bg-white border border-[#141414]/10 rounded-sm py-4 pl-12 pr-4 font-mono text-lg focus:outline-none focus:ring-2 focus:ring-[#141414]/5 transition-all uppercase"
                      />
                    </div>
                  </div>

                  <div className="flex-1 w-full">
                    <AnimatePresence mode="wait">
                      {inputCmyk ? (
                        <motion.div 
                          key="results"
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -10 }}
                          className="grid grid-cols-1 md:grid-cols-2 gap-8"
                        >
                          <div className="bg-white p-6 rounded-sm border border-[#141414]/10 shadow-sm space-y-6">
                            <div className="border-b border-black/5 pb-4">
                              <span className="text-[10px] font-mono uppercase tracking-widest opacity-40">色彩配置分析</span>
                            </div>
                            <div className="flex flex-col items-center gap-6">
                              <div 
                                className="w-16 h-16 rounded-sm border border-[#141414]/10 shadow-sm" 
                                style={{ backgroundColor: hexInput.startsWith('#') ? hexInput : `#${hexInput}` }} 
                              />
                              <div className="grid grid-cols-4 gap-4 w-full">
                                {[
                                  { l: 'C', v: inputCmyk.c },
                                  { l: 'M', v: inputCmyk.m },
                                  { l: 'Y', v: inputCmyk.y },
                                  { l: 'K', v: inputCmyk.k },
                                ].map(val => (
                                  <div key={val.l} className="text-center">
                                    <span className="block text-[8px] font-mono opacity-40 mb-1">{val.l}</span>
                                    <span className="text-xl font-mono font-medium">{val.v}%</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>

                          <div className="space-y-4">
                            {isOutofGamut ? (
                              <motion.div 
                                initial={{ scale: 0.95, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                className="bg-orange-50 border border-orange-200 p-6 rounded-sm space-y-4"
                              >
                                <div className="flex items-center gap-3 text-orange-800">
                                  <div className="p-1.5 bg-orange-100 rounded-full">
                                      <Info className="w-4 h-4" />
                                  </div>
                                  <span className="text-xs font-medium uppercase tracking-wider">超出色域警告</span>
                                </div>
                                <p className="text-xs text-orange-800/70 leading-relaxed font-mono tracking-tight">
                                  {gamutReason || "請求的顏色飽和度過高，無法使用標準 CMYK 油墨印刷。"}
                                </p>
                                <div className="pt-2 space-y-4">
                                   <span className="text-[9px] uppercase tracking-widest text-orange-900/40 font-mono block mb-1">建議的可列印替代方案</span>
                                   <div className="space-y-3">
                                      {suggestions.map((s, idx) => (
                                        <div key={idx} className="flex items-center gap-4 p-3 bg-white/50 border border-orange-900/10 rounded-sm group hover:bg-white transition-colors">
                                          <div className="w-12 h-12 rounded-sm shadow-sm border border-black/5 shrink-0" style={{ backgroundColor: s.hex }} />
                                          <div className="space-y-1 overflow-hidden">
                                              <div className="flex items-center gap-2">
                                                <span className="text-[9px] font-bold px-1.5 py-0.5 bg-orange-900/10 text-orange-900 rounded-[2px]">{s.label}</span>
                                                <span className="text-sm font-mono font-bold text-orange-900">{s.hex}</span>
                                              </div>
                                              <span className="block text-[8px] font-mono opacity-50 uppercase tracking-tighter truncate">
                                                  C:{s.cmyk.c} M:{s.cmyk.m} Y:{s.cmyk.y} K:{s.cmyk.k}
                                              </span>
                                          </div>
                                          <button 
                                            onClick={() => {
                                                navigator.clipboard.writeText(s.hex);
                                                const btn = document.getElementById(`suggestion-btn-${idx}`);
                                                if (btn) {
                                                  const originalText = btn.innerText;
                                                  btn.innerText = "已複製";
                                                  btn.style.backgroundColor = "#7c2d12";
                                                  btn.style.color = "white";
                                                  setTimeout(() => {
                                                    btn.innerText = originalText;
                                                    btn.style.backgroundColor = "";
                                                    btn.style.color = "";
                                                  }, 2000);
                                                }
                                            }}
                                            id={`suggestion-btn-${idx}`}
                                            className="ml-auto text-[8px] uppercase tracking-[0.2em] bg-orange-900/10 text-orange-900 px-3 py-2 rounded-sm hover:bg-orange-900 hover:text-white transition-all whitespace-nowrap min-w-[70px] text-center"
                                          >
                                            複製
                                          </button>
                                        </div>
                                      ))}
                                   </div>
                                </div>
                              </motion.div>
                            ) : (
                              <div className="bg-green-50 border border-green-200 p-6 rounded-sm flex items-center gap-4">
                                  <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center text-green-700">
                                      <Palette className="w-5 h-5" />
                                  </div>
                                  <div>
                                      <span className="block text-xs font-medium text-green-800 uppercase tracking-wider">可列印顏色 (安全)</span>
                                      <p className="text-[10px] text-green-800/60 font-mono">輸入數值在 CMYK 色域範圍內</p>
                                  </div>
                              </div>
                            )}
                          </div>
                        </motion.div>
                      ) : hexInput ? (
                        <div className="text-center lg:text-left py-12">
                           <span className="text-xs font-mono opacity-30 italic">等待有效的 6 位 RGB HEX 格式...</span>
                        </div>
                      ) : (
                         <div className="grid grid-cols-2 gap-4">
                            <div className="h-24 border border-dashed border-[#141414]/10 rounded-sm flex items-center justify-center">
                              <span className="text-[9px] uppercase tracking-widest opacity-20 font-mono">無主動輸入</span>
                            </div>
                         </div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>
              </div>
            </section>
          </motion.div>
        ) : (
          <motion.div
            key="image"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.3 }}
            className="flex-1 flex flex-col"
          >
            <ImageProcessingView />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

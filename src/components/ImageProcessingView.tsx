import React, { useState, useRef, useEffect } from 'react';
import { Upload, ImageIcon, RefreshCw, Sliders, ChevronRight } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface RGB {
  r: number;
  g: number;
  b: number;
}

interface CMYK {
  c: number;
  m: number;
  y: number;
  k: number;
}

// Utility functions (mirrored from App.tsx logic for consistency)
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

const cmykToRgb = (cmyk: CMYK): RGB => {
  const { c, m, y, k } = cmyk;
  const r = Math.round(255 * (1 - c / 100) * (1 - k / 100));
  const g = Math.round(255 * (1 - m / 100) * (1 - k / 100));
  const b = Math.round(255 * (1 - y / 100) * (1 - k / 100));
  return { r: Math.max(0, r), g: Math.max(0, g), b: Math.max(0, b) };
};

export default function ImageProcessingView() {
  const [totalInkLimit, setTotalInkLimit] = useState(300);
  const [originalImage, setOriginalImage] = useState<string | null>(null);
  const [processedImage, setProcessedImage] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const resultCanvasRef = useRef<HTMLCanvasElement>(null);

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setOriginalImage(event.target?.result as string);
        setProcessedImage(null);
      };
      reader.readAsDataURL(file);
    }
  };

  const processImage = () => {
    if (!originalImage || !canvasRef.current || !resultCanvasRef.current) return;

    setIsProcessing(true);
    setProgress(0);

    const img = new Image();
    img.onload = () => {
      const canvas = canvasRef.current!;
      const resultCanvas = resultCanvasRef.current!;
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      const resultCtx = resultCanvas.getContext('2d')!;

      // Resize logic to keep processing fast
      const maxDim = 800;
      let width = img.width;
      let height = img.height;
      if (width > height) {
        if (width > maxDim) {
          height *= maxDim / width;
          width = maxDim;
        }
      } else {
        if (height > maxDim) {
          width *= maxDim / height;
          height = maxDim;
        }
      }

      canvas.width = width;
      canvas.height = height;
      resultCanvas.width = width;
      resultCanvas.height = height;

      ctx.drawImage(img, 0, 0, width, height);
      const imageData = ctx.getImageData(0, 0, width, height);
      const data = imageData.data;
      const resultData = new Uint8ClampedArray(data.length);

      // Process pixels in chunks to avoid UI freeze and show progress
      const totalPixels = width * height;
      let currentPixel = 0;

      const processChunk = () => {
        const chunkSize = 100000; // Process 100k pixels at a time
        const end = Math.min(currentPixel + chunkSize, totalPixels);

        for (let i = currentPixel; i < end; i++) {
          const idx = i * 4;
          const r = data[idx];
          const g = data[idx + 1];
          const b = data[idx + 2];
          const a = data[idx + 3];

          // RGB -> CMYK
          const cmyk = rgbToCmyk({ r, g, b });
          
          // Apply TIC Limit
          const currentTotal = cmyk.c + cmyk.m + cmyk.y + cmyk.k;
          if (currentTotal > totalInkLimit) {
            const allowedCMY = Math.max(0, totalInkLimit - cmyk.k);
            const cmySum = cmyk.c + cmyk.m + cmyk.y;
            if (cmySum > 0) {
              const factor = allowedCMY / cmySum;
              cmyk.c *= factor;
              cmyk.m *= factor;
              cmyk.y *= factor;
            } else {
              cmyk.c = 0; cmyk.m = 0; cmyk.y = 0;
            }
          }

          // CMYK -> RGB
          const newRgb = cmykToRgb(cmyk);
          
          resultData[idx] = newRgb.r;
          resultData[idx + 1] = newRgb.g;
          resultData[idx + 2] = newRgb.b;
          resultData[idx + 3] = a;
        }

        currentPixel = end;
        setProgress(Math.round((currentPixel / totalPixels) * 100));

        if (currentPixel < totalPixels) {
          requestAnimationFrame(processChunk);
        } else {
          resultCtx.putImageData(new ImageData(resultData, width, height), 0, 0);
          setProcessedImage(resultCanvas.toDataURL());
          setIsProcessing(false);
        }
      };

      processChunk();
    };
    img.src = originalImage;
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[#F0F0EE]">
      {/* Settings Bar */}
      <div className="p-6 bg-white border-b border-[#141414]/10 flex flex-wrap items-center gap-8 shadow-sm">
        <div className="space-y-1">
          <label className="text-[10px] uppercase tracking-[0.2em] font-mono opacity-40 block">CMYK 總墨量限制 (TIC)</label>
          <div className="flex items-center gap-3">
            <div className="relative group w-24">
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
                className="w-full bg-white border border-[#141414]/10 rounded-sm py-1.5 pl-3 pr-8 font-mono text-sm focus:outline-none focus:border-[#141414]/30 transition-all shadow-sm"
              />
              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-mono opacity-30 pointer-events-none">%</span>
            </div>
          </div>
        </div>

        <div className="h-8 w-[1px] bg-[#141414]/10" />

        <div className="flex items-center gap-4">
          <button 
            onClick={() => document.getElementById('image-upload')?.click()}
            className="flex items-center gap-2 px-4 py-2 bg-[#141414] text-white rounded-sm text-[10px] uppercase tracking-widest hover:bg-[#141414]/90 transition-colors"
          >
            <Upload className="w-3.5 h-3.5" />
            上傳圖片
          </button>
          <input 
            id="image-upload"
            type="file" 
            accept="image/*" 
            className="hidden" 
            onChange={handleUpload}
          />
          
          <button 
            disabled={!originalImage || isProcessing}
            onClick={processImage}
            className="flex items-center gap-2 px-4 py-2 border border-[#141414]/10 rounded-sm text-[10px] uppercase tracking-widest hover:bg-white disabled:opacity-30 disabled:cursor-not-allowed transition-all"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isProcessing ? 'animate-spin' : ''}`} />
            執行轉換
          </button>
        </div>

        {isProcessing && (
          <div className="flex items-center gap-3 ml-auto text-xs font-mono opacity-60">
            <div className="w-32 h-1 bg-[#141414]/5 rounded-full overflow-hidden">
              <div 
                className="h-full bg-[#141414] transition-all duration-300" 
                style={{ width: `${progress}%` }} 
              />
            </div>
            <span>{progress}%</span>
          </div>
        )}
      </div>

      {/* Main Display */}
      <div className="flex-1 overflow-auto p-8 flex flex-col items-center justify-center gap-12">
        {!originalImage ? (
          <div 
            onClick={() => document.getElementById('image-upload')?.click()}
            className="w-full max-w-2xl aspect-video border-2 border-dashed border-[#141414]/10 rounded-sm flex flex-col items-center justify-center gap-4 cursor-pointer hover:bg-white/50 transition-colors group"
          >
            <div className="w-16 h-16 bg-[#141414]/5 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform">
              <ImageIcon className="w-8 h-8 opacity-20" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium">點擊或拖放圖片至此</p>
              <p className="text-[10px] uppercase tracking-widest opacity-40 font-mono mt-1 italic">支援 JPG, PNG, WebP</p>
            </div>
          </div>
        ) : (
          <div className="w-full max-w-7xl grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* Original */}
            <div className="space-y-3">
              <div className="flex justify-between items-end">
                <span className="text-[10px] uppercase tracking-widest font-mono opacity-50">原始圖檔 (RGB 原色)</span>
              </div>
              <div className="aspect-auto bg-white border border-[#141414]/10 rounded-sm overflow-hidden shadow-xl">
                <img src={originalImage} alt="Original" className="w-full h-auto object-contain" />
              </div>
            </div>

            {/* Processed or Comparison */}
            <div className="space-y-3">
              <div className="flex justify-between items-end">
                <span className="text-[10px] uppercase tracking-widest font-mono opacity-50">轉換後 (模擬 {totalInkLimit}% TIC)</span>
                {processedImage && (
                   <button 
                    onClick={() => {
                      const link = document.createElement('a');
                      link.download = 'cmyk-converted.png';
                      link.href = processedImage;
                      link.click();
                    }}
                    className="text-[10px] uppercase tracking-widest font-mono opacity-60 hover:opacity-100 transition-opacity"
                   >
                     下載圖片
                   </button>
                )}
              </div>
              <div className="aspect-auto bg-white border border-[#141414]/10 rounded-sm overflow-hidden shadow-xl relative min-h-[200px] flex items-center justify-center">
                {processedImage ? (
                  <img src={processedImage} alt="Processed" className="w-full h-auto object-contain" />
                ) : (
                  <div className="text-center px-8 space-y-4">
                    <div className="w-12 h-12 bg-[#141414]/5 rounded-full flex items-center justify-center mx-auto">
                      <RefreshCw className="w-5 h-5 opacity-20" />
                    </div>
                    <p className="text-xs opacity-40 font-mono italic">
                      {isProcessing ? '正在分析色域並重繪像素...' : '點擊「執行轉換」查看受墨量限制後的結果'}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Info Banner */}
        <div className="w-full max-w-4xl p-6 bg-white/50 border border-[#141414]/10 rounded-sm flex gap-6">
          <div className="p-3 bg-[#141414] text-white rounded-sm h-fit">
            <Sliders className="w-5 h-5" />
          </div>
          <div className="space-y-1">
            <h3 className="text-xs font-bold uppercase tracking-widest">關於圖片轉換邏輯</h3>
            <p className="text-xs leading-relaxed opacity-60">
              該工具透過像素級的色彩映射，將 RGB 圖資轉換為 CMYK 模型。當像素的總墨量 (TIC) 超過設定限制時，系統會動態壓縮其青、洋紅、黃色通道，
              同時維持黑色 (K) 通道以保留暗部細節。這可以模擬在高品質塗料紙 (TIC 300%) 或報紙 (TIC 220-240%) 上的實際轉印預期。
            </p>
          </div>
        </div>
      </div>

      {/* Hidden canvases for processing */}
      <canvas ref={canvasRef} className="hidden" />
      <canvas ref={resultCanvasRef} className="hidden" />
    </div>
  );
}
